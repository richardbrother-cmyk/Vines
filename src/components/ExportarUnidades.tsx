"use client";
import { useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/datos";
import { aplicarFiltros, type Filtros } from "@/lib/filtrosUnidades";
import { NOMBRE_STATUS } from "@/lib/formato";

// Exporta a Excel el listado completo con los filtros activos. Se genera en el navegador
// (RLS decide qué ve cada rol; al auditor no se le incluyen columnas de dinero).
export function ExportarUnidades({ filtros, verDinero }: { filtros: Filtros; verDinero: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    setOcupado(true);
    setError(null);
    try {
      const sb = crearClienteNavegador();
      const filas = await traerTodo<Record<string, unknown>>((d, h) =>
        aplicarFiltros(sb.from("v_unidades_full").select("*"), filtros).range(d, h));

      const ExcelJS = (await import("exceljs")).default;
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
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `unidades_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo exportar");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="text-right">
      <button onClick={exportar} disabled={ocupado} className="rounded-lg bg-emerald-600 text-white px-3 py-2 font-semibold disabled:opacity-50">
        {ocupado ? "Generando…" : "Exportar a Excel"}
      </button>
      {error && <span className="block text-xs text-red-700 mt-1">{error}</span>}
    </span>
  );
}
