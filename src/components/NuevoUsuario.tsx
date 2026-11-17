"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { crearUsuario, type NuevoUsuario as Datos } from "@/app/usuarios/acciones";

interface Localidad { id: string; nombre: string }

function generar() {
  // Sin caracteres ambiguos (0/O, 1/l/I) para poder dictarla o escribirla en un celular.
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const n = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(n, (x) => abc[x % abc.length]).join("");
}

export function NuevoUsuario({ localidades }: { localidades: Localidad[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Datos["rol"]>("auditor");
  const [locs, setLocs] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ email: string; password: string; aviso?: string } | null>(null);
  const campo = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2 text-sm";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setError(null); setCreado(null);
    try {
      const r = await crearUsuario({ email, nombre, password, rol, localidades: [...locs] });
      if (!r.ok) { setError(r.error); return; }
      setCreado({ email: email.trim().toLowerCase(), password, aviso: r.aviso });
      setEmail(""); setNombre(""); setPassword(""); setLocs(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nuevo usuario</h2>
        <button onClick={() => setAbierto(!abierto)} className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold">
          {abierto ? "Cerrar" : "Agregar usuario"}
        </button>
      </div>

      {creado && (
        <div role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3 space-y-1">
          <p><b>Usuario creado.</b> Compártele estos datos; la contraseña no se vuelve a mostrar:</p>
          <p className="font-mono break-all">{creado.email}<br />{creado.password}</p>
          {creado.aviso && <p className="text-amber-800">{creado.aviso}</p>}
        </div>
      )}

      {abierto && (
        <form onSubmit={enviar} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-sm">Correo
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={campo} />
            </label>
            <label className="text-sm">Nombre
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={campo} />
            </label>
            <label className="text-sm">Contraseña temporal (mín. 8)
              <span className="flex gap-2">
                <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={campo + " font-mono"} />
                <button type="button" onClick={() => setPassword(generar())} className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 text-sm whitespace-nowrap">Generar</button>
              </span>
            </label>
            <label className="text-sm">Rol
              <select value={rol} onChange={(e) => setRol(e.target.value as Datos["rol"])} className={campo}>
                <option value="auditor">Auditor</option><option value="consulta">Consulta</option><option value="admin">Administrador</option>
              </select>
            </label>
          </div>
          {rol === "auditor" && (
            <fieldset>
              <legend className="text-sm mb-1">Localidades que puede contar</legend>
              <div className="flex flex-wrap gap-2">
                {localidades.map((l) => (
                  <label key={l.id} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm cursor-pointer ${locs.has(l.id) ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-slate-300 dark:border-slate-600"}`}>
                    <input type="checkbox" className="h-4 w-4" checked={locs.has(l.id)}
                      onChange={(e) => { const s = new Set(locs); if (e.target.checked) s.add(l.id); else s.delete(l.id); setLocs(s); }} />
                    {l.nombre}
                  </label>
                ))}
              </div>
              {locs.size === 0 && <p className="text-xs text-amber-700 mt-1">Sin localidades asignadas no podrá abrir ni ver ningún conteo.</p>}
            </fieldset>
          )}
          {rol === "admin" && <p className="text-xs text-amber-700">Un administrador ve costos y saldos, carga datos y gestiona usuarios.</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
          <button disabled={ocupado} className="w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold disabled:opacity-50">
            {ocupado ? "Creando…" : "Crear usuario"}
          </button>
        </form>
      )}
    </section>
  );
}
