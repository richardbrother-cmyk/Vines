import Link from "next/link";
import { redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { BadgePlanPiso, BadgeSeguro, BadgeStatus } from "@/components/Badges";
import { ExportarUnidades } from "@/components/ExportarUnidades";
import { miPerfil } from "@/lib/datos";
import { aplicarFiltros, aQueryString, leerFiltros } from "@/lib/filtrosUnidades";
import { FINANCIERAS } from "@/lib/importar";
import { NOMBRE_STATUS, SEGMENTOS, dinero } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

const POR_PAGINA = 40;

interface Fila {
  vin: string; modelo: string | null; anio: number | null; segmento: string | null; status: string;
  localidad: string | null; financieras: string[] | null; costo: number | null;
  seguro_semaforo: string | null; dias_seguro: number | null; dias_plan_piso: number | null;
}

export default async function Unidades({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const pagina = Math.max(1, Number(Array.isArray(sp.p) ? sp.p[0] : sp.p) || 1);
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");

  const desde = (pagina - 1) * POR_PAGINA;
  const [{ data, count, error }, { data: locs }] = await Promise.all([
    aplicarFiltros(
      sb.from("v_unidades_full")
        .select("vin,modelo,anio,segmento,status,localidad,financieras,costo,seguro_semaforo,dias_seguro,dias_plan_piso", { count: "exact" }),
      f,
    ).range(desde, desde + POR_PAGINA - 1),
    sb.from("localidades").select("id,nombre").eq("activa", true).order("nombre"),
  ]);
  const filas = (data ?? []) as Fila[];
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const link = (p: number) => `/unidades?${aQueryString(f, { p })}`;
  const sel = "rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2 text-sm";

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-3xl p-4 space-y-4">
        <form className="grid grid-cols-2 sm:grid-cols-3 gap-2" action="/unidades">
          <input name="q" defaultValue={f.q} placeholder="VIN o últimos dígitos" autoCapitalize="characters"
            className="col-span-2 sm:col-span-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-3 font-mono" />
          <select name="loc" defaultValue={f.loc ?? ""} className={sel}>
            <option value="">Todas las localidades</option>
            {(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            <option value="sin">Sin ubicación</option>
          </select>
          <select name="status" defaultValue={f.status ?? ""} className={sel}>
            <option value="">Todos los status</option>
            {Object.entries(NOMBRE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {perfil.rol !== "auditor" && (
            <select name="financiera" defaultValue={f.financiera ?? ""} className={sel}>
              <option value="">Todas las financieras</option>
              {FINANCIERAS.map((x) => <option key={x}>{x}</option>)}
            </select>
          )}
          <select name="segmento" defaultValue={f.segmento ?? ""} className={sel}>
            <option value="">Todos los segmentos</option>
            {SEGMENTOS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select name="seguro" defaultValue={f.seguro ?? ""} className={sel}>
            <option value="">Seguro: todos</option>
            <option value="vencido">Vencido</option><option value="por_vencer">Por vencer (≤30 d)</option><option value="vigente">Vigente</option>
          </select>
          <select name="pp" defaultValue={f.pp ?? ""} className={sel}>
            <option value="">Plan piso: todos</option>
            <option value="vencido">Vencido</option><option value="15">Vence en ≤15 d</option><option value="30">Vence en ≤30 d</option>
          </select>
          <button className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-2 font-semibold">Filtrar</button>
          <Link href="/unidades" className="rounded-lg bg-slate-100 dark:bg-slate-800 py-2 text-center text-sm leading-[2.25rem]">Limpiar</Link>
        </form>

        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500">{total.toLocaleString("es-MX")} unidades</p>
          <ExportarUnidades filtros={f} verDinero={perfil.rol !== "auditor"} />
        </div>
        {error && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error.message}</p>}

        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {filas.map((u) => (
            <li key={u.vin}>
              <Link href={`/unidades/${u.vin}`} className="block py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm">{u.vin}</span>
                  {perfil.rol !== "auditor" && <span className="text-sm text-slate-500">{dinero(u.costo)}</span>}
                </div>
                <p className="text-sm">{u.modelo} {u.anio} · <span className="text-slate-500">{u.localidad ?? "sin ubicación"}{u.financieras ? ` · ${u.financieras.join(", ")}` : ""}</span></p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <BadgeStatus status={u.status} />
                  <BadgeSeguro semaforo={u.seguro_semaforo} dias={u.dias_seguro} />
                  <BadgePlanPiso dias={u.dias_plan_piso} />
                </div>
              </Link>
            </li>
          ))}
          {filas.length === 0 && <li className="py-8 text-center text-slate-500">Sin resultados.</li>}
        </ul>

        {paginas > 1 && (
          <nav className="flex items-center justify-between text-sm">
            {pagina > 1 ? <Link href={link(pagina - 1)} className="underline">← Anterior</Link> : <span />}
            <span className="text-slate-500">Página {pagina} de {paginas}</span>
            {pagina < paginas ? <Link href={link(pagina + 1)} className="underline">Siguiente →</Link> : <span />}
          </nav>
        )}
      </main>
    </>
  );
}
