// ============================================================
// store.js — Accès Firestore + recalcul des jours.
// MULTI-MAGASINS : chaque salarié porte son propre siteId.
// punches = source de vérité brute (audit).
// days     = cache calculé, ID = {siteId}_{empId}_{date}.
// ============================================================
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp, Timestamp, runTransaction,
} from "firebase/firestore";
import { db } from "./firebase";
import { computeDay, computeCadreDay, checkRest, DEFAULT_SETTINGS } from "./timeLogic";

const SETTINGS_ID = "global";
const dayId = (siteId, empId, date) => `${siteId}_${empId}_${date}`;

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

// Recherche un salarié par matricule (badgeuse).
export async function findByMatricule(matricule, siteId) {
  const q = query(collection(db, "employees"), where("matricule", "==", String(matricule)));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.active !== false && (!siteId || (e.siteId || "main") === siteId));
  return list[0] || null;
}

// ---------- Réglages (globaux) ----------
export async function getSettings() {
  const ref = doc(db, "settings", SETTINGS_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const init = { ...DEFAULT_SETTINGS };
    await setDoc(ref, init);
    return init;
  }
  return { ...DEFAULT_SETTINGS, ...snap.data() };
}
export async function saveSettings(patch) {
  await setDoc(doc(db, "settings", SETTINGS_ID), patch, { merge: true });
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
export async function addPunch(empId, date, type, source = "badge", editedBy = null, at = new Date()) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const id = doc(collection(db, "punches")).id;
  await setDoc(doc(db, "punches", id), {
    siteId: emp.siteId || "main", employeeId: empId, date, type,
    at: Timestamp.fromDate(at instanceof Date ? at : new Date(at)),
    source, editedBy, createdAt: serverTimestamp(),
  });
  await recomputeDay(empId, date);
  return id;
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
    { siteId, employeeId: empId, date, ...patch, source: "manual", editedBy },
    { merge: true }
  );
  await recomputeDay(empId, date, true);
}

function hhmmToDate(date, hhmm) {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Y, M - 1, D, h, m, 0, 0);
}

// ---------- Cadres : saisie demi-journée ----------
// half = "morning" | "afternoon" ; value = "present" | <leaveType>
export async function setCadreHalfDay(empId, date, half, value, source = "badge", editedBy = null) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const siteId = emp.siteId || "main";
  const ref = doc(db, "days", dayId(siteId, empId, date));
  await setDoc(ref, {
    siteId, employeeId: empId, date, category: "cadre",
    [half]: value, source, editedBy,
  }, { merge: true });
  await recomputeCadreDay(empId, date);
}

export async function recomputeCadreDay(empId, date) {
  const emp = await getEmployee(empId);
  if (!emp) return;
  const siteId = emp.siteId || "main";
  const ref = doc(db, "days", dayId(siteId, empId, date));
  const cur = (await getDoc(ref)).data() || {};
  const m = computeCadreDay({ morning: cur.morning, afternoon: cur.afternoon }, emp, date);
  await setDoc(ref, {
    siteId, employeeId: empId, date, category: "cadre",
    morning: m.morning, afternoon: m.afternoon,
    dayFraction: m.dayFraction, status: m.status,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function recomputeDay(empId, date, fromManual = false) {
  const emp = await getEmployee(empId);
  if (!emp) return;
  const siteId = emp.siteId || "main";
  const settings = await getSettings();
  const ref = doc(db, "days", dayId(siteId, empId, date));

  let times = { arrival: null, breakOut: null, breakIn: null, departure: null };

  if (fromManual) {
    const cur = (await getDoc(ref)).data() || {};
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
      if (!byType[p.type] || p.at.toMillis() > byType[p.type].toMillis()) byType[p.type] = p.at;
    });
    times = {
      arrival: byType.arrival || null, breakOut: byType.breakOut || null,
      breakIn: byType.breakIn || null, departure: byType.departure || null,
    };
  }

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

export function watchDay(date, cb) {
  const q = query(collection(db, "days"), where("date", "==", date));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
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
