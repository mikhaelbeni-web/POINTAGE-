// ============================================================
// demoApi.js — Même interface que planStore.realApi (et que les fonctions du store
// utilisées par le tableau de bord), mais en MÉMOIRE, avec des données fictives.
// Sert à la page de démonstration (/demo) : aucune connexion à Firebase, aucune donnée
// réelle touchée. Les calculs sont ceux de planLogic.js et timeLogic.js (les vrais).
// ============================================================
import { computePlanDay, hasPlanning, addDays, mondayOf, planSettings, DEFAULT_PLAN_SETTINGS } from "./planLogic";
import { computeDay, DEFAULT_SETTINGS } from "./timeLogic";

export const DEMO_SITES = [
  { id: "s1", name: "Magasin Centre" },
  { id: "s2", name: "Magasin Gare" },
];
export const DEMO_EMPLOYEES = [
  { id: "d1", displayName: "Sophie L.", matricule: "101", siteId: "s1", active: true, category: "employee", contractType: "full", weeklyContractMinutes: 2205 },
  { id: "d2", displayName: "Karim B.", matricule: "102", siteId: "s1", active: true, category: "employee", contractType: "full", weeklyContractMinutes: 2205 },
  { id: "d3", displayName: "Léa M.", matricule: "103", siteId: "s1", active: true, category: "employee", contractType: "part", weeklyContractMinutes: 1200 },
  { id: "d4", displayName: "Marc D.", matricule: "104", siteId: "s2", active: true, category: "employee", contractType: "part", weeklyContractMinutes: 900 },
  { id: "d5", displayName: "Inès R.", matricule: "105", siteId: "s2", active: true, category: "employee", contractType: "part", weeklyContractMinutes: 1500 },
  { id: "d6", displayName: "Paul T.", matricule: "106", siteId: "s2", active: true, category: "employee", contractType: "full", weeklyContractMinutes: 2205 },
];

const at = (date, hhmm) => { const [Y, M, D] = date.split("-").map(Number); const [h, m] = hhmm.split(":").map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };
const key = (e, d) => `${e}_${d}`;
const empOf = (id) => DEMO_EMPLOYEES.find((e) => e.id === id);

