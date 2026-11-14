// Clasificación de un VIN escaneado. Refleja exactamente la lógica del trigger
// `detalle_before_insert` en SQL (el servidor es la fuente de verdad al sincronizar).

export type Resultado =
  | "esperada"
  | "otra_localidad"
  | "sobrante"
  | "facturada_en_patio"
  | "vendida_en_patio";

export type StatusUnidad = "en_inventario" | "facturada_en_cartera" | "vendida";

export interface EntradaCatalogo {
  vin: string;
  modelo: string | null;
  anio: number | null;
  segmento: string | null;
  status: StatusUnidad;
  localidad_id: string | null;
  localidad_nombre: string | null;
}

export type Clasificacion = Resultado | "ya_escaneado";

export function clasificar(
  entrada: EntradaCatalogo | undefined,
  localidadConteo: string,
  yaEscaneado: boolean,
): Clasificacion {
  if (yaEscaneado) return "ya_escaneado";
  if (!entrada) return "sobrante";
  if (entrada.status === "facturada_en_cartera") return "facturada_en_patio";
  if (entrada.status === "vendida") return "vendida_en_patio";
  return entrada.localidad_id === localidadConteo ? "esperada" : "otra_localidad";
}

export const ETIQUETA: Record<Clasificacion, string> = {
  esperada: "Esperada aquí",
  otra_localidad: "Pertenece a otra localidad",
  sobrante: "No existe en inventario (sobrante)",
  facturada_en_patio: "Facturada, aún en patio",
  vendida_en_patio: "Ya tuvo salida (vendida)",
  ya_escaneado: "Ya escaneado",
};

/** Sufijos: VINs que terminan en `texto` (últimos 4–8 dígitos), máx. `limite`. */
export function buscarPorSufijo(
  catalogo: Iterable<EntradaCatalogo>,
  texto: string,
  limite = 6,
): EntradaCatalogo[] {
  const q = texto.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
  if (q.length < 4 || q.length > 17) return [];
  const out: EntradaCatalogo[] = [];
  for (const e of catalogo) {
    if (e.vin.endsWith(q)) {
      out.push(e);
      if (out.length >= limite) break;
    }
  }
  return out;
}
