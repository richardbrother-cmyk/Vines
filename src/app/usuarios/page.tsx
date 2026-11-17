import { redirect } from "next/navigation";
import { Barra } from "@/components/Barra";
import { GestorUsuarios, type Usuario } from "@/components/GestorUsuarios";
import { miPerfil } from "@/lib/datos";
import { crearClienteServidor } from "@/lib/supabase/server";

const PERMISOS: [string, boolean, boolean, boolean][] = [
  // acción, admin, auditor, consulta
  ["Ver unidades, fichas y dashboard", true, true, true],
  ["Ver costos, saldos y financiamiento", true, false, true],
  ["Ver conteos y reportes", true, true, true],
  ["Abrir, escanear y cerrar conteos", true, true, false],
  ["Cargar Excel (SAP / financieras)", true, false, false],
  ["Registrar acuses de seguro", true, false, false],
  ["Gestionar usuarios y permisos", true, false, false],
];

export default async function Usuarios() {
  const sb = await crearClienteServidor();
  const perfil = await miPerfil(sb);
  if (!perfil) redirect("/login");
  if (perfil.rol !== "admin") redirect("/conteos");

  const [{ data: usuarios, error }, { data: localidades }] = await Promise.all([
    sb.rpc("usuarios_listar"),
    sb.from("localidades").select("id,nombre").eq("activa", true).order("nombre"),
  ]);

  return (
    <>
      <Barra nombre={perfil.nombre} rol={perfil.rol} />
      <main className="mx-auto max-w-2xl p-4 space-y-6">
        <h1 className="text-xl font-bold">Usuarios y permisos</h1>
        {error ? (
          <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">
            No se pudo cargar la lista: {error.message}. Si acabas de actualizar la app, ejecuta la migración <code>0006_usuarios.sql</code> en Supabase.
          </p>
        ) : (
          <GestorUsuarios usuarios={(usuarios ?? []) as Usuario[]} localidades={localidades ?? []} yo={perfil.id} />
        )}

        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-sm space-y-2">
          <h2 className="font-semibold">Cómo dar de alta a alguien</h2>
          <ol className="list-decimal pl-5 space-y-1">
            <li>En Supabase → Authentication → Users → <b>Add user</b>, crea la cuenta con correo y contraseña (marca <i>Auto Confirm User</i>).</li>
            <li>Vuelve aquí: aparecerá en <b>Pendientes de activar</b>, sin acceso a nada.</li>
            <li>Elige su rol, sus localidades si es auditor, marca <b>Activo</b> y guarda.</li>
          </ol>
          <p className="text-slate-500">Para dar de baja a alguien, desmarca <b>Activo</b>: deja de ver cualquier dato al instante y conserva su historial.</p>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Qué puede hacer cada rol</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2 font-normal">Permiso</th><th className="px-2 font-normal">Admin</th><th className="px-2 font-normal">Auditor</th><th className="px-2 font-normal">Consulta</th></tr></thead>
              <tbody>
                {PERMISOS.map(([t, a, b, c]) => (
                  <tr key={t} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="py-2 pr-2">{t}</td>
                    {[a, b, c].map((v, i) => <td key={i} className="px-2 text-center">{v ? "✓" : "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">El auditor solo ve y opera los conteos de las localidades que tenga asignadas.</p>
        </section>
      </main>
    </>
  );
}
