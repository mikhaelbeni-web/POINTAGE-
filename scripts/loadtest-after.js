import { runLoadTest, db, doc, setDoc, getDocs, collection, query, where, sleep } from "./loadtest-harness";
import { badgePunch } from "../src/lib/store";
import { buildDeclaration, recomputePlanInBackground, dayKey } from "../src/lib/planStore";

const runId = process.env.RUN_ID || Date.now().toString(36);
const N = Number(process.env.N || 60);
const WITH_PLAN = process.env.PLAN_RATIO ? Number(process.env.PLAN_RATIO) : 0.5; // part des salariés ayant un planning
let planned = new Set();

// Même enchaînement que la pointeuse (Badgeuse.js) : écriture groupée, puis calcul différé.
const punch = async (e, date, type, at, siteId) => {
  const hasPlan = planned.has(e.id);
  let decl = null;
  if (type === "departure" && hasPlan) {
    const i = Number(e.matricule) % 3; // 0 : prises, 1 : partielle (10 min), 2 : non prise
    decl = buildDeclaration({ siteId, empId: e.id, date, status: ["taken", "partial", "none"][i], declaredMinutes: 10, expectedMinutes: 24 });
  }
  await badgePunch(e, date, type, at, siteId, decl);
  if (hasPlan && !process.env.NO_BG) recomputePlanInBackground(e.id, date);
};

const res = await runLoadTest({
  label: process.env.LABEL || "après", N, runId, punch,
  seed: async ({ emps, siteId, date }) => {
    const subset = emps.slice(0, Math.round(emps.length * WITH_PLAN));
    subset.forEach((e) => planned.add(e.id));
    await Promise.all(subset.map((e) => setDoc(doc(db, "plannings", dayKey(e.id, date)), {
      siteId, employeeId: e.id, date, morning: { state: "worked", start: "09:00", end: "13:00" }, evening: { state: "worked", start: "14:00", end: "18:00" },
    })));
  },
  // Les calculs différés des arrivées sont terminés avant les départs (une vraie tablette ne traite que ses propres pointages ;
  // ici 60 « tablettes » partagent une seule connexion, ce qui exagère la concurrence).
  afterArrival: async ({ siteId }) => {
    if (process.env.NO_BG) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 90000) {
      const snap = await getDocs(query(collection(db, "pauseLedger"), where("siteId", "==", siteId)));
      if (snap.size >= planned.size) break;
      await sleep(1000);
    }
  },
  settle: async ({ emps, siteId, date }) => {
    if (process.env.NO_BG) return {};
    const t0 = performance.now();
    let rows = [];
    while (performance.now() - t0 < 120000) {
      const snap = await getDocs(query(collection(db, "pauseLedger"), where("siteId", "==", siteId)));
      rows = snap.docs.map((d) => d.data());
      if (rows.filter((r) => r.counted).length === planned.size) break;
      await sleep(1000);
    }
    const bad = rows.filter((r) => {
      const i = Number(emps.find((e) => e.id === r.employeeId).matricule) % 3;
      const expectDelta = [0, 10 - 24, -24][i];
      return r.expectedBreakMinutes !== 24 || r.deltaBreakMinutes !== expectDelta;
    });
    const noPlanLedger = rows.filter((r) => !planned.has(r.employeeId)).length;
    const decls = await getDocs(query(collection(db, "breakDeclarations"), where("siteId", "==", siteId)));
    return {
      ledgerRowsExpected: planned.size, ledgerRowsCounted: rows.filter((r) => r.counted).length, ledgerWrongValues: bad.length,
      ledgerRowsForUnplanned: noPlanLedger, declarations: decls.size, deferredLedgerSettleMs: +(performance.now() - t0).toFixed(1),
    };
  },
});
console.log("RESULT " + JSON.stringify(res));
process.exit(0);
