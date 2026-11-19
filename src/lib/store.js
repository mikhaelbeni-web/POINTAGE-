// ============================================================
// store.js — Accès à la base (Supabase) + recalcul des jours.
// MULTI-MAGASINS : chaque salarié porte son propre siteId.
// punches = source de vérité brute (audit).
// days     = cache calculé, ID = {siteId}_{empId}_{date}.
// ============================================================
import {
  getDoc, queryDocs, setDoc, deleteDoc, watchQuery, serverTimestamp, runTransaction,
  writeBatch, newId, toMs, rawBatch,
} from "./db";
import { enqueue, configureOutbox, flush as flushOutbox } from "./outbox";
import { computeDay, computeCadreDay, checkRest, DEFAULT_SETTINGS } from "./timeLogic";
import { coupureAsBlocks } from "./planLogic";

// Version du calcul des jours. 2 : journée coupée saisie en Départ pause / Retour pause
// = deux blocs (la coupure n'est plus comptée en présence). Les jours calculés avant sont
// recalculés automatiquement à la lecture (tableau de bord, semaine, récap).
const CALC_VERSION = 2;
function needsHeal(d) {
  if (!d || d.category === "cadre") return false;
  if (d.needsRecompute === true) return true;
  return !!(d.breakOut && d.breakIn && !d.arrival2 && (d.calcVersion || 0) < CALC_VERSION);
}

const SETTINGS_ID = "global";
const dayId = (siteId, empId, date) => `${siteId}_${empId}_${date}`;

// Veille d'une date "YYYY-MM-DD", calculée en date locale (sans passer par l'UTC).
function prevDateStr(date) {
  const [Y, M, D] = date.split("-").map(Number);
  const d = new Date(Y, M - 1, D - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
configureOutbox(rawBatch);
if (typeof window !== "undefined") setTimeout(() => flushOutbox(), 0); // pointages restés en file
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
    await setDoc("tablets", docKey, {
      tabletId, siteId: siteId || null,
      lastSeen: serverTimestamp(),
      lastSeenMs: Date.now(),
      ...meta,
    }, { merge: true });
  } catch (_) { /* hors ligne : partira au retour du réseau */ }
}

export function watchTablets(cb) {
  return watchQuery("tablets", [], cb);
}

export async function deleteTablet(tabletId) {
  await deleteDoc("tablets", tabletId);
}

// Matricule auto : plus grand matricule existant + 1 (min 101).
export async function nextMatricule() {
  const list = await queryDocs("employees");
  let max = 100;
  list.forEach((d) => {
    const m = parseInt(d.matricule, 10);
    if (!isNaN(m) && m > max) max = m;
  });
  return String(max + 1);
}

// Recherche un salarié par matricule (badgeuse). Recherche GLOBALE :
// le matricule badge sur n'importe quelle tablette, quel que soit son magasin
// de rattachement. Le magasin du pointage sera celui de la tablette.
export async function findByMatricule(matricule) {
  // Colonne matricule = matricule sans espaces autour (même résultat que l'égalité exacte d'avant
  // pour les matricules bien saisis).
  const list = (await queryDocs("employees", [["matricule", "==", String(matricule).trim()]])).filter((e) => e.active !== false);
  return list[0] || null;
}

// ---------- Réglages (globaux) ----------
// Cache mémoire 5 min : les réglages changent rarement, inutile de les relire
// à chaque badge (économise un aller-retour réseau par pointage).
let _settingsCache = null;
let _settingsAt = 0;
export async function getSettings() {
  if (_settingsCache && Date.now() - _settingsAt < 5 * 60 * 1000) return _settingsCache;
  const snap = await getDoc("settings", SETTINGS_ID);
  let out;
  if (!snap.exists()) {
    out = { ...DEFAULT_SETTINGS };
    await setDoc("settings", SETTINGS_ID, out);
  } else {
    out = { ...DEFAULT_SETTINGS, ...snap.data() };
  }
  _settingsCache = out; _settingsAt = Date.now();
  return out;
}
export async function saveSettings(patch) {
  await setDoc("settings", SETTINGS_ID, patch, { merge: true });
  _settingsCache = null; // force la relecture après modification
}

