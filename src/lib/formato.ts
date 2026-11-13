const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const dinero = (n: number | null | undefined) => (n == null ? "—" : mxn.format(Number(n)));
export function fecha(f: string | null | undefined) {
  if (!f) return "—";
  const [a, m, d] = f.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
export const fechaHora = (f: string | null | undefined) =>
  f ? new Date(f).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";
export const SEGMENTOS = ["tracto", "carga", "pasaje", "seminuevos", "semirremolques", "fl360"] as const;
export const NOMBRE_STATUS: Record<string, string> = {
  en_inventario: "En inventario", facturada_en_cartera: "Facturada en cartera", vendida: "Vendida / salida",
};