export function createDemoApi(todayStr) {
  const state = { settings: { ...DEFAULT_SETTINGS, ...DEFAULT_PLAN_SETTINGS, lateToleranceMinutes: 5 }, plans: {}, days: {}, decls: {}, ledger: {}, ledgerHist: [], planHist: [] };
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => f());

  // Recalcul d'un jour complet (heures + compteur), comme les calculs différés de la vraie version.
  function dayDoc(empId, date) {
    const raw = state.days[key(empId, date)];
    if (!raw) return null;
    const emp = empOf(empId);
    const m = computeDay(raw, emp, state.settings, date);
    return { id: key(empId, date), siteId: raw.siteId || emp.siteId, employeeId: empId, date, ...raw, ...m };
  }
  function recompute(empId, date, reason, by) {
    const id = key(empId, date);
    const emp = empOf(empId);
    const row = computePlanDay({ planning: state.plans[id] || null, day: state.days[id] || null, declaration: state.decls[id] || null, emp, settings: state.settings, date });
    const prev = state.ledger[id] || null;
    if (!row.hasPlanning && !state.decls[id]) delete state.ledger[id]; else state.ledger[id] = { ...row, id, siteId: emp.siteId, employeeId: empId };
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
  const put = (e, date, p) => { state.plans[key(e, date)] = { siteId: empOf(e).siteId, employeeId: e, date, ...p }; };
  for (const w of [addDays(mon, -7), mon]) {
    for (let i = 0; i < 6; i++) {
      const d = addDays(w, i);
      put("d1", d, full());
      put("d2", d, i % 2 ? { morning: { state: "off" }, evening: { state: "worked", start: "14:00", end: "19:00" } } : { morning: { state: "worked", start: "08:00", end: "13:00" }, evening: { state: "off" } });
      if (i < 5) put("d3", d, { morning: { state: "worked", start: "08:30", end: "12:30" }, evening: { state: "off" } });
      if (i === 5) put("d3", d, { morning: { state: "off" }, evening: { state: "off" } });
      if (i < 5) put("d6", d, full("09:00", "13:00", "14:00", "18:00"));
    }
  }
  for (let i = 0; i < 6; i++) put("d4", addDays(addDays(mon, -7), i), { morning: { state: "off" }, evening: { state: "worked", start: "15:00", end: "19:00" } });
  delete state.plans[key("d3", addDays(mon, 3))]; delete state.plans[key("d3", addDays(mon, 4))];
  // Pointages réels (semaine précédente) + déclarations.
  const punch = (e, date, a, b, bo, bi) => { state.days[key(e, date)] = { siteId: empOf(e).siteId, employeeId: e, date, arrival: at(date, a), departure: at(date, b), ...(bo ? { breakOut: at(date, bo), breakIn: at(date, bi) } : {}) }; };
  const decl = (e, date, status, declaredMinutes, exp) => { state.decls[key(e, date)] = { siteId: empOf(e).siteId, employeeId: e, date, status, declaredMinutes, expectedMinutesAtDeclaration: exp, source: "badge", atMs: Date.now() }; };
  const pw = addDays(mon, -7);
  punch("d1", pw, "07:58", "19:03", "13:00", "14:00"); decl("d1", pw, "taken", 30, 30);
  punch("d1", addDays(pw, 1), "08:12", "19:00"); decl("d1", addDays(pw, 1), "partial", 10, 30);
  punch("d1", addDays(pw, 2), "08:00", "20:05"); decl("d1", addDays(pw, 2), "none", 0, 30);
  punch("d1", addDays(pw, 3), "08:00", "19:00"); decl("d1", addDays(pw, 3), "taken", 30, 30);
  punch("d2", pw, "08:00", "13:00"); decl("d2", pw, "taken", 15, 15);
  punch("d2", addDays(pw, 1), "14:05", "19:00"); decl("d2", addDays(pw, 1), "taken", 15, 15);
  punch("d3", pw, "08:30", "12:30"); decl("d3", pw, "none", 0, 12);
  punch("d4", pw, "15:00", "19:10"); // pas de déclaration -> « déclaration manquante »
  punch("d4", addDays(pw, 1), "15:00", "19:00"); state.decls[key("d4", addDays(pw, 1))] = { siteId: "s2", employeeId: "d4", date: addDays(pw, 1), status: "pending", declaredMinutes: null, source: "badge", atMs: Date.now() };
  punch("d5", addDays(pw, 1), "09:00", "17:30"); // pas de planning : heures réelles uniquement
  punch("d6", pw, "09:00", "18:00", "13:00", "14:00"); decl("d6", pw, "taken", 25, 25);
  for (const k of new Set([...Object.keys(state.plans), ...Object.keys(state.days), ...Object.keys(state.decls)])) {
    const [e, d] = k.split("_"); recompute(e, d, "initial", null);
  }
  state.ledgerHist = []; state.planHist = [];

  const inRange = (id, from, to) => { const d = id.split("_")[1]; return d >= from && d <= to; };
  const onDate = (id, date) => id.endsWith("_" + date);
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 30));
  return {
    isDemo: true,
    // ----- API planning / compteurs (même interface que planStore.realApi) -----
    getSettings: async () => ({ ...state.settings }),
    async saveSettings(patch) { Object.assign(state.settings, patch); for (const id of Object.keys(state.ledger)) { const [e, d] = id.split("_"); recompute(e, d, "paramètres", null); } notify(); },
    watchPlannings(from, to, cb) {
      const emit = () => cb(Object.entries(state.plans).filter(([id]) => inRange(id, from, to)).map(([id, p]) => ({ id, ...p })));
      listeners.add(emit); setTimeout(emit, 0); return () => listeners.delete(emit);
    },
    getPlannings: async (from, to) => Object.entries(state.plans).filter(([id]) => inRange(id, from, to)).map(([id, p]) => ({ id, ...p })),
    async savePlannings(list, by, onProgress) {
      let changed = 0;
      for (const p of list) {
        const id = key(p.employeeId, p.date);
        const before = state.plans[id] ? { morning: state.plans[id].morning || null, evening: state.plans[id].evening || null } : null;
        const after = { morning: p.morning || null, evening: p.evening || null };
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        state.plans[id] = { siteId: p.siteId || empOf(p.employeeId).siteId, employeeId: p.employeeId, date: p.date, ...after };
        const r = recompute(p.employeeId, p.date, "planning", by);
        state.planHist.push({ id: String(state.planHist.length), planningId: id, employeeId: p.employeeId, date: p.date, before, after, by, atMs: Date.now(), impact: r.impact });
        changed++; onProgress && onProgress(changed, list.length);
      }
      notify(); return { changed, recomputed: changed };
    },
    getDaysRange: async (from, to) => delay(Object.keys(state.days).filter((id) => inRange(id, from, to)).map((id) => { const [e, d] = id.split("_"); return dayDoc(e, d); })),
    getDaySituations: async (date) => delay({
      plans: Object.entries(state.plans).filter(([id]) => onDate(id, date)).map(([id, p]) => ({ id, ...p })),
      days: Object.keys(state.days).filter((id) => onDate(id, date)).map((id) => { const [e, d] = id.split("_"); return dayDoc(e, d); }),
      ledger: Object.values(state.ledger).filter((r) => r.date === date),
      declarations: Object.entries(state.decls).filter(([id]) => onDate(id, date)).map(([id, p]) => ({ id, ...p })),
    }),
    async getBalances(empIds) { const by = {}; Object.values(state.ledger).filter((r) => empIds.includes(r.employeeId)).forEach((r) => (by[r.employeeId] = by[r.employeeId] || []).push(r)); return by; },
    getLedgerRows: async (empId) => Object.values(state.ledger).filter((r) => r.employeeId === empId).sort((a, b) => a.date.localeCompare(b.date)),
    getLedgerHistory: async (ledgerId) => state.ledgerHist.filter((h) => h.ledgerId === ledgerId),
    getPlanningHistory: async (empId) => state.planHist.filter((h) => h.employeeId === empId).sort((a, b) => b.atMs - a.atMs),
    async regularise({ empId, date, status, declaredMinutes, by, note }) {
      const id = key(empId, date);
      const expected = state.ledger[id]?.expectedBreakMinutes ?? 0;
      state.decls[id] = { siteId: empOf(empId).siteId, employeeId: empId, date, status, declaredMinutes: status === "partial" ? declaredMinutes : status === "none" ? 0 : expected, expectedMinutesAtDeclaration: expected, source: "regularisation", by, note, atMs: Date.now() };
      const r = recompute(empId, date, "régularisation", by); notify(); return r;
    },
    recomputeStale: async () => 0,
    async rebuild() { return 0; },

    // ----- Fonctions utilisées par le tableau de bord (équivalents de store.js) -----
    dashboardSource: {
      getSettings: async () => ({ ...state.settings }),
      healDirtyDays: () => {},
      watchDay(date, cb) {
        const emit = () => cb(Object.keys(state.days).filter((id) => onDate(id, date)).map((id) => { const [e, d] = id.split("_"); return dayDoc(e, d); }));
        listeners.add(emit); setTimeout(emit, 0); return () => listeners.delete(emit);
      },
      getDaysRange: async (empId, from, to) => Object.keys(state.days).filter((id) => id.startsWith(empId + "_") && inRange(id, from, to)).map((id) => { const [e, d] = id.split("_"); return dayDoc(e, d); }),
    },

    // ----- Simulation d'un pointage depuis la pointeuse de démonstration -----
    demoPunch({ empId, date, type, time, declaration }) {
      const id = key(empId, date);
      state.days[id] = { ...(state.days[id] || { siteId: empOf(empId).siteId, employeeId: empId, date }), [type]: at(date, time) };
      if (declaration) state.decls[id] = { siteId: empOf(empId).siteId, employeeId: empId, date, ...declaration, source: "badge", atMs: Date.now() };
      recompute(empId, date, "pointage", null); notify();
    },
    getPlan: (empId, date) => state.plans[key(empId, date)] || null,
    getDayRaw: (empId, date) => state.days[key(empId, date)] || null,
    hasPlanning: (empId, date) => hasPlanning(state.plans[key(empId, date)]),
    settings: () => state.settings,
    planSettings: () => planSettings(state.settings),
  };
}
