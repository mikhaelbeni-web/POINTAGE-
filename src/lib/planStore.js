// ============================================================
// planStore.js — Firestore : plannings, déclarations de pause, compteurs.
//
// RÈGLE ABSOLUE : rien ici ne se trouve dans le parcours de pointage.
// badgePunch (store.js) n'écrit que le pointage ; ce module lit et écrit
// d'AUTRES documents, en arrière-plan ou depuis l'administration.
//
// Collections :
//  plannings/{site_emp_date}      horaires prévus (saisis à la main)
//  planningHistory/{auto}         avant / après de chaque modification + impact
//  breakDeclarations/{site_emp_date} déclaration de pause faite au départ
//  pauseLedger/{site_emp_date}    ligne calculée du jour (jamais incrémentée)
//  ledgerHistory/{auto}           trace de chaque changement d'une ligne
// Le compteur = somme des lignes pauseLedger : recalculable à tout moment,
// aucun double comptage possible.
// ============================================================
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, onSnapshot,
  serverTimestamp, runTransaction, writeBatch, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { getSettings } from "./store";
import { computePlanDay, hasPlanning, addDays, strToDate, dateToStr } from "./planLogic";

export const planId = (siteId, empId, date) => `${siteId}_${empId}_${date}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

// ---------- Lecture ----------
// Pointeuse : UN seul écouteur (jour courant, magasin de la tablette), mis en cache
// local par Firestore. Au moment du départ, la décision « planning ou non » est
// donc locale : aucune lecture réseau dans le parcours de pointage.
export function watchPlanningsSite(date, siteId, cb) {
  const q = query(collection(db, "plannings"), where("date", "==", date), where("siteId", "==", siteId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
}

/** Plannings d'une plage de dates pour des salariés d'un magasin (écran administration). */
export function watchPlanningsRange(siteId, from, to, cb) {
  // Filtre par date seulement (index automatique) puis par magasin ici : un filtre
  // égalité + intervalle exigerait un index composite à créer dans la console Firebase.
  const q = query(collection(db, "plannings"), where("date", ">=", from), where("date", "<=", to));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.siteId === siteId)));
}

export async function getLedgerRows(empId, from, to) {
  const snap = await getDocs(query(collection(db, "pauseLedger"), where("employeeId", "==", empId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
}
export async function getLedgerForDate(siteId, date) {
  const snap = await getDocs(query(collection(db, "pauseLedger"), where("siteId", "==", siteId), where("date", "==", date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getLedgerHistory(ledgerId) {
  const snap = await getDocs(query(collection(db, "ledgerHistory"), where("ledgerId", "==", ledgerId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
}
export async function getPlanningHistory(empId) {
  const snap = await getDocs(query(collection(db, "planningHistory"), where("employeeId", "==", empId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
}
export async function getDaysForDate(siteId, date) {
  const snap = await getDocs(query(collection(db, "days"), where("siteId", "==", siteId), where("date", "==", date)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Écriture d'un planning (modification possible à tout moment, y compris rétroactive) ----------
const clean = (p) => (p && p.state ? (p.state === "off" ? { state: "off" } : { state: "worked", start: p.start, end: p.end }) : null);

export function planningWrite(batch, planning, before, by) {
  const { siteId, employeeId, date } = planning;
  const id = planId(siteId, employeeId, date);
  const after = { morning: clean(planning.morning), evening: clean(planning.evening) };
  const prev = before ? { morning: clean(before.morning), evening: clean(before.evening) } : null;
  if (JSON.stringify(prev) === JSON.stringify(after)) return null; // rien à changer
  batch.set(doc(db, "plannings", id), {
    siteId, employeeId, date, ...after, updatedBy: by || null, updatedAt: serverTimestamp(),
  });
  const histRef = doc(collection(db, "planningHistory"));
  batch.set(histRef, {
    planningId: id, siteId, employeeId, date, before: prev, after, by: by || null,
    atMs: Date.now(), at: serverTimestamp(), impact: null,
  });
  return { id, histId: histRef.id };
}

/**
 * Enregistre un ou plusieurs plannings (liste d'objets {siteId, employeeId, date, morning, evening}).
 * Les pointages ne sont JAMAIS touchés. Les compteurs concernés sont recalculés ensuite,
 * jour par jour, avec une concurrence limitée : ils n'occupent jamais la base au point
 * de gêner un pointage. Retourne { changed, recomputed }.
 */
export async function savePlannings(list, by, onProgress) {
  const changed = [];
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150);
    const befores = await Promise.all(chunk.map((p) => getDoc(doc(db, "plannings", planId(p.siteId, p.employeeId, p.date)))));
    const batch = writeBatch(db);
    chunk.forEach((p, k) => {
      const b = befores[k].exists() ? befores[k].data() : null;
      const w = planningWrite(batch, p, b, by);
      if (w) changed.push({ ...w, siteId: p.siteId, employeeId: p.employeeId, date: p.date });
    });
    await batch.commit();
  }
  // Recalcul différé (4 jours à la fois au maximum).
  let done = 0;
  const queue = [...changed];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const r = await recomputePlanDay(c.siteId, c.employeeId, c.date, { reason: "planning", by });
        await setDoc(doc(db, "planningHistory", c.histId), { impact: r.impact }, { merge: true });
      } catch (_) { /* la ligne reste marquée « à recalculer » : voir recomputeStale */ }
      done++; onProgress && onProgress(done, changed.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { changed: changed.length, recomputed: done };
}

// ---------- Déclaration de pause ----------
/** Données de la déclaration, à joindre à l'écriture groupée du départ (voir badgePunch). */
export function declarationRef(siteId, empId, date) { return doc(db, "breakDeclarations", planId(siteId, empId, date)); }
export function buildDeclaration({ siteId, empId, date, status, declaredMinutes, expectedMinutes, source = "badge", by = null, note = "" }) {
  return {
    siteId, employeeId: empId, date, status,
    declaredMinutes: status === "partial" ? Math.max(0, Math.round(Number(declaredMinutes) || 0)) : status === "none" ? 0 : status === "taken" ? expectedMinutes : null,
    expectedMinutesAtDeclaration: expectedMinutes, source, by, note,
    atMs: Date.now(), at: serverTimestamp(),
  };
}

/** Régularisation par la direction (oubli, panne) : conserve la trace de qui a corrigé et pourquoi. */
export async function regulariseDeclaration({ siteId, empId, date, status, declaredMinutes, by, note }) {
  const expected = (await getDoc(doc(db, "pauseLedger", planId(siteId, empId, date)))).data()?.expectedBreakMinutes ?? 0;
  const d = buildDeclaration({ siteId, empId, date, status, declaredMinutes, expectedMinutes: expected, source: "regularisation", by, note });
  await setDoc(declarationRef(siteId, empId, date), d);
  return recomputePlanDay(siteId, empId, date, { reason: "régularisation", by });
}

// ---------- Recalcul d'une journée (jamais dans le parcours de pointage) ----------
let _planSettings = null, _planSettingsAt = 0;
async function settingsCached() {
  if (_planSettings && Date.now() - _planSettingsAt < 60000) return _planSettings;
  _planSettings = await getSettings(); _planSettingsAt = Date.now();
  return _planSettings;
}
export function invalidatePlanSettings() { _planSettings = null; }

const SIG_KEYS = ["plannedWorkMinutes", "expectedBreakMinutes", "actualWorkMinutes", "overtimeMinutes", "undertimeMinutes", "arrivalDeltaMinutes", "departureDeltaMinutes", "declarationStatus", "declaredBreakMinutes", "missingBreakMinutes", "extraBreakMinutes", "deltaBreakMinutes", "counted", "state"];
const sig = (r) => JSON.stringify(SIG_KEYS.map((k) => (r ? r[k] ?? null : null)));

/**
 * Recalcule la ligne pauseLedger d'un jour. Transaction : lit pointage, planning,
 * déclaration et ancienne ligne, puis ÉCRIT la nouvelle ligne (remplacement, pas
 * incrément) : exécuter deux fois donne le même résultat. N'écrit jamais dans
 * days, punches, breakDeclarations.
 */
export async function recomputePlanDay(siteId, empId, date, { reason = "calcul", by = null } = {}) {
  if (isOffline()) throw new Error("hors-ligne");
  const settings = await settingsCached();
  const empSnap = await getDoc(doc(db, "employees", empId));
  const emp = empSnap.exists() ? { id: empId, ...empSnap.data() } : { id: empId };
  const id = planId(siteId, empId, date);
  let result;
  await runTransaction(db, async (tx) => {
    const [pl, dy, dc, lg] = await Promise.all([
      tx.get(doc(db, "plannings", id)), tx.get(doc(db, "days", id)),
      tx.get(doc(db, "breakDeclarations", id)), tx.get(doc(db, "pauseLedger", id)),
    ]);
    const row = computePlanDay({
      planning: pl.exists() ? pl.data() : null, day: dy.exists() ? dy.data() : null,
      declaration: dc.exists() ? dc.data() : null, emp, settings, date,
    });
    const prev = lg.exists() ? lg.data() : null;
    const changed = sig(prev) !== sig(row);
    // Une ligne sans planning ni pointage n'a pas de raison d'exister.
    if (!row.hasPlanning && !dc.exists()) {
      if (prev) tx.delete(doc(db, "pauseLedger", id));
    } else {
      tx.set(doc(db, "pauseLedger", id), { ...row, siteId, employeeId: empId, computedAt: serverTimestamp(), computedAtMs: Date.now() });
    }
    if (changed && (prev || row.hasPlanning || dc.exists())) {
      tx.set(doc(collection(db, "ledgerHistory")), {
        ledgerId: id, employeeId: empId, siteId, date, reason, by,
        before: prev ? Object.fromEntries(SIG_KEYS.map((k) => [k, prev[k] ?? null])) : null,
        after: Object.fromEntries(SIG_KEYS.map((k) => [k, row[k] ?? null])),
        atMs: Date.now(), at: serverTimestamp(),
      });
    }
    result = {
      row, changed,
      impact: {
        expectedBefore: prev ? prev.expectedBreakMinutes ?? null : null, expectedAfter: row.expectedBreakMinutes,
        deltaBefore: prev ? prev.deltaBreakMinutes ?? 0 : 0, deltaAfter: row.deltaBreakMinutes,
        plannedBefore: prev ? prev.plannedWorkMinutes ?? null : null, plannedAfter: row.plannedWorkMinutes,
      },
    };
  });
  return result;
}

// File d'attente des calculs différés : au plus 3 recalculs en même temps, un seul en attente
// par journée. Une rafale de pointages ne déclenche donc jamais une rafale de transactions.
const RETRY_MS = [300, 5000, 15000, 45000, 120000];
const _queue = [];
const _queued = new Set();
let _running = 0;
const MAX_PARALLEL = 3;
function pump() {
  while (_running < MAX_PARALLEL && _queue.length) {
    const job = _queue.shift();
    _queued.delete(job.key);       // le calcul relira les données à jour au moment de s'exécuter
    _running++;
    job.run().finally(() => { _running--; pump(); });
  }
}
function schedule(siteId, empId, date, attempt, reason) {
  const key = planId(siteId, empId, date);
  setTimeout(() => {
    if (_queued.has(key)) return;  // déjà en file : ce passage couvrira aussi ce pointage
    _queued.add(key);
    _queue.push({ key, run: async () => {
      try { await recomputePlanDay(siteId, empId, date, { reason }); }
      catch (_) { if (attempt + 1 < RETRY_MS.length) schedule(siteId, empId, date, attempt + 1, reason); }
    } });
    pump();
  }, RETRY_MS[attempt]);
}
/** Calcul différé après un pointage. Ne bloque jamais, ne lève jamais d'erreur ; reprise automatique, sinon recomputeStale. */
export function recomputePlanInBackground(siteId, empId, date) { schedule(siteId, empId, date, 0, "pointage"); }

/**
 * Reprise après erreur : recalcule les jours d'une période dont la ligne manque ou est plus
 * ancienne que le dernier pointage / la dernière modification. Appelé à l'ouverture du suivi.
 */
export async function recomputeStale(siteId, date, by) {
  const [days, plans, ledger, decls] = await Promise.all([
    getDaysForDate(siteId, date),
    getDocs(query(collection(db, "plannings"), where("siteId", "==", siteId), where("date", "==", date))).then((s) => s.docs.map((d) => d.data())),
    getLedgerForDate(siteId, date),
    getDocs(query(collection(db, "breakDeclarations"), where("siteId", "==", siteId), where("date", "==", date))).then((s) => s.docs.map((d) => d.data())),
  ]);
  const ids = new Set([...days.map((d) => d.employeeId), ...plans.map((p) => p.employeeId), ...decls.map((p) => p.employeeId)]);
  const led = Object.fromEntries(ledger.map((l) => [l.employeeId, l]));
  const upd = (x) => x?.updatedAt?.toMillis?.() ?? x?.atMs ?? 0;
  let n = 0;
  for (const empId of ids) {
    const l = led[empId];
    const newest = Math.max(
      upd(days.find((d) => d.employeeId === empId)), upd(plans.find((p) => p.employeeId === empId)), upd(decls.find((p) => p.employeeId === empId)),
    );
    if (!l || (l.computedAtMs || 0) < newest) { try { await recomputePlanDay(siteId, empId, date, { reason: "reprise", by }); n++; } catch (_) {} }
  }
  return n;
}

/** Recalcule tout depuis les données de référence (plannings, pointages, déclarations). Idempotent. */
export async function rebuildEmployeeLedger(siteId, empId, from, to, by) {
  const [pl, dy, dc] = await Promise.all(["plannings", "days", "breakDeclarations"].map((c) =>
    getDocs(query(collection(db, c), where("employeeId", "==", empId))).then((s) => s.docs.map((d) => d.data()))));
  const dates = new Set([...pl, ...dy, ...dc].map((x) => x.date).filter((d) => d >= from && d <= to));
  for (const date of dates) {
    const sid = [...pl, ...dy, ...dc].find((x) => x.date === date)?.siteId || siteId;
    await recomputePlanDay(sid, empId, date, { reason: "reconstruction", by });
  }
  return dates.size;
}

// ---------- API utilisée par les écrans (Planning, Suivi) ----------
// Les écrans reçoivent un objet « api » : la vraie (Firestore, ci-dessous) ou celle de la
// page de démonstration (mémoire, voir demoApi.js). Même interface, mêmes calculs (planLogic).
import { saveSettings } from "./store";
async function getByDate(c, siteId, date) {
  const s = await getDocs(query(collection(db, c), where("siteId", "==", siteId), where("date", "==", date)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export const realApi = {
  getSettings,
  async saveSettings(patch) { await saveSettings(patch); invalidatePlanSettings(); },
  watchPlannings: watchPlanningsRange,
  async getPlannings(siteId, from, to) {
    const s = await getDocs(query(collection(db, "plannings"), where("date", ">=", from), where("date", "<=", to)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.siteId === siteId);
  },
  savePlannings,
  async getDaysRange(siteId, from, to) {
    const s = await getDocs(query(collection(db, "days"), where("date", ">=", from), where("date", "<=", to)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.siteId === siteId);
  },
  async getDaySituations(siteId, date) {
    const [plans, days, ledger, declarations] = await Promise.all([
      getByDate("plannings", siteId, date), getByDate("days", siteId, date),
      getByDate("pauseLedger", siteId, date), getByDate("breakDeclarations", siteId, date),
    ]);
    return { plans, days, ledger, declarations };
  },
  async getBalances(siteId) {
    const s = await getDocs(query(collection(db, "pauseLedger"), where("siteId", "==", siteId)));
    const by = {};
    s.docs.forEach((d) => { const r = d.data(); (by[r.employeeId] = by[r.employeeId] || []).push(r); });
    return by;
  },
  getLedgerRows: (empId) => getLedgerRows(empId),
  getLedgerHistory,
  getPlanningHistory,
  regularise: regulariseDeclaration,
  recomputeStale,
  rebuild: rebuildEmployeeLedger,
};
