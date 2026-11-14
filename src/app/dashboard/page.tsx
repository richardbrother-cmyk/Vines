import Link from "next/link";
import { redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { BadgePlanPiso, BadgeSeguro } from "@/components/Badges";
import { miPerfil } from "@/lib/datos";
import { aQueryString } from "@/lib/filtrosUnidades";
import { dinero, fecha } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

interface Resumen {
  unidades: number; valor: number | null; facturadas: number;
  por_financiera: { financiera: string; unidades: number; saldo: number | null }[];
  por_segmento: { segmento: string; unidades: number; valor: number | null }[];
  seguros: { vencidos: number; por_vencer: number; vigentes: number; sin_dato: number };
  plan_piso: { vencido: number; d15: number; d30: number };
  localidades: { id: string; nombre: string; unidades: number; valor: number | null;
                 ultimo_conteo: { id: string; fecha: string; pct: number | null; faltantes: number } | null }[];
}
interface Alerta { vin: string; modelo: string | null; localidad: string | null; seguro_semaforo: string | null; dias_seguro: number | null; dias_plan_piso: number | null }

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { loc } = await searchParams;
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");

  const filtrarLoc = <B,>(q: B): B => (loc ? (q as unknown as { eq(c: string, v: string): B }).eq("localidad_id", loc) : q);
  const [{ data: r, error }, segs, pps, { data: todas }] = await Promise.all([
    sb.rpc("dashboard_resumen", { p_localidad: loc ?? null }),
    filtrarLoc(sb.from("v_unidades_full").select("vin,modelo,localidad,seguro_semaforo,dias_seguro,dias_plan_piso")
      .eq("status", "en_inventario").in("seguro_semaforo", ["vencido", "por_vencer"])
      .order("dias_seguro", { ascending: true }).limit(8)),
    filtrarLoc(sb.from("v_unidades_full").select("vin,modelo,localidad,seguro_semaforo,dias_seguro,dias_plan_piso")
      .eq("status", "en_inventario").lte("dias_plan_piso", 30)
      .order("dias_plan_piso", { ascending: true }).limit(8)),
    sb.from("localidades").select("id,nombre").eq("activa", true).order("nombre"),
  ]);
  const d = r as Resumen | null;
  if (!d) return <p className="p-6 text-red-700">{error?.message ?? "Sin datos"}</p>;

  const verDinero = perfil.rol !== "auditor";
  const lista = (extra: Record<string, string>) => `/unidades?${aQueryString({ loc, status: "en_inventario" }, extra)}`;
  const maxFin = Math.max(1, ...d.por_financiera.map((x) => x.unidades));
  const maxSeg = Math.max(1, ...d.por_segmento.map((x) => x.unidades));
  const sel = "rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2 text-sm";

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-3xl p-4 space-y-5">
        <form className="flex items-center gap-2" action="/dashboard">
          <select name="loc" defaultValue={loc ?? ""} className={sel}>
            <option value="">Global (todas las localidades)</option>
            {(todas ?? []).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <button className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold">Ver</button>
        </form>

        <section className="grid grid-cols-2 gap-3">
          <Kpi t="Unidades en inventario" v={d.unidades.toLocaleString("es-MX")} href={lista({})} />
          <Kpi t="Valor (costo)" v={verDinero ? dinero(d.valor) : "—"} />
          <Kpi t="Facturadas en cartera" v={String(d.facturadas)} href={`/unidades?${aQueryString({ loc, status: "facturada_en_cartera" })}`} />
          <Kpi t="Sin dato de seguro" v={String(d.seguros.sin_dato)} />
        </section>

        <section>
          <h2 className="font-semibold mb-2">Seguros</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Semaforo n={d.seguros.vencidos} t="Vencidos" c="bg-red-100 text-red-800" href={lista({ seguro: "vencido" })} />
            <Semaforo n={d.seguros.por_vencer} t="Por vencer ≤30 d" c="bg-amber-100 text-amber-900" href={lista({ seguro: "por_vencer" })} />
            <Semaforo n={d.seguros.vigentes} t="Vigentes" c="bg-emerald-100 text-emerald-800" href={lista({ seguro: "vigente" })} />
          </div>
          <Alertas filas={(segs.data ?? []) as Alerta[]} />
        </section>

        {verDinero && (
          <section>
            <h2 className="font-semibold mb-2">Plan piso</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Semaforo n={d.plan_piso.vencido} t="Vencido" c="bg-red-100 text-red-800" href={lista({ pp: "vencido" })} />
              <Semaforo n={d.plan_piso.d15} t="Vence ≤15 d" c="bg-orange-100 text-orange-900" href={lista({ pp: "15" })} />
              <Semaforo n={d.plan_piso.d30} t="Vence 16–30 d" c="bg-amber-100 text-amber-900" href={lista({ pp: "16-30" })} />
            </div>
            <Alertas filas={(pps.data ?? []) as Alerta[]} plan />
          </section>
        )}

        {verDinero && (
          <section>
            <h2 className="font-semibold mb-2">Por financiera</h2>
            <ul className="space-y-2">
              {d.por_financiera.map((x) => (
                <Barra2 key={x.financiera} etiqueta={x.financiera} n={x.unidades} max={maxFin} extra={dinero(x.saldo)}
                  href={x.financiera === "Sin registro" ? undefined : lista({ financiera: x.financiera })} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="font-semibold mb-2">Por segmento</h2>
          <ul className="space-y-2">
            {d.por_segmento.map((x) => (
              <Barra2 key={x.segmento} etiqueta={x.segmento} n={x.unidades} max={maxSeg} extra={verDinero ? dinero(x.valor) : ""}
                href={x.segmento === "sin segmento" ? undefined : lista({ segmento: x.segmento })} />
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Último conteo físico por localidad</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {d.localidades.map((l) => (
              <li key={l.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <Link href={`/dashboard?loc=${l.id}`} className="font-medium">{l.nombre}</Link>
                  <p className="text-xs text-slate-500">{l.unidades} unidades{verDinero ? ` · ${dinero(l.valor)}` : ""}</p>
                </div>
                {l.ultimo_conteo ? (
                  <Link href={`/conteos/${l.ultimo_conteo.id}/reporte`} className="text-right">
                    <span className="block text-lg font-bold">{l.ultimo_conteo.pct != null ? `${l.ultimo_conteo.pct}%` : "—"}</span>
                    <span className="block text-xs text-slate-500">{fecha(l.ultimo_conteo.fecha)} · {l.ultimo_conteo.faltantes} faltantes</span>
                  </Link>
                ) : <span className="text-sm text-slate-500">Sin conteos</span>}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Kpi({ t, v, href }: { t: string; v: string; href?: string }) {
  const c = (
    <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
      <p className="text-2xl font-bold">{v}</p><p className="text-xs text-slate-500">{t}</p>
    </div>
  );
  return href ? <Link href={href}>{c}</Link> : c;
}
function Semaforo({ n, t, c, href }: { n: number; t: string; c: string; href: string }) {
  return <Link href={href} className={`rounded-xl py-3 ${c}`}><span className="block text-2xl font-bold">{n}</span><span className="text-xs">{t}</span></Link>;
}
function Barra2({ etiqueta, n, max, extra, href }: { etiqueta: string; n: number; max: number; extra: string; href?: string }) {
  const cuerpo = (
    <>
      <div className="flex justify-between text-sm"><span>{etiqueta}</span><span className="text-slate-500">{n} · {extra}</span></div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 mt-1"><div className="h-2 rounded-full bg-slate-700 dark:bg-slate-300" style={{ width: `${(100 * n) / max}%` }} /></div>
    </>
  );
  return <li>{href ? <Link href={href}>{cuerpo}</Link> : cuerpo}</li>;
}
function Alertas({ filas, plan }: { filas: Alerta[]; plan?: boolean }) {
  if (!filas.length) return null;
  return (
    <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700 text-sm">
      {filas.map((u) => (
        <li key={u.vin}>
          <Link href={`/unidades/${u.vin}`} className="py-2 flex items-center justify-between gap-2">
            <span><span className="font-mono">{u.vin}</span><span className="block text-xs text-slate-500">{u.modelo} · {u.localidad ?? "sin ubicación"}</span></span>
            {plan ? <BadgePlanPiso dias={u.dias_plan_piso} /> : <BadgeSeguro semaforo={u.seguro_semaforo} dias={u.dias_seguro} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
