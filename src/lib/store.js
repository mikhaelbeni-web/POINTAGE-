// ============================================================
// store.js — Accès Firestore + recalcul des jours.
// punches = source de vérité brute (audit).
// days     = cache calculé (affichage rapide), ID déterministe.
// ============================================================
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db, SITE_ID } from "./firebase";
import { computeDay, checkRest, DEFAULT_SETTINGS } from "./timeLogic";

const dayId = (empId, date) => `${SITE_ID}_${empId}_${date}`;

// ---------- Réglages ----------
export async function getSettings() {
  const ref = doc(db, "settings", SITE_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...DEFAULT_SETTINGS, siteId: SITE_ID, managerPinHash: null });
    return { ...DEFAULT_SETTINGS };
  }
  return snap.data();
}
export async function saveSettings(patch) {
  await setDoc(doc(db, "settings", SITE_ID), patch, { merge: true });
}

// ---------- Salariés ----------
export function watchEmployees(cb) {
  const q = query(
    collection(db, "employees"),
    where("siteId", "==", SITE_ID)
  );
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    cb(list);
  });
}
export async function saveEmployee(emp) {
  const id = emp.id || doc(collection(db, "employees")).id;
  const { id: _omit, ...data } = emp;
  await setDoc(
    doc(db, "employees", id),
    { ...data, siteId: SITE_ID, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return id;
}
export async function deleteEmployee(id) {
  await deleteDoc(doc(db, "employees", id));
}

// ---------- Badges (punches) ----------
/** Enregistre un badge et recalcule la journée. */
export async function addPunch(empId, date, type, source = "badge", editedBy = null, at = new Date()) {
  const id = doc(collection(db, "punches")).id;
  await setDoc(doc(db, "punches", id), {
    siteId: SITE_ID, employeeId: empId, date, type,
    at: Timestamp.fromDate(at instanceof Date ? at : new Date(at)),
    source, editedBy, createdAt: serverTimestamp(),
  });
  await recomputeDay(empId, date);
  return id;
}

/** Corrige/écrase directement les 4 instants d'une journée (mode manager). */
export async function setDayTimes(empId, date, times, editedBy) {
  // times: { arrival, breakOut, breakIn, departure } en "HH:MM" ou null
  const patch = {};
  for (const k of ["arrival", "breakOut", "breakIn", "departure"]) {
    const v = times[k];
    patch[k] = v ? Timestamp.fromDate(hhmmToDate(date, v)) : null;
  }
  await setDoc(
    doc(db, "days", dayId(empId, date)),
    { siteId: SITE_ID, employeeId: empId, date, ...patch, source: "manual", editedBy },
    { merge: true }
  );
  await recomputeDay(empId, date, true);
}

function hhmmToDate(date, hhmm) {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Y, M - 1, D, h, m, 0, 0);
}

/** Recompose une journée depuis les badges bruts (ou depuis les instants
 *  déjà posés en mode manuel), calcule les métriques, écrit days/. */
export async function recomputeDay(empId, date, fromManual = false) {
  const empSnap = await getDoc(doc(db, "employees", empId));
  if (!empSnap.exists()) return;
  const emp = empSnap.data();
  const settings = await getSettings();
  const ref = doc(db, "days", dayId(empId, date));

  let times = { arrival: null, breakOut: null, breakIn: null, departure: null };

  if (fromManual) {
    const cur = (await getDoc(ref)).data() || {};
    times = {
      arrival: cur.arrival || null, breakOut: cur.breakOut || null,
      breakIn: cur.breakIn || null, departure: cur.departure || null,
    };
  } else {
    // Reconstruire depuis les badges : dernier badge de chaque type gagne.
    const q = query(
      collection(db, "punches"),
      where("siteId", "==", SITE_ID),
      where("employeeId", "==", empId),
      where("date", "==", date)
    );
    const snap = await getDocs(q);
    const byType = {};
    snap.docs.forEach((d) => {
      const p = d.data();
      if (!byType[p.type] || p.at.toMillis() > byType[p.type].toMillis()) {
        byType[p.type] = p.at;
      }
    });
    times = {
      arrival: byType.arrival || null,
      breakOut: byType.breakOut || null,
      breakIn: byType.breakIn || null,
      departure: byType.departure || null,
    };
  }

  const m = computeDay(times, emp, settings, date);

  // Repos vs veille
  const prev = new Date(date); prev.setDate(prev.getDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  const prevSnap = await getDoc(doc(db, "days", dayId(empId, prevStr)));
  let restViolation = false, restMinutes = null;
  if (prevSnap.exists() && prevSnap.data().departure && times.arrival) {
    const r = checkRest(prevSnap.data().departure, times.arrival, settings);
    restViolation = r.violation; restMinutes = r.restMinutes;
  }

  await setDoc(ref, {
    siteId: SITE_ID, employeeId: empId, date,
    arrival: times.arrival, breakOut: times.breakOut,
    breakIn: times.breakIn, departure: times.departure,
    workedMinutes: m.workedMinutes, breakMinutes: m.breakMinutes,
    lateMinutes: m.lateMinutes, status: m.status,
    restViolation, restMinutes,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ---------- Lecture des jours (plages) ----------
export async function getDaysRange(empId, startDate, endDate) {
  const q = query(
    collection(db, "days"),
    where("siteId", "==", SITE_ID),
    where("employeeId", "==", empId),
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function watchDay(date, cb) {
  const q = query(
    collection(db, "days"),
    where("siteId", "==", SITE_ID),
    where("date", "==", date)
  );
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

// ---------- Congés ----------
export async function addLeave(empId, type, startDate, endDate, note = "") {
  const id = doc(collection(db, "leaves")).id;
  await setDoc(doc(db, "leaves", id), {
    siteId: SITE_ID, employeeId: empId, type, startDate, endDate, note,
    createdAt: serverTimestamp(),
  });
  return id;
}
export async function getLeaves(empId, startDate, endDate) {
  const q = query(
    collection(db, "leaves"),
    where("siteId", "==", SITE_ID),
    where("employeeId", "==", empId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => !(l.endDate < startDate || l.startDate > endDate));
}
export async function deleteLeave(id) {
  await deleteDoc(doc(db, "leaves", id));
}
