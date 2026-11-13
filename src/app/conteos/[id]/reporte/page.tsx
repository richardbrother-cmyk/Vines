import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { CerrarConteo } from "@/components/CerrarConteo";
import { ExportarReporte, type FilaReporte } from "@/components/ExportarReporte";
import { miPerfil, traerTodo } from "@/lib/datos";
import { ETIQUETA, type Resultado } from "@/lib/clasificar";
import { crearClienteServidor } from "@/lib/supabase/server";

interface Det {
  vin: string; modelo: string | null; anio: number | null; segmento: string | null; resultado: Resultado;
  localidad_esperada: string | null; escaneado_en: string; observaciones: string | null;
}
interface Falt { vin: string; modelo: string | null; anio: number | null; segmento: string | null }

export default async function Reporte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");

  const { data: c } = await sb.from("conteos")
    .select("id,fecha,status,cerrado_en,actualizo_ubicacion,resumen,localidades(nombre)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const localidad = (c.localidades as unknown as { nombre: string } | null)?.nombre ?? "";
  const cerrado = c.status === "cerrado";

  const detalle = await traerTodo<Det>((d, h) =>
    sb.from("v_conteo_detalle")
      .select("vin,modelo,anio,segmento,resultado,localidad_esperada,escaneado_en,observaciones")
      .eq("conteo_id", id).order("escaneado_en").range(d, h));
  const faltantes = cerrado
    ? await traerTodo<Falt>((d, h) => sb.from("conteo_faltantes").select("vin,modelo,anio,segmento").eq("conteo_id", id).order("modelo").range(d, h))
    : await traerTodo<Falt>((d, h) => sb.rpc("conteo_faltantes_calc", { p_conteo: id }).range(d, h));

  const por = (r: Resultado) => detalle.filter((x) => x.resultado === r);
  const fila = (x: Det, detalleTxt: string): FilaReporte => ({
    vin: x.vin, modelo: x.modelo, anio: x.anio, segmento: x.segmento, detalle: detalleTxt,
    localidad_esperada: x.localidad_esperada, escaneado_en: x.escaneado_en, observaciones: x.observaciones,
  });
  const esperadas = por("esperada");
  const esperadasTotal = esperadas.length + faltantes.length;
  const pct = esperadasTotal ? Math.round((1000 * esperadas.length) / esperadasTotal) / 10 : null;

  const resumen: [string, string | number][] = [
    ["Estado", cerrado ? `Cerrado ${c.cerrado_en?.slice(0, 16).replace("T", " ")}` : "Abierto (vista previa)"],
    ["Unidades esperadas", esperadasTotal], ["Encontradas", esperadas.length],
    ["Faltantes", faltantes.length], ["Sobrantes", por("sobrante").length],
    ["Encontradas en otra localidad", por("otra_localidad").length],
    ["Facturadas aún en patio", por("facturada_en_patio").length],
    ["Vendidas encontradas en patio", por("vendida_en_patio").length],
    ["% coincidencia", pct != null ? `${pct}%` : "—"],
    ["Ubicaciones actualizadas al cerrar", cerrado ? (c.actualizo_ubicacion ? "Sí" : "No") : "—"],
  ];

  const datos = {
    archivo: `conteo_${localidad.replace(/\W+/g, "_")}_${c.fecha}.xlsx`,
    localidad, resumen,
    faltantes: faltantes.map((f) => ({ ...f, detalle: "Esperada, no encontrada" })),
    sobrantes: por("sobrante").map((x) => fila(x, ETIQUETA.sobrante)),
    otraLocalidad: por("otra_localidad").map((x) => fila(x, `Pertenece a ${x.localidad_esperada ?? "sin ubicación"}`)),
    facturadas: por("facturada_en_patio").map((x) => fila(x, ETIQUETA.facturada_en_patio)),
    esperadasEncontradas: esperadas.map((x) => fila(x, ETIQUETA.esperada)),
  };

  const puedeCerrar = !cerrado && (perfil.rol === "admin" || perfil.rol === "auditor");

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-xl p-4 space-y-5">
        <div>
          <Link href={cerrado ? "/conteos" : `/conteos/${id}`} className="text-sm text-slate-500">← {cerrado ? "Conteos" : "Seguir contando"}</Link>
          <h1 className="text-xl font-bold mt-1">{localidad}</h1>
          <p className="text-sm text-slate-500">{c.fecha} · {cerrado ? "Cerrado" : "Abierto: vista previa, los faltantes se congelan al cerrar"}</p>
        </div>

        <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4 text-center">
          <p className="text-4xl font-bold">{pct != null ? `${pct}%` : "—"}</p>
          <p className="text-sm text-slate-500">coincidencia ({esperadas.length} de {esperadasTotal} esperadas)</p>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          {resumen.slice(3, 8).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <dt className="text-slate-500">{k}</dt><dd className="text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <ExportarReporte datos={datos} />
        {puedeCerrar && <CerrarConteo conteoId={id} faltantes={faltantes.length} />}

        <Lista titulo="Faltantes" filas={faltantes.map((f) => ({ vin: f.vin, sub: `${f.modelo ?? ""} ${f.anio ?? ""}` }))} />
        <Lista titulo="Sobrantes (no existen en inventario)" filas={datos.sobrantes.map((f) => ({ vin: f.vin, sub: f.observaciones ?? "" }))} />
        <Lista titulo="Encontradas en otra localidad" filas={datos.otraLocalidad.map((f) => ({ vin: f.vin, sub: f.detalle }))} />
        <Lista titulo="Facturadas aún en patio" filas={datos.facturadas.map((f) => ({ vin: f.vin, sub: f.modelo ?? "" }))} />
      </main>
    </>
  );
}

function Lista({ titulo, filas }: { titulo: string; filas: { vin: string; sub: string }[] }) {
  if (filas.length === 0) return null;
  return (
    <section>
      <h2 className="font-semibold mb-1">{titulo} <span className="text-slate-500 font-normal">({filas.length})</span></h2>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
        {filas.slice(0, 200).map((f) => (
          <li key={f.vin} className="py-2"><span className="font-mono">{f.vin}</span><span className="block text-xs text-slate-500">{f.sub}</span></li>
        ))}
      </ul>
      {filas.length > 200 && <p className="text-xs text-slate-500 mt-1">Mostrando 200; el Excel trae todas.</p>}
    </section>
  );
}
