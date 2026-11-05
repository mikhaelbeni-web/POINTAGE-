// ============================================================
// planLogic.js — Calculs PURS du planning, des pauses et des compteurs.
// Aucune dépendance Firebase : testable seul, exécuté hors du parcours
// critique du pointage (jamais au moment où le salarié badge).
// Toutes les durées sont en minutes entières.
//
// Trois notions séparées, jamais mélangées :
//  - CONTRAT  : référence (weeklyContractMinutes du salarié)
//  - PLANNING : horaires prévus, saisis à la main (collection plannings)
//  - RÉEL     : pointages (days) + déclaration de pause (breakDeclarations)
// ============================================================
import { computeDay } from "./timeLogic.js";

// Règle de pause par défaut. Le calcul « 5 % » n'est PAS présenté comme l'unique
// obligation légale : le minimum légal (20 min dès 6 h de travail) est appliqué
// en plus, et tout est configurable dans Paramètres.
export const DEFAULT_PLAN_SETTINGS = {
  breakMode: "max",          // "max" = le plus grand de 5 % et du minimum légal ; "pct" = 5 % seul ; "legal" = minimum légal seul
  breakPercent: 5,           // % du temps de travail prévu
  breakLegalMinutes: 20,     // pause minimale légale
  breakLegalThresholdMinutes: 360, // seuil de temps de travail quotidien (6 h)
  breakLongMinutes: 30,      // pause longue : REMPLACE le calcul ci-dessus…
  breakLongThresholdMinutes: 480, // …dès 8 h de travail CONTINU (un seul bloc, sans interruption)
  splitGapMinutes: 60,       // coupure : un trou d'au moins 1 h sans travail entre matin et soir = journée en 2 blocs
  breakCompensation: "none", // "none" = manquantes et supplémentaires restent séparées ; "net" = solde net
  presetMorning: { start: "08:00", end: "13:00" },
  presetEvening: { start: "14:00", end: "19:00" },
};

export function planSettings(settings = {}) {
  return {
    ...DEFAULT_PLAN_SETTINGS, ...settings,
    presetMorning: { ...DEFAULT_PLAN_SETTINGS.presetMorning, ...(settings.presetMorning || {}) },
    presetEvening: { ...DEFAULT_PLAN_SETTINGS.presetEvening, ...(settings.presetEvening || {}) },
  };
}

export const hhmmToMin = (hhmm) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// ---------- Période (matin / soir) ----------
// Trois états distincts :
//   undefined/null            -> "unset"  : pas encore planifié (JAMAIS = non travaillé)
//   { state: "off" }          -> "off"    : explicitement non travaillé
//   { state: "worked", start, end } -> "worked"
export function periodState(p) {
  if (!p || !p.state) return "unset";
  if (p.state === "off") return "off";
  if (p.state === "worked" && hhmmToMin(p.start) != null && hhmmToMin(p.end) != null) return "worked";
  return "unset";
}

export function periodMinutes(p) {
  if (periodState(p) !== "worked") return 0;
  let d = hhmmToMin(p.end) - hhmmToMin(p.start);
  if (d <= 0) d += 24 * 60; // fin après minuit
  return d;
}

/** Résumé du jour : "none" (pas de planning), "partial" (une période non décidée), "complete". */
export function planningStatus(planning) {
  if (!planning) return "none";
  const m = periodState(planning.morning), e = periodState(planning.evening);
  if (m === "unset" && e === "unset") return "none";
  if (m === "unset" || e === "unset") return "partial";
  return "complete";
}

/** Un planning « existe » pour la déclaration de pause dès qu'au moins une période est décidée. */
export const hasPlanning = (planning) => planningStatus(planning) !== "none";

export function plannedWorkMinutes(planning) {
  if (!planning) return 0;
  return periodMinutes(planning.morning) + periodMinutes(planning.evening);
}

