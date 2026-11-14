// Sincronización de la cola local con Supabase. Idempotente: reintentar es seguro
// (el servidor deduplica por client_id y por (conteo, vin)).
import { crearClienteNavegador } from "./supabase/client";
import { borrarItem, guardarItem, itemsDeConteo, obtenerItem, type ItemCola } from "./offline";
import type { Resultado } from "./clasificar";

const LOTE = 50;
let enCurso: Promise<ResultadoSync> | null = null;

export interface ResultadoSync {
  enviados: number;
  errores: number;
  cerrado: boolean;      // la sesión ya estaba cerrada en el servidor
  sinRed: boolean;
}

interface RespuestaScan {
  client_id: string;
  vin: string;
  resultado?: Resultado;
  duplicado?: boolean;
  server_client_id?: string;
  error?: string;
}

export function sincronizar(conteoId: string): Promise<ResultadoSync> {
  if (!enCurso) enCurso = ejecutar(conteoId).finally(() => (enCurso = null));
  return enCurso;
}

async function ejecutar(conteoId: string): Promise<ResultadoSync> {
  const sb = crearClienteNavegador();
  const out: ResultadoSync = { enviados: 0, errores: 0, cerrado: false, sinRed: false };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ...out, sinRed: true };

  // 1) Insertar escaneos pendientes en lotes
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
        for (const it of lote) await guardarItem({ ...it, estado: "error", error: "Sin permiso en esta localidad" });
        out.errores += lote.length;
        continue;
      }
      return { ...out, sinRed: true }; // fallo de red/servidor: se reintenta luego
    }
    for (const r of (data ?? []) as RespuestaScan[]) {
      const it = lote.find((l) => l.client_id === r.client_id);
      if (!it) continue;
      if (r.error) {
        await guardarItem({ ...it, estado: "error", error: r.error });
        out.errores++;
      } else {
        if (r.duplicado && r.server_client_id) {
          // El VIN ya lo había registrado otro dispositivo: esta captura se funde con el registro
          // del servidor (se adopta su client_id para que "deshacer", notas y fotos apunten al real).
          await borrarItem(it.client_id);
          if (!(await obtenerItem(r.server_client_id))) {
            await guardarItem({ ...it, client_id: r.server_client_id, estado: "enviado", resultado: r.resultado ?? it.resultado });
          }
        } else {
          await guardarItem({ ...it, estado: "enviado", resultado: r.resultado ?? it.resultado, error: undefined });
        }
        out.enviados++;
      }
    }
  }

  // 2) Fotos y observaciones tardías de escaneos ya insertados
  const sucios = (await itemsDeConteo(conteoId)).filter((i) => i.estado === "enviado" && i.meta_sucia);
  for (const it of sucios) {
    try {
      let path = it.foto_path;
      if (it.foto && !path) {
        path = `${conteoId}/${it.client_id}.jpg`;
        // Sin upsert (no hay política de UPDATE en el bucket): si un intento anterior ya la subió,
        // "ya existe" cuenta como éxito y se continúa con el registro de la ruta.
        const { error } = await sb.storage.from("conteo-fotos").upload(path, it.foto, { contentType: "image/jpeg" });
        if (error && !/exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`)) throw error;
      }
      const { error } = await sb.rpc("actualizar_scan", {
        p_conteo: conteoId, p_client_id: it.client_id,
        p_foto_path: path ?? null, p_observaciones: it.observaciones ?? null,
      });
      if (error) throw error;
      await guardarItem({ ...it, foto_path: path, foto: undefined, meta_sucia: false });
    } catch {
      out.sinRed = true;
      break;
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
      .order("escaneado_en")
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
