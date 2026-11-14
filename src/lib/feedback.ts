// Sonido y vibración al leer un VIN (en el patio no siempre se mira la pantalla).
import type { Clasificacion } from "./clasificar";

let ctx: AudioContext | null = null;

function tono(freq: number, ms: number, delay = 0) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + ms / 1000);
  } catch { /* sin audio */ }
}

export function avisar(c: Clasificacion | "error") {
  const bien = c === "esperada";
  if (bien) tono(880, 120);
  else if (c === "otra_localidad" || c === "facturada_en_patio" || c === "vendida_en_patio") { tono(520, 120); tono(520, 120, 0.18); }
  else if (c === "ya_escaneado") tono(330, 200);
  else { tono(220, 250); tono(180, 250, 0.3); }
  try { navigator.vibrate?.(bien ? 40 : [80, 60, 80]); } catch { /* iOS no soporta */ }
}
