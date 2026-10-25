// Tests d'intégration sur l'émulateur Firestore : pointages simultanés + modifications
// rétroactives du planning en même temps, idempotence des compteurs, reconstruction, reprise.
import { db, doc, setDoc, getDoc, getDocs, collection, query, where, sleep, stats } from "./loadtest-harness";
import { badgePunch } from "../src/lib/store";
import {
  buildDeclaration, recomputePlanInBackground, recomputePlanDay, savePlannings, dayKey, rebuildEmployeeLedger, recomputeStale,
} from "../src/lib/planStore";
import { computeBalance } from "../src/lib/planLogic";
const dayId = (s, e, d) => `${s}_${e}_${d}`;

const runId = Date.now().toString(36);
const N = Number(process.env.N || 40);
const siteId = `it_${runId}`;
const date = new Date().toISOString().slice(0, 10);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
const pl = (m, e) => ({ morning: m, evening: e });
const w = (s, e) => ({ state: "worked", start: s, end: e });
const emps = Array.from({ length: N }, (_, i) => ({ id: `ie_${runId}_${i}`, matricule: String(2000 + i), displayName: `T${i}`, siteId, category: "employee", contractType: "full", weeklyContractMinutes: 2205, active: true }));
const byId = Object.fromEntries(emps.map((e) => [e.id, e]));
const unplanned = emps.slice(N - 5); // 5 salariés sans aucun planning
const planned = emps.slice(0, N - 5);
const col = async (c, extra) => (await getDocs(query(collection(db, c), where("siteId", "==", siteId), ...(extra || [])))).docs.map((d) => ({ id: d.id, ...d.data() }));

await setDoc(doc(db, "settings", "global"), { lateToleranceMinutes: 5 }, { merge: true });
await setDoc(doc(db, "warmup", runId), { a: 1 });
await Promise.all(emps.map((e) => setDoc(doc(db, "employees", e.id), e)));
// Planning initial : 08-16 (8 h -> 24 min attendues)
await savePlannings(planned.map((e) => ({ siteId, employeeId: e.id, date, ...pl(w("08:00", "16:00"), null) })), "test");
await sleep(500);

const statusOf = (e) => ["taken", "partial", "none"][Number(e.matricule) % 3];
const lat = { arrival: [], departure: [] };
const punch = async (e, type) => {
  const hasPlan = planned.includes(e);
  const decl = type === "departure" && hasPlan ? buildDeclaration({ siteId, empId: e.id, date, status: statusOf(e), declaredMinutes: 10, expectedMinutes: 24 }) : null;
  const s = performance.now();
  await badgePunch(e, date, type, new Date(), siteId, decl);
  lat[type].push(performance.now() - s);
  if (hasPlan) recomputePlanInBackground(e.id, date);
};

// --- A. pointages ET modifications rétroactives en même temps ---------------------------------
const edits = [pl(w("08:00", "14:00"), null), pl(w("08:00", "16:00"), null), pl(w("08:00", "14:00"), null)]; // 6 h (20 min), 8 h (24), 6 h (20)
let editsDone = 0;
const editLoop = (async () => {
  for (const p of edits) {
    await savePlannings(planned.map((e) => ({ siteId, employeeId: e.id, date, ...p })), "retro");
    editsDone++;
  }
})();
const arr = Promise.all(emps.map((e) => punch(e, "arrival")));
await Promise.all([arr, editLoop]);
await sleep(2500);
const dep = Promise.all(emps.map((e) => punch(e, "departure")));
const editLoop2 = savePlannings(planned.map((e) => ({ siteId, employeeId: e.id, date, ...pl(w("08:00", "14:00"), null) })), "retro 2"); // final : 6 h -> 20 min, pendant les départs
await Promise.all([dep, editLoop2]);

// attente des calculs différés
const t0 = performance.now();
let ledger = [];
while (performance.now() - t0 < 90000) {
  ledger = await col("pauseLedger");
  if (ledger.filter((r) => r.counted && r.expectedBreakMinutes === 20).length === planned.length) break;
  await sleep(1000);
}
const settleMs = Math.round(performance.now() - t0);
const punches = await col("punches");
const days = await col("days");
const per = {}; punches.forEach((p) => { const k = `${p.employeeId}|${p.type}`; per[k] = (per[k] || 0) + 1; });
check("A1 aucun pointage perdu ni dupliqué pendant les modifications du planning", punches.length === N * 2 && Object.values(per).every((c) => c === 1), `${punches.length}/${N * 2}`);
check("A2 les heures réelles des jours = heures des pointages (jamais modifiées par le planning)", days.every((d) => {
  const a = punches.find((p) => p.employeeId === d.employeeId && p.type === "arrival"), b = punches.find((p) => p.employeeId === d.employeeId && p.type === "departure");
  return d.arrival.toMillis() === a.at.toMillis() && d.departure.toMillis() === b.at.toMillis();
}));
check("A3 ligne de compteur finale = dernier planning (pause attendue 20 min)", ledger.filter((r) => r.counted && r.expectedBreakMinutes === 20).length === planned.length, `${ledger.length} lignes`);
const exp = (e) => ({ taken: 0, partial: 10 - 20, none: -20 }[statusOf(e)]);
check("A4 écarts de pause exacts après 3 modifications rétroactives", planned.every((e) => ledger.find((r) => r.employeeId === e.id)?.deltaBreakMinutes === exp(e)));
check("A5 salariés sans planning : pointage libre, aucune déclaration, aucune ligne de compteur", unplanned.every((e) => !ledger.some((r) => r.employeeId === e.id)) && (await col("breakDeclarations")).every((d) => !unplanned.some((e) => e.id === d.employeeId)));
const hist = (await col("planningHistory"));
check("A6 historique du planning conservé (avant / après / impact)", hist.length >= planned.length * 3 && hist.every((h) => h.after && "before" in h), `${hist.length} entrées`);
check("A7 historique : les conséquences sont renseignées", hist.filter((h) => h.impact).length >= planned.length * 3 * 0.9, `${hist.filter((h) => h.impact).length}`);

