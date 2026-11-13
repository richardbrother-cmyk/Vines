import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { leerExcel } from "./excel";
import {
  CAMPOS_FIN, CAMPOS_SAP, normalizarFinanciera, normalizarSegmento, normalizarStatus, parsearFecha,
  parsearNumero, procesarFinanciera, procesarSAP, sugerirMapeo,
} from "./importar";

describe("parsers", () => {
  it("fechas: ISO, dd/mm/yyyy, serial de Excel, Date e inválidas", () => {
    expect(parsearFecha("2026-03-05")).toBe("2026-03-05");
    expect(parsearFecha("05/03/2026")).toBe("2026-03-05");
    expect(parsearFecha("5-3-26")).toBe("2026-03-05");
    expect(parsearFecha(46086)).toBe("2026-03-05");
    expect(parsearFecha(new Date(Date.UTC(2026, 2, 5)))).toBe("2026-03-05");
    expect(parsearFecha("31/02/2026")).toBeNull();
    expect(parsearFecha("basura")).toBeNull();
  });
  it("números con $ y comas", () => {
    expect(parsearNumero("$1,234,567.50")).toBe(1234567.5);
    expect(parsearNumero("(500)")).toBe(-500);
    expect(parsearNumero("")).toBeNull();
  });
  it("catálogos", () => {
    expect(normalizarFinanciera("Daimler Truck Financial MP-340")).toBe("DAIMLER MP340");
    expect(normalizarFinanciera("BBVA México")).toBe("BBVA IPP");
    expect(normalizarSegmento("Tractocamión")).toBe("tracto");
    expect(normalizarSegmento("Semirremolque")).toBe("semirremolques");
    expect(normalizarStatus("Facturada en cartera")).toBe("facturada_en_cartera");
  });
});

describe("procesarSAP", () => {
  const m = { vin: "VIN", modelo: "Modelo", anio: "", tipo: "", segmento: "", lote_sap: "", division_sap: "Div", costo: "Costo", fecha_alta_inventario: "", status: "" };
  it("normaliza VIN, deduplica (última gana) y reporta inválidos", () => {
    const r = procesarSAP([
      { __fila: 2, VIN: " 3alacwfc0mdma0001 ", Modelo: "A", Div: 4105, Costo: "$100.5" },
      { __fila: 3, VIN: "3ALACWFC0MDMA0001-X", Modelo: "B", Div: 4105, Costo: 200 },
      { __fila: 4, VIN: "CORTO", Modelo: "C" },
      { __fila: 5, VIN: "3ALACWFCOMDMA0002", Modelo: "D" },
    ], m);
    expect(r.validas.map((v) => v.vin)).toEqual(["3ALACWFC0MDMA0001", "3ALACWFC0MDMA0002"]);
    expect(r.validas[0]).toMatchObject({ modelo: "B", costo: 200, division_sap: "4105" });
    expect(r.duplicadas).toBe(1);
    expect(r.errores).toHaveLength(1);
    expect(r.vinsCorregidos).toBeGreaterThan(0);
  });
});

describe("procesarFinanciera", () => {
  const m = { vin: "VIN", financiera: "", disposicion: "", concepto: "", saldo: "Saldo", fecha_entrada_plan_piso: "", fecha_vencimiento_plan_piso: "Vence" };
  it("numera disposiciones por VIN y rechaza la tercera", () => {
    const f = (n: number) => ({ __fila: n, VIN: "3ALACWFC0MDMA0001", Saldo: 10 * n, Vence: "01/12/2026" });
    const r = procesarFinanciera([f(2), f(3), f(4)], m, "SANTANDER");
    expect(r.validas.map((v) => v.disposicion)).toEqual([1, 2]);
    expect(r.errores).toHaveLength(1);
    expect(r.validas[0]).toMatchObject({ financiera: "SANTANDER", fecha_vencimiento_plan_piso: "2026-12-01" });
  });
  it("sin financiera fija ni columna: error", () => {
    expect(procesarFinanciera([{ __fila: 2, VIN: "3ALACWFC0MDMA0001" }], m).errores).toHaveLength(1);
  });
});

describe("Excel demo", () => {
  it("se lee, se autoemapea y se procesa sin errores", async () => {
    const buf = readFileSync("datos/demo_inventario.xlsx");
    const h = await leerExcel(buf);
    expect(h.filas).toHaveLength(20);
    const map = sugerirMapeo(h.encabezados, CAMPOS_SAP);
    expect(map.vin).toBe("VIN");
    expect(map.fecha_alta_inventario).toBe("Fecha alta inventario");
    expect(map.division_sap).toBe("División SAP");
    expect(Object.values(map).filter(Boolean).length).toBe(CAMPOS_SAP.length - 1); // el demo no trae antigüedad
    expect(map.antiguedad_dias).toBe("");
    const r = procesarSAP(h.filas, map);
    expect(r.errores).toEqual([]);
    expect(r.validas).toHaveLength(20);
    expect(r.validas.find((v) => v.status === "vendida")).toBeTruthy();
    const mf = sugerirMapeo(h.encabezados, CAMPOS_FIN);
    expect(mf.saldo).toBe("Saldo");
    expect(mf.fecha_vencimiento_plan_piso).toBe("Vencimiento plan piso");
  });
});

describe("formato real de SAP (Inventario_gdl)", () => {
  const enc = ["Desc. Segmento", "Lote", "Año Modelo", "Modelo", "Cod. Sucursal", "Serial de Motor", "VIN", "Inventario", "Valor Inventario", "Antigüedad Inventario"];
  const fila = (n: number, seg: string, vin: string, dias: number) => ({
    "Desc. Segmento": seg, Lote: "N0001", "Año Modelo": "2026", Modelo: "M2106", "Cod. Sucursal": "4105",
    "Serial de Motor": "99", VIN: vin, Inventario: 1, "Valor Inventario": 1877409.37, "Antigüedad Inventario": dias, __fila: n,
  });
  it("mapea solo, deriva fecha de alta, tipo y reporta segmentos desconocidos", () => {
    const m = sugerirMapeo(enc, CAMPOS_SAP);
    expect(m).toMatchObject({ division_sap: "Cod. Sucursal", antiguedad_dias: "Antigüedad Inventario", segmento: "Desc. Segmento", costo: "Valor Inventario", lote_sap: "Lote" });
    const r = procesarSAP([
      fila(2, "CARGA", "3ALHCYFE5TDWW4838", 345),
      fila(3, "VEHICULOS SEMINUEVOS", "3ALACWFC3VDXC3680", 10),
      fila(4, "FL360", "JLMCPG1A9TK000239", 5),
    ], m, { fechaReporte: "2026-11-13" });
    expect(r.errores).toEqual([]);
    expect(r.validas[0]).toMatchObject({ fecha_alta_inventario: "2025-12-03", division_sap: "4105", segmento: "carga", tipo: null });
    expect(r.validas[1]).toMatchObject({ segmento: "seminuevos", tipo: "usada" });
    expect(r.sinReconocer?.segmento).toEqual({ FL360: 1 });
  });
  it("statusFijo fuerza facturada_en_cartera", () => {
    const m = sugerirMapeo(enc, CAMPOS_SAP);
    const r = procesarSAP([fila(2, "CARGA", "3ALHCYFE5TDWW4838", 1)], m, { statusFijo: "facturada_en_cartera" });
    expect(r.validas[0].status).toBe("facturada_en_cartera");
  });
});
