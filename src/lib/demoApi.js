// ============================================================
// demoApi.js — Même interface que planStore.realApi, mais en MÉMOIRE.
// Sert à la page de démonstration (/demo) : aucune connexion Firebase,
// aucune donnée réelle touchée. Les calculs sont ceux de planLogic.js (les vrais).
// ============================================================
import { computePlanDay, hasPlanning, addDays, mondayOf, dateToStr, DEFAULT_PLAN_SETTINGS } from "./planLogic";

const SITE = "demo";
export const DEMO_SITE = { id: SITE, name: "Magasin démo" };
export const DEMO_EMPLOYEES = [
  { id: "d1", displayName: "Sophie L.", matricule: "101", siteId: SITE, active: true, contractType: "full", weeklyContractMinutes: 2205 },
  { id: "d2", displayName: "Karim B.", matricule: "102", siteId: SITE, active: true, contractType: "full", weeklyContractMinutes: 2205 },
  { id: "d3", displayName: "Léa M.", matricule: "103", siteId: SITE, active: true, contractType: "part", weeklyContractMinutes: 1200 },
  { id: "d4", displayName: "Marc D.", matricule: "104", siteId: SITE, active: true, contractType: "part", weeklyContractMinutes: 900 },
  { id: "d5", displayName: "Inès R.", matricule: "105", siteId: SITE, active: true, contractType: "part", weeklyContractMinutes: 1500 },
];

const at = (date, hhmm) => { const [Y, M, D] = date.split("-").map(Number); const [h, m] = hhmm.split(":").map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };
const idOf = (e, d) => `${SITE}_${e}_${d}`;