/** Première arrivée et dernier départ prévus (minutes depuis minuit), ou null. */
export function plannedBounds(planning) {
  if (!planning) return null;
  const worked = ["morning", "evening"].map((k) => planning[k]).filter((p) => periodState(p) === "worked");
  if (!worked.length) return null;
  const start = Math.min(...worked.map((p) => hhmmToMin(p.start)));
  const last = worked.reduce((a, p) => (hhmmToMin(p.end) > hhmmToMin(p.start) ? Math.max(a, hhmmToMin(p.end)) : Math.max(a, hhmmToMin(p.end) + 1440)), 0);
  return { start, end: last };
}

// ---------- Pause attendue ----------
/** Plus long bloc de travail prévu sans interruption (matin et soir accolés = un seul bloc). */
export function longestContinuousMinutes(planning) {
  if (!planning) return 0;
  const iv = ["morning", "evening"].map((k) => planning[k]).filter((p) => periodState(p) === "worked")
    .map((p) => { const a = hhmmToMin(p.start); let b = hhmmToMin(p.end); if (b <= a) b += 1440; return [a, b]; })
    .sort((x, y) => x[0] - y[0]);
  let best = 0, cur = null;
  for (const [a, b] of iv) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else { if (cur) best = Math.max(best, cur[1] - cur[0]); cur = [a, b]; }
  }
  if (cur) best = Math.max(best, cur[1] - cur[0]);
  return best;
}

/**
 * Pause attendue. continuousMinutes = plus long bloc continu prévu : à partir du seuil
 * (8 h par défaut), la pause longue (30 min) remplace le calcul au pourcentage.
 */
export function expectedBreakMinutes(plannedMinutes, settings, continuousMinutes = 0) {
  const s = planSettings(settings);
  if (!plannedMinutes || plannedMinutes <= 0) return 0;
  const longMin = Number(s.breakLongMinutes) || 0, longThr = Number(s.breakLongThresholdMinutes) || 0;
  if (longMin > 0 && longThr > 0 && (Number(continuousMinutes) || 0) >= longThr) return longMin;
  const pct = Math.ceil((plannedMinutes * Number(s.breakPercent)) / 100);
  const legal = plannedMinutes >= Number(s.breakLegalThresholdMinutes) ? Number(s.breakLegalMinutes) : 0;
  if (s.breakMode === "pct") return pct;
  if (s.breakMode === "legal") return legal;
  return Math.max(pct, legal);
}

/**
 * Journée COUPÉE : matin et soir travaillés avec au moins splitGapMinutes (1 h) sans travail entre les deux.
 * Retourne [matin, soir] en minutes depuis minuit { start, end, minutes }, sinon null.
 * Dans ce cas la badgeuse propose Arrivée/Départ deux fois, sans pointage de pause.
 */
export function splitBlocks(planning, settings) {
  if (!planning || periodState(planning.morning) !== "worked" || periodState(planning.evening) !== "worked") return null;
  const gapMin = Number(planSettings(settings).splitGapMinutes) || 0;
  if (gapMin <= 0) return null;
  const mk = (p) => { const start = hhmmToMin(p.start); let end = hhmmToMin(p.end); if (end <= start) end += 1440; return { start, end, minutes: end - start }; };
  const a = mk(planning.morning), b = mk(planning.evening);
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return second.start - first.end >= gapMin ? [first, second] : null;
}

/** Pause attendue de chaque bloc d'une journée coupée ([m, s]) ou null. Chaque bloc suit la règle habituelle (3 min/h, minimum légal, 30 min dès 8 h d'affilée). */
export function expectedBreakBlocks(planning, settings) {
  const blocks = splitBlocks(planning, settings);
  if (!blocks) return null;
  const out = blocks.map((b) => expectedBreakMinutes(b.minutes, settings, b.minutes));
  // Minimum légal du jour (20 min dès 6 h de travail au total) : le complément va au bloc le plus long.
  const s = planSettings(settings), total = blocks[0].minutes + blocks[1].minutes;
  const legal = total >= Number(s.breakLegalThresholdMinutes) ? Number(s.breakLegalMinutes) : 0;
  if (s.breakMode !== "pct" && out[0] + out[1] < legal) out[blocks[0].minutes >= blocks[1].minutes ? 0 : 1] += legal - out[0] - out[1];
  return out;
}

