// ============================================================
// pin.js — Hachage des PIN (SHA-256 + sel), côté client.
//
// LIMITE ASSUMÉE : un PIN 4 chiffres = 10 000 combinaisons.
// SHA-256 ne ralentit pas la force brute. Le sel bloque les
// rainbow tables, pas une attaque ciblée si la base fuite.
// -> Acceptable pour badger (enjeu faible).
// -> Pour durcir le PIN MANAGER plus tard : remplacer verifyPin
//    par un appel Cloud Function bcrypt. Le reste du code ne change pas.
// ============================================================

// Sels applicatifs. Change-les à l'installation. Le sel manager est distinct
// pour éviter qu'un PIN salarié == PIN manager produise le même hash.
const SALT_EMPLOYEE = "k7Rx9mP2vQ8wZ4nL6tJ3bF5hD1sG0yA";
const SALT_MANAGER = "aH4jN8kW2pT6xR9mB3vL7cF1qD5zY0sE";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashEmployeePin(pin) {
  return sha256(SALT_EMPLOYEE + "|" + pin);
}
export async function hashManagerPin(pin) {
  return sha256(SALT_MANAGER + "|" + pin);
}

export async function verifyEmployeePin(pin, hash) {
  return (await hashEmployeePin(pin)) === hash;
}
export async function verifyManagerPin(pin, hash) {
  return (await hashManagerPin(pin)) === hash;
}

export function isValidPin(pin) {
  return /^\d{4}$/.test(pin);
}
