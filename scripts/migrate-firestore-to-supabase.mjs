// ============================================================
// Copie de l'ancienne base (Firestore) vers Supabase, puis VÉRIFICATION.
//
// Lancer depuis le dossier du projet (Windows, macOS ou Linux, Node 20.6+) :
//   npm run migrate              copie + vérification
//   npm run migrate -- --verify  vérification seule (rien n'est écrit)
// Le fichier .env.local doit contenir la config Firebase (NEXT_PUBLIC_FIREBASE_*) ET
// Supabase (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).
//
// Sans danger à relancer : chaque document garde son identifiant, une 2e copie
// remplace la 1re à l'identique. L'ancienne base n'est jamais modifiée (lecture seule).
//
// Vérifications (rapport dans migration-rapport.csv) :
//  1. même nombre de documents par collection ;
//  2. chaque document identique champ par champ (heures converties en millisecondes) ;
//  3. heures de chaque journée RECALCULÉES depuis les deux bases avec les règles de l'app
//     (pauses, journée coupée, présence) : mêmes minutes, même statut ;
//  4. totaux par salarié et par mois (présence, travaillé, écart de pauses) identiques.
// Code de sortie 0 = tout est identique ; 1 = au moins un écart (détails affichés).
//
// Coût côté Firestore : chaque document est lu UNE fois (ex. 60 000 documents = 60 000
// lectures). Sur le plan gratuit (50 000 lectures/jour), lancer après 9 h (remise à zéro du
// quota) ou passer en Blaze avant.
// ============================================================
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy, limit, startAfter, documentId } from "firebase/firestore";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { computeDay, countedMinutes, DEFAULT_SETTINGS } from "../src/lib/timeLogic.js";
import { coupureAsBlocks } from "../src/lib/planLogic.js";

