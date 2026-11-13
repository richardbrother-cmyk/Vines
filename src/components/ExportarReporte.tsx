"use client";
import { useState } from "react";

export interface FilaReporte {
  vin: string; modelo: string | null; anio: number | null; segmento: string | null;
  detalle: string; localidad_esperada?: string | null; escaneado_en?: string; observaciones?: string | null;
}
export interface DatosReporte {
  archivo: string;
  localidad: string;
  resumen: [string, string | number][];
  faltantes: FilaReporte[];
  sobrantes: FilaReporte[];
  otraLocalidad: FilaReporte[];
  facturadas: FilaReporte[];
  esperadasEncontradas: FilaReporte[];
}

const COLS = [
  { header: "VIN", key: "vin", width: 22 }, { header: "Modelo", key: "modelo", width: 16 },
  { header: "Año", key: "anio", width: 8 }, { header: "Segmento", key: "segmento", width: 16 },
  { header: "Detalle", key: "detalle", width: 30 }, { header: "Ubicación según base", key: "localidad_esperada", width: 24 },
  { header: "Escaneado", key: "escaneado_en", width: 20 }, { header: "Observaciones", key: "observaciones", width: 36 },
];

export function ExportarReporte({ datos }: { datos: DatosReporte }) {
  const [ocupado, setOcupado] = useState(false);

  async function exportar() {
    setOcupado(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const resumen = wb.addWorksheet("Resumen");
      resumen.columns = [{ width: 34 }, { width: 22 }];
      resumen.addRow([`Conteo físico — ${datos.localidad}`]).font = { bold: true, size: 14 };
      datos.resumen.forEach((r) => resumen.addRow(r));
      const hojas: [string, FilaReporte[]][] = [
        ["Faltantes", datos.faltantes], ["Sobrantes", datos.sobrantes],
        ["En otra localidad", datos.otraLocalidad], ["Facturadas en patio", datos.facturadas],
        ["Encontradas (ok)", datos.esperadasEncontradas],
      ];
      for (const [nombre, filas] of hojas) {
        const ws = wb.addWorksheet(nombre);
        ws.columns = COLS;
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: "frozen", ySplit: 1 }];
        filas.forEach((f) => ws.addRow(f));
        ws.autoFilter = { from: "A1", to: "H1" };
      }
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = datos.archivo; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button onClick={exportar} disabled={ocupado} className="w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold disabled:opacity-50">
      {ocupado ? "Generando…" : "Exportar a Excel"}
    </button>
  );
}
