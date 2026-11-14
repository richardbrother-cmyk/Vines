import Link from "next/link";
import { redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { miPerfil } from "@/lib/datos";
import { crearClienteServidor } from "@/lib/supabase/server";

async function abrir(datos: FormData) {
  "use server";
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc("abrir_conteo", { p_localidad: String(datos.get("localidad")) });
  if (error) redirect(`/conteos?error=${encodeURIComponent(error.message)}`);
  redirect(`/conteos/${data}`);
}

interface Resumen { pct_coincidencia: number | null; faltantes: number; sobrantes: number; otra_localidad: number }

export default async function Conteos({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");

  const [{ data: locs }, { data: asignadas }, { data: abiertos }, { data: cerrados }] = await Promise.all([
    sb.from("localidades").select("id,nombre,direccion").eq("activa", true).order("nombre"),
    sb.from("usuario_localidades").select("localidad_id").eq("usuario_id", perfil.id),
    sb.from("conteos").select("id,localidad_id,creado_en").eq("status", "abierto"),
    sb.from("conteos").select("id,fecha,cerrado_en,resumen,localidades(nombre)").eq("status", "cerrado")
      .order("cerrado_en", { ascending: false }).limit(20),
  ]);

  const puedeOperar = perfil.rol === "admin" || perfil.rol === "auditor";
  const mias = new Set((asignadas ?? []).map((a) => a.localidad_id));
  const visibles = (locs ?? []).filter((l) => perfil.rol !== "auditor" || mias.has(l.id));
  const abiertoDe = new Map((abiertos ?? []).map((a) => [a.localidad_id, a.id]));

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-xl p-4 space-y-6">
        {error && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error === "sin_permiso" ? "No tienes permiso en esa localidad." : error}</p>}

        <section>
          <h2 className="font-semibold mb-2">Localidades</h2>
          {visibles.length === 0 && (
            <p className="text-sm text-slate-500">
              {perfil.rol === "auditor" ? "Aún no tienes localidades asignadas. Pídele a un administrador que te asigne una." : "No hay localidades registradas."}
            </p>
          )}
          <ul className="space-y-2">
            {visibles.map((l) => {
              const abierto = abiertoDe.get(l.id);
              return (
                <li key={l.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{l.nombre}</p>
                    <p className="text-xs text-slate-500 truncate">{abierto ? "Conteo en curso" : l.direccion ?? "Sin conteo abierto"}</p>
                  </div>
                  {abierto ? (
                    <Link href={`/conteos/${abierto}`} className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-semibold">Continuar</Link>
                  ) : puedeOperar ? (
                    <form action={abrir}>
                      <input type="hidden" name="localidad" value={l.id} />
                      <button className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 font-semibold">Iniciar conteo</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Conteos cerrados</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(cerrados ?? []).map((c) => {
              const r = c.resumen as Resumen | null;
              const loc = (c.localidades as unknown as { nombre: string } | null)?.nombre;
              return (
                <li key={c.id}>
                  <Link href={`/conteos/${c.id}/reporte`} className="py-3 flex items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">{loc}</span>
                      <span className="block text-xs text-slate-500">{c.fecha} · {r?.faltantes ?? 0} faltantes · {r?.sobrantes ?? 0} sobrantes</span>
                    </span>
                    <span className="text-lg font-bold">{r?.pct_coincidencia != null ? `${r.pct_coincidencia}%` : "—"}</span>
                  </Link>
                </li>
              );
            })}
            {(cerrados ?? []).length === 0 && <li className="py-4 text-sm text-slate-500">Todavía no hay conteos cerrados.</li>}
          </ul>
        </section>
      </main>
    </>
  );
}
