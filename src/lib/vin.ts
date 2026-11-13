// Normalización y validación de VIN. El VIN es la llave universal: toda captura
// (cámara, teclado, Excel) debe pasar por aquí antes de tocar la base.

const VIN_VALIDO = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Normaliza un VIN capturado:
 *  - mayúsculas, sin espacios ni guiones ni símbolos
 *  - lectores Code 39 de VIN a veces anteponen una "I" (18 caracteres): se descarta
 *  - O→0, I→1 (los VIN no usan O, I ni Q)
 *  - si trae sufijos (más de 17), se trunca a 17
 */
export function normalizarVin(crudo: string): string {
  let v = (crudo ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (v.length === 18 && v.startsWith("I")) v = v.slice(1);
  v = v.replace(/O/g, "0").replace(/I/g, "1");
  return v.length > 17 ? v.slice(0, 17) : v;
}

export function esVinValido(vin: string): boolean {
  return VIN_VALIDO.test(vin);
}

/** Texto para mostrar al usuario cuando el VIN no es válido; null si es válido. */
export function errorVin(vin: string): string | null {
  if (vin.length !== 17) return `Faltan ${17 - vin.length} caracteres (${vin.length}/17)`;
  if (/Q/.test(vin)) return "Los VIN no usan la letra Q";
  if (!VIN_VALIDO.test(vin)) return "VIN con caracteres no válidos";
  return null;
}
