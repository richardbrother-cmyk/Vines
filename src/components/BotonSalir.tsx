"use client";
import { useState } from "react";
import { borrarDatosLocales, pendientesTotales } from "@/lib/offline";

// Al salir se borran catálogo, cola y páginas guardadas del dispositivo, para que el siguiente
// usuario no vea datos ajenos ni sincronice escaneos de otra persona a su nombre.
export function BotonSalir({ salir }: { salir: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  async function alSalir() {
    const n = await pendientesTotales().catch(() => 0);
    if (n > 0 && !window.confirm(`Hay ${n} escaneo(s) sin sincronizar en este dispositivo. Si sales ahora se PIERDEN. ¿Salir de todos modos?`)) return;
    setOcupado(true);
    await borrarDatosLocales();
    await salir();
  }
  return <button onClick={() => void alSalir()} disabled={ocupado} className="underline">{ocupado ? "Saliendo…" : "Salir"}</button>;
}
