"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CamaraScanner } from "./CamaraScanner";
import { useConteo, type ConteoInfo, type RespuestaRegistro } from "@/lib/useConteo";
import { ETIQUETA, type Clasificacion, type EntradaCatalogo } from "@/lib/clasificar";
import { avisar } from "@/lib/feedback";
import { reducirImagen } from "@/lib/imagen";
import { errorVin, normalizarVin } from "@/lib/vin";
import { NOMBRE_CACHE } from "@/lib/offline";

const COLOR: Record<Clasificacion, string> = {
  esperada: "bg-emerald-600 text-white",
  otra_localidad: "bg-amber-500 text-black",
  sobrante: "bg-red-600 text-white",
  facturada_en_patio: "bg-violet-600 text-white",
  vendida_en_patio: "bg-rose-700 text-white",
  ya_escaneado: "bg-sky-600 text-white",
};
const PUNTO: Record<Clasificacion, string> = {
  esperada: "bg-emerald-500", otra_localidad: "bg-amber-500", sobrante: "bg-red-500",
  facturada_en_patio: "bg-violet-500", vendida_en_patio: "bg-rose-600", ya_escaneado: "bg-sky-500",
};

type Ultimo = Extract<RespuestaRegistro, { ok: true }>;
type Filtro = "todas" | "esperada" | "otras";

