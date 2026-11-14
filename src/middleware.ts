import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function aviso(titulo: string, detalle: string, status: number) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">${titulo}</h1><p>${detalle}</p></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// Refresca la sesión de Supabase y exige login en todas las rutas salvo /login.
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !clave) {
    // Causa típica de un "500 Internal Server Error" en todas las páginas tras un despliegue.
    console.error("Configuración incompleta: faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en el build");
    return aviso(
      "Configuración incompleta",
      `Esta versión se compiló sin ${[!url && "NEXT_PUBLIC_SUPABASE_URL", !clave && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean).join(" ni ")}.
       Defínelas como <b>variables de build</b> (en Cloudflare: Settings → Build → Build variables and secrets) y vuelve a desplegar.`,
      503,
    );
  }

  try {
    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(url, clave, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (lista) => {
          lista.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          lista.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    const enLogin = req.nextUrl.pathname.startsWith("/login");
    if (!data.user && !enLogin) {
      const destino = req.nextUrl.clone();
      destino.pathname = "/login";
      return NextResponse.redirect(destino);
    }
    if (data.user && enLogin) {
      const destino = req.nextUrl.clone();
      destino.pathname = "/conteos";
      return NextResponse.redirect(destino);
    }
    return res;
  } catch (e) {
    // Nunca un 500 mudo: el motivo queda en los registros y a la vista.
    const m = e instanceof Error ? e.message : String(e);
    console.error("Fallo en middleware:", req.nextUrl.pathname, e);
    return aviso("No se pudo procesar la solicitud", `Error al validar la sesión: <code>${m.replace(/[<>&]/g, "")}</code>`, 500);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)"],
};
