import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

async function entrar(datos: FormData) {
  "use server";
  const sb = await crearClienteServidor();
  const { error } = await sb.auth.signInWithPassword({
    email: String(datos.get("email") ?? "").trim(),
    password: String(datos.get("password") ?? ""),
  });
  if (error) redirect("/login?error=1");
  redirect("/conteos");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <form action={entrar} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Inventario físico</h1>
        <p className="text-slate-500 text-sm">Zapata Camiones · Guadalajara</p>
        {error && <p className="rounded-lg bg-red-50 text-red-800 text-sm p-3">Correo o contraseña incorrectos.</p>}
        <input name="email" type="email" required autoComplete="username" placeholder="Correo"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-3" />
        <input name="password" type="password" required autoComplete="current-password" placeholder="Contraseña"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-3" />
        <button className="w-full rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 py-3 font-semibold">Entrar</button>
      </form>
    </main>
  );
}
