// Filtros compartidos por el listado /unidades, el dashboard (enlaces) y el exporte a Excel.
import { normalizarVin } from "./vin";

export interface Filtros {
  q?: string; loc?: string; status?: string; financiera?: string;
  segmento?: string; seguro?: string; pp?: string;
}
type SP = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function leerFiltros(sp: SP): Filtros {
  return {
    q: uno(sp.q), loc: uno(sp.loc), status: uno(sp.status), financiera: uno(sp.financiera),
    segmento: uno(sp.segmento), seguro: uno(sp.seguro), pp: uno(sp.pp),
  };
}

export function aQueryString(f: Filtros, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

/** Aplica los filtros a una consulta PostgREST sobre v_unidades_full. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltros<B>(qb: B, f: Filtros): B {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = qb as any;
  if (f.q) {
    const t = f.q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (t) q = q.ilike("vin", `%${t.length === 17 ? normalizarVin(t) : t}%`);
  }
  if (f.loc) q = f.loc === "sin" ? q.is("localidad_id", null) : q.eq("localidad_id", f.loc);
  if (f.status) q = q.eq("status", f.status);
  if (f.financiera) q = q.contains("financieras", [f.financiera]);
  if (f.segmento) q = q.eq("segmento", f.segmento);
  if (f.seguro) q = q.eq("seguro_semaforo", f.seguro);
  if (f.pp === "vencido") q = q.lt("dias_plan_piso", 0);
  else if (f.pp === "15") q = q.gte("dias_plan_piso", 0).lte("dias_plan_piso", 15);
  else if (f.pp === "30") q = q.gte("dias_plan_piso", 0).lte("dias_plan_piso", 30);
  q = f.seguro ? q.order("dias_seguro", { ascending: true }) : f.pp ? q.order("dias_plan_piso", { ascending: true }) : q.order("vin");
  return q as B;
}
