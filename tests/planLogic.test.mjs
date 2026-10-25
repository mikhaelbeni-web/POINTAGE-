// Lancer : npm run test:logic   (Node 18+, aucune dépendance)
import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedBreakMinutes, periodState, planningStatus, hasPlanning, plannedWorkMinutes, computePlanDay,
  computeBalance, paginateRows, mondayOf, weeksOfMonth, contractMonthMinutes, DEFAULT_PLAN_SETTINGS,
} from "../src/lib/planLogic.js";

const S = { ...DEFAULT_PLAN_SETTINGS, lateToleranceMinutes: 5 };
const date = "2026-10-20";
const at = (hhmm, d = date) => { const [h, m] = hhmm.split(":").map(Number); const [Y, M, D] = d.split("-").map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };
const worked = (start, end) => ({ state: "worked", start, end });
const plan = (m, e) => ({ morning: m, evening: e });

test("pause attendue : 5 % avec minimum légal de 20 min dès 6 h", () => {
  assert.equal(expectedBreakMinutes(480, S), 24);          // 8 h -> 24 min (exemple du cahier des charges)
  assert.equal(expectedBreakMinutes(360, S), 20);          // 6 h : 5 % = 18 -> minimum légal 20
  assert.equal(expectedBreakMinutes(300, S), 15);          // 5 h : sous le seuil, 5 % seul
  assert.equal(expectedBreakMinutes(0, S), 0);
  assert.equal(expectedBreakMinutes(480, { ...S, breakMode: "legal" }), 20);
  assert.equal(expectedBreakMinutes(480, { ...S, breakMode: "pct", breakPercent: 10 }), 48);
  assert.equal(expectedBreakMinutes(481, S), 25);          // arrondi à la minute supérieure
});

test("trois états distincts : non planifié, non travaillé, travaillé", () => {
  assert.equal(periodState(null), "unset");
  assert.equal(periodState(undefined), "unset");
  assert.equal(periodState({ state: "off" }), "off");
  assert.equal(periodState(worked("08:00", "13:00")), "worked");
  assert.equal(periodState(worked("08:00", "")), "unset");
  assert.equal(planningStatus(null), "none");
  assert.equal(planningStatus(plan(null, null)), "none");           // rien saisi != journée non travaillée
  assert.equal(planningStatus(plan({ state: "off" }, null)), "partial");
  assert.equal(planningStatus(plan({ state: "off" }, { state: "off" })), "complete");
  assert.equal(hasPlanning(plan(null, null)), false);
});

test("matin seul, soir seul, deux services, aucun service", () => {
  assert.equal(plannedWorkMinutes(plan(worked("08:00", "13:00"), { state: "off" })), 300);
  assert.equal(plannedWorkMinutes(plan({ state: "off" }, worked("14:00", "19:00"))), 300);
  assert.equal(plannedWorkMinutes(plan(worked("08:00", "13:00"), worked("14:00", "19:00"))), 600);
  assert.equal(plannedWorkMinutes(plan({ state: "off" }, { state: "off" })), 0);
});

test("sans planning : aucun horaire inventé, aucun écart, aucun blocage", () => {
  const r = computePlanDay({ planning: null, day: { arrival: at("09:00"), departure: at("17:00") }, declaration: null, emp: {}, settings: S, date });
  assert.equal(r.hasPlanning, false);
  assert.equal(r.state, "no-planning");
  assert.equal(r.expectedBreakMinutes, 0);
  assert.equal(r.deltaBreakMinutes, 0);
  assert.equal(r.counted, false);
  assert.equal(r.arrivalDeltaMinutes, null);
  assert.equal(r.actualWorkMinutes, 480);                  // heures réelles conservées
});

test("déclaration : prise, partielle, non prise", () => {
  const p = plan(worked("08:00", "13:00"), worked("14:00", "19:00")); // 10 h -> 30 min attendues
  const day = { arrival: at("08:00"), departure: at("19:00") };
  const run = (declaration) => computePlanDay({ planning: p, day, declaration, emp: {}, settings: S, date });
  const taken = run({ status: "taken" });
  assert.deepEqual([taken.expectedBreakMinutes, taken.declaredBreakMinutes, taken.deltaBreakMinutes, taken.counted], [30, 30, 0, true]);
  const partial = run({ status: "partial", declaredMinutes: 10 });
  assert.deepEqual([partial.missingBreakMinutes, partial.extraBreakMinutes, partial.deltaBreakMinutes], [20, 0, -20]);
  const none = run({ status: "none" });
  assert.deepEqual([none.declaredBreakMinutes, none.missingBreakMinutes], [0, 30]);
  const extra = run({ status: "partial", declaredMinutes: 45 });
  assert.deepEqual([extra.missingBreakMinutes, extra.extraBreakMinutes], [0, 15]);
});

