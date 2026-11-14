// Normalización de filas de Excel (SAP / financieras) antes de enviarlas a la base.
import { esVinValido, normalizarVin } from "./vin";

export type Mapeo = Record<string, string>; // campo -> encabezado del archivo ("" = sin mapear)

export interface Campo { clave: string; etiqueta: string; requerido?: boolean; alias: string[] }

export const CAMPOS_SAP: Campo[] = [
  { clave: "vin", etiqueta: "VIN", requerido: true, alias: ["vin", "no de serie", "numero de serie", "chasis", "serie", "n serie"] },
  { clave: "modelo", etiqueta: "Modelo", alias: ["modelo", "descripcion", "material", "denominacion"] },
  { clave: "anio", etiqueta: "Año", alias: ["ano", "año", "anio", "ano modelo", "modelo ano"] },
  { clave: "tipo", etiqueta: "Tipo (nueva/usada)", alias: ["tipo", "condicion", "nueva usada"] },
  { clave: "segmento", etiqueta: "Segmento", alias: ["segmento", "linea", "familia", "clase"] },
  { clave: "lote_sap", etiqueta: "Lote SAP", alias: ["lote", "lote sap", "batch"] },
  { clave: "division_sap", etiqueta: "División SAP", alias: ["division", "division sap", "cod sucursal", "codigo sucursal", "sucursal", "centro", "div"] },
  { clave: "costo", etiqueta: "Costo", alias: ["costo", "valor", "costo total", "importe", "valor inventario"] },
  { clave: "fecha_alta_inventario", etiqueta: "Fecha de alta en inventario", alias: ["fecha alta inventario", "fecha alta", "fecha de alta", "fecha entrada", "fecha ingreso", "alta inventario"] },
  { clave: "antiguedad_dias", etiqueta: "Antigüedad en inventario (días)", alias: ["antiguedad inventario", "antiguedad", "dias en inventario", "dias inventario"] },
  { clave: "status", etiqueta: "Status", alias: ["status", "estatus", "estado"] },
];

export const CAMPOS_FIN: Campo[] = [
  { clave: "vin", etiqueta: "VIN", requerido: true, alias: ["vin", "no de serie", "numero de serie", "chasis", "serie"] },
  { clave: "financiera", etiqueta: "Financiera (si viene en el archivo)", alias: ["financiera", "institucion", "banco"] },
  { clave: "disposicion", etiqueta: "No. de disposición (1 o 2)", alias: ["disposicion", "no disposicion", "num disposicion"] },
  { clave: "concepto", etiqueta: "Concepto (chasis/carrocería)", alias: ["concepto", "descripcion", "tipo disposicion"] },
  { clave: "saldo", etiqueta: "Saldo", alias: ["saldo", "saldo insoluto", "saldo actual", "importe"] },
  { clave: "fecha_entrada_plan_piso", etiqueta: "Fecha de entrada a plan piso", alias: ["fecha entrada plan piso", "fecha disposicion", "fecha de disposicion", "fecha entrada", "fecha alta", "fecha inicio"] },
  { clave: "fecha_vencimiento_plan_piso", etiqueta: "Fecha de vencimiento de plan piso", alias: ["fecha vencimiento", "vencimiento", "fecha de vencimiento", "vence", "fecha limite"] },
];