/** Pause attendue d'un planning (0 sans planning). Journée coupée : somme des pauses de chaque bloc. À utiliser partout plutôt que expectedBreakMinutes. */
export function expectedBreakForPlanning(planning, settings) {
  if (!hasPlanning(planning)) return 0;
  const blocks = expectedBreakBlocks(planning, settings);
  if (blocks) return blocks[0] + blocks[1];
  return expectedBreakMinutes(plannedWorkMinutes(planning), settings, longestContinuousMinutes(planning));
}

/**
 * Déclaration du jour = déclaration du bloc 1 + (facultatif) decl.block2 pour le bloc 2.
 * Fusion en une seule déclaration : à régulariser si un bloc l'est, "taken" si tout est pris,
 * sinon "partial" avec la somme des minutes déclarées.
 */
export function mergeBlockDeclarations(decl) {
  if (!decl || !decl.block2) return decl || null;
  const { block2, ...d1 } = decl;
  const m1 = declaredBreakMinutes(d1, d1.expectedMinutesAtDeclaration ?? 0);
  const m2 = declaredBreakMinutes(block2, block2.expectedMinutesAtDeclaration ?? 0);
  if (m1 == null || m2 == null) return { ...d1, status: "pending", declaredMinutes: null };
  const allTaken = d1.status === "taken" && block2.status === "taken";
  return { ...d1, status: allTaken ? "taken" : "partial", declaredMinutes: m1 + m2,
    expectedMinutesAtDeclaration: (d1.expectedMinutesAtDeclaration ?? 0) + (block2.expectedMinutesAtDeclaration ?? 0) };
}

// ---------- Déclaration de pause ----------
// status : "taken" (pauses prévues prises) | "partial" | "none" (non prise)
//          | "pending" (à régulariser : départ enregistré sans déclaration)
export function declaredBreakMinutes(decl, expected) {
  if (!decl) return null;
  if (decl.status === "taken") return expected;
  if (decl.status === "none") return 0;
  if (decl.status === "partial") return Math.max(0, Math.round(Number(decl.declaredMinutes) || 0));
  return null; // pending
}

// ---------- Calcul d'une journée (entrée du compteur) ----------
const toMs = (t) => (t == null ? null : t.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : typeof t === "number" ? t : null);
const minOfDay = (ms, dateStr) => {
  const [Y, M, D] = dateStr.split("-").map(Number);
  return Math.round((ms - new Date(Y, M - 1, D, 0, 0, 0, 0).getTime()) / 60000);
};

/**
 * Fonction pure : mêmes entrées -> mêmes sorties. Le compteur n'est jamais
 * incrémenté : il est la SOMME de ces lignes (une par jour), donc recalculer
 * deux fois ne double jamais un écart.
 */
