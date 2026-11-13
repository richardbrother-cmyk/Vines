import { NOMBRE_STATUS } from "@/lib/formato";

const base = "inline-block rounded-full px-2 py-0.5 text-xs font-medium";

export function BadgeSeguro({ semaforo, dias }: { semaforo: string | null; dias: number | null }) {
  if (!semaforo) return <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}>Seguro s/d</span>;
  const c = semaforo === "vencido" ? "bg-red-100 text-red-800" : semaforo === "por_vencer" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800";
  const t = semaforo === "vencido" ? `Seguro vencido${dias != null ? ` (${-dias} d)` : ""}` : semaforo === "por_vencer" ? `Seguro vence en ${dias} d` : "Seguro vigente";
  return <span className={`${base} ${c}`}>{t}</span>;
}

export function BadgePlanPiso({ dias }: { dias: number | null }) {
  if (dias == null) return null;
  const c = dias < 0 ? "bg-red-100 text-red-800" : dias <= 15 ? "bg-orange-100 text-orange-900" : dias <= 30 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  return <span className={`${base} ${c}`}>{dias < 0 ? `Plan piso vencido (${-dias} d)` : `Plan piso ${dias} d`}</span>;
}

export function BadgeStatus({ status }: { status: string }) {
  const c = status === "en_inventario" ? "bg-sky-100 text-sky-800" : status === "facturada_en_cartera" ? "bg-violet-100 text-violet-800" : "bg-slate-200 text-slate-700";
  return <span className={`${base} ${c}`}>{NOMBRE_STATUS[status] ?? status}</span>;
}
