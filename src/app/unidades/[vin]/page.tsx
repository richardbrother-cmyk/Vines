import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Barra } from "@/components/Barra";
import { BadgePlanPiso, BadgeSeguro, BadgeStatus } from "@/components/Badges";
import { miPerfil } from "@/lib/datos";
import { ETIQUETA, type Resultado } from "@/lib/clasificar";
import { dinero, fecha, fechaHora } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { normalizarVin } from "@/lib/vin";

async function agregarSeguro(datos: FormData) {
  "use server";
  const sb = await crearClienteServidor();
  const vin = String(datos.get("vin"));
  const venc = String(datos.get("fecha_vencimiento") ?? "");
  if (!venc) return;
  await sb.from("seguros").insert({
    vin, origen: "manual", fecha_vencimiento: venc,
    fecha_alta_seguro: String(datos.get("fecha_alta_seguro") || "") || null,
    notas: String(datos.get("notas") || "") || null,
  });
  revalidatePath(`/unidades/${vin}`);
}

const COLOR: Record<string, string> = {
  esperada: "text-emerald-700", otra_localidad: "text-amber-700", sobrante: "text-red-700",
  facturada_en_patio: "text-violet-700", vendida_en_patio: "text-rose-700",
};

export default async function Ficha({ params }: { params: Promise<{ vin: string }> }) {
  const { vin: crudo } = await params;
  const vin = normalizarVin(decodeURIComponent(crudo));
  if (vin.length < 17) redirect(`/unidades?q=${vin}`);

  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");

  const [{ data: u }, { data: fin }, { data: hist }, { data: seguros }] = await Promise.all([
    sb.from("v_unidades_full").select("*").eq("vin", vin).maybeSingle(),
    sb.from("financiamientos").select("*").eq("vin", vin).order("disposicion"),
    sb.from("v_historial_unidad").select("*").eq("vin", vin).order("escaneado_en", { ascending: false }).limit(50),
    sb.from("seguros").select("*").eq("vin", vin).order("created_at", { ascending: false }),
  ]);

  if (!u) {
    // Puede ser un sobrante de conteo (VIN que no existe en inventario)
    if (!hist?.length) notFound();
  }

  const rutas = (hist ?? []).map((h) => h.foto_path as string | null).filter((p): p is string => !!p);
  const firmadas = new Map<string, string>();
  if (rutas.length) {
    const { data } = await sb.storage.from("conteo-fotos").createSignedUrls(rutas, 3600);
    data?.forEach((d) => { if (d.path && d.signedUrl) firmadas.set(d.path, d.signedUrl); });
  }
  const verDinero = perfil.rol !== "auditor";

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-2xl p-4 space-y-4">
        <Link href="/unidades" className="text-sm text-slate-500">← Unidades</Link>
        <div>
          <h1 className="font-mono text-xl break-all">{vin}</h1>
          {u ? (
            <>
              <p className="text-slate-600 dark:text-slate-300">{u.modelo} {u.anio} · {u.tipo} · {u.segmento}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <BadgeStatus status={u.status} />
                <BadgeSeguro semaforo={u.seguro_semaforo} dias={u.dias_seguro} />
                <BadgePlanPiso dias={u.dias_plan_piso} />
              </div>
            </>
          ) : (
            <p className="text-red-700">Este VIN no existe en el inventario (aparece como sobrante en conteos).</p>
          )}
        </div>

        {u && (
          <>
            <Tarjeta titulo="Ubicación">
              <Fila k="Última conocida" v={u.localidad ?? "Sin ubicación"} />
              <Fila k="Actualizada" v={fechaHora(u.ubicacion_actualizada_en)} />
              <Fila k="División / lote SAP" v={`${u.division_sap ?? "—"} / ${u.lote_sap ?? "—"}`} />
              <Fila k="Alta en inventario" v={fecha(u.fecha_alta_inventario)} />
              {verDinero && <Fila k="Costo" v={dinero(u.costo)} />}
            </Tarjeta>

            {verDinero && (
              <Tarjeta titulo="Financiamiento (plan piso)">
                {(fin ?? []).length === 0 && <p className="text-sm text-slate-500">Sin financiamiento registrado.</p>}
                {(fin ?? []).map((f) => (
                  <div key={f.id} className="py-2 border-t first:border-t-0 border-slate-200 dark:border-slate-700 text-sm">
                    <p className="font-medium">{f.financiera} <span className="text-slate-500 font-normal">· disposición {f.disposicion}{f.concepto ? ` (${f.concepto})` : ""}</span></p>
                    <Fila k="Saldo" v={dinero(f.saldo)} />
                    <Fila k="Entrada a plan piso" v={fecha(f.fecha_entrada_plan_piso)} />
                    <Fila k="Vencimiento" v={fecha(f.fecha_vencimiento_plan_piso)} />
                  </div>
                ))}
                {(fin ?? []).length > 1 && <Fila k="Saldo total" v={dinero(u.saldo)} />}
              </Tarjeta>
            )}

            <Tarjeta titulo="Seguro">
              <Fila k="Vence" v={fecha(u.seguro_vence)} />
              <Fila k="Origen" v={u.seguro_origen === "manual" ? "Registro de aseguradora (manual)" : "Regla: 355 días desde alta en inventario / plan piso"} />
              {(seguros ?? []).map((s) => (
                <p key={s.id} className="text-xs text-slate-500">Manual: vence {fecha(s.fecha_vencimiento)}{s.notas ? ` · ${s.notas}` : ""}</p>
              ))}
              {perfil.rol === "admin" && (
                <form action={agregarSeguro} className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <input type="hidden" name="vin" value={vin} />
                  <label className="col-span-1">Alta<input type="date" name="fecha_alta_seguro" className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2" /></label>
                  <label className="col-span-1">Vencimiento*<input required type="date" name="fecha_vencimiento" className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2" /></label>
                  <input name="notas" placeholder="Notas (acuse, póliza…)" className="col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2" />
                  <button className="col-span-2 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-2 font-semibold">Registrar acuse de aseguradora</button>
                </form>
              )}
            </Tarjeta>
          </>
        )}

        <Tarjeta titulo="Historial de conteos">
          {(hist ?? []).length === 0 && <p className="text-sm text-slate-500">Nunca ha sido contada.</p>}
          {(hist ?? []).map((h) => (
            <div key={`${h.conteo_id}`} className="py-2 border-t first:border-t-0 border-slate-200 dark:border-slate-700 text-sm">
              <p><span className={`font-medium ${COLOR[h.resultado] ?? ""}`}>{ETIQUETA[h.resultado as Resultado]}</span>
                {" · "}<Link className="underline" href={`/conteos/${h.conteo_id}/reporte`}>{h.localidad_conteo}</Link></p>
              <p className="text-xs text-slate-500">{fechaHora(h.escaneado_en)} · {h.metodo}{h.status_conteo === "abierto" ? " · conteo abierto" : ""}</p>
              {h.observaciones && <p className="mt-1">“{h.observaciones}”</p>}
              {h.foto_path && firmadas.get(h.foto_path) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firmadas.get(h.foto_path)} alt="Foto del conteo" className="mt-2 rounded-lg max-h-56" />
              )}
            </div>
          ))}
        </Tarjeta>
      </main>
    </>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
      <h2 className="font-semibold mb-2">{titulo}</h2>
      {children}
    </section>
  );
}
function Fila({ k, v }: { k: string; v: string }) {
  return <p className="flex justify-between gap-4 text-sm py-0.5"><span className="text-slate-500">{k}</span><span className="text-right">{v}</span></p>;
}