export const FINANCIERAS = ["BBVA IPP", "DAIMLER MP315", "DAIMLER MP340", "SANTANDER", "NO FINANCIADA"] as const;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const llave = (s: unknown) =>
  sinAcentos(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Sugiere qué encabezado del archivo corresponde a cada campo (por alias exacto, luego por contención). */
export function sugerirMapeo(encabezados: string[], campos: Campo[]): Mapeo {
  const porLlave = new Map(encabezados.map((h) => [llave(h), h]));
  const usados = new Set<string>();
  const m: Mapeo = {};
  for (const c of campos) {
    let hit = c.alias.map(llave).map((a) => porLlave.get(a)).find((h) => h && !usados.has(h));
    if (!hit) {
      const a0 = c.alias.map(llave);
      hit = encabezados.find((h) => !usados.has(h) && a0.some((a) => a.length > 3 && llave(h).includes(a)));
    }
    m[c.clave] = hit ?? "";
    if (hit) usados.add(hit);
  }
  return m;
}

// ---------------------------------------------------------------- parsers
export function parsearFecha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // serial de Excel razonable (1954–2118)
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // día/mes/año (formato MX)
  if (m) return valida(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function valida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

export function parsearNumero(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : neg ? -n : n;
}

const texto = (v: unknown) => {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  return s === "" ? null : s;
};

export function normalizarTipo(v: unknown): "nueva" | "usada" | null {
  const k = llave(v);
  if (!k) return null;
  if (/^(nuev|n$)/.test(k)) return "nueva";
  if (/^(usad|seminuev|u$)/.test(k)) return "usada";
  return null;
}

export function normalizarSegmento(v: unknown): string | null {
  const k = llave(v);
  if (!k) return null;
  if (k.includes("fl360") || k.includes("fl 360")) return "fl360";
  if (k.includes("tracto")) return "tracto";
  if (k.includes("semirremolque") || k.includes("remolque") || k.includes("caja")) return "semirremolques";
  if (k.includes("seminuev")) return "seminuevos";
  if (k.includes("pasaje") || k.includes("autobus") || k.includes("bus")) return "pasaje";
  if (k.includes("carga") || k.includes("camion") || k.includes("chasis")) return "carga";
  return null;
}

export function normalizarStatus(v: unknown): "en_inventario" | "facturada_en_cartera" | "vendida" | null {
  const k = llave(v);
  if (!k) return null;
  if (k.includes("cartera") || k.includes("factur")) return "facturada_en_cartera";
  if (k.includes("vendid") || k.includes("salida") || k.includes("baja")) return "vendida";
  if (k.includes("inventario") || k.includes("stock") || k.includes("disponible") || k.includes("patio")) return "en_inventario";
  return null;
}

export function normalizarFinanciera(v: unknown): string | null {
  const k = llave(v);
  if (!k) return null;
  if (k.includes("no financ") || k.includes("sin financ") || k.includes("contado")) return "NO FINANCIADA";
  if (k.includes("bbva")) return "BBVA IPP";
  if (k.includes("santander")) return "SANTANDER";
  if (k.includes("315")) return "DAIMLER MP315";
  if (k.includes("340")) return "DAIMLER MP340";
  return null;
}

// ---------------------------------------------------------------- procesamiento
export interface ErrorFila { fila: number; vin: string; error: string }
export interface Procesado<T> {
  validas: T[]; errores: ErrorFila[]; duplicadas: number; vinsCorregidos: number;
  /** Valores de texto que no se pudieron reconocer (p. ej. segmentos nuevos), con su conteo. */
  sinReconocer?: Record<string, Record<string, number>>;
}

export interface OpcionesSAP {
  /** Fuerza el status de todas las filas (p. ej. archivo de unidades facturadas en cartera). */
  statusFijo?: "en_inventario" | "facturada_en_cartera" | "vendida";
  /** Fecha del reporte (YYYY-MM-DD): base para calcular alta = fecha − antigüedad en días. */
  fechaReporte?: string;
}

/** Fecha de hoy en Guadalajara (YYYY-MM-DD), sin importar la zona del servidor o del navegador. */
export const hoyLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(fecha + "T00:00:00Z") - dias * 86400000).toISOString().slice(0, 10);
}

type Fila = Record<string, unknown>;
const get = (f: Fila, m: Mapeo, c: string) => (m[c] ? f[m[c]] : undefined);

