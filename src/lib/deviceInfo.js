// ============================================================
// deviceInfo.js — Infos techniques réellement disponibles côté navigateur.
// PAS d'adresse IP : inaccessible à une page web (blocage navigateur).
// ============================================================

export function getDeviceInfo() {
  if (typeof navigator === "undefined") return {};
  const ua = navigator.userAgent || "";

  // Modèle Android : souvent présent entre parenthèses (ex. "SM-X130").
  let model = null;
  const sm = ua.match(/;\s*([A-Z]{2}-[A-Z0-9]+)\b/); // Samsung SM-XXXX, etc.
  if (sm) model = sm[1];
  else if (/iPad/.test(ua)) model = "iPad";
  else if (/iPhone/.test(ua)) model = "iPhone";

  // OS
  let os = "Inconnu";
  const andr = ua.match(/Android\s+([\d.]+)/);
  const ios = ua.match(/OS\s+([\d_]+)\s+like Mac/);
  if (andr) os = "Android " + andr[1];
  else if (ios) os = "iOS/iPadOS " + ios[1].replace(/_/g, ".");
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";

  // Navigateur
  let browser = "Inconnu";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\/(\d+)/.test(ua)) browser = "Chrome " + ua.match(/Chrome\/(\d+)/)[1];
  else if (/Firefox\/(\d+)/.test(ua)) browser = "Firefox " + ua.match(/Firefox\/(\d+)/)[1];
  else if (/Version\/[\d.]+.*Safari/.test(ua)) browser = "Safari";

  // Écran
  let screen = null;
  if (typeof window !== "undefined" && window.screen) {
    const w = Math.round(window.screen.width);
    const h = Math.round(window.screen.height);
    if (w && h) screen = `${w}×${h}`;
  }

  return { model, os, browser, screen };
}