// --- B. idempotence : recalculer plusieurs fois ne change rien -------------------------------
const snap = async () => JSON.stringify((await col("pauseLedger")).map((r) => [r.employeeId, r.expectedBreakMinutes, r.declaredBreakMinutes, r.deltaBreakMinutes, r.state]).sort());
const before = await snap();
const histCount = (await col("ledgerHistory")).length;
for (let k = 0; k < 4; k++) await Promise.all(planned.map((e) => recomputePlanDay(e.id, date, { reason: "test" })));
check("B1 4 recalculs complets : compteurs identiques (aucun double comptage)", (await snap()) === before);
check("B2 4 recalculs complets : aucune trace d'historique ajoutée", (await col("ledgerHistory")).length === histCount);
const sum = (rows) => computeBalance(rows, {}).netBalance;
const total1 = sum(await col("pauseLedger"));

// --- C. reconstruction depuis les données de référence ---------------------------------------
await Promise.all((await col("pauseLedger")).map((r) => setDoc(doc(db, "pauseLedger", r.id), { ...r, deltaBreakMinutes: 9999, counted: true })));  // corrompt volontairement
await Promise.all(planned.map((e) => rebuildEmployeeLedger(e.id, date, date, "test")));
check("C1 reconstruction : le compteur redevient exact après corruption", sum(await col("pauseLedger")) === total1 && (await snap()) === before);

// --- D. reprise après calcul différé raté -----------------------------------------------------
const lateEmp = planned[0];
await setDoc(doc(db, "pauseLedger", dayKey(lateEmp.id, date)), { siteId, employeeId: lateEmp.id, date, computedAtMs: 0, counted: false, deltaBreakMinutes: 0, state: "x" });
const fixed = await recomputeStale(planned.map((e) => e.id), date, "test");
check("D1 reprise : une ligne en retard est recalculée sans action manuelle", fixed >= 1 && (await getDoc(doc(db, "pauseLedger", dayKey(lateEmp.id, date)))).data().state === "counted", `${fixed} reprise(s)`);

// --- E. solde cumulé sur plusieurs jours, sans double comptage --------------------------------
const e0 = planned[1];
const d2 = "2026-01-12", d3 = "2026-01-13";
for (const [d, st] of [[d2, "none"], [d3, "partial"]]) {
  await setDoc(doc(db, "plannings", dayKey(e0.id, d)), { siteId, employeeId: e0.id, date: d, morning: w("08:00", "16:00"), evening: null });
  await setDoc(doc(db, "days", dayId(siteId, e0.id, d)), { siteId, employeeId: e0.id, date: d, arrival: new Date(`${d}T08:00:00`), departure: new Date(`${d}T16:00:00`) });
  await setDoc(doc(db, "breakDeclarations", dayKey(e0.id, d)), buildDeclaration({ siteId, empId: e0.id, date: d, status: st, declaredMinutes: 30, expectedMinutes: 24 }));
}
for (let k = 0; k < 3; k++) { await recomputePlanDay(e0.id, d2); await recomputePlanDay(e0.id, d3); }
const rows = (await col("pauseLedger")).filter((r) => r.employeeId === e0.id);
const b = computeBalance(rows, {});
const r2 = rows.find((r) => r.date === d2), r3 = rows.find((r) => r.date === d3), r1 = rows.find((r) => r.date === date);
const expMissing = (r1?.missingBreakMinutes || 0) + 24, expExtra = (r1?.extraBreakMinutes || 0) + 6;
check("E1 solde cumulé multi-jours : 24 manquantes (jour 1) et 6 supplémentaires (jour 2), 3 recalculs sans double comptage",
  r2?.missingBreakMinutes === 24 && r3?.extraBreakMinutes === 6 && b.missingTotal === expMissing && b.extraTotal === expExtra, JSON.stringify({ missing: b.missingTotal, extra: b.extraTotal }));

console.log("RESULT " + JSON.stringify({
  label: "intégration", N, retroEditsDuringArrivals: editsDone, deferredSettleMs: settleMs,
  arrival: stats(lat.arrival), departure: stats(lat.departure), checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length,
}));
process.exit(0);
