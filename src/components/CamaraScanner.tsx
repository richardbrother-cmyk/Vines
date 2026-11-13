"use client";
import { useEffect, useRef, useState } from "react";

// Lector de código de barras (Code 39 / Code 128 / QR). html5-qrcode usa la
// Barcode Detection API nativa cuando existe (Chrome/Android) y cae a ZXing en JS
// (iOS Safari y otros), que funciona sin red una vez cargada la app.
export function CamaraScanner({ onLectura, onCerrar }: { onLectura: (texto: string) => void; onCerrar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);
  const alLeer = useRef(onLectura);
  alLeer.current = onLectura;

  useEffect(() => {
    let detenido = false;
    let lector: import("html5-qrcode").Html5Qrcode | null = null;
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode");
        lector = new Html5Qrcode("lector-camara", {
          verbose: false,
          formatsToSupport: [F.CODE_39, F.CODE_128, F.QR_CODE],
          useBarCodeDetectorIfSupported: true,
        });
        await lector.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 320, height: 130 } },
          (texto) => alLeer.current(texto),
          undefined,
        );
        if (detenido) await lector.stop();
        else setLista(true);
      } catch (e) {
        setError(
          e instanceof Error && /Permission|NotAllowed/i.test(e.message)
            ? "Permiso de cámara denegado. Actívalo en los ajustes del navegador o captura el VIN a mano."
            : "No se pudo abrir la cámara. Captura el VIN a mano.",
        );
      }
    })();
    return () => {
      detenido = true;
      const l = lector;
      if (l?.isScanning) l.stop().then(() => l.clear()).catch(() => {});
    };
  }, []);

  return (
    <div className="rounded-2xl overflow-hidden bg-black relative">
      <div id="lector-camara" className="w-full min-h-48" />
      {!lista && !error && <p className="absolute inset-0 grid place-items-center text-white/70 text-sm">Abriendo cámara…</p>}
      {error && <p className="p-4 text-sm text-amber-200">{error}</p>}
      <button onClick={onCerrar} className="absolute top-2 right-2 rounded-full bg-black/60 text-white px-3 py-1.5 text-sm">
        Cerrar cámara
      </button>
    </div>
  );
}