export function computePlanDay({ planning, day, declaration, emp, settings, date }) {
  const s = planSettings(settings);
  const plan = hasPlanning(planning);
  const plannedWork = plannedWorkMinutes(planning);
  const expectedBreak = plan ? expectedBreakForPlanning(planning, s) : 0;

  const out = {
    date, hasPlanning: plan, planningStatus: planningStatus(planning),
    plannedWorkMinutes: plannedWork, expectedBreakMinutes: expectedBreak,
    actualWorkMinutes: null, overtimeMinutes: 0, undertimeMinutes: 0,
    arrivalDeltaMinutes: null, departureDeltaMinutes: null,
    arrivalFlag: null, departureFlag: null,
    declarationStatus: declaration ? declaration.status : null,
    declaredBreakMinutes: null, missingBreakMinutes: 0, extraBreakMinutes: 0, deltaBreakMinutes: 0,
    counted: false, state: "no-planning",
  };

  // Journée coupée : le départ qui compte est celui du 2e bloc (null tant qu'il n'est pas badgé).
  const arrival = toMs(day?.arrival);
  const departure = day?.arrival2 != null ? toMs(day?.departure2) : toMs(day?.departure);

  // Temps réellement travaillé (pointages) : calculé ici depuis les heures brutes,
  // donc indépendant de l'ordre des recalculs et séparé des minutes de pause.
  if (arrival != null && departure != null && day) {
    const m = computeDay({ arrival: day.arrival, breakOut: day.breakOut, breakIn: day.breakIn, departure: day.departure,
      arrival2: day.arrival2, departure2: day.departure2, breakDecl1: day.breakDecl1, breakDecl2: day.breakDecl2 }, emp || {}, settings || {}, date);
    // Heures comptées : présence (pause comprise) si la pause est payée (défaut), sinon hors pause.
    out.actualWorkMinutes = settings?.breakPaid === false ? m.workedMinutes : m.spanMinutes;
  }

  if (!plan) { out.state = "no-planning"; return out; }

  // Écarts d'horaires (seulement si planning ET pointage existent).
  const b = plannedBounds(planning);
  const tol = Number(settings?.lateToleranceMinutes ?? 0);
  if (b && arrival != null) {
    out.arrivalDeltaMinutes = minOfDay(arrival, date) - b.start; // < 0 : en avance
    out.arrivalFlag = out.arrivalDeltaMinutes > tol ? "late" : out.arrivalDeltaMinutes < -tol ? "early" : "ok";
  }
  if (b && departure != null) {
    let dep = minOfDay(departure, date);
    if (arrival != null && departure < arrival) dep += 1440;
    out.departureDeltaMinutes = dep - b.end; // > 0 : parti après l'heure prévue
    out.departureFlag = out.departureDeltaMinutes > tol ? "over" : out.departureDeltaMinutes < -tol ? "early" : "ok";
  }
  if (out.actualWorkMinutes != null) {
    out.overtimeMinutes = Math.max(0, out.actualWorkMinutes - plannedWork);
    out.undertimeMinutes = Math.max(0, plannedWork - out.actualWorkMinutes);
  }

  // Pause : comptée seulement si le départ est enregistré ET la déclaration est définitive.
  if (departure == null) { out.state = arrival != null ? "in-progress" : "no-punch"; return out; }
  const blockTwoMissing = !!(declaration && splitBlocks(planning, s) && day?.arrival2 != null && !declaration.block2);
  declaration = mergeBlockDeclarations(declaration);
  const declared = declaredBreakMinutes(declaration, expectedBreak);
  out.declaredBreakMinutes = declared;
  if (!declaration || blockTwoMissing) { out.state = "declaration-missing"; return out; }
  if (declared == null) { out.state = "to-regularise"; return out; }
  out.missingBreakMinutes = Math.max(0, expectedBreak - declared);
  out.extraBreakMinutes = Math.max(0, declared - expectedBreak);
  out.deltaBreakMinutes = declared - expectedBreak;
  out.counted = true;
  out.state = "counted";
  return out;
}

// ---------- Compteur cumulatif ----------
/**
 * Solde = somme des lignes comptées. Jamais remis à zéro.
 * Avec breakCompensation "none", manquantes et supplémentaires restent deux totaux ;
 * "net" ajoute en plus un solde net utilisé comme solde principal.
 */
export function computeBalance(rows, settings) {
  const s = planSettings(settings);
  const sorted = [...rows].filter((r) => r.counted).sort((a, b) => a.date.localeCompare(b.date));
  let missing = 0, extra = 0, net = 0;
  const evolution = sorted.map((r) => {
    missing += r.missingBreakMinutes; extra += r.extraBreakMinutes; net += r.deltaBreakMinutes;
    return { date: r.date, delta: r.deltaBreakMinutes, missing, extra, net };
  });
  return {
    missingTotal: missing, extraTotal: extra, netBalance: net,
    compensation: s.breakCompensation,
    // solde principal affiché : en mode "none", les minutes manquantes (dette) ; en "net", le solde net.
    headline: s.breakCompensation === "net" ? net : -missing,
    daysCounted: sorted.length,
    pendingDays: rows.filter((r) => r.state === "to-regularise" || r.state === "declaration-missing").length,
    evolution,
  };
}

