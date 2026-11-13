// Almacenamiento local (IndexedDB): catálogo para validar sin red y cola de
// escaneos pendientes de sincronizar.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { EntradaCatalogo, Resultado } from "./clasificar";

export interface ItemCola {
  client_id: string;
  conteo_id: string;
  vin: string;
  escaneado_en: string;
  metodo: "camara" | "manual";
  resultado: Resultado;            // local primero; el servidor lo confirma al sincronizar
  observaciones?: string;
  foto?: Blob;                     // pendiente de subir
  foto_path?: string;
  estado: "pendiente" | "enviado" | "error";
  meta_sucia: boolean;             // hay foto/observaciones por enviar tras el insert
  error?: string;
  ordinal: number;                 // orden de captura (para listar)
}

export interface MetaCatalogo {
  conteo_id: string;
  localidad_id: string;
  descargado_en: string;
}

interface Esquema extends DBSchema {
  catalogo: { key: string; value: EntradaCatalogo };
  meta: { key: string; value: MetaCatalogo };
  cola: { key: string; value: ItemCola; indexes: { por_conteo: string } };
}

let dbp: Promise<IDBPDatabase<Esquema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Esquema>("inventario-v1", 1, {
      upgrade(d) {
        d.createObjectStore("catalogo", { keyPath: "vin" });
        d.createObjectStore("meta", { keyPath: "conteo_id" });
        d.createObjectStore("cola", { keyPath: "client_id" }).createIndex("por_conteo", "conteo_id");
      },
    });
  }
  return dbp;
}

export async function guardarCatalogo(meta: MetaCatalogo, filas: EntradaCatalogo[]) {
  const d = await db();
  const tx = d.transaction(["catalogo", "meta"], "readwrite");
  await tx.objectStore("catalogo").clear();
  for (const f of filas) tx.objectStore("catalogo").put(f);
  await tx.objectStore("meta").clear();
  await tx.objectStore("meta").put(meta);
  await tx.done;
}

export async function leerCatalogo(): Promise<{ meta: MetaCatalogo | undefined; filas: EntradaCatalogo[] }> {
  const d = await db();
  const metas = await d.getAll("meta");
  return { meta: metas[0], filas: await d.getAll("catalogo") };
}

export async function itemsDeConteo(conteoId: string): Promise<ItemCola[]> {
  const d = await db();
  const items = await d.getAllFromIndex("cola", "por_conteo", conteoId);
  return items.sort((a, b) => a.ordinal - b.ordinal);
}

export async function guardarItem(item: ItemCola) {
  await (await db()).put("cola", item);
}

export async function obtenerItem(clientId: string) {
  return (await db()).get("cola", clientId);
}

export async function borrarItem(clientId: string) {
  await (await db()).delete("cola", clientId);
}

export async function pendientesDeConteo(conteoId: string): Promise<number> {
  const items = await itemsDeConteo(conteoId);
  return items.filter((i) => i.estado === "pendiente" || i.meta_sucia).length;
}