export function procesarSAP(filas: Fila[], m: Mapeo, opc: OpcionesSAP = {}): Procesado<Record<string, unknown>> {
  const base = parsearFecha(opc.fechaReporte) ?? hoyLocal();
  const sinReconocer: Record<string, Record<string, number>> = {};
  const anotar = (campo: string, crudo: unknown) => {
    const t = texto(crudo);
    if (t) (sinReconocer[campo] ??= {})[t] = (sinReconocer[campo][t] ?? 0) + 1;
  };
  const porVin = new Map<string, Record<string, unknown>>();
  const errores: ErrorFila[] = [];
  let duplicadas = 0, vinsCorregidos = 0;
  for (const f of filas) {
    const n = Number(f.__fila ?? 0);
    const crudo = String(get(f, m, "vin") ?? "");
    const vin = normalizarVin(crudo);
    if (!esVinValido(vin)) { errores.push({ fila: n, vin: crudo, error: "VIN inválido tras normalizar" }); continue; }
    if (vin !== crudo.trim()) vinsCorregidos++;
    const anio = parsearNumero(get(f, m, "anio"));
    const segmento = normalizarSegmento(get(f, m, "segmento"));
    if (!segmento) anotar("segmento", get(f, m, "segmento"));
    const statusCol = normalizarStatus(get(f, m, "status"));
    if (!statusCol && get(f, m, "status")) anotar("status", get(f, m, "status"));
    const dias = parsearNumero(get(f, m, "antiguedad_dias"));
    const fila: Record<string, unknown> = {
      vin,
      modelo: texto(get(f, m, "modelo")),
      anio: anio && anio >= 1980 && anio <= 2100 ? Math.round(anio) : null,
      // Sin columna de tipo: los "seminuevos" son usadas; lo demás se deja sin definir (no se adivina).
      tipo: normalizarTipo(get(f, m, "tipo")) ?? (segmento === "seminuevos" ? "usada" : null),
      segmento,
      lote_sap: texto(get(f, m, "lote_sap")),
      division_sap: texto(get(f, m, "division_sap")),
      costo: parsearNumero(get(f, m, "costo")),
      // Fecha de alta explícita; si no, se deriva de la antigüedad (días) respecto a la fecha del reporte.
      fecha_alta_inventario: parsearFecha(get(f, m, "fecha_alta_inventario")) ?? (dias != null && dias >= 0 && dias <= 20000 ? restarDias(base, Math.round(dias)) : null),
      // Sin columna de status, estar en el archivo de inventario significa "en inventario"
      // (así una unidad marcada por error como vendida/facturada vuelve al reaparecer en SAP).
      status: opc.statusFijo ?? statusCol ?? (m.status ? null : "en_inventario"),
    };
    if (porVin.has(vin)) duplicadas++; // el VIN es único: la última fila del archivo gana
    porVin.set(vin, fila);
  }
  return { validas: [...porVin.values()], errores, duplicadas, vinsCorregidos, sinReconocer };
}

export function procesarFinanciera(filas: Fila[], m: Mapeo, financieraFija?: string): Procesado<Record<string, unknown>> {
  const validas: Record<string, unknown>[] = [];
  const errores: ErrorFila[] = [];
  const usadas = new Map<string, Set<number>>(); // disposiciones ya ocupadas por VIN en este archivo
  let vinsCorregidos = 0;
  for (const f of filas) {
    const n = Number(f.__fila ?? 0);
    const crudo = String(get(f, m, "vin") ?? "");
    const vin = normalizarVin(crudo);
    if (!esVinValido(vin)) { errores.push({ fila: n, vin: crudo, error: "VIN inválido tras normalizar" }); continue; }
    if (vin !== crudo.trim()) vinsCorregidos++;
    const financiera = financieraFija || normalizarFinanciera(get(f, m, "financiera"));
    if (!financiera) { errores.push({ fila: n, vin, error: "Financiera no reconocida" }); continue; }
    const ocupadas = usadas.get(vin) ?? new Set<number>();
    usadas.set(vin, ocupadas);
    let disp = parsearNumero(get(f, m, "disposicion"));
    if (disp === 1 || disp === 2) {
      // Un (VIN, disposición) repetido tumbaría el lote completo en la base: se rechaza la fila.
      if (ocupadas.has(disp)) { errores.push({ fila: n, vin, error: `Disposición ${disp} repetida para el mismo VIN` }); continue; }
    } else {
      // Sin número en el archivo: la primera libre (1 = chasis, 2 = carrocería).
      disp = !ocupadas.has(1) ? 1 : !ocupadas.has(2) ? 2 : 3;
      if (disp > 2) { errores.push({ fila: n, vin, error: "Más de 2 disposiciones para el mismo VIN" }); continue; }
    }
    ocupadas.add(disp);
    validas.push({
      vin, financiera, disposicion: disp, concepto: texto(get(f, m, "concepto")),
      saldo: parsearNumero(get(f, m, "saldo")),
      fecha_entrada_plan_piso: parsearFecha(get(f, m, "fecha_entrada_plan_piso")),
      fecha_vencimiento_plan_piso: parsearFecha(get(f, m, "fecha_vencimiento_plan_piso")),
    });
  }
  return { validas, errores, duplicadas: 0, vinsCorregidos };
}
