import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegistrarSW } from "@/components/RegistrarSW";

export const metadata: Metadata = {
  title: "Inventario físico",
  description: "Conteo físico de unidades por localidad",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Inventario", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

// Dinámico: la configuración se lee en cada petición (variables de build o de ejecución del Worker).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // La URL y la clave anon son públicas por diseño (las protege RLS). Se entregan al navegador
  // desde el servidor para no depender de que existieran al compilar.
  const config = JSON.stringify({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    clave: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  }).replace(/</g, "\\u003c");
  return (
    <html lang="es">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `window.__SUPABASE__=${config}` }} />
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
