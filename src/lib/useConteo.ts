"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crearClienteNavegador } from "./supabase/client";
import {
  borrarItem, guardarCatalogo, guardarItem, itemsDeConteo, leerCatalogo, obtenerItem,
  type ItemCola,
} from "./offline";
import { buscarPorSufijo, clasificar, type Clasificacion, type EntradaCatalogo } from "./clasificar";
import { errorVin, normalizarVin } from "./vin";
import { descargarServidor, sincronizar } from "./sync";

export interface ConteoInfo {
  id: string;
  localidad_id: string;
  localidad_nombre: string;
  status: "abierto" | "cerrado";
}

export type RespuestaRegistro =
  | { ok: false; error: string }
  | { ok: true; vin: string; clasificacion: Clasificacion; entrada?: EntradaCatalogo; client_id?: string };

export function useConteo(conteo: ConteoInfo) {
  const [catalogo, setCatalogo] = useState<Map<string, EntradaCatalogo>>(new Map());
  const [items, setItems] = useState<ItemCola[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [enLinea, setEnLinea] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [cerradoRemoto, setCerradoRemoto] = useState(conteo.status === "cerrado");
  const itemsRef = useRef<ItemCola[]>([]);
  itemsRef.current = items;
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargarItems = useCallback(async () => {
    setItems(await itemsDeConteo(conteo.id));
  }, [conteo.id]);

  const sincronizarYa = useCallback(async () => {
    setSincronizando(true);
    try {
      const r = await sincronizar(conteo.id);
      if (r.cerrado) setCerradoRemoto(true);
      setEnLinea(!r.sinRed);
    } finally {
      setSincronizando(false);
      await recargarItems();
    }
  }, [conteo.id, recargarItems]);

  const programarSync = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void sincronizarYa(), 800);
  }, [sincronizarYa]);

  // Carga inicial: catálogo (red si hay, si no el local), escaneos ya existentes y sincronización.
  useEffect(() => {
    let vivo = true;
    (async () => {
      setEnLinea(navigator.onLine);
      const local = await leerCatalogo();
      const tieneLocal = local.meta?.conteo_id === conteo.id && local.filas.length > 0;
      if (tieneLocal) setCatalogo(new Map(local.filas.map((f) => [f.vin, f])));

      if (navigator.onLine) {
        const sb = crearClienteNavegador();
        // Paginado: PostgREST entrega máx. 1000 filas por petición y el inventario puede superarlo.
        let filas: EntradaCatalogo[] | null = [];
        let errCat: string | null = null;
        for (let d = 0; filas; d += 1000) {
          const { data, error } = await sb.rpc("conteo_catalogo", { p_conteo: conteo.id }).order("vin").range(d, d + 999);
          if (error || !data) { errCat = error?.message ?? "No se pudo descargar el catálogo"; filas = null; break; }
          filas.push(...(data as EntradaCatalogo[]));
          if (data.length < 1000) break;
        }
        if (filas) {
          await guardarCatalogo(
            { conteo_id: conteo.id, localidad_id: conteo.localidad_id, descargado_en: new Date().toISOString() },
            filas,
          );
          const mapa = new Map(filas.map((f) => [f.vin, f] as const));
          if (vivo) setCatalogo(mapa);
        } else if (!tieneLocal && vivo) {
          setErrorCarga(errCat);
        }
        const remotos = await descargarServidor(conteo.id);
        if (remotos) {
          const locales = await itemsDeConteo(conteo.id);
          const conocidos = new Set(locales.map((l) => l.client_id));
          const vins = new Set(locales.map((l) => l.vin));
          for (const r of remotos) if (!conocidos.has(r.client_id) && !vins.has(r.vin)) await guardarItem(r);
        }
      } else if (!tieneLocal && vivo) {
        setErrorCarga("Sin red y sin catálogo guardado. Conéctate una vez para descargar las unidades de la localidad.");
      }
      if (vivo) {
        await recargarItems();
        setCargando(false);
        if (conteo.status === "abierto") void sincronizarYa();
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conteo.id]);

  // Red: al volver, sincroniza; mientras haya pendientes, reintenta cada 20 s.
  useEffect(() => {
    const alVolver = () => { setEnLinea(true); void sincronizarYa(); };
    const alPerder = () => setEnLinea(false);
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alPerder);
    const tick = setInterval(() => {
      if (navigator.onLine && itemsRef.current.some((i) => i.estado === "pendiente" || i.meta_sucia)) void sincronizarYa();
    }, 20000);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alPerder);
      clearInterval(tick);
    };
  }, [sincronizarYa]);

  const registrar = useCallback(
    async (crudo: string, metodo: "camara" | "manual"): Promise<RespuestaRegistro> => {
      const vin = normalizarVin(crudo);
      const err = errorVin(vin);
      if (err) return { ok: false, error: err };
      const entrada = catalogo.get(vin);
      const yaEscaneado = itemsRef.current.some((i) => i.vin === vin);
      const clasificacion = clasificar(entrada, conteo.localidad_id, yaEscaneado);
      if (clasificacion === "ya_escaneado") return { ok: true, vin, clasificacion, entrada };

      const item: ItemCola = {
        client_id: crypto.randomUUID(), conteo_id: conteo.id, vin, metodo,
        escaneado_en: new Date().toISOString(), resultado: clasificacion,
        estado: "pendiente", meta_sucia: false, ordinal: Date.now(),
      };
      await guardarItem(item);
      setItems((prev) => [...prev, item]);
      programarSync();
      return { ok: true, vin, clasificacion, entrada, client_id: item.client_id };
    },
    [catalogo, conteo.id, conteo.localidad_id, programarSync],
  );

  const quitar = useCallback(
    async (clientId: string): Promise<string | null> => {
      const it = await obtenerItem(clientId);
      if (!it) return null;
      if (it.estado === "enviado") {
        if (!navigator.onLine) return "Sin red: no se puede quitar un escaneo ya sincronizado";
        const { error } = await crearClienteNavegador().rpc("quitar_scan", { p_conteo: conteo.id, p_client_id: clientId });
        if (error) return error.message;
      }
      await borrarItem(clientId);
      await recargarItems();
      return null;
    },
    [conteo.id, recargarItems],
  );

  const anotar = useCallback(
    async (clientId: string, cambios: { observaciones?: string; foto?: Blob }) => {
      const it = await obtenerItem(clientId);
      if (!it) return;
      await guardarItem({ ...it, ...cambios, meta_sucia: true });
      await recargarItems();
      programarSync();
    },
    [recargarItems, programarSync],
  );

  const sugerencias = useCallback((texto: string) => buscarPorSufijo(catalogo.values(), texto), [catalogo]);

  const stats = useMemo(() => {
    let esperadasTotal = 0;
    for (const e of catalogo.values()) {
      if (e.localidad_id === conteo.localidad_id && e.status === "en_inventario") esperadasTotal++;
    }
    const por = { esperada: 0, otra_localidad: 0, sobrante: 0, facturada_en_patio: 0, vendida_en_patio: 0 };
    for (const i of items) por[i.resultado]++;
    return {
      total: items.length,
      ...por,
      esperadasTotal,
      faltan: Math.max(0, esperadasTotal - por.esperada),
      pendientes: items.filter((i) => i.estado === "pendiente" || i.meta_sucia).length,
      conError: items.filter((i) => i.estado === "error").length,
    };
  }, [items, catalogo, conteo.localidad_id]);

  return {
    catalogo, items, cargando, errorCarga, enLinea, sincronizando, stats,
    cerrado: cerradoRemoto,
    registrar, quitar, anotar, sugerencias, sincronizar: sincronizarYa,
  };
}