const VERIFY_ONLY = process.argv.includes("--verify");
const COLLECTIONS = [
  ["settings", "settings"], ["sites", "sites"], ["managers", "managers"], ["tablets", "tablets"], ["employees", "employees"],
  ["punches", "punches"], ["days", "days"], ["leaves", "leaves"], ["plannings", "plannings"], ["planningHistory", "planning_history"],
  ["breakDeclarations", "break_declarations"], ["pauseLedger", "pause_ledger"], ["ledgerHistory", "ledger_history"],
];

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Variable manquante dans .env.local : ${k}`); process.exit(2); } return v; };
const fb = getFirestore(initializeApp({
  apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY"), authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env("NEXT_PUBLIC_FIREBASE_PROJECT_ID"), storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}));
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });

// Timestamp Firestore -> millisecondes, partout dans le document.
function convert(v) {
  if (v == null) return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(convert);
  if (typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = convert(x); return o; }
  return v;
}
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

async function readFirestore(name) {
  const out = []; let last = null;
  for (;;) {
    const q = last ? query(collection(fb, name), orderBy(documentId()), startAfter(last), limit(2000)) : query(collection(fb, name), orderBy(documentId()), limit(2000));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => out.push({ id: d.id, raw: d.data(), data: convert(d.data()) }));
    if (snap.size < 2000) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}
async function readSupabase(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("id,data").order("id").range(from, from + 999);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return new Map(out.map((r) => [r.id, r.data]));
}

const problems = [];
const report = [["collection", "id", "probleme", "firestore", "supabase"]];
const problem = (c, id, what, a = "", b = "") => { problems.push(`${c}/${id} : ${what}`); report.push([c, id, what, String(a), String(b)]); };

console.log("Lecture de l'ancienne base (Firestore)…");
const src = {};
for (const [name] of COLLECTIONS) { src[name] = await readFirestore(name); console.log(`  ${name} : ${src[name].length}`); }

// Matricules en double : la nouvelle base les refuse. On s'arrête avant d'écrire quoi que ce soit.
const byMat = new Map();
for (const e of src.employees) { const m = String(e.data.matricule ?? "").trim(); if (m) byMat.set(m, [...(byMat.get(m) || []), `${e.data.displayName || "?"} (${e.id})`]); }
const dups = [...byMat].filter(([, l]) => l.length > 1);
if (dups.length) {
  console.error("\nMatricules en double, à corriger dans l'app actuelle avant la copie :");
  dups.forEach(([m, l]) => console.error(`  ${m} : ${l.join(", ")}`));
  process.exit(1);
}

if (!VERIFY_ONLY) {
  console.log("\nCopie vers Supabase…");
  for (const [name, table] of COLLECTIONS) {
    const docs = src[name];
    for (let i = 0; i < docs.length; i += 500) {
      const ops = docs.slice(i, i + 500).map((d) => ({ t: table, id: d.id, op: "set", data: d.data }));
      const { data, error } = await sb.rpc("batch_write", { p_ops: ops, p_preconds: [] });
      if (error || !data?.ok) { console.error(`Échec ${name} (lot ${i / 500 + 1}) : ${error?.message || JSON.stringify(data)}`); process.exit(1); }
    }
    console.log(`  ${name} : ${docs.length} copiés`);
  }
}

console.log("\nVérification…");
const dst = {};
for (const [name, table] of COLLECTIONS) {
  dst[name] = await readSupabase(table);
  if (dst[name].size !== src[name].length) problem(name, "*", "nombre de documents différent", src[name].length, dst[name].size);
  for (const d of src[name]) {
    const s = dst[name].get(d.id);
    if (!s) problem(name, d.id, "absent dans Supabase");
    else if (canon(s) !== canon(d.data)) problem(name, d.id, "contenu différent", canon(d.data), canon(s));
  }
}

// Recalcul des journées avec les règles de l'app, depuis chaque base.
const settings = { ...DEFAULT_SETTINGS, ...(src.settings.find((s) => s.id === "global")?.data || {}) };
const sbSettings = { ...DEFAULT_SETTINGS, ...(dst.settings.get("global") || {}) };
const emps = new Map(src.employees.map((e) => [e.id, { id: e.id, ...e.data }]));
const plansFs = new Map(src.plannings.map((p) => [p.id, p.raw]));
const T = ["arrival", "breakOut", "breakIn", "departure", "arrival2", "departure2", "breakDecl1", "breakDecl2"];
const totals = new Map(); // salarié|mois -> { fs, sb }
const tot = (empId, month) => { const k = `${empId}|${month}`; if (!totals.has(k)) totals.set(k, { fs: { span: 0, worked: 0, pause: 0, days: 0 }, sb: { span: 0, worked: 0, pause: 0, days: 0 } }); return totals.get(k); };
let recomputed = 0;
for (const d of src.days) {
  const s = dst.days.get(d.id);
  const emp = emps.get(d.raw.employeeId);
  if (s && emp && d.raw.category !== "cadre" && d.raw.arrival) {
    const pick = (o) => Object.fromEntries(T.map((k) => [k, o[k] ?? null]));
    const planKey = `${d.raw.employeeId}_${d.raw.date}`;
    const a = computeDay(coupureAsBlocks(pick(d.raw), plansFs.get(planKey) || null, settings), emp, settings, d.raw.date);
    const b = computeDay(coupureAsBlocks(pick(s), dst.plannings.get(planKey) || null, sbSettings), emp, sbSettings, s.date);
    for (const k of ["workedMinutes", "breakMinutes", "spanMinutes", "lateMinutes", "status", "spanViolation"]) {
      if (a[k] !== b[k]) problem("days", d.id, `recalcul ${k} différent`, a[k], b[k]);
    }
    recomputed++;
  }
  const t = tot(d.raw.employeeId, String(d.raw.date).slice(0, 7));
  t.fs.span += d.data.spanMinutes || 0; t.fs.worked += d.data.workedMinutes || 0; t.fs.days++;
  if (s) { t.sb.span += s.spanMinutes || 0; t.sb.worked += s.workedMinutes || 0; t.sb.days++; }
}
for (const l of src.pauseLedger) {
  const t = tot(l.data.employeeId, String(l.data.date).slice(0, 7));
  t.fs.pause += l.data.deltaBreakMinutes || 0;
  t.sb.pause += dst.pauseLedger.get(l.id)?.deltaBreakMinutes || 0;
}
const h = (m) => `${Math.floor(m / 60)}h${String(Math.abs(m) % 60).padStart(2, "0")}`;
const lines = [["salarie", "matricule", "mois", "jours", "presence_avant", "presence_apres", "travaille_avant", "travaille_apres", "ecart_pauses_avant", "ecart_pauses_apres", "identique"]];
for (const [k, t] of [...totals].sort()) {
  const [empId, month] = k.split("|");
  const same = t.fs.span === t.sb.span && t.fs.worked === t.sb.worked && t.fs.pause === t.sb.pause && t.fs.days === t.sb.days;
  if (!same) problem("totaux", k, "total mensuel différent", JSON.stringify(t.fs), JSON.stringify(t.sb));
  const e = emps.get(empId);
  lines.push([e?.displayName || empId, e?.matricule || "", month, t.fs.days, h(t.fs.span), h(t.sb.span), h(t.fs.worked), h(t.sb.worked), t.fs.pause, t.sb.pause, same ? "oui" : "NON"]);
}

const csv = (rows) => rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
writeFileSync("migration-totaux.csv", "﻿" + csv(lines));
writeFileSync("migration-rapport.csv", "﻿" + csv(report));
console.log(`  ${Object.values(src).reduce((n, l) => n + l.length, 0)} documents comparés, ${recomputed} journées recalculées, ${totals.size} totaux salarié/mois comparés.`);
console.log("  Totaux par salarié et par mois : migration-totaux.csv (s'ouvre dans Excel).");
if (problems.length) {
  console.error(`\n${problems.length} écart(s) — détails dans migration-rapport.csv. Premiers :`);
  problems.slice(0, 20).forEach((p) => console.error("  " + p));
  process.exit(1);
}
console.log("\nTout est identique.");
process.exit(0);
