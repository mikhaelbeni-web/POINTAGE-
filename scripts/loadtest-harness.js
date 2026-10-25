// Harnais de test de charge de la pointeuse (émulateur Firestore, jamais la vraie base).
// Mesure le temps d'enregistrement d'une arrivée / d'un départ quand N salariés
// pointent en même temps, puis vérifie : pas de doublon, pas de perte, calculs
// différés terminés. Utilisé à l'identique avant et après l'évolution.
import { db } from "../src/lib/firebase";
import { doc, setDoc, getDocs, getDoc, collection, query, where } from "firebase/firestore";

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (arr) => ({ n: arr.length, p50: +pct(arr, 0.5).toFixed(1), p95: +pct(arr, 0.95).toFixed(1), max: +Math.max(...arr).toFixed(1), mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function runLoadTest({ label, N = 60, runId, punch, seed, settle, afterArrival }) {
  const siteId = `lt_${runId}`;
  const date = dateStr(new Date());
  const emps = Array.from({ length: N }, (_, i) => ({
    id: `e_${runId}_${i}`, matricule: String(1000 + i), displayName: `Test ${i}`, siteId,
    category: "employee", contractType: "full", weeklyContractMinutes: 2205, plannedStart: "09:00", plannedEnd: "17:00", active: true,
  }));
  await setDoc(doc(db, "settings", "global"), { lateToleranceMinutes: 5 }, { merge: true });
  await setDoc(doc(db, "warmup", runId), { at: Date.now() }); // ouvre la connexion avant la mesure
  await Promise.all(emps.map((e) => setDoc(doc(db, "employees", e.id), e)));
  if (seed) await seed({ emps, siteId, date });

  const timed = async (type) => {
    const lat = [];
    const t0 = performance.now();
    await Promise.all(emps.map(async (e) => {
      const s = performance.now();
      await punch(e, date, type, new Date(), siteId);
      lat.push(performance.now() - s);
    }));
    return { ...stats(lat), wallMs: +(performance.now() - t0).toFixed(1) };
  };

  const out = { label, N, date };
  const settleDays = async () => {
    const t = performance.now();
    while (performance.now() - t < 90000) {
      const snap = await getDocs(query(collection(db, "days"), where("siteId", "==", siteId)));
      if (snap.docs.every((d) => d.data().needsRecompute !== true)) break;
      await sleep(1000);
    }
  };
  out.arrival = await timed("arrival");
  // Scénario normal : les départs ont lieu longtemps après les arrivées (calculs différés terminés).
  // BACK_TO_BACK=1 : stress, départs immédiatement après les arrivées, calculs différés encore en cours.
  if (!process.env.BACK_TO_BACK) { await settleDays(); if (afterArrival) await afterArrival({ emps, siteId, date }); await sleep(Number(process.env.PHASE_GAP_MS || 4000)); }
  out.departure = await timed("departure");

  // Fin des calculs différés (arrière-plan).
  const t1 = performance.now();
  let dirty = N;
  while (performance.now() - t1 < 90000) {
    const snap = await getDocs(query(collection(db, "days"), where("siteId", "==", siteId)));
    dirty = snap.docs.filter((d) => d.data().needsRecompute === true || typeof d.data().workedMinutes !== "number").length;
    if (dirty === 0) break;
    await sleep(1000);
  }
  out.backgroundSettleMs = +(performance.now() - t1).toFixed(1);
  out.daysStillDirty = dirty;
  if (settle) out.extra = await settle({ emps, siteId, date });

  // Intégrité : exactement 1 arrivée + 1 départ par salarié, aucun doublon.
  const punches = await getDocs(query(collection(db, "punches"), where("siteId", "==", siteId)));
  const per = {};
  punches.docs.forEach((d) => { const p = d.data(); const k = `${p.employeeId}|${p.type}`; per[k] = (per[k] || 0) + 1; });
  out.punchDocs = punches.size;
  out.expectedPunchDocs = N * 2;
  out.duplicates = Object.values(per).filter((c) => c > 1).length;
  const days = await getDocs(query(collection(db, "days"), where("siteId", "==", siteId)));
  out.daysWithBothTimes = days.docs.filter((d) => d.data().arrival && d.data().departure).length;
  return out;
}
export { db, doc, getDoc, setDoc, getDocs, collection, query, where, sleep, stats };