test("déclaration à régulariser ou absente : jamais comptée dans le solde", () => {
  const p = plan(worked("08:00", "13:00"), null);
  const day = { arrival: at("08:00"), departure: at("13:00") };
  const pend = computePlanDay({ planning: p, day, declaration: { status: "pending" }, emp: {}, settings: S, date });
  assert.equal(pend.state, "to-regularise"); assert.equal(pend.counted, false);
  const none = computePlanDay({ planning: p, day, declaration: null, emp: {}, settings: S, date });
  assert.equal(none.state, "declaration-missing"); assert.equal(none.counted, false);
  assert.equal(computeBalance([pend, none], S).pendingDays, 2);
});

test("dépassement horaire séparé de la pause (18 h prévu, 19 h réel)", () => {
  const p = plan(null, worked("14:00", "18:00"));
  const day = { arrival: at("14:00"), departure: at("19:00") };
  const r = computePlanDay({ planning: p, day, declaration: { status: "taken" }, emp: {}, settings: S, date });
  assert.equal(r.plannedWorkMinutes, 240);
  assert.equal(r.actualWorkMinutes, 300);
  assert.equal(r.overtimeMinutes, 60);
  assert.equal(r.departureDeltaMinutes, 60);
  assert.equal(r.departureFlag, "over");
  assert.equal(r.deltaBreakMinutes, 0);                    // les heures en plus ne sont pas des minutes de pause
});

test("arrivée anticipée / tardive avec tolérance", () => {
  const p = plan(worked("08:00", "13:00"), null);
  const f = (a) => computePlanDay({ planning: p, day: { arrival: at(a), departure: at("13:00") }, declaration: { status: "taken" }, emp: {}, settings: S, date });
  assert.equal(f("07:40").arrivalFlag, "early");
  assert.equal(f("08:04").arrivalFlag, "ok");
  assert.equal(f("08:20").arrivalFlag, "late");
});

test("compteur cumulatif : somme des lignes, recalcul sans double comptage", () => {
  const mk = (d, decl) => computePlanDay({ planning: plan(worked("08:00", "16:00"), null), day: { arrival: at("08:00", d), departure: at("16:00", d) }, declaration: decl, emp: {}, settings: S, date: d });
  const rows = [mk("2026-10-19", { status: "none" }), mk("2026-10-20", { status: "partial", declaredMinutes: 30 }), mk("2026-10-21", { status: "taken" })];
  // 8 h -> 24 min attendues : -24, +6, 0
  const b1 = computeBalance(rows, S);
  assert.deepEqual([b1.missingTotal, b1.extraTotal, b1.netBalance], [24, 6, -18]);
  assert.equal(b1.headline, -24);                           // sans compensation : l'extra ne rattrape pas le manquant
  // recalculer les mêmes jours 10 fois donne le même solde
  let again = rows;
  for (let i = 0; i < 10; i++) again = [mk("2026-10-19", { status: "none" }), mk("2026-10-20", { status: "partial", declaredMinutes: 30 }), mk("2026-10-21", { status: "taken" })];
  assert.deepEqual(computeBalance(again, S), b1);
  const net = computeBalance(rows, { ...S, breakCompensation: "net" });
  assert.equal(net.headline, -18);
  assert.equal(b1.evolution.at(-1).net, -18);
});

test("modification rétroactive : nouvelle référence, mêmes pointages", () => {
  const day = { arrival: at("08:00"), departure: at("16:00") };
  const before = computePlanDay({ planning: plan(worked("08:00", "16:00"), null), day, declaration: { status: "partial", declaredMinutes: 20 }, emp: {}, settings: S, date });
  const after = computePlanDay({ planning: plan(worked("08:00", "12:00"), null), day, declaration: { status: "partial", declaredMinutes: 20 }, emp: {}, settings: S, date });
  assert.equal(before.expectedBreakMinutes, 24); assert.equal(before.deltaBreakMinutes, -4);
  assert.equal(after.expectedBreakMinutes, 12); assert.equal(after.deltaBreakMinutes, 8);   // 4 h : 5 % seul
  assert.equal(before.actualWorkMinutes, after.actualWorkMinutes);                          // le réel ne change pas
  assert.deepEqual(computeBalance([after], S).extraTotal, 8);
});

test("service qui passe minuit", () => {
  const p = plan(null, worked("20:00", "02:00"));
  assert.equal(plannedWorkMinutes(p), 360);
});

test("pagination équilibrée de l'impression", () => {
  assert.deepEqual(paginateRows(0, 12), []);
  assert.deepEqual(paginateRows(5, 12), [5]);
  assert.deepEqual(paginateRows(12, 12), [12]);
  assert.deepEqual(paginateRows(13, 12), [7, 6]);          // pas de page quasi vide
  assert.deepEqual(paginateRows(25, 12), [9, 8, 8]);
});

test("semaines et contrat mensuel", () => {
  assert.equal(mondayOf("2026-10-25"), "2026-10-19");       // dimanche -> lundi précédent
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  assert.deepEqual(weeksOfMonth(2026, 10), ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.equal(contractMonthMinutes(35 * 60), Math.round((35 * 60 * 52) / 12));
});
