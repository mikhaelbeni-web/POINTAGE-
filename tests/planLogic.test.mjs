// Lancer : npm run test:logic   (Node 18+, aucune dépendance)
import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedBreakMinutes, expectedBreakForPlanning, longestContinuousMinutes, periodState, planningStatus, hasPlanning, plannedWorkMinutes, computePlanDay,
  computeBalance, paginateRows, mondayOf, weeksOfMonth, contractMonthMinutes, DEFAULT_PLAN_SETTINGS,
} from "../src/lib/planLogic.js";
import { computeDay, countedMinutes } from "../src/lib/timeLogic.js";

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

test("pause longue : 30 min dès 8 h de travail continu, remplace le 3 min/h", () => {
  // 8 h d'affilée -> 30 min (et non 24)
  assert.equal(longestContinuousMinutes(plan(worked("09:00", "17:00"), { state: "off" })), 480);
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "17:00"), { state: "off" }), S), 30);
  // 8 h en deux blocs séparés par une coupure -> pas continu -> 3 min/h = 24 min
  assert.equal(longestContinuousMinutes(plan(worked("09:00", "13:00"), worked("14:00", "18:00"))), 240);
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "13:00"), worked("14:00", "18:00")), S), 24);
  // matin et soir accolés (13:00 -> 13:00) = un seul bloc de 8 h -> 30 min
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "13:00"), worked("13:00", "17:00")), S), 30);
  // au-delà de 8 h : 30 min fixes (11 h -> 30, pas 33)
  assert.equal(expectedBreakForPlanning(plan(worked("08:00", "19:00"), { state: "off" }), S), 30);
  // 7h59 d'affilée -> règle normale : 3 min/h = 24 (arrondi sup.)
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "16:59"), { state: "off" }), S), 24);
  // minimum légal conservé : 6 h -> 20 min (et non 18)
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "15:00"), { state: "off" }), S), 20);
  // service de nuit qui passe minuit : 22:00 -> 06:00 = 8 h continues
  assert.equal(expectedBreakForPlanning(plan({ state: "off" }, worked("22:00", "06:00")), S), 30);
  // pause longue désactivée (0) -> retour au 3 min/h
  assert.equal(expectedBreakForPlanning(plan(worked("09:00", "17:00"), { state: "off" }), { ...S, breakLongMinutes: 0 }), 24);
  // sans planning -> 0
  assert.equal(expectedBreakForPlanning(null, S), 0);
  // même calcul dans la ligne du compteur
  const r = computePlanDay({ planning: plan(worked("09:00", "17:00"), { state: "off" }), day: { arrival: at("09:00"), departure: at("17:00") }, declaration: { status: "partial", declaredMinutes: 20 }, emp: {}, settings: S, date });
  assert.deepEqual([r.expectedBreakMinutes, r.deltaBreakMinutes], [30, -10]);
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
  const mk = (d, decl) => computePlanDay({ planning: plan(worked("08:00", "12:00"), worked("13:00", "17:00")), day: { arrival: at("08:00", d), departure: at("16:00", d) }, declaration: decl, emp: {}, settings: S, date: d });
  const rows = [mk("2026-10-19", { status: "none" }), mk("2026-10-20", { status: "partial", declaredMinutes: 30 }), mk("2026-10-21", { status: "taken" })];
  // 8 h en deux services -> 24 min attendues : -24, +6, 0
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
  const before = computePlanDay({ planning: plan(worked("08:00", "12:00"), worked("13:00", "17:00")), day, declaration: { status: "partial", declaredMinutes: 20 }, emp: {}, settings: S, date });
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

// ---------- Journée coupée (2 blocs, pause non badgée) ----------
import { splitBlocks, expectedBreakBlocks, mergeBlockDeclarations } from "../src/lib/planLogic.js";

test("journée coupée : coupure d'au moins 1 h entre matin et soir", () => {
  assert.ok(splitBlocks(plan(worked("08:00", "13:00"), worked("14:00", "18:00")), S));
  assert.equal(splitBlocks(plan(worked("08:00", "13:00"), worked("13:30", "18:00")), S), null); // 30 min = pas une coupure
  assert.equal(splitBlocks(plan(worked("08:00", "13:00"), { state: "off" }), S), null);
});

