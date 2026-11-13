// Utilidades de lectura en servidor.
import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST limita a 1000 filas por consulta: pagina hasta traer todo. */
export async function traerTodo<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todo: T[] = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await pedir(d, d + 999);
    if (error) throw new Error(error.message);
    todo.push(...(data ?? []));
    if (!data || data.length < 1000) return todo;
  }
}

export type Rol = "admin" | "auditor" | "consulta";

export async function miPerfil(sb: SupabaseClient) {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data } = await sb.from("perfiles").select("nombre,rol").eq("id", u.user.id).single();
  return data ? { id: u.user.id, nombre: data.nombre as string | null, rol: data.rol as Rol } : null;
}
