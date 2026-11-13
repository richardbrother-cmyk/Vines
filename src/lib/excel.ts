// Lectura de .xlsx (navegador o Node) a filas { encabezado: valor }.
import ExcelJS from "exceljs";

export interface HojaLeida {
  hojas: string[];
  hoja: string;
  encabezados: string[];
  filas: Record<string, unknown>[];
}

function valorCelda(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return valorCelda((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as ExcelJS.CellHyperlinkValue).text;
    if ("error" in v) return null;
  }
  return v;
}

export async function leerExcel(datos: ArrayBuffer | Uint8Array, hojaNombre?: string): Promise<HojaLeida> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(datos as ArrayBuffer);
  const hojas = wb.worksheets.map((w) => w.name);
  const ws = (hojaNombre && wb.getWorksheet(hojaNombre)) || wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene hojas");

  // El encabezado es la primera fila con al menos 2 celdas con texto (los exportes de SAP traen títulos arriba).
  let filaEnc = 0;
  ws.eachRow((row, n) => {
    if (filaEnc) return;
    const llenas = (row.values as ExcelJS.CellValue[]).filter((c) => c != null && String(valorCelda(c)).trim() !== "").length;
    if (llenas >= 2) filaEnc = n;
  });
  if (!filaEnc) throw new Error("No se encontró una fila de encabezados");

  const encabezados: string[] = [];
  ws.getRow(filaEnc).eachCell({ includeEmpty: false }, (c, col) => {
    encabezados[col] = String(valorCelda(c.value) ?? "").trim();
  });
  const filas: Record<string, unknown>[] = [];
  ws.eachRow((row, n) => {
    if (n <= filaEnc) return;
    const obj: Record<string, unknown> = {};
    let alguna = false;
    encabezados.forEach((h, col) => {
      if (!h) return;
      const v = valorCelda(row.getCell(col).value);
      if (v != null && String(v).trim() !== "") alguna = true;
      obj[h] = v;
    });
    if (alguna) filas.push({ ...obj, __fila: n });
  });
  return { hojas, hoja: ws.name, encabezados: encabezados.filter(Boolean), filas };
}
