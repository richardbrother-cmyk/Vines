// Genera datos/demo_inventario.xlsx (20 unidades demo) y lo carga en Supabase.
//   node --env-file=.env.local scripts/seed-demo.mjs            -> genera el Excel y carga la base
//   node --env-file=.env.local scripts/seed-demo.mjs --solo-excel
// Requiere SUPABASE_SERVICE_ROLE_KEY y haber aplicado migración + seed.sql (localidades).
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const hoy = new Date();
const dias = (n) => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);
const modelos = [
  ["M2 106", "carga", "4105"], ["M2 112", "carga", "4105"], ["Cascadia", "tracto", "4106"],
  ["Accelo", "carga", "4105"], ["Actros", "tracto", "4106"], ["Marcopolo G7", "pasaje", "4305"],
  ["Hino 300", "carga", "4105"], ["Freightliner M2 usado", "seminuevos", "4111"],
];
const financieras = ["BBVA IPP", "DAIMLER MP315", "DAIMLER MP340", "SANTANDER", "NO FINANCIADA"];

const unidades = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const [modelo, segmento, division] = modelos[i % modelos.length];
  const status = n === 19 ? "facturada_en_cartera" : n === 20 ? "vendida" : n === 18 ? "facturada_en_cartera" : "en_inventario";
  const financiera = financieras[i % financieras.length];
  return {
    vin: `3ALACWFC0MDM${String(n).padStart(5, "0")}`,
    modelo, anio: 2023 + (i % 3), tipo: segmento === "seminuevos" ? "usada" : "nueva", segmento,
    lote_sap: `L${1000 + n}`, division_sap: division, costo: 1_200_000 + n * 35_000,
    fecha_alta_inventario: dias(-(20 + n * 15)), status, financiera,
    saldo: financiera === "NO FINANCIADA" ? 0 : 900_000 + n * 20_000,
    entrada_plan_piso: financiera === "NO FINANCIADA" ? "" : dias(-(15 + n * 12)),
    vencimiento_plan_piso: financiera === "NO FINANCIADA" ? "" : dias(-5 + n * 6),
  };
});

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Inventario");
ws.columns = [
  ["VIN", "vin"], ["Modelo", "modelo"], ["Año", "anio"], ["Tipo", "tipo"], ["Segmento", "segmento"],
  ["Lote SAP", "lote_sap"], ["División SAP", "division_sap"], ["Costo", "costo"],
  ["Fecha alta inventario", "fecha_alta_inventario"], ["Status", "status"], ["Financiera", "financiera"],
  ["Saldo", "saldo"], ["Entrada plan piso", "entrada_plan_piso"], ["Vencimiento plan piso", "vencimiento_plan_piso"],
].map(([header, key]) => ({ header, key, width: 20 }));
unidades.forEach((u) => ws.addRow(u));
ws.getRow(1).font = { bold: true };
await wb.xlsx.writeFile("datos/demo_inventario.xlsx");
console.log("Excel demo: datos/demo_inventario.xlsx (20 unidades)");
if (process.argv.includes("--solo-excel")) process.exit(0);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: locs, error: e0 } = await sb.from("localidades").select("id,nombre,divisiones");
if (e0 || !locs?.length) throw new Error("Primero aplica supabase/seed.sql (localidades): " + (e0?.message ?? "vacío"));
// Si ninguna localidad tiene la división asignada, se reparten en rotación para tener datos de prueba.
let rot = 0;
const locDe = (div) => locs.find((l) => l.divisiones.includes(div))?.id ?? locs[rot++ % locs.length].id;

const check = async (p) => { const { error } = await p; if (error) throw new Error(error.message); };
await check(sb.from("unidades").upsert(unidades.map((u) => ({
  vin: u.vin, modelo: u.modelo, anio: u.anio, tipo: u.tipo, segmento: u.segmento, lote_sap: u.lote_sap,
  division_sap: u.division_sap, fecha_alta_inventario: u.fecha_alta_inventario, status: u.status,
  // La unidad vendida ya no tiene ubicación; las demás parten de la localidad de su división.
  localidad_id: u.status === "vendida" ? null : locDe(u.division_sap),
}))));
await check(sb.from("unidades_costos").upsert(unidades.map((u) => ({ vin: u.vin, costo: u.costo }))));
await check(sb.from("financiamientos").upsert(unidades.map((u) => ({
  vin: u.vin, financiera: u.financiera, disposicion: 1, saldo: u.saldo,
  fecha_entrada_plan_piso: u.entrada_plan_piso || null, fecha_vencimiento_plan_piso: u.vencimiento_plan_piso || null,
})), { onConflict: "vin,disposicion" }));
// Dos seguros manuales de ejemplo (uno vencido, uno por vencer): ganan sobre la regla de 355 días
await check(sb.from("seguros").insert([
  { vin: unidades[0].vin, fecha_alta_seguro: dias(-380), fecha_vencimiento: dias(-15), origen: "manual", notas: "Demo: acuse aseguradora" },
  { vin: unidades[1].vin, fecha_alta_seguro: dias(-340), fecha_vencimiento: dias(20), origen: "manual", notas: "Demo: acuse aseguradora" },
]));
console.log(`Cargadas ${unidades.length} unidades demo en ${locs.length} localidades.`);
