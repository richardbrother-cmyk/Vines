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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