export function PantallaConteo({ conteo }: { conteo: ConteoInfo }) {
  const c = useConteo(conteo);
  const [texto, setTexto] = useState("");
  const [msgError, setMsgError] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const antiRebote = useRef({ vin: "", t: 0 });
  const cerrado = c.cerrado;

  // Con red: deja guardadas esta pantalla y el lector de códigos para poder reanudar o abrir la
  // cámara sin señal (p. ej. si el teléfono recarga la pestaña al tomar una foto).
  useEffect(() => {
    if (!navigator.onLine || process.env.NODE_ENV !== "production") return;
    void import("html5-qrcode").catch(() => {});
    if ("caches" in window) void caches.open(NOMBRE_CACHE).then((k) => k.add(location.pathname)).catch(() => {});
  }, []);

  const procesar = useCallback(
    async (crudo: string, metodo: "camara" | "manual") => {
      const r = await c.registrar(crudo, metodo);
      if (!r.ok) {
        setMsgError(r.error);
        avisar("error");
        return;
      }
      setMsgError(null);
      setUltimo(r);
      setNota(null);
      avisar(r.clasificacion);
    },
    [c],
  );

  const alLeerCamara = useCallback(
    (crudo: string) => {
      const vin = normalizarVin(crudo);
      const ahora = Date.now();
      if (vin === antiRebote.current.vin && ahora - antiRebote.current.t < 2500) return;
      if (errorVin(vin)) return; // lecturas parciales/ruido: se ignoran sin molestar
      antiRebote.current = { vin, t: ahora };
      void procesar(vin, "camara");
    },
    [procesar],
  );

  const sugeridas = useMemo(() => (texto.length >= 4 && texto.length < 17 ? c.sugerencias(texto) : []), [texto, c]);

  const lista = useMemo(() => {
    const inv = [...c.items].reverse();
    if (filtro === "esperada") return inv.filter((i) => i.resultado === "esperada");
    if (filtro === "otras") return inv.filter((i) => i.resultado !== "esperada");
    return inv;
  }, [c.items, filtro]);

  async function enviarManual(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    await procesar(texto, "manual");
    setTexto("");
  }

  async function subirFoto(f: File | undefined) {
    if (!f || !ultimo?.client_id) return;
    await c.anotar(ultimo.client_id, { foto: await reducirImagen(f) });
  }

  if (c.cargando) return <p className="p-6 text-center text-slate-500">Descargando unidades de {conteo.localidad_nombre}…</p>;
  if (c.errorCarga) return <p className="p-6 text-center text-red-600">{c.errorCarga}</p>;

  const entrada: EntradaCatalogo | undefined = ultimo?.entrada;

  return (
    <div className="mx-auto max-w-xl pb-28">
      <header className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-2">
        <Link href="/conteos" className="text-slate-500 text-lg" aria-label="Volver">←</Link>
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{conteo.localidad_nombre}</p>
          <p className="text-xs text-slate-500">Conteo físico {cerrado ? "· cerrado" : "· abierto"}</p>
        </div>
        <button onClick={() => void c.sincronizar()} className={`text-xs rounded-full px-3 py-1 ${c.enLinea ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {c.sincronizando ? "Sincronizando…" : c.enLinea ? "En línea" : "Sin red"}
          {c.stats.pendientes > 0 && ` · ${c.stats.pendientes} pend.`}
        </button>
      </header>

      <section className="grid grid-cols-4 gap-2 p-4 text-center">
        <Contador n={c.stats.total} t="Escaneadas" />
        <Contador n={`${c.stats.esperada}/${c.stats.esperadasTotal}`} t="Esperadas" />
        <Contador n={c.stats.faltan} t="Faltan" />
        <Contador n={c.stats.sobrante + c.stats.otra_localidad + c.stats.facturada_en_patio + c.stats.vendida_en_patio} t="Otras" />
      </section>

      {c.sinSesion && (
        <p className="mx-4 mb-3 rounded-lg bg-red-50 text-red-800 text-sm p-3">
          Tu sesión venció y los escaneos no se están sincronizando (siguen guardados en el teléfono).{" "}
          <a href="/login" className="underline font-medium">Vuelve a entrar</a> y regresa a este conteo.
        </p>
      )}
      {c.stats.conError > 0 && (
        <p className="mx-4 mb-3 rounded-lg bg-red-50 text-red-800 text-sm p-3">
          {c.stats.conError} escaneo(s) con ⚠️ no se han podido registrar (se reintentan solos). Si es un permiso de la
          localidad, pide que te la asignen; si no, quítalos de la lista. No se puede cerrar el conteo mientras existan.
        </p>
      )}

      {cerrado ? (
        <div className="mx-4 rounded-xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
          <p className="mb-2">Esta sesión ya fue cerrada.</p>
          {c.stats.sinSincronizar > 0 && (
            <p className="mb-2 text-red-700 text-sm">
              {c.stats.sinSincronizar} escaneo(s) de este teléfono no alcanzaron a sincronizarse antes del cierre y NO quedaron en el conteo. Avisa al responsable: se corrigen con una nueva sesión.
            </p>
          )}
          <Link className="underline font-medium" href={`/conteos/${conteo.id}/reporte`}>Ver reporte de diferencias</Link>
        </div>
      ) : (
        <>
          {ultimo && (
            <section className={`mx-4 rounded-2xl p-4 ${COLOR[ultimo.clasificacion]}`}>
              <p className="text-sm opacity-90">{ETIQUETA[ultimo.clasificacion]}</p>
              <p className="font-mono text-xl tracking-wide break-all">{ultimo.vin}</p>
              <p className="text-sm">
                {entrada ? `${entrada.modelo ?? "—"} ${entrada.anio ?? ""} · ${entrada.segmento ?? ""}` : "Sin datos en inventario"}
                {ultimo.clasificacion === "otra_localidad" && ` · ubicada en: ${entrada?.localidad_nombre ?? "sin ubicación"}`}
              </p>
              {ultimo.client_id && (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <label className="rounded-lg bg-white/25 px-3 py-1.5 cursor-pointer">
                    Foto
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void subirFoto(e.target.files?.[0])} />
                  </label>
                  <button className="rounded-lg bg-white/25 px-3 py-1.5" onClick={() => setNota(nota === null ? "" : null)}>Nota</button>
                  <button
                    className="rounded-lg bg-black/30 px-3 py-1.5"
                    onClick={async () => {
                      const e = await c.quitar(ultimo.client_id!);
                      if (e) setMsgError(e); else setUltimo(null);
                    }}
                  >
                    Deshacer
                  </button>
                </div>
              )}
              {nota !== null && ultimo.client_id && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={async (e) => { e.preventDefault(); await c.anotar(ultimo.client_id!, { observaciones: nota }); setNota(null); }}
                >
                  <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observación (golpe, falta llanta…)"
                    className="flex-1 rounded-lg px-3 py-2 text-black" />
                  <button className="rounded-lg bg-black/40 px-3">Guardar</button>
                </form>
              )}
            </section>
          )}

          {msgError && <p className="mx-4 mt-3 rounded-lg bg-red-50 text-red-800 text-sm p-3">{msgError}</p>}

          <section className="p-4 space-y-3">
            {camara ? (
              <CamaraScanner onLectura={alLeerCamara} onCerrar={() => setCamara(false)} />
            ) : (
              <button onClick={() => setCamara(true)} className="w-full rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-4 text-lg font-semibold">
                Escanear con cámara
              </button>
            )}

            <form onSubmit={enviarManual} className="space-y-2">
              <label className="text-sm text-slate-500" htmlFor="vin">Captura manual (VIN completo o últimos 4–8 dígitos)</label>
              <div className="flex gap-2">
                <input
                  id="vin" value={texto} onChange={(e) => { setTexto(e.target.value.toUpperCase()); setMsgError(null); }}
                  autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
                  inputMode="text" maxLength={24} placeholder="Ej. MA0001"
                  className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-3 font-mono text-lg"
                />
                <button className="rounded-xl bg-emerald-600 text-white px-5 font-semibold disabled:opacity-40" disabled={normalizarVin(texto).length < 17}>
                  Registrar
                </button>
              </div>
              {sugeridas.length > 0 && (
                <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
                  {sugeridas.map((s) => (
                    <li key={s.vin}>
                      <button type="button" className="w-full text-left px-3 py-2" onClick={async () => { await procesar(s.vin, "manual"); setTexto(""); }}>
                        <span className="font-mono">{s.vin}</span>
                        <span className="block text-xs text-slate-500">{s.modelo} · {s.localidad_nombre ?? "sin ubicación"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {texto.length >= 4 && texto.length < 17 && sugeridas.length === 0 && (
                <p className="text-xs text-slate-500">Sin coincidencias en el catálogo. Si es una unidad nueva, escribe los 17 caracteres para registrarla como sobrante.</p>
              )}
            </form>
          </section>
        </>
      )}

      <section className="px-4">
        <div className="flex gap-2 mb-2 text-sm">
          {(["todas", "esperada", "otras"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className={`rounded-full px-3 py-1 ${filtro === f ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800"}`}>
              {f === "todas" ? "Todas" : f === "esperada" ? "Esperadas" : "Otras"}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {lista.slice(0, 100).map((i) => (
            <li key={i.client_id} className="py-2 flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full shrink-0 ${PUNTO[i.resultado]}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{i.vin}</p>
                <p className="text-xs text-slate-500 truncate">
                  {c.catalogo.get(i.vin)?.modelo ?? "Sobrante"} · {ETIQUETA[i.resultado]}
                  {i.observaciones ? ` · “${i.observaciones}”` : ""}{(i.foto || i.foto_path) ? " · 📷" : ""}
                </p>
              </div>
              {i.estado === "error" && !cerrado && (
                <button className="text-xs underline text-red-700" onClick={async () => { const e = await c.quitar(i.client_id); if (e) setMsgError(e); }}>Quitar</button>
              )}
              <span className="text-xs text-slate-400" title={i.error}>{i.estado === "pendiente" ? "⏳" : i.estado === "error" || i.error ? "⚠️" : "✓"}</span>
            </li>
          ))}
          {lista.length === 0 && <li className="py-6 text-center text-slate-500 text-sm">Aún no hay escaneos.</li>}
        </ul>
      </section>

      <footer className="fixed bottom-0 inset-x-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
        <Link href={`/conteos/${conteo.id}/reporte`} className="block mx-auto max-w-xl rounded-xl bg-slate-100 dark:bg-slate-800 py-3 text-center font-semibold">
          {cerrado ? "Ver reporte" : "Terminar y ver diferencias"}
        </Link>
      </footer>
    </div>
  );
}

function Contador({ n, t }: { n: number | string; t: string }) {
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 py-2">
      <p className="text-xl font-bold">{n}</p>
      <p className="text-[11px] text-slate-500">{t}</p>
    </div>
  );
}
