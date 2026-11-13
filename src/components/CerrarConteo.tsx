"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { pendientesDeConteo } from "@/lib/offline";
import { sincronizar } from "@/lib/sync";

export function CerrarConteo({ conteoId, faltantes }: { conteoId: string; faltantes: number }) {
  const router = useRouter();
  const [actualizar, setActualizar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cerrar() {
    setOcupado(true);
    setError(null);
    try {
      // Nada se cierra con escaneos aún en la cola de este dispositivo.
      if ((await pendientesDeConteo(conteoId)) > 0) {
        await sincronizar(conteoId);
        if ((await pendientesDeConteo(conteoId)) > 0) {
          setError("Hay escaneos pendientes de sincronizar. Conéctate a internet y vuelve a intentar.");
          return;
        }
      }
      const { error } = await crearClienteNavegador().rpc("cerrar_conteo", {
        p_conteo: conteoId, p_actualizar_ubicacion: actualizar,
      });
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar");
    } finally {
      setOcupado(false);
      setConfirmar(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <h2 className="font-semibold">Cerrar conteo</h2>
      <p className="text-sm text-slate-500">
        Al cerrar, la sesión queda inmutable y se congelan los {faltantes} faltante(s). Las correcciones se hacen con una nueva sesión.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>Actualizar la “última ubicación conocida” de todas las unidades contadas a esta localidad</span>
      </label>
      {error && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {!confirmar ? (
        <button onClick={() => setConfirmar(true)} className="w-full rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-3 font-semibold">
          Cerrar conteo
        </button>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setConfirmar(false)} disabled={ocupado} className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-3">Cancelar</button>
          <button onClick={cerrar} disabled={ocupado} className="flex-1 rounded-xl bg-red-600 text-white py-3 font-semibold disabled:opacity-50">
            {ocupado ? "Cerrando…" : "Sí, cerrar definitivamente"}
          </button>
        </div>
      )}
    </section>
  );
}
