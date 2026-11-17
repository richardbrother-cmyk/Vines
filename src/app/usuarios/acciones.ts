"use server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { crearClienteServidor } from "@/lib/supabase/server";

export interface NuevoUsuario {
  email: string; nombre: string; password: string;
  rol: "admin" | "auditor" | "consulta"; localidades: string[];
}
export type ResultadoAlta = { ok: true; aviso?: string } | { ok: false; error: string };

const ROLES = ["admin", "auditor", "consulta"];

/** La clave maestra solo existe en el servidor (secreto del Worker); nunca se envía al navegador. */
export async function claveMaestraConfigurada(): Promise<boolean> {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Las Server Actions son endpoints públicos: toda la autorización se valida aquí, no en la pantalla.
export async function crearUsuario(d: NuevoUsuario): Promise<ResultadoAlta> {
  const sb = await crearClienteServidor();
  const { data: esAdmin, error: eAdmin } = await sb.rpc("es_admin");
  if (eAdmin || esAdmin !== true) return { ok: false, error: "Solo un administrador activo puede crear usuarios." };

  const email = String(d.email ?? "").trim().toLowerCase();
  const nombre = String(d.nombre ?? "").trim();
  const password = String(d.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "El correo no es válido." };
  if (password.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres." };
  if (!ROLES.includes(d.rol)) return { ok: false, error: "Rol no válido." };
  const localidades = d.rol === "auditor" && Array.isArray(d.localidades) ? d.localidades.map(String) : [];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    return { ok: false, error: "Falta configurar el secreto SUPABASE_SERVICE_ROLE_KEY en el servidor (Cloudflare → Settings → Variables and Secrets)." };
  }

  const admin = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre: nombre || email.split("@")[0] },
  });
  if (error || !data.user) {
    const m = error?.message ?? "sin respuesta";
    if (/already|registered|exists/i.test(m)) return { ok: false, error: "Ya existe una cuenta con ese correo." };
    if (/invalid api key|unauthorized|jwt|401|403/i.test(m)) return { ok: false, error: "Supabase rechazó la clave del servidor: revisa que SUPABASE_SERVICE_ROLE_KEY sea la clave service_role (o secret) de este proyecto." };
    return { ok: false, error: `No se pudo crear la cuenta: ${m}` };
  }

  // Rol, estado y localidades se asignan con la sesión del administrador (aplican candados y bitácora).
  const { error: ePerfil } = await sb.rpc("usuario_actualizar", {
    p_id: data.user.id, p_nombre: nombre || email.split("@")[0], p_rol: d.rol, p_activo: true, p_localidades: localidades,
  });
  revalidatePath("/usuarios");
  if (ePerfil) {
    return { ok: true, aviso: `La cuenta se creó, pero quedó pendiente de activar (${ePerfil.message}). Actívala en la lista de abajo.` };
  }
  return { ok: true };
}
