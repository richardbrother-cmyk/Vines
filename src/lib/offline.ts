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
  foto_nombre?: string;            // nombre único del archivo pendiente (permite reemplazar la foto)
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

/** Lee-modifica-escribe en UNA transacción: evita pisar cambios hechos mientras había una petición de red en vuelo. */
export async function actualizarItem(clientId: string, cambio: (actual: ItemCola) => ItemCola | null): Promise<ItemCola | null> {
  const tx = (await db()).transaction("cola", "readwrite");
  const actual = await tx.store.get(clientId);
  const nuevo = actual ? cambio(actual) : null;
  if (nuevo) await tx.store.put(nuevo);
  await tx.done;
  return nuevo;
}

export const NOMBRE_CACHE = "inventario-v2"; // debe coincidir con public/sw.js

/** Sin sincronizar = pendientes, con foto/nota por subir, o con error (un error no es "ya quedó"). */
export const sinSincronizar = (i: ItemCola) => i.estado !== "enviado" || i.meta_sucia;

export async function pendientesDeConteo(conteoId: string): Promise<number> {
  return (await itemsDeConteo(conteoId)).filter(sinSincronizar).length;
}

export async function pendientesTotales(): Promise<number> {
  return (await (await db()).getAll("cola")).filter(sinSincronizar).length;
}

/** Al cerrar sesión: borra catálogo, cola y páginas guardadas para que no las vea el siguiente usuario. */
export async function borrarDatosLocales() {
  try {
    const d = await db();
    const tx = d.transaction(["catalogo", "meta", "cola"], "readwrite");
    await Promise.all([tx.objectStore("catalogo").clear(), tx.objectStore("meta").clear(), tx.objectStore("cola").clear()]);
    await tx.done;
  } catch { /* sin IndexedDB */ }
  try {
    if (typeof caches !== "undefined") await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* sin Cache API */ }
}
