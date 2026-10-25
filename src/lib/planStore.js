// ============================================================
// planStore.js — Firestore : plannings, déclarations de pause, compteurs.
//
// RÈGLE ABSOLUE : rien ici ne se trouve dans le parcours de pointage.
// badgePunch (store.js) n'écrit que le pointage ; ce module lit et écrit
// d'AUTRES documents, en arrière-plan ou depuis l'administration.
//
// Un planning, une déclaration de pause et une ligne de compteur sont rattachés
// au SALARIÉ et à la DATE (pas au magasin de la tablette) : un salarié qui badge
// dans un autre magasin garde le même planning, et son jour n'est jamais compté deux fois.
//
// Collections (id = {salarié}_{date}) :
//  plannings           horaires prévus (saisis à la main) ; siteId = magasin de rattachement
//  breakDeclarations   déclaration de pause faite au départ (une par jour)
//  pauseLedger         ligne calculée du jour (jamais incrémentée) ; siteId = magasin du pointage
// Collections (id automatique) :
//  planningHistory     avant / après de chaque modification + conséquences
//  ledgerHistory       trace de chaque changement d'une ligne du compteur
// Le compteur = somme des lignes pauseLedger : recalculable à tout moment,
// aucun double comptage possible.
// ============================================================
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, onSnapshot,
  serverTimestamp, runTransaction, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { getSettings, saveSettings } from "./store";
import { computePlanDay } from "./planLogic";

