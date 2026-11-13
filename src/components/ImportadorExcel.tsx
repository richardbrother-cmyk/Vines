"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { leerExcel, type HojaLeida } from "@/lib/excel";
import {
  CAMPOS_FIN, CAMPOS_SAP, FINANCIERAS, procesarFinanciera, procesarSAP, sugerirMapeo, type Mapeo,
} from "@/lib/importar";

type Tipo = "sap" | "financiera";
interface Ausentes {
  en_alcance: number; ausentes_total: number;
  ausentes: { vin: string; modelo: string | null; anio: number | null; segmento: string | null; division_sap: string | null; localidad: string | null }[];
}
const LOTE = 500;

export function ImportadorExcel({ mapeosGuardados }: { mapeosGuardados: Partial<Record<Tipo, Mapeo>> }) {
  const [tipo, setTipo] = useState<Tipo>("sap");
  const [financiera, setFinanciera] = useState<string>("");
  const [statusFijo, setStatusFijo] = useState<"" | "en_inventario" | "facturada_en_cartera" | "vendida">("");
  const [fechaReporte, setFechaReporte] = useState(new Date().toISOString().slice(0, 10));
  const [nombre, setNombre] = useState("");
  const [lectura, setLectura] = useState<HojaLeida | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo>({});
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const buffer = useRef<ArrayBuffer | null>(null);
  // Unidades que siguen "en inventario" en la base pero ya no vienen en el archivo SAP
  const [alcance, setAlcance] = useState<"divisiones" | "todo">("divisiones");
  const [ausentes, setAusentes] = useState<Ausentes | null>(null);
  const [errAus, setErrAus] = useState<string | null>(null);
  const [accion, setAccion] = useState<"" | "facturada_en_cartera" | "vendida">("");
  const [confirmarAus, setConfirmarAus] = useState(false);
  const [msgAus, setMsgAus] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const campos = tipo === "sap" ? CAMPOS_SAP : CAMPOS_FIN;

  function mapeoInicial(enc: string[], t: Tipo): Mapeo {
    const cs = t === "sap" ? CAMPOS_SAP : CAMPOS_FIN;
    const sugerido = sugerirMapeo(enc, cs);
    const guardado = mapeosGuardados[t] ?? {};
    // El mapeo guardado manda si esas columnas existen en el archivo; si no, la sugerencia.
    return Object.fromEntries(cs.map((c) => [c.clave, enc.includes(guardado[c.clave] ?? "\0") ? guardado[c.clave] : sugerido[c.clave]]));
  }

  async function cargar(archivo: File | undefined, hoja?: string, t: Tipo = tipo) {
    if (!archivo && !buffer.current) return;
    setError(null); setResultado(null);
    try {
      if (archivo) { buffer.current = await archivo.arrayBuffer(); setNombre(archivo.name); }
      const l = await leerExcel(buffer.current!, hoja);
      setLectura(l);
      setMapeo(mapeoInicial(l.encabezados, t));
    } catch (e) {
      setLectura(null);
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo (¿es .xlsx?)");
    }
  }

  const proc = useMemo(() => {
    if (!lectura || !mapeo.vin) return null;
    return tipo === "sap" ? procesarSAP(lectura.filas, mapeo, { statusFijo: statusFijo || undefined, fechaReporte }) : procesarFinanciera(lectura.filas, mapeo, financiera || undefined);
  }, [lectura, mapeo, tipo, financiera, statusFijo, fechaReporte]);

  // El archivo es una "foto" del inventario solo si sus unidades se cargan en inventario.
  const esFoto = tipo === "sap" && (statusFijo === "" || statusFijo === "en_inventario");
  const vinsArchivo = useMemo(() => (proc?.validas ?? []).map((v) => String(v.vin)), [proc]);
  const divisionesArchivo = useMemo(
    () => [...new Set((proc?.validas ?? []).map((v) => v.division_sap).filter((d): d is string => typeof d === "string" && d !== ""))],
    [proc],
  );
  const divisionesAlcance = alcance === "divisiones" && divisionesArchivo.length > 0 ? divisionesArchivo : null;

  useEffect(() => {
    if (!esFoto || vinsArchivo.length === 0) { setAusentes(null); setErrAus(null); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      const { data, error } = await crearClienteNavegador().rpc("unidades_ausentes", { p_vins: vinsArchivo, p_divisiones: divisionesAlcance });
      if (!vivo) return;
      if (error) { setErrAus(error.message); setAusentes(null); } else { setErrAus(null); setAusentes(data as Ausentes); }
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [esFoto, vinsArchivo, divisionesAlcance, recarga]);

  async function aplicarAusentes() {
    if (!accion) return;
    setConfirmarAus(false);
    const { data, error } = await crearClienteNavegador().rpc("marcar_ausentes", {
      p_vins: vinsArchivo, p_status: accion, p_divisiones: divisionesAlcance,
    });
    if (error) { setErrAus(error.message); return; }
    setMsgAus(`${data} unidades marcadas como ${accion === "vendida" ? "vendidas / con salida" : "facturadas en cartera"}.`);
    setAccion("");
    setRecarga((n) => n + 1);
  }

  const listo = !!proc && proc.validas.length > 0 && (tipo === "sap" || !!financiera || !!mapeo.financiera);

  async function importar() {
    if (!proc || !lectura) return;
    setError(null); setResultado(null);
    const sb = crearClienteNavegador();
    const fn = tipo === "sap" ? "importar_unidades" : "importar_financiamientos";
    let ins = 0, upd = 0;
    const omitidas: string[] = [];
    let fallo: string | null = null;
    for (let i = 0; i < proc.validas.length; i += LOTE) {
      setProgreso(`Importando ${Math.min(i + LOTE, proc.validas.length)} de ${proc.validas.length}…`);
      const { data, error } = await sb.rpc(fn, { p_filas: proc.validas.slice(i, i + LOTE) });
      if (error) { fallo = error.message; break; }
      const r = data as { insertadas: number; actualizadas: number; omitidas_sin_unidad?: string[] };
      ins += r.insertadas; upd += r.actualizadas; omitidas.push(...(r.omitidas_sin_unidad ?? []));
    }
    const errores = [
      ...proc.errores,
      ...omitidas.map((vin) => ({ fila: 0, vin, error: "VIN no existe en inventario (cárgalo primero desde SAP)" })),
      ...(fallo ? [{ fila: 0, vin: "", error: `Carga interrumpida: ${fallo}` }] : []),
    ].slice(0, 500);
    await sb.from("cargas").insert({
      tipo, archivo: nombre, filas_total: lectura.filas.length, insertadas: ins, actualizadas: upd, errores,
    });
    if (!fallo) await sb.from("mapeos_columnas").upsert({ tipo, mapeo, actualizado_en: new Date().toISOString() });
    setProgreso(null);
    if (fallo) setError(`Se interrumpió: ${fallo}. Lo ya importado quedó guardado (reintentar es seguro).`);
    setResultado(`Listo: ${ins} nuevas, ${upd} actualizadas, ${proc.errores.length} filas con error${omitidas.length ? `, ${omitidas.length} VIN no existen en inventario` : ""}.`);
  }

  const sel = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["sap", "financiera"] as Tipo[]).map((t) => (
          <button key={t} onClick={() => { setTipo(t); if (lectura) setMapeo(mapeoInicial(lectura.encabezados, t)); setResultado(null); }}
            className={`rounded-xl py-3 font-semibold ${tipo === t ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800"}`}>
            {t === "sap" ? "Inventario SAP" : "Estado de cuenta financiera"}
          </button>
        ))}
      </div>

      {tipo === "financiera" && (
        <label className="block text-sm">Financiera de este archivo
          <select value={financiera} onChange={(e) => setFinanciera(e.target.value)} className={sel}>
            <option value="">(tomarla de una columna del archivo)</option>
            {FINANCIERAS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      )}

      {tipo === "sap" && (
        <label className="block text-sm">Status de las unidades de este archivo
          <select value={statusFijo} onChange={(e) => setStatusFijo(e.target.value as typeof statusFijo)} className={sel}>
            <option value="">Según la columna de status (o “en inventario” si no hay)</option>
            <option value="en_inventario">Todas en inventario</option>
            <option value="facturada_en_cartera">Todas facturadas en cartera</option>
            <option value="vendida">Todas vendidas / con salida</option>
          </select>
        </label>
      )}

      <input type="file" accept=".xlsx" onChange={(e) => void cargar(e.target.files?.[0], undefined, tipo)}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:px-4 file:py-2" />
      {error && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}

      {lectura && (
        <>
          {lectura.hojas.length > 1 && (
            <label className="block text-sm">Hoja
              <select value={lectura.hoja} onChange={(e) => void cargar(undefined, e.target.value)} className={sel}>
                {lectura.hojas.map((h) => <option key={h}>{h}</option>)}
              </select>
            </label>
          )}

          <section>
            <h3 className="font-semibold mb-1">Mapeo de columnas</h3>
            <p className="text-xs text-slate-500 mb-2">Sugerido automáticamente; se guarda para la próxima carga.</p>
            {tipo === "sap" && mapeo.antiguedad_dias && !mapeo.fecha_alta_inventario && (
              <label className="block text-sm mb-2">Fecha del reporte (alta = esta fecha − antigüedad en días)
                <input type="date" value={fechaReporte} onChange={(e) => setFechaReporte(e.target.value)} className={sel} />
              </label>
            )}
            <div className="space-y-2">
              {campos.map((c) => (
                <label key={c.clave} className="grid grid-cols-2 gap-2 items-center text-sm">
                  <span>{c.etiqueta}{c.requerido && " *"}</span>
                  <select value={mapeo[c.clave] ?? ""} onChange={(e) => setMapeo({ ...mapeo, [c.clave]: e.target.value })} className={sel}>
                    <option value="">— sin mapear —</option>
                    {lectura.encabezados.map((h) => <option key={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          {proc && (
            <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-sm space-y-2">
              <h3 className="font-semibold">Vista previa</h3>
              <p>{lectura.filas.length} filas leídas · <b>{proc.validas.length} válidas</b> · {proc.errores.length} con error
                {proc.duplicadas > 0 && ` · ${proc.duplicadas} VIN repetidos (gana la última fila)`}
                {proc.vinsCorregidos > 0 && ` · ${proc.vinsCorregidos} VIN corregidos (O→0, I→1, sufijos)`}</p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead><tr>{Object.keys(proc.validas[0] ?? {}).map((k) => <th key={k} className="text-left pr-3 py-1 text-slate-500">{k}</th>)}</tr></thead>
                  <tbody>
                    {proc.validas.slice(0, 5).map((f, i) => (
                      <tr key={i}>{Object.values(f).map((v, j) => <td key={j} className="pr-3 py-1 whitespace-nowrap">{v == null ? "—" : String(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {proc.sinReconocer && Object.entries(proc.sinReconocer).map(([campo, vals]) => (
                <p key={campo} className="rounded-lg bg-amber-50 text-amber-900 p-2 text-xs">
                  Valores de “{campo}” sin reconocer (quedan vacíos): {Object.entries(vals).map(([v, n]) => `${v} (${n})`).join(", ")}
                </p>
              ))}
              {proc.errores.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-red-700">Ver errores ({proc.errores.length})</summary>
                  <ul className="mt-1 text-xs">{proc.errores.slice(0, 50).map((e, i) => <li key={i}>Fila {e.fila}: {e.vin || "—"} — {e.error}</li>)}</ul>
                </details>
              )}
              {tipo === "sap" && <p className="text-xs text-slate-500">Las unidades que no vengan en el archivo no se modifican. Los campos vacíos no borran datos. La localidad solo se asigna (por división) a unidades nuevas o sin ubicación.</p>}
            </section>
          )}


          {esFoto && ausentes && ausentes.ausentes_total > 0 && (
            <section className={`rounded-2xl border p-4 text-sm space-y-3 ${ausentes.ausentes_total > 0.3 * ausentes.en_alcance && ausentes.en_alcance > 20 ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
              <h3 className="font-semibold">{ausentes.ausentes_total} unidades ya no vienen en este archivo</h3>
              <p>
                Siguen como “en inventario” en la base ({ausentes.ausentes_total} de {ausentes.en_alcance}
                {divisionesAlcance ? ` en las divisiones ${divisionesAlcance.join(", ")}` : " en todo el inventario"}).
                Probablemente se facturaron o se vendieron.
                {ausentes.ausentes_total > 0.3 * ausentes.en_alcance && ausentes.en_alcance > 20 && " Es una proporción alta: ¿el archivo está incompleto o es de una sola plaza?"}
              </p>
              {divisionesArchivo.length > 0 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={alcance === "todo"} onChange={(e) => setAlcance(e.target.checked ? "todo" : "divisiones")} />
                  Comparar contra todo el inventario (no solo las divisiones que trae el archivo)
                </label>
              )}
              <details>
                <summary className="cursor-pointer">Ver unidades{ausentes.ausentes_total > ausentes.ausentes.length ? ` (primeras ${ausentes.ausentes.length})` : ""}</summary>
                <ul className="mt-1 text-xs space-y-0.5">
                  {ausentes.ausentes.map((u) => (
                    <li key={u.vin}><Link href={`/unidades/${u.vin}`} className="font-mono underline" target="_blank">{u.vin}</Link> {u.modelo} {u.anio} · div. {u.division_sap ?? "—"} · {u.localidad ?? "sin ubicación"}</li>
                  ))}
                </ul>
              </details>
              <label className="block">¿Qué hago con ellas?
                <select value={accion} onChange={(e) => { setAccion(e.target.value as typeof accion); setConfirmarAus(false); }} className={sel + " text-slate-900"}>
                  <option value="">Nada por ahora (siguen en inventario)</option>
                  <option value="facturada_en_cartera">Marcarlas como facturadas en cartera</option>
                  <option value="vendida">Marcarlas como vendidas / con salida</option>
                </select>
              </label>
              {accion && !confirmarAus && (
                <button onClick={() => setConfirmarAus(true)} className="w-full rounded-xl bg-slate-900 text-white py-2 font-semibold">
                  Aplicar a {ausentes.ausentes_total} unidades
                </button>
              )}
              {accion && confirmarAus && (
                <div className="flex gap-2">
                  <button onClick={() => setConfirmarAus(false)} className="flex-1 rounded-xl bg-white text-slate-900 py-2">Cancelar</button>
                  <button onClick={() => void aplicarAusentes()} className="flex-1 rounded-xl bg-red-600 text-white py-2 font-semibold">Sí, cambiar status</button>
                </div>
              )}
            </section>
          )}
          {esFoto && ausentes && ausentes.ausentes_total === 0 && vinsArchivo.length > 0 && (
            <p className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">Todas las unidades en inventario de la base vienen en este archivo.</p>
          )}
          {errAus && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">No se pudo comparar contra la base: {errAus}</p>}
          {msgAus && <p className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{msgAus}</p>}

          <button onClick={() => void importar()} disabled={!listo || !!progreso}
            className="w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold disabled:opacity-40">
            {progreso ?? `Importar ${proc?.validas.length ?? 0} filas`}
          </button>
          {tipo === "financiera" && !financiera && !mapeo.financiera && <p className="text-xs text-amber-700">Elige la financiera o mapea una columna que la contenga.</p>}
        </>
      )}
      {resultado && <p className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{resultado}</p>}
    </div>
  );
}
