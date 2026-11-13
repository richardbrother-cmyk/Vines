import Link from "next/link";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

async function salir() {
  "use server";
  const sb = await crearClienteServidor();
  await sb.auth.signOut();
  redirect("/login");
}

export function Barra({ nombre, rol }: { nombre?: string | null; rol?: string }) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
      <Link href="/conteos" className="font-bold">Inventario físico</Link>
      <form action={salir} className="flex items-center gap-3 text-sm text-slate-500">
        <span>{nombre} · {rol}</span>
        <button className="underline">Salir</button>
      </form>
    </header>
  );
}