test("journée coupée : pause attendue par bloc (3 min/h), somme = pause du jour", () => {
  const p = plan(worked("08:00", "13:00"), worked("14:00", "18:00"));
  assert.deepEqual(expectedBreakBlocks(p, S), [15, 12]);
  assert.equal(expectedBreakForPlanning(p, S), 27);
  // minimum légal 20 min dès 6 h au total : complément sur le bloc le plus long
  const q = plan(worked("08:00", "12:00"), worked("14:00", "16:00"));
  assert.deepEqual(expectedBreakBlocks(q, S), [14, 6]);
  assert.equal(expectedBreakForPlanning(q, S), 20);
  // un bloc de 8 h d'affilée -> 30 min pour ce bloc
  assert.deepEqual(expectedBreakBlocks(plan(worked("06:00", "14:00"), worked("16:00", "18:00")), S), [30, 6]);
});

test("journée coupée : 13h-14h hors Présence et hors Travaillé, pause déclarée déduite du Travaillé", () => {
  const m = computeDay({ arrival: at("08:00"), departure: at("13:00"), arrival2: at("14:00"), departure2: at("18:00"), breakDecl1: 15, breakDecl2: 12 }, {}, {}, date);
  assert.equal(m.spanMinutes, 540);   // Présence 9 h (pas 10 h)
  assert.equal(m.breakMinutes, 27);
  assert.equal(m.workedMinutes, 513); // Travaillé 8 h 33
  assert.equal(m.status, "present");
  // 2e bloc commencé, pas fini : jour incomplet
  const inc = computeDay({ arrival: at("08:00"), departure: at("13:00"), arrival2: at("14:00") }, {}, {}, date);
  assert.equal(inc.status, "incomplete");
  assert.equal(inc.workedMinutes, 0);
});

test("journée coupée : le compteur compare la pause déclarée des deux blocs à 27 min", () => {
  const p = plan(worked("08:00", "13:00"), worked("14:00", "18:00"));
  const day = { arrival: at("08:00"), departure: at("13:00"), arrival2: at("14:00"), departure2: at("18:00"), breakDecl1: 15, breakDecl2: 12 };
  const d1 = { status: "taken", declaredMinutes: 15, expectedMinutesAtDeclaration: 15, block2: { status: "taken", declaredMinutes: 12, expectedMinutesAtDeclaration: 12 } };
  const r = computePlanDay({ planning: p, day, declaration: d1, emp: {}, settings: S, date });
  assert.equal(r.expectedBreakMinutes, 27);
  assert.equal(r.declaredBreakMinutes, 27);
  assert.equal(r.deltaBreakMinutes, 0);
  assert.equal(r.actualWorkMinutes, 540); // heures comptées : présence (pause payée par défaut)
  assert.equal(computePlanDay({ planning: p, day, declaration: d1, emp: {}, settings: { ...S, breakPaid: false }, date }).actualWorkMinutes, 513);
  assert.equal(r.state, "counted");
  // matin pris, après-midi non pris (partiel 5 min) -> 20 déclarées, 7 manquantes
  const d2 = { ...d1, block2: { status: "partial", declaredMinutes: 5, expectedMinutesAtDeclaration: 12 } };
  const r2 = computePlanDay({ planning: p, day, declaration: d2, emp: {}, settings: S, date });
  assert.equal(r2.declaredBreakMinutes, 20);
  assert.equal(r2.missingBreakMinutes, 7);
  // 2e bloc pointé sans déclaration du bloc 2 -> à compléter, pas compté
  const r3 = computePlanDay({ planning: p, day, declaration: { status: "taken", declaredMinutes: 15, expectedMinutesAtDeclaration: 15 }, emp: {}, settings: S, date });
  assert.equal(r3.state, "declaration-missing");
  // un bloc à régulariser -> tout est à régulariser
  assert.equal(mergeBlockDeclarations({ ...d1, status: "pending", declaredMinutes: null }).status, "pending");
});

