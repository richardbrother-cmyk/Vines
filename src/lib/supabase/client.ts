import { createBrowserClient } from "@supabase/ssr";

declare global {
  interface Window { __SUPABASE__?: { url: string; clave: string } }
}

export function crearClienteNavegador() {
  // 1.º lo que entrega el servidor en la página; 2.º lo incrustado al compilar.
  const inyectada = typeof window !== "undefined" ? window.__SUPABASE__ : undefined;
  const url = inyectada?.url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = inyectada?.clave || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !clave) {
    throw new Error("Configuración incompleta: el navegador no recibió la URL ni la clave de Supabase. Recarga la página; si persiste, revisa las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY del despliegue.");
  }
  return createBrowserClient(url, clave);
}
