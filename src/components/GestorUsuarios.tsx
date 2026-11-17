"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { fechaHora } from "@/lib/formato";

export interface Usuario {
  id: string; email: string; nombre: string | null; rol: "admin" | "auditor" | "consulta"; activo: boolean;
  creado_en: string; ultimo_acceso: string | null; localidades: string[];
}
interface Localidad { id: string; nombre: string }

const ROLES: Record<Usuario["rol"], string> = { admin: "Administrador", auditor: "Auditor", consulta: "Consulta" };
const ERRORES: Record<string, string> = {
  no_puedes_quitarte_admin: "No puedes quitarte a ti mismo el rol de administrador ni desactivarte.",
  debe_quedar_un_admin: "Debe quedar al menos un administrador activo.",
  sin_permiso: "Solo un administrador puede cambiar usuarios.",
};

export function GestorUsuarios({ usuarios, localidades, yo }: { usuarios: Usuario[]; localidades: Localidad[]; yo: string }) {
  const pendientes = usuarios.filter((u) => !u.activo);
  const activos = usuarios.filter((u) => u.activo);
  return (
    <div className="space-y-6">
      {pendientes.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">Pendientes de activar ({pendientes.length})</h2>
          <ul className="space-y-3">{pendientes.map((u) => <Tarjeta key={u.id} u={u} localidades={localidades} yo={yo} />)}</ul>
        </section>
      )}
      <section>
        <h2 className="font-semibold mb-2">Usuarios activos ({activos.length})</h2>
        <ul className="space-y-3">{activos.map((u) => <Tarjeta key={u.id} u={u} localidades={localidades} yo={yo} />)}</ul>
      </section>
    </div>
  );
}

function Tarjeta({ u, localidades, yo }: { u: Usuario; localidades: Localidad[]; yo: string }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(u.nombre ?? "");
  const [rol, setRol] = useState(u.rol);
  const [activo, setActivo] = useState(u.activo);
  const [locs, setLocs] = useState<Set<string>>(new Set(u.localidades));
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const soyYo = u.id === yo;
  const cambiado = nombre !== (u.nombre ?? "") || rol !== u.rol || activo !== u.activo
    || locs.size !== u.localidades.length || u.localidades.some((l) => !locs.has(l));
  const auditorSinLocalidad = rol === "auditor" && activo && locs.size === 0;
  const campo = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-2 text-sm";

  async function guardar() {
    setOcupado(true); setMsg(null);
    try {
      const { error } = await crearClienteNavegador().rpc("usuario_actualizar", {
        p_id: u.id, p_nombre: nombre, p_rol: rol, p_activo: activo, p_localidades: [...locs],
      });
      if (error) {
        const clave = Object.keys(ERRORES).find((k) => error.message.includes(k));
        setMsg({ ok: false, t: clave ? ERRORES[clave] : error.message });
      } else {
        setMsg({ ok: true, t: "Guardado." });
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className={`rounded-2xl border p-4 space-y-3 ${u.activo ? "border-slate-200 dark:border-slate-700" : "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{u.email}{soyYo && <span className="text-slate-500 font-normal"> (tú)</span>}</p>
          <p className="text-xs text-slate-500">Alta: {fechaHora(u.creado_en)} · Último acceso: {u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : "nunca"}</p>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0">
          <input type="checkbox" checked={activo} disabled={soyYo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4" />
          Activo
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} />
        </label>
        <label className="text-sm">Rol
          <select value={rol} disabled={soyYo} onChange={(e) => setRol(e.target.value as Usuario["rol"])} className={campo}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      {rol === "auditor" ? (
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
          {auditorSinLocalidad && <p className="text-xs text-amber-700 mt-1">Sin localidades asignadas no podrá abrir ni ver ningún conteo.</p>}
        </fieldset>
      ) : (
        <p className="text-xs text-slate-500">{rol === "admin" ? "Ve y opera todas las localidades." : "Ve todas las localidades, sin poder modificar nada."}</p>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void guardar()} disabled={!cambiado || ocupado}
          className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm font-semibold disabled:opacity-40">
          {ocupado ? "Guardando…" : !u.activo && activo ? "Activar y guardar" : "Guardar cambios"}
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.t}</span>}
      </div>
    </li>
  );
}
