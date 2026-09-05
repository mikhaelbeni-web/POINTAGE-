// ============================================================
// timeLogic.js — Logique métier PURE (aucune dépendance externe)
// Toutes les durées sont en MINUTES entières.
// Les instants (badges) sont des Date JS ou des timestamps ms.
// ============================================================

export const DAY_MS = 24 * 60 * 60 * 1000;

// --- Conversions d'affichage --------------------------------

/** minutes -> "36h75" façon convention (centièmes) OU "36h45" horaire réel ?
 *  Ici on garde le format HORAIRE VRAI "HHhMM" (ex. 2205 -> "36h45").
 *  36h75 de la convention = 36h45min réelles. On documente les deux. */
export function minutesToHHhMM(min) {
  if (min == null || isNaN(min)) return "—";
  const sign = min < 0 ? "-" : "";
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${sign}${h}h${String(r).padStart(2, "0")}`;
}

/** "09:00" + date "2026-09-03" -> Date locale */
export function timeOnDate(dateStr, hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const [Y, Mo, D] = dateStr.split("-").map(Number);
  return new Date(Y, Mo - 1, D, h, m, 0, 0);
}

function toMs(t) {
  if (t == null) return null;
  if (t instanceof Date) return t.getTime();
  if (typeof t?.toMillis === "function") return t.toMillis(); // Firestore Timestamp
  if (typeof t === "number") return t;
  return new Date(t).getTime();
}

// --- Numéro de semaine ISO (lundi->dimanche) ----------------

/** Retourne {year, week} ISO 8601 pour une date "YYYY-MM-DD". */
export function isoWeek(dateStr) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  const dayNum = d.getUTCDay() || 7; // dim=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // jeudi de la semaine
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function weekKey(dateStr) {
  const { year, week } = isoWeek(dateStr);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** jour ISO : lundi=1 ... dimanche=7 */
export function isoWeekday(dateStr) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dow = new Date(Y, M - 1, D).getDay(); // dim=0..sam=6
  return dow === 0 ? 7 : dow;
}

// --- Calcul d'une journée -----------------------------------

/**
 * Calcule les métriques d'une journée à partir des badges bruts.
 * @param {Object} p  { arrival, breakOut, breakIn, departure } (Date|ts|null)
 * @param {Object} emp { plannedStart, plannedEnd, workDays, contractType }
 * @param {Object} settings { lateToleranceMinutes }
 * @param {string} dateStr "YYYY-MM-DD"
 * @returns métriques jour
 */
export function computeDay(p, emp, settings, dateStr) {
  const arrival = toMs(p.arrival);
  const breakOut = toMs(p.breakOut);
  const breakIn = toMs(p.breakIn);
  let departure = toMs(p.departure);

  // Défense minuit : si départ < arrivée, la vacation a traversé minuit.
  if (arrival != null && departure != null && departure < arrival) {
    departure += DAY_MS;
  }
  // Idem pour retour de pause si incohérent.
  let bIn = breakIn;
  if (breakOut != null && bIn != null && bIn < breakOut) bIn += DAY_MS;

  let breakMinutes = 0;
  if (breakOut != null && bIn != null) {
    breakMinutes = Math.max(0, Math.round((bIn - breakOut) / 60000));
  }

  // Amplitude = présence totale (départ - arrivée), pause INCLUSE.
  let spanMinutes = 0;
  if (arrival != null && departure != null) {
    spanMinutes = Math.max(0, Math.round((departure - arrival) / 60000));
  }

  // Temps de travail = amplitude - pause. La pause est TOUJOURS déduite.
  let workedMinutes = 0;
  if (arrival != null && departure != null) {
    workedMinutes = Math.max(0, spanMinutes - breakMinutes);
  }

  // Alerte amplitude maximale (ex. 12h). Sur la présence, pas le travail.
  const maxSpan = settings.maxSpanMinutes ?? 720;
  const spanViolation = spanMinutes > maxSpan;

  // Retard vs horaire prévu, avec tolérance
  let lateMinutes = 0;
  if (arrival != null && emp.plannedStart) {
    const planned = timeOnDate(dateStr, emp.plannedStart).getTime();
    const tol = settings.lateToleranceMinutes ?? 0;
    lateMinutes = Math.max(0, Math.round((arrival - planned) / 60000) - tol);
  }

  // Statut
  let status;
  const worksToday = (emp.workDays || []).includes(isoWeekday(dateStr));
  if (arrival != null && departure != null) status = "present";
  else if (arrival != null) status = "incomplete";
  else if (worksToday) status = "absent";
  else status = "off";

  return { workedMinutes, breakMinutes, spanMinutes, spanViolation, lateMinutes, status, worksToday };
}

// --- Alerte repos minimum entre deux jours ------------------

/** restViolation si repos entre départ(J-1) et arrivée(J) < seuil. */
export function checkRest(prevDeparture, currArrival, settings) {
  const dep = toMs(prevDeparture);
  const arr = toMs(currArrival);
  if (dep == null || arr == null) return { restMinutes: null, violation: false };
  const restMinutes = Math.round((arr - dep) / 60000);
  return {
    restMinutes,
    violation: restMinutes < (settings.restMinMinutes ?? 660),
  };
}

// --- Agrégation hebdomadaire : comp / supp ------------------

/**
 * @param {number} weeklyWorkedMinutes  somme des workedMinutes de la semaine
 * @param {Object} emp { contractType, weeklyContractMinutes }
 * @param {Object} settings { weeklyOvertimeAlertMinutes }
 */
export function classifyWeek(weeklyWorkedMinutes, emp, settings) {
  const contract = emp.weeklyContractMinutes ?? 0;
  const excess = weeklyWorkedMinutes - contract;
  let overtimeType = "none";
  let overtimeMinutes = 0;
  if (excess > 0) {
    overtimeMinutes = excess;
    overtimeType = emp.contractType === "part" ? "complementary" : "supplementary";
  }
  const alert =
    overtimeMinutes >= (settings.weeklyOvertimeAlertMinutes ?? 240);
  return {
    weeklyWorkedMinutes,
    contractMinutes: contract,
    excessMinutes: Math.max(0, excess),
    deficitMinutes: Math.max(0, -excess),
    overtimeType, // "none" | "complementary" | "supplementary"
    overtimeMinutes,
    overtimeAlert: alert,
  };
}

// --- Constantes convention ----------------------------------
// 36h75 (centièmes de la convention) = 36h + 0,75*60 = 36h45 réelles = 2205 min.
export const FULL_TIME_WEEKLY_MINUTES = 2205;

// Réglages par défaut
export const DEFAULT_SETTINGS = {
  restMinMinutes: 660, // 11h
  lateToleranceMinutes: 5,
  weeklyOvertimeAlertMinutes: 240, // 4h/semaine
  maxSpanMinutes: 720, // amplitude max 12h
  fullTimeWeeklyMinutes: FULL_TIME_WEEKLY_MINUTES,
  timezone: "Europe/Paris",
};
