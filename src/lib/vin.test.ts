import { describe, expect, it } from "vitest";
import { errorVin, esVinValido, normalizarVin } from "./vin";
import { buscarPorSufijo, clasificar, type EntradaCatalogo } from "./clasificar";

describe("normalizarVin", () => {
  it("mayúsculas y sin espacios/guiones", () => {
    expect(normalizarVin(" 3alacwfc0mdma0001 ")).toBe("3ALACWFC0MDMA0001");
    expect(normalizarVin("3ALA-CWFC 0MDM-A0001")).toBe("3ALACWFC0MDMA0001");
  });
  it("corrige O→0 e I→1", () => {
    expect(normalizarVin("3ALACWFCOMDMA000I")).toBe("3ALACWFC0MDMA0001");
  });
  it("trunca sufijos a 17", () => {
    expect(normalizarVin("3ALACWFC0MDMA0001-X2")).toBe("3ALACWFC0MDMA0001");
    expect(normalizarVin("3ALACWFC0MDMA0001  ABC")).toBe("3ALACWFC0MDMA0001");
  });
  it("descarta el prefijo 'I' que agregan algunos lectores Code 39 (18 chars)", () => {
    expect(normalizarVin("I3ALACWFC0MDMA0001")).toBe("3ALACWFC0MDMA0001");
  });
  it("no toca un VIN de 17 que empieza con I (se vuelve 1)", () => {
    expect(normalizarVin("IALACWFC0MDMA0001")).toBe("1ALACWFC0MDMA0001");
  });
  it("tolera nulos", () => {
    expect(normalizarVin(undefined as unknown as string)).toBe("");
  });
});

describe("validación", () => {
  it("acepta 17 válidos y rechaza Q o longitud", () => {
    expect(esVinValido("3ALACWFC0MDMA0001")).toBe(true);
    expect(esVinValido("3ALACWFC0MDMA000Q")).toBe(false);
    expect(errorVin("3ALACWFC0MDMA000Q")).toMatch(/Q/);
    expect(errorVin("3ALAC")).toMatch(/Faltan 12/);
    expect(errorVin("3ALACWFC0MDMA0001")).toBeNull();
  });
});

const cat = (o: Partial<EntradaCatalogo>): EntradaCatalogo => ({
  vin: "3ALACWFC0MDMA0001", modelo: "M2", anio: 2024, segmento: "carga",
  status: "en_inventario", localidad_id: "A", localidad_nombre: "Patio A", ...o,
});

describe("clasificar", () => {
  it("cubre todos los casos", () => {
    expect(clasificar(cat({}), "A", false)).toBe("esperada");
    expect(clasificar(cat({ localidad_id: "B" }), "A", false)).toBe("otra_localidad");
    expect(clasificar(cat({ localidad_id: null }), "A", false)).toBe("otra_localidad");
    expect(clasificar(undefined, "A", false)).toBe("sobrante");
    expect(clasificar(cat({ status: "facturada_en_cartera" }), "A", false)).toBe("facturada_en_patio");
    expect(clasificar(cat({ status: "vendida" }), "A", false)).toBe("vendida_en_patio");
    expect(clasificar(cat({}), "A", true)).toBe("ya_escaneado");
  });
});

describe("buscarPorSufijo", () => {
  const lista = [cat({ vin: "3ALACWFC0MDMA0001" }), cat({ vin: "3ALACWFC0MDMB0001" }), cat({ vin: "3ALACWFC0MDMA0002" })];
  it("encuentra por últimos dígitos y exige mínimo 4", () => {
    expect(buscarPorSufijo(lista, "0001").map((e) => e.vin)).toHaveLength(2);
    expect(buscarPorSufijo(lista, "a0002")).toHaveLength(1);
    expect(buscarPorSufijo(lista, "002")).toHaveLength(0);
  });
  it("normaliza O/I al buscar", () => {
    expect(buscarPorSufijo(lista, "OOOI")).toHaveLength(2); // 0001
  });
});