export function createDemoApi(todayStr) {
  const state = { settings: { ...DEFAULT_PLAN_SETTINGS, lateToleranceMinutes: 5 }, plans: {}, days: {}, decls: {}, ledger: {}, ledgerHist: [], planHist: [] };
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => f());

  function recompute(empId, date, reason, by) {
    const id = idOf(empId, date);
    const emp = DEMO_EMPLOYEES.find((e) => e.id === empId);
    const row = computePlanDay({ planning: state.plans[id] || null, day: state.days[id] || null, declaration: state.decls[id] || null, emp, settings: state.settings, date });
    const prev = state.ledger[id] || null;
    if (!row.hasPlanning && !state.decls[id]) delete state.ledger[id]; else state.ledger[id] = { ...row, id, siteId: SITE, employeeId: empId };
    const keys = ["plannedWorkMinutes", "expectedBreakMinutes", "declaredBreakMinutes", "deltaBreakMinutes", "state"];
    if (!prev || keys.some((k) => prev[k] !== row[k])) {
      state.ledgerHist.push({ id: String(state.ledgerHist.length), ledgerId: id, employeeId: empId, date, reason, by,
        before: prev ? Object.fromEntries(keys.map((k) => [k, prev[k]])) : null, after: Object.fromEntries(keys.map((k) => [k, row[k]])), atMs: Date.now() });
    }
    return { row, impact: { expectedBefore: prev?.expectedBreakMinutes ?? null, expectedAfter: row.expectedBreakMinutes, deltaBefore: prev?.deltaBreakMinutes ?? 0, deltaAfter: row.deltaBreakMinutes, plannedBefore: prev?.plannedWorkMinutes ?? null, plannedAfter: row.plannedWorkMinutes } };
  }

  // ----- Données de départ : la semaine en cours + la précédente -----
  const mon = mondayOf(todayStr);
  const full = (a = "08:00", b = "13:00", c = "14:00", d = "19:00") => ({ morning: { state: "worked", start: a, end: b }, evening: { state: "worked", start: c, end: d } });
  const put = (e, date, p) => { state.plans[idOf(e, date)] = { siteId: SITE, employeeId: e, date, ...p }; };
  for (const w of [addDays(mon, -7), mon]) {
    for (let i = 0; i < 6; i++) {
      const d = addDays(w, i);
      put("d1", d, full());
      put("d2", d, i % 2 ? { morning: { state: "off" }, evening: { state: "worked", start: "14:00", end: "19:00" } } : { morning: { state: "worked", start: "08:00", end: "13:00" }, evening: { state: "off" } });
      if (i < 5) put("d3", d, { morning: { state: "worked", start: "08:30", end: "12:30" }, evening: { state: "off" } });
      if (i === 5) put("d3", d, { morning: { state: "off" }, evening: { state: "off" } });
    }
    // Léa : semaine en cours à moitié planifiée (jeudi→ non créé) ; Marc : aucun planning la semaine en cours.
  }
  for (let i = 0; i < 6; i++) put("d4", addDays(addDays(mon, -7), i), { morning: { state: "off" }, evening: { state: "worked", start: "15:00", end: "19:00" } });
  delete state.plans[idOf("d3", addDays(mon, 3))]; delete state.plans[idOf("d3", addDays(mon, 4))];
  // Pointages réels (jours passés) + déclarations.
  const punch = (e, date, a, b, bo, bi) => { state.days[idOf(e, date)] = { siteId: SITE, employeeId: e, date, arrival: at(date, a), departure: at(date, b), ...(bo ? { breakOut: at(date, bo), breakIn: at(date, bi) } : {}) }; };
  const decl = (e, date, status, declaredMinutes, exp) => { state.decls[idOf(e, date)] = { siteId: SITE, employeeId: e, date, status, declaredMinutes, expectedMinutesAtDeclaration: exp, source: "badge", atMs: Date.now() }; };
  const pw = addDays(mon, -7);
  punch("d1", pw, "07:58", "19:03", "13:00", "14:00"); decl("d1", pw, "taken", 20, 20);
  punch("d1", addDays(pw, 1), "08:12", "19:00"); decl("d1", addDays(pw, 1), "partial", 10, 20);
  punch("d1", addDays(pw, 2), "08:00", "20:05"); decl("d1", addDays(pw, 2), "none", 0, 20);
  punch("d1", addDays(pw, 3), "08:00", "19:00"); decl("d1", addDays(pw, 3), "taken", 20, 20);
  punch("d2", pw, "08:00", "13:00"); decl("d2", pw, "taken", 20, 20);
  punch("d2", addDays(pw, 1), "14:05", "19:00"); decl("d2", addDays(pw, 1), "taken", 15, 15);
  punch("d3", pw, "08:30", "12:30"); decl("d3", pw, "none", 0, 12);
  punch("d4", pw, "15:00", "19:10"); // pas de déclaration -> « déclaration manquante »
  punch("d4", addDays(pw, 1), "15:00", "19:00"); state.decls[idOf("d4", addDays(pw, 1))] = { siteId: SITE, employeeId: "d4", date: addDays(pw, 1), status: "pending", declaredMinutes: null, source: "badge", atMs: Date.now() };
  punch("d5", addDays(pw, 1), "09:00", "17:30"); // pas de planning : heures réelles uniquement
  for (const k of new Set([...Object.keys(state.plans), ...Object.keys(state.days), ...Object.keys(state.decls)])) {
    const [, e, d] = k.split("_"); recompute(e, d, "initial", null);
  }
  state.ledgerHist = []; state.planHist = [];

  const inRange = (id, from, to) => { const d = id.split("_")[2]; return d >= from && d <= to; };
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 30));
  return {
    isDemo: true,
    getSettings: async () => ({ ...state.settings }),
    async saveSettings(patch) { Object.assign(state.settings, patch); for (const id of Object.keys(state.ledger)) { const [, e, d] = id.split("_"); recompute(e, d, "paramètres", null); } notify(); },
    watchPlannings(siteId, from, to, cb) {
      const emit = () => cb(Object.entries(state.plans).filter(([id]) => inRange(id, from, to)).map(([id, p]) => ({ id, ...p })));
      listeners.add(emit); setTimeout(emit, 0); return () => listeners.delete(emit);
    },
    getPlannings: async (siteId, from, to) => Object.entries(state.plans).filter(([id]) => inRange(id, from, to)).map(([id, p]) => ({ id, ...p })),
    async savePlannings(list, by, onProgress) {
      let changed = 0;
      for (const p of list) {
        const id = idOf(p.employeeId, p.date);
        const before = state.plans[id] ? { morning: state.plans[id].morning || null, evening: state.plans[id].evening || null } : null;
        const after = { morning: p.morning || null, evening: p.evening || null };
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        state.plans[id] = { siteId: SITE, employeeId: p.employeeId, date: p.date, ...after };
        const r = recompute(p.employeeId, p.date, "planning", by);
        state.planHist.push({ id: String(state.planHist.length), planningId: id, employeeId: p.employeeId, date: p.date, before, after, by, atMs: Date.now(), impact: r.impact });
        changed++; onProgress && onProgress(changed, list.length);
      }
      notify(); return { changed, recomputed: changed };
    },
    getDaysRange: async (siteId, from, to) => delay(Object.entries(state.days).filter(([id]) => inRange(id, from, to)).map(([id, d]) => ({ id, ...d }))),
    getDaySituations: async (siteId, date) => delay({
      plans: Object.entries(state.plans).filter(([id]) => id.endsWith(date)).map(([id, p]) => ({ id, ...p })),
      days: Object.entries(state.days).filter(([id]) => id.endsWith(date)).map(([id, p]) => ({ id, ...p })),
      ledger: Object.values(state.ledger).filter((r) => r.date === date),
      declarations: Object.entries(state.decls).filter(([id]) => id.endsWith(date)).map(([id, p]) => ({ id, ...p })),
    }),
    async getBalances() { const by = {}; Object.values(state.ledger).forEach((r) => (by[r.employeeId] = by[r.employeeId] || []).push(r)); return by; },
    getLedgerRows: async (empId) => Object.values(state.ledger).filter((r) => r.employeeId === empId).sort((a, b) => a.date.localeCompare(b.date)),
    getLedgerHistory: async (ledgerId) => state.ledgerHist.filter((h) => h.ledgerId === ledgerId),
    getPlanningHistory: async (empId) => state.planHist.filter((h) => h.employeeId === empId).sort((a, b) => b.atMs - a.atMs),
    async regularise({ empId, date, status, declaredMinutes, by, note }) {
      const id = idOf(empId, date);
      const expected = state.ledger[id]?.expectedBreakMinutes ?? 0;
      state.decls[id] = { siteId: SITE, employeeId: empId, date, status, declaredMinutes: status === "partial" ? declaredMinutes : status === "none" ? 0 : expected, expectedMinutesAtDeclaration: expected, source: "regularisation", by, note, atMs: Date.now() };
      const r = recompute(empId, date, "régularisation", by); notify(); return r;
    },
    recomputeStale: async () => 0,
    async rebuild() { return 0; },
    // Utilisé par la simulation de pointage de la page de démo.
    demoPunch({ empId, date, type, time, declaration }) {
      const id = idOf(empId, date);
      state.days[id] = { ...(state.days[id] || { siteId: SITE, employeeId: empId, date }), [type]: at(date, time) };
      if (declaration) state.decls[id] = { siteId: SITE, employeeId: empId, date, ...declaration, source: "badge", atMs: Date.now() };
      recompute(empId, date, "pointage", null); notify();
    },
    hasPlanning: (empId, date) => hasPlanning(state.plans[idOf(empId, date)]),
    getPlan: (empId, date) => state.plans[idOf(empId, date)] || null,
    getDayRaw: (empId, date) => state.days[idOf(empId, date)] || null,
    settings: () => state.settings,
  };
}