// ---------- Dates ----------
export const pad2 = (n) => String(n).padStart(2, "0");
export const dateToStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function strToDate(s) { const [Y, M, D] = s.split("-").map(Number); return new Date(Y, M - 1, D); }
export function addDays(s, n) { const d = strToDate(s); d.setDate(d.getDate() + n); return dateToStr(d); }
export function mondayOf(s) { const d = strToDate(s); const dow = d.getDay() === 0 ? 7 : d.getDay(); d.setDate(d.getDate() - (dow - 1)); return dateToStr(d); }
export function weekDates(mondayStr) { return Array.from({ length: 7 }, (_, i) => addDays(mondayStr, i)); }

/** Découpe n lignes en pages équilibrées (impression) : le moins de pages possible, sans page quasi vide. */
export function paginateRows(n, maxPerPage) {
  if (n <= 0) return [];
  const pages = Math.ceil(n / maxPerPage);
  const base = Math.floor(n / pages), extra = n % pages;
  return Array.from({ length: pages }, (_, i) => base + (i < extra ? 1 : 0));
}

export const fmtMin = (m) => {
  if (m == null) return "—";
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(m);
  return a < 60 ? `${sign}${a} min` : `${sign}${Math.floor(a / 60)} h ${pad2(a % 60)}`;
};

// ---------- Repris du calendrier de la résidence Le Belleville ----------
// Horaires rapides proposés en boutons (matin / soir), en plus des horaires habituels
// configurables ; ils restent toujours modifiables ou remplaçables par une saisie libre.
export const PRESETS_MORNING = ["08:00-13:00", "08:30-13:00", "08:30-13:30", "08:45-12:00", "09:00-13:00", "09:15-12:45", "10:00-12:30", "10:15-12:45", "11:45-16:00", "11:45-16:30"];
export const PRESETS_EVENING = ["13:00-18:30", "14:00-17:00", "14:00-18:00", "14:00-18:30", "14:00-19:00", "14:15-18:00", "14:15-18:30", "14:45-18:00", "14:45-18:30", "15:30-18:30"];
// Couleur par salarié (même palette que le calendrier Le Belleville).
export const EMP_COLORS = [
  { bg: "#EDE9FE", text: "#5B21B6", border: "#C4B5FD", dot: "#8B5CF6" },
  { bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD", dot: "#3B82F6" },
  { bg: "#D1FAE5", text: "#065F46", border: "#6EE7B7", dot: "#10B981" },
  { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D", dot: "#F59E0B" },
  { bg: "#FCE7F3", text: "#9D174D", border: "#F9A8D4", dot: "#EC4899" },
  { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5", dot: "#EF4444" },
  { bg: "#CFFAFE", text: "#164E63", border: "#67E8F9", dot: "#06B6D4" },
  { bg: "#F3E8FF", text: "#6B21A8", border: "#D8B4FE", dot: "#A855F7" },
  { bg: "#DCFCE7", text: "#14532D", border: "#86EFAC", dot: "#22C55E" },
  { bg: "#FEF9C3", text: "#713F12", border: "#FDE047", dot: "#EAB308" },
];
/** "08:00-13:00" -> { start, end } */
export function parseRange(r) { const [start, end] = String(r).split("-"); return { state: "worked", start, end }; }
/** Contrat mensuel en minutes : heures hebdo × 52 / 12 (formule du calendrier Le Belleville). */
export const contractMonthMinutes = (weeklyMinutes) => Math.round((weeklyMinutes * 52) / 12);
/** Semaines (lundi) qui touchent un mois, comme les boutons « Sem. 1…5 » du calendrier Le Belleville. */
export function weeksOfMonth(year, month) {
  const first = new Date(year, month - 1, 1), last = new Date(year, month, 0);
  const out = []; let cur = mondayOf(dateToStr(first));
  while (strToDate(cur) <= last) { out.push(cur); cur = addDays(cur, 7); }
  return out;
}
export const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
