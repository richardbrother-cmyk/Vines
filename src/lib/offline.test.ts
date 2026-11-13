import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { guardarCatalogo, guardarItem, itemsDeConteo, leerCatalogo, pendientesDeConteo, borrarItem, type ItemCola } from "./offline";

const item = (n: number, o: Partial<ItemCola> = {}): ItemCola => ({
  client_id: `c${n}`, conteo_id: "K1", vin: `3ALACWFC0MDMA000${n}`, escaneado_en: new Date().toISOString(),
  metodo: "manual", resultado: "esperada", estado: "pendiente", meta_sucia: false, ordinal: n, ...o,
});

describe("cola offline", () => {
  it("ordena por captura, separa conteos y cuenta pendientes", async () => {
    await guardarItem(item(2)); await guardarItem(item(1));
    await guardarItem(item(3, { estado: "enviado" }));
    await guardarItem(item(4, { estado: "enviado", meta_sucia: true }));
    await guardarItem(item(9, { conteo_id: "K2" }));
    expect((await itemsDeConteo("K1")).map((i) => i.client_id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(await pendientesDeConteo("K1")).toBe(3); // c1, c2 pendientes + c4 con foto por subir
    await borrarItem("c1");
    expect(await pendientesDeConteo("K1")).toBe(2);
  });

  it("el catálogo se reemplaza por completo", async () => {
    const e = (vin: string) => ({ vin, modelo: null, anio: null, segmento: null, status: "en_inventario" as const, localidad_id: "A", localidad_nombre: "A" });
    await guardarCatalogo({ conteo_id: "K1", localidad_id: "A", descargado_en: "x" }, [e("1"), e("2")]);
    await guardarCatalogo({ conteo_id: "K2", localidad_id: "B", descargado_en: "y" }, [e("3")]);
    const r = await leerCatalogo();
    expect(r.filas.map((f) => f.vin)).toEqual(["3"]);
    expect(r.meta?.conteo_id).toBe("K2");
  });
});
