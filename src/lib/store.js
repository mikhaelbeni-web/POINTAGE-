// ============================================================
// store.js — Accès Firestore + recalcul des jours.
// MULTI-MAGASINS : chaque salarié porte son propre siteId.
// punches = source de vérité brute (audit).
// days     = cache calculé, ID = {siteId}_{empId}_{date}.
// ============================================================
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp, Timestamp, runTransaction, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { computeDay, computeCadreDay, checkRest, DEFAULT_SETTINGS } from "./timeLogic";

const SETTINGS_ID = "global";
const dayId = (siteId, empId, date) => `${siteId}_${empId}_${date}`;

// Veille d'une date "YYYY-MM-DD", calculée en date locale (sans passer par l'UTC).
function prevDateStr(date) {
  const [Y, M, D] = date.split("-").map(Number);
  const d = new Date(Y, M - 1, D - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Suivi des tablettes (heartbeat) ----------
// Chaque tablette écrit régulièrement un "battement" dans tablets/{tabletId}.
// lastSeenMs = heure client (visible tout de suite sur les autres postes,
// contrairement à serverTimestamp qui est différé par le cache hors-ligne).
export async function sendHeartbeat(tabletId, siteId, meta = {}) {
  try {
    // ID du doc = tablette + magasin. Ainsi deux magasins produisent
    // TOUJOURS deux documents distincts, même si deux appareils partagent
    // le même tabletId (ex. localStorage synchronisé entre navigateurs).
    const docKey = `${tabletId}__${siteId || "none"}`;
    await setDoc(doc(db, "tablets", docKey), {
      tabletId, siteId: siteId || null,
      lastSeen: serverTimestamp(),
      lastSeenMs: Date.now(),
      ...meta,
    }, { merge: true });
  } catch (_) { /* hors ligne : partira au retour du réseau */ }
}

export function watchTablets(cb) {
  return onSnapshot(collection(db, "tablets"), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function deleteTablet(tabletId) {
  await deleteDoc(doc(db, "tablets", tabletId));
}

// Matricule auto : plus grand matricule existant + 1 (min 101).
export async function nextMatricule() {
  const snap = await getDocs(collection(db, "employees"));
  let max = 100;
  snap.docs.forEach((d) => {
    const m = parseInt(d.data().matricule, 10);
    if (!isNaN(m) && m > max) max = m;
  });
  return String(max + 1);
}

// Recherche un salarié par matricule (badgeuse). Recherche GLOBALE :
// le matricule badge sur n'importe quelle tablette, quel que soit son magasin
// de rattachement. Le magasin du pointage sera celui de la tablette.
export async function findByMatricule(matricule) {
  const q = query(collection(db, "employees"), where("matricule", "==", String(matricule)));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.active !== false);
  return list[0] || null;
}

// ---------- Réglages (globaux) ----------
// Cache mémoire 5 min : les réglages changent rarement, inutile de les relire
// à chaque badge (économise un aller-retour réseau par pointage).
let _settingsCache = null;
let _settingsAt = 0;
export async function getSettings() {
  if (_settingsCache && Date.now() - _settingsAt < 5 * 60 * 1000) return _settingsCache;
  const ref = doc(db, "settings", SETTINGS_ID);
  const snap = await getDoc(ref);
  let out;
  if (!snap.exists()) {
    out = { ...DEFAULT_SETTINGS };
    await setDoc(ref, out);
  } else {
    out = { ...DEFAULT_SETTINGS, ...snap.data() };
  }
  _settingsCache = out; _settingsAt = Date.now();
  return out;
}
export async function saveSettings(patch) {
  await setDoc(doc(db, "settings", SETTINGS_ID), patch, { merge: true });
  _settingsCache = null; // force la relecture après modification
}

// ---------- Magasins ----------
export function watchSites(cb) {
  return onSnapshot(collection(db, "sites"), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    cb(list);
  });
}
export async function saveSite(site) {
  const id = site.id || doc(collection(db, "sites")).id;
  const { id: _o, ...data } = site;
  await setDoc(doc(db, "sites", id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}
export async function deleteSite(id) {
  await deleteDoc(doc(db, "sites", id));
}

// ---------- Managers (PIN unique + périmètre) ----------
// scope: "all" OU liste d'IDs de magasins.
export function watchManagers(cb) {
  return onSnapshot(collection(db, "managers"), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    cb(list);
  });
}
export async function saveManager(mgr) {
  const id = mgr.id || doc(collection(db, "managers")).id;
  const { id: _o, ...data } = mgr;
  await setDoc(doc(db, "managers", id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}
export async function deleteManager(id) {
  await deleteDoc(doc(db, "managers", id));
}
export async function getAllManagers() {
  const snap = await getDocs(collection(db, "managers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Salariés ----------
export function watchEmployees(cb) {
  return onSnapshot(collection(db, "employees"), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    cb(list);
  });
}
// Clé de verrou pour un matricule (unicité réseau).
const matLockId = (mat) => `mat_${String(mat).trim()}`;

/**
 * Enregistre un salarié en RÉSERVANT son matricule de façon atomique.
 * Un doc matricules/{mat_XXX} sert de verrou : la transaction échoue
 * si le matricule est déjà réservé par un AUTRE salarié.
 * Impossible de créer deux salariés avec le même matricule, même simultanément.
 */
export async function saveEmployee(emp) {
  const id = emp.id || doc(collection(db, "employees")).id;
  const { id: _omit, ...data } = emp;
  const newMat = String(data.matricule || "").trim();
  if (!newMat) throw new Error("Matricule requis");

  // Ancien matricule (si modification) pour libérer l'ancien verrou.
  let oldMat = null;
  if (emp.id) {
    const prev = await getDoc(doc(db, "employees", id));
    if (prev.exists()) oldMat = String(prev.data().matricule || "").trim();
  }

  await runTransaction(db, async (tx) => {
    const lockRef = doc(db, "matricules", matLockId(newMat));
    const lockSnap = await tx.get(lockRef);
    // Le verrou existe ET appartient à un autre salarié -> refus.
    if (lockSnap.exists() && lockSnap.data().employeeId !== id) {
      throw new Error("Ce matricule est déjà utilisé par un autre salarié.");
    }
    // Réserve le nouveau matricule pour ce salarié.
    tx.set(lockRef, { employeeId: id, matricule: newMat });
    // Libère l'ancien matricule s'il a changé.
    if (oldMat && oldMat !== newMat) {
      tx.delete(doc(db, "matricules", matLockId(oldMat)));
    }
    // Écrit le salarié.
    tx.set(doc(db, "employees", id), { ...data, matricule: newMat, updatedAt: serverTimestamp() }, { merge: true });
  });
  return id;
}

export async function deleteEmployee(id) {
  // Libère le verrou de matricule en même temps que la suppression.
  const snap = await getDoc(doc(db, "employees", id));
  const mat = snap.exists() ? String(snap.data().matricule || "").trim() : null;
  await deleteDoc(doc(db, "employees", id));
  if (mat) {
    try { await deleteDoc(doc(db, "matricules", matLockId(mat))); } catch (_) {}
  }
}
async function getEmployee(empId) {
  const s = await getDoc(doc(db, "employees", empId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// ---------- Badges (punches) ----------
// punchSiteId = magasin de la tablette où le badge a lieu (peut différer
// du magasin de rattachement du salarié). C'est le magasin RÉEL du pointage.
export async function addPunch(empId, date, type, source = "badge", editedBy = null, at = new Date(), punchSiteId = null) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const siteId = punchSiteId || emp.siteId || "main";
  const id = doc(collection(db, "punches")).id;
  await setDoc(doc(db, "punches", id), {
    siteId, employeeId: empId, date, type,
    at: Timestamp.fromDate(at instanceof Date ? at : new Date(at)),
    source, editedBy, createdAt: serverTimestamp(),
  });
  await recomputeDay(empId, date, false, siteId);
  return id;
}

// Badge rapide (tablette) : UNE seule écriture atomique (journal du badge +
// heure dans le jour), sans aucune lecture préalable. Le salarié est déjà connu
// côté tablette (emp). Le recalcul des indicateurs (heures, retard, repos)
// part ensuite en arrière-plan : l'écran n'attend pas.
export async function badgePunch(emp, date, type, at, siteId) {
  const sid = siteId || emp.siteId || "main";
  const when = Timestamp.fromDate(at instanceof Date ? at : new Date(at));
  const punchRef = doc(collection(db, "punches"));
  const dayRef = doc(db, "days", dayId(sid, emp.id, date));
  const batch = writeBatch(db);
  batch.set(punchRef, {
    siteId: sid, employeeId: emp.id, date, type, at: when,
    source: "badge", editedBy: null, createdAt: serverTimestamp(),
  });
  batch.set(dayRef, {
    siteId: sid, employeeId: emp.id, date, [type]: when,
    source: "badge", updatedAt: serverTimestamp(),
    // Marqueur "à recalculer" : effacé uniquement par un recalcul réussi.
    // S'il reste (coupure réseau, tablette rechargée…), un autre poste le refait.
    needsRecompute: true,
  }, { merge: true });
  await batch.commit();
  // Recalcul en arrière-plan (pas d'attente côté écran), avec nouvelles tentatives.
  recomputeInBackground(sid, emp.id, date, emp);
}

// Recalcul en arrière-plan : 4 tentatives espacées. En cas d'échec définitif,
// le jour reste marqué needsRecompute et sera recalculé par healDirtyDays.
function recomputeInBackground(siteId, empId, date, emp) {
  (async () => {
    for (const wait of [0, 2000, 10000, 30000]) {
      if (wait) await sleep(wait);
      try { await recomputeDayDoc(siteId, empId, date, emp); return; } catch (_) { /* nouvelle tentative */ }
    }
  })();
}

export async function setDayTimes(empId, date, times, editedBy) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const siteId = emp.siteId || "main";
  const patch = {};
  for (const k of ["arrival", "breakOut", "breakIn", "departure"]) {
    const v = times[k];
    patch[k] = v ? Timestamp.fromDate(hhmmToDate(date, v)) : null;
  }
  await setDoc(
    doc(db, "days", dayId(siteId, empId, date)),
    { siteId, employeeId: empId, date, ...patch, source: "manual", editedBy, needsRecompute: true },
    { merge: true }
  );
  // Les heures corrigées sont enregistrées ci-dessus. Si le recalcul échoue
  // (réseau), le jour reste marqué et sera recalculé plus tard : on ne bloque
  // pas la fenêtre de correction.
  try { await recomputeDayDoc(siteId, empId, date, emp); }
  catch (_) { recomputeInBackground(siteId, empId, date, emp); }
}

function hhmmToDate(date, hhmm) {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Y, M - 1, D, h, m, 0, 0);
}

// ---------- Cadres : saisie demi-journée ----------
// half = "morning" | "afternoon" ; value = "present" | <leaveType>
// punchSiteId = magasin de la tablette (magasin réel du pointage)
export async function setCadreHalfDay(empId, date, half, value, source = "badge", editedBy = null, punchSiteId = null) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const siteId = punchSiteId || emp.siteId || "main";
  const ref = doc(db, "days", dayId(siteId, empId, date));
  await setDoc(ref, {
    siteId, employeeId: empId, date, category: "cadre",
    [half]: value, source, editedBy,
  }, { merge: true });
  await recomputeCadreDay(empId, date, siteId);
}

export async function recomputeCadreDay(empId, date, siteId = null) {
  const emp = await getEmployee(empId);
  if (!emp) return;
  const sid = siteId || emp.siteId || "main";
  const ref = doc(db, "days", dayId(sid, empId, date));
  const cur = (await getDoc(ref)).data() || {};
  const m = computeCadreDay({ morning: cur.morning, afternoon: cur.afternoon }, emp, date);
  await setDoc(ref, {
    siteId: sid, employeeId: empId, date, category: "cadre",
    morning: m.morning, afternoon: m.afternoon,
    dayFraction: m.dayFraction, status: m.status,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ------------------------------------------------------------------
// Recalcul SÛR d'un jour (badge, correction manager, réparation).
// 1. Ne réécrit JAMAIS les heures (arrivée, pause, retour, départ) : elles ne
//    sont écrites que par le badge ou la correction manager. Un pointage
//    simultané ne peut donc plus être effacé par un recalcul.
// 2. Transaction : si le jour change entre la lecture et l'écriture (autre
//    badge, correction), Firestore rejoue le calcul sur la version à jour.
//    Les indicateurs (heures, retard, statut) correspondent toujours aux heures.
// 3. Chaque salarié a son propre document : aucune attente entre salariés ni
//    entre magasins.
// Lève une erreur si hors-ligne / échec : l'appelant garde le jour "à recalculer".
// ------------------------------------------------------------------
export async function recomputeDayDoc(siteId, empId, date, empPreloaded = null) {
  if (isOffline()) throw new Error("hors-ligne");
  const emp = empPreloaded || (await getEmployee(empId));
  if (!emp) return;
  const settings = await getSettings();
  const ref = doc(db, "days", dayId(siteId, empId, date));

  // Départ de la veille (repos minimum), tous magasins confondus.
  // En cas d'échec de la requête : repli sur le jour de la veille du même magasin.
  const prevStr = prevDateStr(date);
  let prevDeparture = null;
  try {
    const prevSnap = await getDocs(query(
      collection(db, "days"), where("employeeId", "==", empId), where("date", "==", prevStr)
    ));
    prevSnap.docs.forEach((d) => {
      const dep = d.data().departure;
      if (dep && (!prevDeparture || dep.toMillis() > prevDeparture.toMillis())) prevDeparture = dep;
    });
  } catch (_) {
    const p = await getDoc(doc(db, "days", dayId(siteId, empId, prevStr)));
    prevDeparture = p.exists() ? (p.data().departure || null) : null;
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data();
    if (cur.category === "cadre") return; // les cadres ont leur propre calcul
    const times = {
      arrival: cur.arrival || null, breakOut: cur.breakOut || null,
      breakIn: cur.breakIn || null, departure: cur.departure || null,
    };
    const m = computeDay(times, emp, settings, date);
    let restViolation = false, restMinutes = null;
    if (prevDeparture && times.arrival) {
      const r = checkRest(prevDeparture, times.arrival, settings);
      restViolation = r.violation; restMinutes = r.restMinutes;
    }
    tx.update(ref, {
      workedMinutes: m.workedMinutes, breakMinutes: m.breakMinutes,
      spanMinutes: m.spanMinutes, spanViolation: m.spanViolation,
      lateMinutes: m.lateMinutes, status: m.status,
      restViolation, restMinutes,
      needsRecompute: false,
      updatedAt: serverTimestamp(),
    });
  });
}

// ------------------------------------------------------------------
// Réparation automatique : tout poste qui affiche des jours (badgeuse,
// tableau de bord) relance le recalcul des jours restés "à recalculer"
// plus de ~20 s. Sans danger si plusieurs postes le font en même temps
// (transaction). Nombre de tentatives limité par jour et par session.
// ------------------------------------------------------------------
const HEAL_DELAY_MS = 20000;
const HEAL_RETRY_MS = 60000;
const HEAL_MAX_ATTEMPTS = 5;
const _healTimers = new Map();   // id du jour -> minuteur programmé
const _healLatest = new Map();   // id du jour -> dernière version vue
const _healAttempts = new Map(); // id du jour -> nombre de tentatives
const _empCache = new Map();     // id salarié -> { emp, at } (relue toutes les 5 min)
const EMP_CACHE_MS = 5 * 60 * 1000;

function _armHeal(id, delay) {
  if (_healTimers.has(id)) return;
  if ((_healAttempts.get(id) || 0) >= HEAL_MAX_ATTEMPTS) return;
  const jitter = Math.floor(Math.random() * 10000); // évite que tous les postes réparent en même temps
  _healTimers.set(id, setTimeout(async () => {
    _healTimers.delete(id);
    const d = _healLatest.get(id);
    if (!d || d.needsRecompute !== true || d.category === "cadre") return;
    _healAttempts.set(id, (_healAttempts.get(id) || 0) + 1);
    try {
      const c = _empCache.get(d.employeeId);
      let emp = c && Date.now() - c.at < EMP_CACHE_MS ? c.emp : null;
      if (!emp) { emp = await getEmployee(d.employeeId); if (emp) _empCache.set(d.employeeId, { emp, at: Date.now() }); }
      if (!emp) return;
      await recomputeDayDoc(d.siteId, d.employeeId, d.date, emp);
    } catch (_) {
      _armHeal(id, HEAL_RETRY_MS);
    }
  }, delay + jitter));
}

// Retour du réseau après une longue coupure : on remet les compteurs à zéro et on
// relance tout de suite la réparation des jours encore "à recalculer".
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    try {
      _healAttempts.clear();
      for (const [id, d] of _healLatest) {
        if (d.needsRecompute === true && !d._pending && d.category !== "cadre") _armHeal(id, 3000);
      }
    } catch (_) { /* jamais bloquant */ }
  });
}

export function healDirtyDays(list) {
  try {
    for (const d of list || []) {
      if (!d || !d.id) continue;
      _healLatest.set(d.id, d);
      if (d.needsRecompute === true && !d._pending && d.category !== "cadre") {
        _armHeal(d.id, HEAL_DELAY_MS);
      } else {
        const t = _healTimers.get(d.id);
        if (t) { clearTimeout(t); _healTimers.delete(d.id); }
      }
    }
  } catch (_) { /* la réparation ne doit jamais casser l'affichage */ }
}

export async function recomputeDay(empId, date, fromManual = false, punchSiteId = null, empPreloaded = null) {
  if (fromManual) {
    const e = empPreloaded || (await getEmployee(empId));
    if (!e) return;
    return recomputeDayDoc(punchSiteId || e.siteId || "main", empId, date, e);
  }
  // Ancien chemin (reconstruction depuis le journal des badges), conservé tel quel.
  // N'est plus utilisé par la badgeuse (badgePunch) ni par la correction manager.
  const emp = empPreloaded || (await getEmployee(empId));
  if (!emp) return;
  const settings = await getSettings();

  let times = { arrival: null, breakOut: null, breakIn: null, departure: null };
  let siteId = punchSiteId || emp.siteId || "main";

  if (fromManual) {
    // Correction manager : on lit le jour déjà ciblé (siteId fourni).
    const ref0 = doc(db, "days", dayId(siteId, empId, date));
    const cur = (await getDoc(ref0)).data() || {};
    times = {
      arrival: cur.arrival || null, breakOut: cur.breakOut || null,
      breakIn: cur.breakIn || null, departure: cur.departure || null,
    };
  } else {
    const q = query(
      collection(db, "punches"),
      where("employeeId", "==", empId),
      where("date", "==", date)
    );
    const snap = await getDocs(q);
    const byType = {};
    snap.docs.forEach((d) => {
      const p = d.data();
      // le magasin du pointage = celui des badges du jour
      if (p.siteId) siteId = p.siteId;
      if (!byType[p.type] || p.at.toMillis() > byType[p.type].toMillis()) byType[p.type] = p.at;
    });
    times = {
      arrival: byType.arrival || null, breakOut: byType.breakOut || null,
      breakIn: byType.breakIn || null, departure: byType.departure || null,
    };
  }

  const ref = doc(db, "days", dayId(siteId, empId, date));
  const m = computeDay(times, emp, settings, date);

  const prev = new Date(date); prev.setDate(prev.getDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  const prevSnap = await getDoc(doc(db, "days", dayId(siteId, empId, prevStr)));
  let restViolation = false, restMinutes = null;
  if (prevSnap.exists() && prevSnap.data().departure && times.arrival) {
    const r = checkRest(prevSnap.data().departure, times.arrival, settings);
    restViolation = r.violation; restMinutes = r.restMinutes;
  }

  await setDoc(ref, {
    siteId, employeeId: empId, date,
    arrival: times.arrival, breakOut: times.breakOut,
    breakIn: times.breakIn, departure: times.departure,
    workedMinutes: m.workedMinutes, breakMinutes: m.breakMinutes,
    spanMinutes: m.spanMinutes, spanViolation: m.spanViolation,
    lateMinutes: m.lateMinutes, status: m.status,
    restViolation, restMinutes,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ---------- Lecture des jours (plages) — sans index composite ----------
export async function getDaysRange(empId, startDate, endDate) {
  const q = query(
    collection(db, "days"),
    where("employeeId", "==", empId),
    where("date", ">=", startDate),
    where("date", "<=", endDate)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// _pending = écriture locale pas encore confirmée par le serveur (sert à la réparation).
const mapDays = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }));

export function watchDay(date, cb) {
  const q = query(collection(db, "days"), where("date", "==", date));
  return onSnapshot(q, (snap) => cb(mapDays(snap)));
}

// Badgeuse : uniquement les jours du magasin de la tablette (divise les lectures
// par le nombre de magasins). Si Firestore refuse la requête (index), repli
// automatique sur l'écoute de tous les jours de la date, filtrée côté tablette :
// même résultat, seulement plus de lectures.
export function watchDaySite(date, siteId, cb) {
  let unsub = () => {};
  let stopped = false;
  const fallback = () => {
    if (stopped) return;
    const q = query(collection(db, "days"), where("date", "==", date));
    unsub = onSnapshot(q, (snap) => cb(mapDays(snap).filter((d) => d.siteId === siteId)));
  };
  const q = query(collection(db, "days"), where("date", "==", date), where("siteId", "==", siteId));
  unsub = onSnapshot(q, (snap) => cb(mapDays(snap)), (err) => {
    console.warn("[pointage] écoute par magasin refusée, repli :", err && err.code);
    try { unsub(); } catch (_) {}
    fallback();
  });
  return () => { stopped = true; try { unsub(); } catch (_) {} };
}

// Récap : relit les jours et recalcule d'abord ceux restés "à recalculer",
// pour ne jamais imprimer de chiffres en retard. stale = nombre de jours
// qu'il a été impossible de recalculer (à signaler à l'écran).
export async function getDaysRangeHealed(emp, startDate, endDate) {
  let days = await getDaysRange(emp.id, startDate, endDate);
  const dirty = days.filter((d) => d.needsRecompute === true && d.category !== "cadre");
  if (dirty.length === 0) return { days, stale: 0 };
  for (const d of dirty) {
    try { await recomputeDayDoc(d.siteId, emp.id, d.date, emp); } catch (_) { /* compté plus bas */ }
  }
  days = await getDaysRange(emp.id, startDate, endDate);
  const stale = days.filter((d) => d.needsRecompute === true && d.category !== "cadre").length;
  return { days, stale };
}

// ---------- Congés ----------
export async function addLeave(empId, type, startDate, endDate, note = "") {
  const emp = await getEmployee(empId);
  const id = doc(collection(db, "leaves")).id;
  await setDoc(doc(db, "leaves", id), {
    siteId: emp?.siteId || "main", employeeId: empId, type, startDate, endDate, note,
    createdAt: serverTimestamp(),
  });
  return id;
}
export async function getLeaves(empId, startDate, endDate) {
  const q = query(collection(db, "leaves"), where("employeeId", "==", empId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => !(l.endDate < startDate || l.startDate > endDate));
}
export async function deleteLeave(id) {
  await deleteDoc(doc(db, "leaves", id));
}