export const dayKey = (empId, date) => `${empId}_${date}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : null);

// ---------- Lecture ----------
// Pointeuse : UN seul écouteur (jour courant), mis en cache local par Firestore. Au moment
// du départ, la décision « planning ou non » est donc locale : aucune lecture réseau
// dans le parcours de pointage. (Un seul jour de plannings, jamais le calendrier complet.)
export function watchPlanningsDate(date, cb) {
  const q = query(collection(db, "plannings"), where("date", "==", date));
  return onSnapshot(q, (snap) => cb(rows(snap)), () => cb(null));
}

/** Plannings d'une plage de dates (écran administration). Filtre par date seulement : index automatique. */
export function watchPlanningsRange(from, to, cb) {
  const q = query(collection(db, "plannings"), where("date", ">=", from), where("date", "<=", to));
  return onSnapshot(q, (snap) => cb(rows(snap)));
}

export async function getLedgerRows(empId) {
  const snap = await getDocs(query(collection(db, "pauseLedger"), where("employeeId", "==", empId)));
  return rows(snap).sort((a, b) => a.date.localeCompare(b.date));
}
export async function getLedgerHistory(ledgerId) {
  const snap = await getDocs(query(collection(db, "ledgerHistory"), where("ledgerId", "==", ledgerId)));
  return rows(snap).sort((a, b) => (a.atMs || 0) - (b.atMs || 0));
}
export async function getPlanningHistory(empId) {
  const snap = await getDocs(query(collection(db, "planningHistory"), where("employeeId", "==", empId)));
  return rows(snap).sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
}

// ---------- Écriture d'un planning (modification possible à tout moment, y compris rétroactive) ----------
const clean = (p) => (p && p.state ? (p.state === "off" ? { state: "off" } : { state: "worked", start: p.start, end: p.end }) : null);

export function planningWrite(batch, planning, before, by) {
  const { siteId, employeeId, date } = planning;
  const id = dayKey(employeeId, date);
  const after = { morning: clean(planning.morning), evening: clean(planning.evening) };
  const prev = before ? { morning: clean(before.morning), evening: clean(before.evening) } : null;
  if (JSON.stringify(prev) === JSON.stringify(after)) return null; // rien à changer
  batch.set(doc(db, "plannings", id), {
    siteId: siteId || null, employeeId, date, ...after, updatedBy: by || null, updatedAt: serverTimestamp(),
  });
  const histRef = doc(collection(db, "planningHistory"));
  batch.set(histRef, {
    planningId: id, siteId: siteId || null, employeeId, date, before: prev, after, by: by || null,
    atMs: Date.now(), at: serverTimestamp(), impact: null,
  });
  return { id, histId: histRef.id };
}

/**
 * Enregistre un ou plusieurs plannings ({siteId, employeeId, date, morning, evening}).
 * Les pointages ne sont JAMAIS touchés. Les compteurs concernés sont recalculés ensuite,
 * jour par jour, 4 à la fois au maximum : ils n'occupent jamais la base au point de gêner
 * un pointage. Retourne { changed, recomputed }.
 */
export async function savePlannings(list, by, onProgress) {
  const changed = [];
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150);
    const befores = await Promise.all(chunk.map((p) => getDoc(doc(db, "plannings", dayKey(p.employeeId, p.date)))));
    const batch = writeBatch(db);
    chunk.forEach((p, k) => {
      const b = befores[k].exists() ? befores[k].data() : null;
      const w = planningWrite(batch, p, b, by);
      if (w) changed.push({ ...w, employeeId: p.employeeId, date: p.date });
    });
    await batch.commit();
  }
  let done = 0;
  const queue = [...changed];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const r = await recomputePlanDay(c.employeeId, c.date, { reason: "planning", by });
        await setDoc(doc(db, "planningHistory", c.histId), { impact: r.impact }, { merge: true });
      } catch (_) { /* la ligne sera reprise par recomputeStale à l'ouverture du tableau de bord */ }
      done++; onProgress && onProgress(done, changed.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { changed: changed.length, recomputed: done };
}

// ---------- Déclaration de pause ----------
export const declarationRef = (empId, date) => doc(db, "breakDeclarations", dayKey(empId, date));
/** siteId = magasin de la tablette où le salarié pointe son départ. */
export function buildDeclaration({ siteId, empId, date, status, declaredMinutes, expectedMinutes, source = "badge", by = null, note = "" }) {
  return {
    siteId, employeeId: empId, date, status,
    declaredMinutes: status === "partial" ? Math.max(0, Math.round(Number(declaredMinutes) || 0)) : status === "none" ? 0 : status === "taken" ? expectedMinutes : null,
    expectedMinutesAtDeclaration: expectedMinutes, source, by, note,
    atMs: Date.now(), at: serverTimestamp(),
  };
}

/** Régularisation par la direction (oubli, panne) : conserve la trace de qui a corrigé et pourquoi. */
export async function regulariseDeclaration({ empId, date, status, declaredMinutes, by, note }) {
  const led = (await getDoc(doc(db, "pauseLedger", dayKey(empId, date)))).data();
  const d = buildDeclaration({ siteId: led?.siteId || null, empId, date, status, declaredMinutes, expectedMinutes: led?.expectedBreakMinutes ?? 0, source: "regularisation", by, note });
  await setDoc(declarationRef(empId, date), d);
  return recomputePlanDay(empId, date, { reason: "régularisation", by });
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

/** Un salarié peut avoir un jour par magasin : on garde la 1re arrivée, le dernier départ et la pause du jour qui en a une. */
function mergeDays(list) {
  if (!list.length) return null;
  const min = (k) => list.map((d) => ms(d[k])).filter((x) => x != null).reduce((a, b) => (a == null || b < a ? b : a), null);
  const max = (k) => list.map((d) => ms(d[k])).filter((x) => x != null).reduce((a, b) => (a == null || b > a ? b : a), null);
  const withBreak = list.find((d) => d.breakOut && d.breakIn);
  return { arrival: min("arrival"), departure: max("departure"), breakOut: withBreak?.breakOut || null, breakIn: withBreak?.breakIn || null };
}

/**
 * Recalcule la ligne pauseLedger d'un salarié pour un jour. Transaction : lit pointage(s), planning,
 * déclaration et ancienne ligne, puis ÉCRIT la nouvelle ligne (remplacement, pas incrément) :
 * exécuter deux fois donne le même résultat. N'écrit jamais dans days, punches, breakDeclarations.
 */
export async function recomputePlanDay(empId, date, { reason = "calcul", by = null } = {}) {
  if (isOffline()) throw new Error("hors-ligne");
  const settings = await settingsCached();
  const empSnap = await getDoc(doc(db, "employees", empId));
  const emp = empSnap.exists() ? { id: empId, ...empSnap.data() } : { id: empId };
  const id = dayKey(empId, date);
  const findDayRefs = async () => (await getDocs(query(collection(db, "days"), where("employeeId", "==", empId), where("date", "==", date)))).docs.map((d) => d.ref);
  // Une transaction ne peut pas faire de requête : les jours sont listés avant, puis relus dedans. Si un pointage
  // crée un jour entre-temps, la liste utilisée serait périmée (même après un nouvel essai de la transaction) :
  // on vérifie donc après coup et on recommence si la liste a changé.
  let dayRefs = await findDayRefs();
  let result;
  for (let pass = 0; pass < 3; pass++) {
    result = await recomputeOnce(dayRefs);
    const now = await findDayRefs();
    if (now.length === dayRefs.length && now.every((r) => dayRefs.some((q) => q.path === r.path))) break;
    dayRefs = now;
  }
  return result;

  async function recomputeOnce(dayRefs) {
  let result;
  await runTransaction(db, async (tx) => {
    const [pl, dc, lg, ...dys] = await Promise.all([
      tx.get(doc(db, "plannings", id)), tx.get(doc(db, "breakDeclarations", id)), tx.get(doc(db, "pauseLedger", id)),
      ...dayRefs.map((r) => tx.get(r)),
    ]);
    const dayDocs = dys.filter((d) => d.exists()).map((d) => d.data());
    const planning = pl.exists() ? pl.data() : null;
    const row = computePlanDay({ planning, day: mergeDays(dayDocs), declaration: dc.exists() ? dc.data() : null, emp, settings, date });
    const prev = lg.exists() ? lg.data() : null;
    const siteId = dayDocs[0]?.siteId || planning?.siteId || emp.siteId || null;
    const changed = sig(prev) !== sig(row);
    // Une ligne sans planning ni déclaration n'a pas de raison d'exister.
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
function schedule(empId, date, attempt, reason) {
  const key = dayKey(empId, date);
  setTimeout(() => {
    if (_queued.has(key)) return;  // déjà en file : ce passage couvrira aussi ce pointage
    _queued.add(key);
    _queue.push({ key, run: async () => {
      try { await recomputePlanDay(empId, date, { reason }); }
      catch (_) { if (attempt + 1 < RETRY_MS.length) schedule(empId, date, attempt + 1, reason); }
    } });
    pump();
  }, RETRY_MS[attempt]);
}
/** Calcul différé après un pointage. Ne bloque jamais, ne lève jamais d'erreur ; reprise automatique, sinon recomputeStale. */
export function recomputePlanInBackground(empId, date) { schedule(empId, date, 0, "pointage"); }

/**
 * Reprise après erreur : recalcule, pour les salariés donnés et un jour, les lignes manquantes ou plus
 * anciennes que le dernier pointage / la dernière modification. Appelé à l'ouverture du tableau de bord.
 */
export async function recomputeStale(empIds, date, by) {
  const wanted = new Set(empIds);
  const byDate = (c) => getDocs(query(collection(db, c), where("date", "==", date))).then(rows);
  const [days, plans, ledger, decls] = await Promise.all([byDate("days"), byDate("plannings"), byDate("pauseLedger"), byDate("breakDeclarations")]);
  const upd = (x) => (x ? x.updatedAt?.toMillis?.() ?? x.atMs ?? 0 : 0);
  const led = Object.fromEntries(ledger.map((l) => [l.employeeId, l]));
  const ids = new Set([...days, ...plans, ...decls].map((x) => x.employeeId).filter((e) => wanted.has(e)));
  let n = 0;
  for (const empId of ids) {
    const l = led[empId];
    const newest = Math.max(
      ...days.filter((d) => d.employeeId === empId).map(upd), upd(plans.find((p) => p.employeeId === empId)), upd(decls.find((p) => p.employeeId === empId)), 0,
    );
    if (!l || (l.computedAtMs || 0) < newest) { try { await recomputePlanDay(empId, date, { reason: "reprise", by }); n++; } catch (_) { /* repris plus tard */ } }
  }
  return n;
}

/** Recalcule tout depuis les données de référence (plannings, pointages, déclarations). Idempotent. */
export async function rebuildEmployeeLedger(empId, from, to, by) {
  const [pl, dy, dc] = await Promise.all(["plannings", "days", "breakDeclarations"].map((c) =>
    getDocs(query(collection(db, c), where("employeeId", "==", empId))).then((s) => s.docs.map((d) => d.data()))));
  const dates = new Set([...pl, ...dy, ...dc].map((x) => x.date).filter((d) => d >= from && d <= to));
  for (const date of dates) await recomputePlanDay(empId, date, { reason: "reconstruction", by });
  return dates.size;
}

// ---------- API utilisée par les écrans (Planning, Tableau de bord) ----------
// Les écrans reçoivent un objet « api » : la vraie (Firestore, ci-dessous) ou celle de la
// page de démonstration (mémoire, voir demoApi.js). Même interface, mêmes calculs (planLogic).
// Tout est lu par DATE seulement (index automatique) puis filtré par salarié côté écran.
const byDate = (c, date) => getDocs(query(collection(db, c), where("date", "==", date))).then(rows);
export const realApi = {
  getSettings,
  async saveSettings(patch) { await saveSettings(patch); invalidatePlanSettings(); },
  watchPlannings: watchPlanningsRange,
  async getPlannings(from, to) {
    return rows(await getDocs(query(collection(db, "plannings"), where("date", ">=", from), where("date", "<=", to))));
  },
  savePlannings,
  async getDaysRange(from, to) {
    return rows(await getDocs(query(collection(db, "days"), where("date", ">=", from), where("date", "<=", to))));
  },
  async getDaySituations(date) {
    const [plans, days, ledger, declarations] = await Promise.all(["plannings", "days", "pauseLedger", "breakDeclarations"].map((c) => byDate(c, date)));
    return { plans, days, ledger, declarations };
  },
  /** Lignes du compteur par salarié (par lots de 10 : limite de l'opérateur « in »). */
  async getBalances(empIds) {
    const by = {};
    for (let i = 0; i < empIds.length; i += 10) {
      const snap = await getDocs(query(collection(db, "pauseLedger"), where("employeeId", "in", empIds.slice(i, i + 10))));
      snap.docs.forEach((d) => { const r = d.data(); (by[r.employeeId] = by[r.employeeId] || []).push(r); });
    }
    return by;
  },
  getLedgerRows,
  getLedgerHistory,
  getPlanningHistory,
  regularise: regulariseDeclaration,
  recomputeStale,
  rebuild: rebuildEmployeeLedger,
};
