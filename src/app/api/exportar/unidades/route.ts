import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { miPerfil, traerTodo } from "@/lib/datos";
import { aplicarFiltros, leerFiltros } from "@/lib/filtrosUnidades";
import { NOMBRE_STATUS } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) return new NextResponse("No autenticado", { status: 401 });

  const f = leerFiltros(Object.fromEntries(req.nextUrl.searchParams));
  const filas = await traerTodo<Record<string, unknown>>((d, h) =>
    aplicarFiltros(sb.from("v_unidades_full").select("*"), f).range(d, h));

  const verDinero = perfil.rol !== "auditor";
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Unidades");
  ws.columns = [
    { header: "VIN", key: "vin", width: 20 }, { header: "Modelo", key: "modelo", width: 18 },
    { header: "Año", key: "anio", width: 7 }, { header: "Tipo", key: "tipo", width: 9 },
    { header: "Segmento", key: "segmento", width: 15 }, { header: "Lote SAP", key: "lote_sap", width: 12 },
    { header: "División", key: "division_sap", width: 9 }, { header: "Status", key: "status", width: 20 },
    { header: "Localidad", key: "localidad", width: 22 }, { header: "Alta inventario", key: "fecha_alta_inventario", width: 14 },
    ...(verDinero ? [
      { header: "Costo", key: "costo", width: 14 }, { header: "Financiera(s)", key: "financieras", width: 22 },
      { header: "Saldo", key: "saldo", width: 14 }, { header: "Vence plan piso", key: "plan_piso_vence", width: 14 },
      { header: "Días plan piso", key: "dias_plan_piso", width: 12 },
    ] : []),
    { header: "Vence seguro", key: "seguro_vence", width: 14 }, { header: "Origen seguro", key: "seguro_origen", width: 12 },
    { header: "Semáforo seguro", key: "seguro_semaforo", width: 14 }, { header: "Días seguro", key: "dias_seguro", width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of filas) {
    ws.addRow({
      ...r,
      status: NOMBRE_STATUS[String(r.status)] ?? r.status,
      financieras: Array.isArray(r.financieras) ? r.financieras.join(", ") : "",
    });
  }
  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  const hoy = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="unidades_${hoy}.xlsx"`,
    },
  });
}