// ---------- Magasins ----------
export function watchSites(cb) {
  return watchQuery("sites", [], (list) => {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    cb(list);
  }, { cacheKey: "sites" });
}
export async function saveSite(site) {
  const id = site.id || newId();
  const { id: _o, ...data } = site;
  await setDoc("sites", id, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}
export async function deleteSite(id) {
  await deleteDoc("sites", id);
}

// ---------- Managers (PIN unique + périmètre) ----------
// scope: "all" OU liste d'IDs de magasins.
export function watchManagers(cb) {
  return watchQuery("managers", [], (list) => {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    cb(list);
  }, { cacheKey: "managers" });
}
export async function saveManager(mgr) {
  const id = mgr.id || newId();
  const { id: _o, ...data } = mgr;
  await setDoc("managers", id, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}
export async function deleteManager(id) {
  await deleteDoc("managers", id);
}
export async function getAllManagers() {
  return queryDocs("managers");
}

// ---------- Salariés ----------
export function watchEmployees(cb) {
  return watchQuery("employees", [], (list) => {
    list.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    cb(list);
  }, { cacheKey: "employees" });
}

/**
 * Enregistre un salarié. L'unicité du matricule est garantie par la base elle-même
 * (index unique) : impossible de créer deux salariés avec le même matricule, même
 * simultanément. En cas de doublon : « Ce matricule est déjà utilisé par un autre salarié. »
 */
export async function saveEmployee(emp) {
  const id = emp.id || newId();
  const { id: _omit, ...data } = emp;
  const newMat = String(data.matricule || "").trim();
  if (!newMat) throw new Error("Matricule requis");
  await setDoc("employees", id, { ...data, matricule: newMat, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}

export async function deleteEmployee(id) {
  await deleteDoc("employees", id);
}
async function getEmployee(empId) {
  const s = await getDoc("employees", empId);
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// ---------- Badges (punches) ----------
// punchSiteId = magasin de la tablette où le badge a lieu (peut différer
// du magasin de rattachement du salarié). C'est le magasin RÉEL du pointage.
export async function addPunch(empId, date, type, source = "badge", editedBy = null, at = new Date(), punchSiteId = null) {
  const emp = await getEmployee(empId);
  if (!emp) throw new Error("Salarié introuvable");
  const siteId = punchSiteId || emp.siteId || "main";
  const id = newId();
  await setDoc("punches", id, {
    siteId, employeeId: empId, date, type,
    at: toMs(at instanceof Date ? at : new Date(at)),
    source, editedBy, createdAt: serverTimestamp(),
  });
  await recomputeDay(empId, date, false, siteId);
  return id;
}

// Badge rapide (tablette) : UNE seule écriture atomique (journal du badge +
// heure dans le jour), sans aucune lecture préalable. Le salarié est déjà connu
// côté tablette (emp). Le recalcul des indicateurs (heures, retard, repos)
// part ensuite en arrière-plan : l'écran n'attend pas.
// decl (facultatif) = déclaration de pause du départ (voir planStore.buildDeclaration) :
// elle part dans la MÊME écriture groupée, donc départ et déclaration sont enregistrés
// ensemble ou pas du tout. Sans planning, decl est absent : comportement inchangé.
// split = journée coupée : la pause déclarée de chaque bloc est mémorisée dans le jour
// (breakDecl1 / breakDecl2, minutes) pour être déduite du temps travaillé ; la déclaration du
// 2e bloc s'ajoute à celle du jour (champ block2) sans écraser celle du 1er bloc.
//
// Hors-ligne : l'écriture groupée part d'abord dans la file de la tablette (outbox.js),
// puis vers la base dès que le réseau est là. La promesse se résout à la confirmation de la base.
export async function badgePunch(emp, date, type, at, siteId, decl = null, split = false) {
  const sid = siteId || emp.siteId || "main";
  const when = toMs(at instanceof Date ? at : new Date(at));
  const batch = writeBatch();
  batch.set("punches", newId(), {
    siteId: sid, employeeId: emp.id, date, type, at: when,
    source: "badge", editedBy: null, createdAt: serverTimestamp(),
  });
  const dayExtra = {};
  if (split && decl && (type === "departure" || type === "departure2")) {
    const mins = decl.status === "taken" ? decl.expectedMinutesAtDeclaration : decl.status === "partial" ? decl.declaredMinutes : decl.status === "none" ? 0 : null;
    dayExtra[type === "departure" ? "breakDecl1" : "breakDecl2"] = mins;
  }
  batch.set("days", dayId(sid, emp.id, date), {
    siteId: sid, employeeId: emp.id, date, [type]: when, ...dayExtra,
    source: "badge", updatedAt: serverTimestamp(),
    // Marqueur "à recalculer" : effacé uniquement par un recalcul réussi.
    // S'il reste (coupure réseau, tablette rechargée…), un autre poste le refait.
    needsRecompute: true,
  }, { merge: true });
  if (decl) {
    const declId = `${emp.id}_${date}`; // une déclaration par salarié et par jour
    if (type === "departure2") batch.set("breakDeclarations", declId, { block2: decl }, { merge: true });
    else batch.set("breakDeclarations", declId, decl);
  }
  await enqueue(batch.ops);
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
  for (const k of ["arrival", "breakOut", "breakIn", "departure", "arrival2", "departure2"]) {
    if (!(k in times)) continue; // anciens appelants : pas de 2e bloc
    const v = times[k];
    patch[k] = v ? hhmmToDate(date, v).getTime() : null;
  }
  await setDoc(
    "days", dayId(siteId, empId, date),
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
  await setDoc("days", dayId(siteId, empId, date), {
    siteId, employeeId: empId, date, category: "cadre",
    [half]: value, source, editedBy,
  }, { merge: true });
  await recomputeCadreDay(empId, date, siteId);
}

export async function recomputeCadreDay(empId, date, siteId = null) {
  const emp = await getEmployee(empId);
  if (!emp) return;
  const sid = siteId || emp.siteId || "main";
  const ref = dayId(sid, empId, date);
  const cur = (await getDoc("days", ref)).data() || {};
  const m = computeCadreDay({ morning: cur.morning, afternoon: cur.afternoon }, emp, date);
  await setDoc("days", ref, {
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
//    badge, correction), le calcul est rejoué sur la version à jour (db.runTransaction).
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
  const ref = dayId(siteId, empId, date);

  // Départ de la veille (repos minimum), tous magasins confondus.
  // En cas d'échec de la requête : repli sur le jour de la veille du même magasin.
  const prevStr = prevDateStr(date);
  let prevDeparture = null;
  try {
    const prevList = await queryDocs("days", [["employeeId", "==", empId], ["date", "==", prevStr]]);
    prevList.forEach((d) => {
      const dep = d.departure;
      if (dep && (!prevDeparture || toMs(dep) > toMs(prevDeparture))) prevDeparture = dep;
    });
  } catch (_) {
    const p = await getDoc("days", dayId(siteId, empId, prevStr));
    prevDeparture = p.exists() ? (p.data().departure || null) : null;
  }

  await runTransaction(async (tx) => {
    const snap = await tx.get("days", ref);
    if (!snap.exists()) return;
    const planSnap = await tx.get("plannings", `${empId}_${date}`);
    const planning = planSnap.exists() ? planSnap.data() : null;
    const cur = snap.data();
    if (cur.category === "cadre") return; // les cadres ont leur propre calcul
    const times = {
      arrival: cur.arrival || null, breakOut: cur.breakOut || null,
      breakIn: cur.breakIn || null, departure: cur.departure || null,
      arrival2: cur.arrival2 || null, departure2: cur.departure2 || null,
      breakDecl1: cur.breakDecl1 ?? null, breakDecl2: cur.breakDecl2 ?? null,
    };
    const m = computeDay(coupureAsBlocks(times, planning, settings), emp, settings, date);
    let restViolation = false, restMinutes = null;
    if (prevDeparture && times.arrival) {
      const r = checkRest(prevDeparture, times.arrival, settings);
      restViolation = r.violation; restMinutes = r.restMinutes;
    }
    tx.update("days", ref, {
      workedMinutes: m.workedMinutes, breakMinutes: m.breakMinutes,
      spanMinutes: m.spanMinutes, spanViolation: m.spanViolation,
      lateMinutes: m.lateMinutes, status: m.status,
      restViolation, restMinutes,
      needsRecompute: false, calcVersion: CALC_VERSION,
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
    if (!needsHeal(d)) return;
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
        if (needsHeal(d) && !d._pending) _armHeal(id, 3000);
      }
    } catch (_) { /* jamais bloquant */ }
  });
}

export function healDirtyDays(list) {
  try {
    for (const d of list || []) {
      if (!d || !d.id) continue;
      _healLatest.set(d.id, d);
      if (needsHeal(d) && !d._pending) {
        _armHeal(d.id, d.needsRecompute === true ? HEAL_DELAY_MS : 0);
      } else {
        const t = _healTimers.get(d.id);
        if (t) { clearTimeout(t); _healTimers.delete(d.id); }
      }
    }
  } catch (_) { /* la réparation ne doit jamais casser l'affichage */ }
}

// Recalcul d'un jour depuis le tableau de bord / la correction. (L'ancien calcul reconstruit
// depuis le journal des badges n'était plus utilisé : il passe désormais par le calcul sûr.)
export async function recomputeDay(empId, date, fromManual = false, punchSiteId = null, empPreloaded = null) {
  const e = empPreloaded || (await getEmployee(empId));
  if (!e) return;
  return recomputeDayDoc(punchSiteId || e.siteId || "main", empId, date, e);
}

// ---------- Lecture des jours (plages) — sans index composite ----------
export async function getDaysRange(empId, startDate, endDate) {
  const list = await queryDocs("days", [["employeeId", "==", empId], ["date", ">=", startDate], ["date", "<=", endDate]]);
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// _pending = pointage encore dans la file de la tablette (sert à la réparation).
export function watchDay(date, cb) {
  return watchQuery("days", [["date", "==", date]], cb);
}

// Badgeuse : uniquement les jours du magasin de la tablette. Copie locale gardée :
// une tablette rechargée sans réseau affiche quand même l'état des pointages du jour.
export function watchDaySite(date, siteId, cb) {
  return watchQuery("days", [["date", "==", date], ["siteId", "==", siteId]], cb, { cacheKey: `days_${siteId}_${date}` });
}

// Récap : relit les jours et recalcule d'abord ceux restés "à recalculer",
// pour ne jamais imprimer de chiffres en retard. stale = nombre de jours
// qu'il a été impossible de recalculer (à signaler à l'écran).
export async function getDaysRangeHealed(emp, startDate, endDate) {
  let days = await getDaysRange(emp.id, startDate, endDate);
  const dirty = days.filter(needsHeal);
  if (dirty.length === 0) return { days, stale: 0 };
  for (const d of dirty) {
    try { await recomputeDayDoc(d.siteId, emp.id, d.date, emp); } catch (_) { /* compté plus bas */ }
  }
  days = await getDaysRange(emp.id, startDate, endDate);
  const stale = days.filter(needsHeal).length;
  return { days, stale };
}

// ---------- Congés ----------
export async function addLeave(empId, type, startDate, endDate, note = "") {
  const emp = await getEmployee(empId);
  const id = newId();
  await setDoc("leaves", id, {
    siteId: emp?.siteId || "main", employeeId: empId, type, startDate, endDate, note,
    createdAt: serverTimestamp(),
  });
  return id;
}
export async function getLeaves(empId, startDate, endDate) {
  const list = await queryDocs("leaves", [["employeeId", "==", empId]]);
  return list
    .filter((l) => !(l.endDate < startDate || l.startDate > endDate));
}
export async function deleteLeave(id) {
  await deleteDoc("leaves", id);
}
