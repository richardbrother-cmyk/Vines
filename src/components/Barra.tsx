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
  const enlaces = [
    { href: "/conteos", t: "Conteos" },
    { href: "/unidades", t: "Unidades" },
    { href: "/dashboard", t: "Dashboard" },
    ...(rol === "admin" ? [{ href: "/cargas", t: "Cargas" }] : []),
  ];
  return (
    <header className="border-b border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/conteos" className="font-bold">Inventario físico</Link>
        <form action={salir} className="flex items-center gap-3 text-sm text-slate-500">
          <span className="hidden sm:inline">{nombre} · {rol}</span>
          <button className="underline">Salir</button>
        </form>
      </div>
      <nav className="flex gap-1 px-3 pb-2 text-sm overflow-x-auto">
        {enlaces.map((e) => (
          <Link key={e.href} href={e.href} className="rounded-full px-3 py-1 bg-slate-100 dark:bg-slate-800 whitespace-nowrap">{e.t}</Link>
        ))}
      </nav>
    </header>
  );
}
