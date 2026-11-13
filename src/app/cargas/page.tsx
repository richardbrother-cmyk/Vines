import { redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { ImportadorExcel } from "@/components/ImportadorExcel";
import { miPerfil } from "@/lib/datos";
import { fechaHora } from "@/lib/formato";
import type { Mapeo } from "@/lib/importar";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function Cargas() {
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");
  if (perfil.rol !== "admin") redirect("/conteos");

  const [{ data: mapeos }, { data: cargas }] = await Promise.all([
    sb.from("mapeos_columnas").select("tipo,mapeo"),
    sb.from("cargas").select("id,tipo,archivo,filas_total,insertadas,actualizadas,errores,creado_en").order("creado_en", { ascending: false }).limit(15),
  ]);
  const guardados = Object.fromEntries((mapeos ?? []).map((m) => [m.tipo, m.mapeo as Mapeo]));

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-2xl p-4 space-y-6">
        <h1 className="text-xl font-bold">Carga de datos desde Excel</h1>
        <ImportadorExcel mapeosGuardados={guardados} />

        <section>
          <h2 className="font-semibold mb-2">Bitácora de cargas</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            {(cargas ?? []).map((c) => {
              const errs = (c.errores as { fila: number; vin: string; error: string }[] | null) ?? [];
              return (
                <li key={c.id} className="py-3">
                  <p className="font-medium">{c.tipo === "sap" ? "Inventario SAP" : "Financiera"} · {c.archivo}</p>
                  <p className="text-xs text-slate-500">{fechaHora(c.creado_en)} · {c.filas_total} filas · {c.insertadas} nuevas · {c.actualizadas} actualizadas · {errs.length} errores</p>
                  {errs.length > 0 && (
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer text-red-700">Detalle de errores</summary>
                      <ul>{errs.slice(0, 50).map((e, i) => <li key={i}>{e.fila ? `Fila ${e.fila}: ` : ""}{e.vin || "—"} — {e.error}</li>)}</ul>
                    </details>
                  )}
                </li>
              );
            })}
            {(cargas ?? []).length === 0 && <li className="py-4 text-slate-500">Aún no hay cargas.</li>}
          </ul>
        </section>
      </main>
    </>
  );
}
