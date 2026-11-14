// Sincronización de la cola local con Supabase. Idempotente: reintentar es seguro
// (el servidor deduplica por client_id y por (conteo, vin)).
import { crearClienteNavegador } from "./supabase/client";
import { actualizarItem, borrarItem, guardarItem, itemsDeConteo, obtenerItem, type ItemCola } from "./offline";
import type { Resultado } from "./clasificar";

const LOTE = 50;
let enCurso: Promise<ResultadoSync> | null = null;

export interface ResultadoSync {
  enviados: number;
  errores: number;
  cerrado: boolean;      // la sesión ya estaba cerrada en el servidor
  sinRed: boolean;
  sinSesion: boolean;    // la sesión del usuario venció: hay que volver a entrar
}

interface RespuestaScan {
  client_id: string;
  vin: string;
  resultado?: Resultado;
  duplicado?: boolean;
  server_client_id?: string;
  error?: string;
}

const esAuth = (m: string) => /JWT|permission denied|not authenticated|401/i.test(m);

export function sincronizar(conteoId: string): Promise<ResultadoSync> {
  if (!enCurso) enCurso = ejecutar(conteoId).finally(() => (enCurso = null));
  return enCurso;
}

async function ejecutar(conteoId: string): Promise<ResultadoSync> {
  const sb = crearClienteNavegador();
  const out: ResultadoSync = { enviados: 0, errores: 0, cerrado: false, sinRed: false, sinSesion: false };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ...out, sinRed: true };

  // 1) Insertar escaneos pendientes (y reintentar los que quedaron en error) en lotes
  const pendientes = (await itemsDeConteo(conteoId)).filter((i) => i.estado !== "enviado");
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const { data, error } = await sb.rpc("registrar_scans", {
      p_conteo: conteoId,
      p_scans: lote.map((l) => ({
        client_id: l.client_id, vin: l.vin, escaneado_en: l.escaneado_en,
        metodo: l.metodo, observaciones: l.observaciones ?? "",
      })),
    });
    if (error) {
      if (error.message.includes("conteo_cerrado")) return { ...out, cerrado: true };
      if (error.message.includes("sin_permiso")) {
        for (const it of lote) await actualizarItem(it.client_id, (a) => ({ ...a, estado: "error", error: "Sin permiso en esta localidad" }));
        out.errores += lote.length;
        continue;
      }
      if (esAuth(error.message)) return { ...out, sinSesion: true };
      return { ...out, sinRed: true }; // fallo de red/servidor: se reintenta luego
    }
    for (const r of (data ?? []) as RespuestaScan[]) {
      if (r.error) {
        await actualizarItem(r.client_id, (a) => ({ ...a, estado: "error", error: r.error }));
        out.errores++;
        continue;
      }
      if (r.duplicado && r.server_client_id) {
        // El VIN ya lo registró otro dispositivo: esta captura se funde con el registro del servidor
        // (se adopta su client_id para que "deshacer", notas y fotos apunten al real). Se relee el
        // item por si el usuario le agregó foto/nota mientras la petición estaba en vuelo.
        const actual = await obtenerItem(r.client_id);
        await borrarItem(r.client_id);
        if (actual) {
          const existente = await obtenerItem(r.server_client_id);
          const tieneMeta = !!actual.foto || !!actual.observaciones;
          await guardarItem({
            ...(existente ?? actual), client_id: r.server_client_id, estado: "enviado",
            resultado: r.resultado ?? actual.resultado, error: undefined,
            ...(tieneMeta ? { foto: actual.foto, foto_nombre: actual.foto_nombre, observaciones: actual.observaciones ?? existente?.observaciones, meta_sucia: true } : {}),
          });
        }
      } else {
        // Solo se tocan estado/resultado: foto y nota agregadas durante la petición se conservan.
        await actualizarItem(r.client_id, (a) => ({ ...a, estado: "enviado", resultado: r.resultado ?? a.resultado, error: undefined }));
      }
      out.enviados++;
    }
  }

  // 2) Fotos y observaciones de escaneos ya insertados
  const sucios = (await itemsDeConteo(conteoId)).filter((i) => i.estado === "enviado" && i.meta_sucia);
  for (const it of sucios) {
    try {
      let path = it.foto_path;
      const fotoSubida = it.foto;
      if (fotoSubida) {
        path = `${conteoId}/${it.foto_nombre ?? `${it.client_id}.jpg`}`;
        // Sin upsert (el bucket no permite sobrescribir): si un intento anterior ya la subió,
        // "ya existe" cuenta como éxito y se continúa con el registro de la ruta.
        const { error } = await sb.storage.from("conteo-fotos").upload(path, fotoSubida, { contentType: "image/jpeg" });
        if (error && !/exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`)) throw error;
      }
      const notaEnviada = it.observaciones;
      const { error } = await sb.rpc("actualizar_scan", {
        p_conteo: conteoId, p_client_id: it.client_id,
        p_foto_path: path ?? null, p_observaciones: notaEnviada ?? null,
      });
      if (error) throw error;
      // Solo se da por limpio si el usuario no cambió foto/nota mientras tanto.
      await actualizarItem(it.client_id, (a) => {
        const sinCambios = a.foto === fotoSubida && a.observaciones === notaEnviada;
        return sinCambios
          ? { ...a, foto_path: path, foto: undefined, foto_nombre: undefined, meta_sucia: false }
          : { ...a, foto_path: a.foto === fotoSubida ? path : a.foto_path };
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      if (/conteo_cerrado|sin_permiso|row-level security/i.test(m)) {
        // Error permanente: no tiene caso reintentar. Se avisa en el item y se sigue con los demás.
        await actualizarItem(it.client_id, (a) => ({ ...a, meta_sucia: false, error: "La foto/nota no se guardó (sesión cerrada o sin permiso)" }));
        if (m.includes("conteo_cerrado")) out.cerrado = true;
        out.errores++;
      } else if (esAuth(m)) {
        out.sinSesion = true;
        break;
      } else {
        out.sinRed = true; // transitorio: se reintenta en la siguiente vuelta, sin frenar a los demás
      }
    }
  }
  return out;
}

export async function descargarServidor(conteoId: string): Promise<ItemCola[] | null> {
  // Trae lo que ya existe en la sesión (otros dispositivos / reinstalaciones) para el "ya escaneado".
  const sb = crearClienteNavegador();
  const filas: { client_id: string; vin: string; escaneado_en: string; resultado: Resultado;
                 metodo: "camara" | "manual"; observaciones: string | null; foto_path: string | null }[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("conteo_detalle")
      .select("client_id,vin,escaneado_en,resultado,metodo,observaciones,foto_path")
      .eq("conteo_id", conteoId)
      .order("escaneado_en").order("client_id")
      .range(desde, desde + 999);
    if (error) return null;
    filas.push(...(data as typeof filas));
    if (!data || data.length < 1000) break;
  }
  return filas.map((f) => ({
    client_id: f.client_id, conteo_id: conteoId, vin: f.vin, escaneado_en: f.escaneado_en,
    metodo: f.metodo, resultado: f.resultado, observaciones: f.observaciones ?? undefined,
    foto_path: f.foto_path ?? undefined, estado: "enviado" as const, meta_sucia: false,
    ordinal: Date.parse(f.escaneado_en),
  }));
}