test("heures comptées : présence pause comprise par défaut (pause payée)", () => {
  // 06:30 -> 12:00 avec 15 min de pause badgée : présence 5h30, travaillé 5h15
  const raw = { arrival: at("06:30"), breakOut: at("09:30"), breakIn: at("09:45"), departure: at("12:00") };
  const m = computeDay(raw, {}, S, date);
  assert.deepEqual([m.spanMinutes, m.breakMinutes, m.workedMinutes], [330, 15, 315]);
  assert.equal(countedMinutes(m, S), 330);                                  // défaut : 5h30 comptées
  assert.equal(countedMinutes(m, { ...S, breakPaid: false }), 315);         // option : 5h15
  assert.equal(countedMinutes({ workedMinutes: 315, breakMinutes: 15 }, S), 330); // ancien document sans spanMinutes
  assert.equal(countedMinutes(null, S), 0);
  // écart au planning : 06:30-12:00 prévu = 5h30, compté 5h30 -> aucun manque
  const pl = plan(worked("06:30", "12:00"), { state: "off" });
  const r = computePlanDay({ planning: pl, day: raw, declaration: { status: "taken" }, emp: {}, settings: S, date });
  assert.deepEqual([r.actualWorkMinutes, r.undertimeMinutes, r.overtimeMinutes], [330, 0, 0]);
  const r2 = computePlanDay({ planning: pl, day: raw, declaration: { status: "taken" }, emp: {}, settings: { ...S, breakPaid: false }, date });
  assert.deepEqual([r2.actualWorkMinutes, r2.undertimeMinutes], [315, 15]);
});

test("journée coupée saisie en Départ pause / Retour pause : la coupure n'est ni présence ni travail", async () => {
  const { coupureAsBlocks } = await import("../src/lib/planLogic.js");
  const { buildMonthlyRecap } = await import("../src/lib/recap.js");
  const p = plan(worked("09:00", "13:00"), worked("14:00", "18:00"));
  const raw = { arrival: at("09:00"), breakOut: at("13:00"), breakIn: at("14:00"), departure: at("18:00") };
  // Avant : 9 h de présence (la coupure 13-14 comptée comme pause payée)
  assert.equal(computeDay(raw, {}, S, date).spanMinutes, 540);
  // Après : planning coupé -> deux blocs, 8 h de présence, 8 h travaillées
  const m = computeDay(coupureAsBlocks(raw, p, S), {}, S, date);
  assert.deepEqual([m.spanMinutes, m.workedMinutes, m.breakMinutes, m.status], [480, 480, 0, "present"]);
  // Planning continu (09-13 + 13-17) : la pause badgée reste une pause, heures inchangées
  assert.equal(coupureAsBlocks(raw, plan(worked("09:00", "13:00"), worked("13:00", "17:00")), S), raw);
  // Sans planning : inchangé
  assert.equal(coupureAsBlocks(raw, null, S), raw);
  // Compteur : 8 h réelles = 8 h prévues, aucune heure sup.
  const r = computePlanDay({ planning: p, day: raw, declaration: { status: "taken" }, emp: {}, settings: S, date });
  assert.deepEqual([r.actualWorkMinutes, r.overtimeMinutes, r.expectedBreakMinutes, r.declaredBreakMinutes], [480, 0, 24, 24]);

  // Récap : ligne pauses prises / attendues
  const day = { date, status: "present", spanMinutes: 480, workedMinutes: 480, breakMinutes: 0 };
  const rec = buildMonthlyRecap({ contractType: "full", weeklyContractMinutes: 2205 }, S, [day], [],
    2026, 10, [{ date, hasPlanning: true, expectedBreakMinutes: 24, declaredBreakMinutes: 20, counted: true, state: "counted" }]);
  assert.deepEqual([rec.totals.workedMinutes, rec.totals.breakTaken, rec.totals.breakExpected, rec.totals.breakPending], [480, 20, 24, 0]);
  const rec2 = buildMonthlyRecap({ contractType: "full", weeklyContractMinutes: 2205 }, S, [day], [],
    2026, 10, [{ date, hasPlanning: true, expectedBreakMinutes: 24, declaredBreakMinutes: null, counted: false, state: "declaration-missing" }]);
  assert.deepEqual([rec2.totals.breakTaken, rec2.totals.breakExpected, rec2.totals.breakPending], [0, 24, 1]);
});
