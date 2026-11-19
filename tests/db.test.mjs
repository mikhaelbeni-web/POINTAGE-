// Tests d'intégration de la base Supabase (schéma SQL + src/lib/db.js + store.js + planStore.js)
// sur un VRAI Postgres local. Lancer :
//   TEST_PG_URL=postgres://user@localhost:5432/pointage_test npm run test:db
// La base indiquée est entièrement vidée : son nom doit contenir « test ».
// Sans TEST_PG_URL, les tests sont ignorés.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const URL_ = process.env.TEST_PG_URL;
const skip = !URL_ ? "TEST_PG_URL non défini" : !/test/.test(URL_) ? "le nom de la base doit contenir « test »" : false;

// Environnement « tablette » minimal : stockage local + état du réseau.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
let online = true;
Object.defineProperty(globalThis.navigator, "onLine", { get: () => online, configurable: true });

const at = (date, hhmm) => { const [Y, M, D] = date.split("-").map(Number); const [h, m] = hhmm.split(":").map(Number); return new Date(Y, M - 1, D, h, m); };
const fsTs = (ms) => (ms == null ? null : { toMillis: () => ms, toDate: () => new Date(ms) }); // Timestamp façon Firestore

test("base Supabase : pointage, calculs, hors-ligne, sécurité", { skip }, async (t) => {
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`drop schema if exists public cascade; create schema public;
    do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
                 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
                 if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end $$;
    grant usage on schema public to anon, authenticated;`);
  await admin.query(readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));

  const { createPgFake } = await import("./pgFakeSupabase.mjs");
  const fake = createPgFake(URL_);
  const db = await import("../src/lib/db.js");
  db.setClient(fake);
  const store = await import("../src/lib/store.js");
  const planStore = await import("../src/lib/planStore.js");
  const outbox = await import("../src/lib/outbox.js");
  const { computeDay, DEFAULT_SETTINGS } = await import("../src/lib/timeLogic.js");
  const { coupureAsBlocks } = await import("../src/lib/planLogic.js");

  const settings = await store.getSettings();
  const empId = await store.saveEmployee({ displayName: "Test A", matricule: "501", siteId: "s1", active: true, category: "employee", contractType: "full", weeklyContractMinutes: 2205 });
  const emp = { id: empId, ...(await db.getDoc("employees", empId)).data() };
  const D = "2026-11-17";

  await t.test("journée simple : mêmes heures qu'avec Firestore", async () => {
    for (const [type, h] of [["arrival", "09:00"], ["breakOut", "12:00"], ["breakIn", "12:30"], ["departure", "17:30"]]) {
      await store.badgePunch(emp, D, type, at(D, h), "s1");
    }
    await store.recomputeDayDoc("s1", empId, D, emp);
    const day = (await db.getDoc("days", `s1_${empId}_${D}`)).data();
    const ref = computeDay({ arrival: fsTs(at(D, "09:00").getTime()), breakOut: fsTs(at(D, "12:00").getTime()), breakIn: fsTs(at(D, "12:30").getTime()), departure: fsTs(at(D, "17:30").getTime()) }, emp, settings, D);
    assert.equal(day.spanMinutes, 510);
    assert.equal(day.workedMinutes, 480);
    assert.equal(day.spanMinutes, ref.spanMinutes);
    assert.equal(day.workedMinutes, ref.workedMinutes);
    assert.equal(day.status, ref.status);
    assert.equal(day.needsRecompute, false);
    const punches = await db.queryDocs("punches", [["employeeId", "==", empId], ["date", "==", D]]);
    assert.equal(punches.length, 4);
  });

  await t.test("journée coupée saisie en pause (09-13 / 14-18) : 8 h de présence", async () => {
    const D2 = "2026-11-18";
    await planStore.savePlannings([{ siteId: "s1", employeeId: empId, date: D2, morning: { state: "worked", start: "09:00", end: "13:00" }, evening: { state: "worked", start: "14:00", end: "18:00" } }], "test");
    for (const [type, h] of [["arrival", "09:00"], ["breakOut", "13:00"], ["breakIn", "14:00"], ["departure", "18:00"]]) {
      await store.badgePunch(emp, D2, type, at(D2, h), "s1");
    }
    await store.recomputeDayDoc("s1", empId, D2, emp);
    const day = (await db.getDoc("days", `s1_${empId}_${D2}`)).data();
    const plan = (await db.getDoc("plannings", `${empId}_${D2}`)).data();
    const ref = computeDay(coupureAsBlocks({ arrival: fsTs(at(D2, "09:00").getTime()), breakOut: fsTs(at(D2, "13:00").getTime()), breakIn: fsTs(at(D2, "14:00").getTime()), departure: fsTs(at(D2, "18:00").getTime()) }, plan, settings), emp, settings, D2);
    assert.equal(day.spanMinutes, 480);
    assert.equal(day.spanMinutes, ref.spanMinutes);
    assert.equal(day.workedMinutes, ref.workedMinutes);
    // Compteur de pauses : calcul idempotent, une seule trace d'historique.
    await planStore.recomputePlanDay(empId, D2, { reason: "test" });
    const r1 = (await db.getDoc("pauseLedger", `${empId}_${D2}`)).data();
    const h1 = (await db.queryDocs("ledgerHistory", [["ledgerId", "==", `${empId}_${D2}`]])).length;
    await planStore.recomputePlanDay(empId, D2, { reason: "test" });
    const r2 = (await db.getDoc("pauseLedger", `${empId}_${D2}`)).data();
    assert.equal(r1.deltaBreakMinutes, r2.deltaBreakMinutes);
    assert.equal(r1.plannedWorkMinutes, 480);
    assert.equal(r1.actualWorkMinutes, r2.actualWorkMinutes);
    const h2 = (await db.queryDocs("ledgerHistory", [["ledgerId", "==", `${empId}_${D2}`]])).length;
    assert.equal(h2, h1); // recalcul identique : aucune nouvelle trace
  });

  await t.test("recalculs simultanés : les chiffres correspondent toujours aux dernières heures", async () => {
    const D3 = "2026-11-16";
    await store.setDayTimes(empId, D3, { arrival: "08:00", breakOut: null, breakIn: null, departure: "12:00" }, "test");
    const jobs = [];
    for (let i = 0; i < 8; i++) jobs.push(store.recomputeDayDoc("s1", empId, D3, emp));
    jobs.push(store.setDayTimes(empId, D3, { arrival: "08:00", breakOut: null, breakIn: null, departure: "15:00" }, "test"));
    for (let i = 0; i < 8; i++) jobs.push(store.recomputeDayDoc("s1", empId, D3, emp));
    await Promise.all(jobs);
    const day = (await db.getDoc("days", `s1_${empId}_${D3}`)).data();
    assert.equal(day.spanMinutes, 420);
    assert.equal(day.needsRecompute, false);
  });

  await t.test("hors-ligne : le pointage attend dans la tablette, part une seule fois au retour du réseau", async () => {
    const D4 = "2026-11-19";
    online = false;
    let done = false;
    const p = store.badgePunch(emp, D4, "arrival", at(D4, "07:45"), "s1").then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(done, false);
    assert.equal(outbox.pendingCount(), 1);
    assert.equal((await db.getDoc("days", `s1_${empId}_${D4}`)).exists(), false);
    // La badgeuse voit déjà le pointage (marqué en attente), comme avec le cache Firestore.
    const seen = await new Promise((resolve) => {
      const stop = store.watchDaySite(D4, "s1", (list) => { if (list.length) { stop(); resolve(list); } });
    });
    assert.equal(seen[0]._pending, true);
    assert.equal(db.toMs(seen[0].arrival), at(D4, "07:45").getTime());
    online = true;
    await outbox.flush();
    await p;
    assert.equal(done, true);
    assert.equal(outbox.pendingCount(), 0);
    await outbox.flush();
    const punches = await db.queryDocs("punches", [["employeeId", "==", empId], ["date", "==", D4]]);
    assert.equal(punches.length, 1);
    assert.equal((await db.getDoc("days", `s1_${empId}_${D4}`)).data().arrival, at(D4, "07:45").getTime());
  });

  await t.test("matricule unique", async () => {
    await assert.rejects(store.saveEmployee({ displayName: "Doublon", matricule: " 501 ", siteId: "s1" }), /déjà utilisé/);
    assert.equal(await store.nextMatricule(), "502");
    assert.equal((await store.findByMatricule("501")).id, empId);
  });

  await t.test("plus de 1000 lignes : lecture complète (pagination)", async () => {
    const ops = [];
    for (let i = 0; i < 2300; i++) ops.push({ t: "days", id: `s9_e${i}_2026-10-01`, op: "set", data: { siteId: "s9", employeeId: `e${i}`, date: "2026-10-01", spanMinutes: 60 } });
    for (let i = 0; i < ops.length; i += 500) await db.rawBatch(ops.slice(i, i + 500));
    const all = await planStore.realApi.getDaysRange("2026-10-01", "2026-10-01");
    assert.equal(all.length, 2300);
    const bal = await planStore.realApi.getBalances(Array.from({ length: 250 }, (_, i) => `e${i}`).concat([empId]));
    assert.ok(bal[empId].length >= 1);
  });

  await t.test("sécurité : pas d'écriture directe, journal des badges non supprimable", async () => {
    const { error } = await fake.from("days").select("id").then((x) => x);
    assert.equal(error, null);
    const c = await fake.pool.connect();
    try {
      await c.query("set role anon");
      await assert.rejects(c.query("insert into public.days(id, data) values ('x', '{}')"), /permission denied/);
      await assert.rejects(c.query("delete from public.punches"), /permission denied/);
    } finally { await c.query("reset role"); c.release(); }
    await assert.rejects(db.rawBatch([{ t: "punches", id: "x", op: "delete" }]), /suppression interdite/);
  });

  await fake.pool.end();
  await admin.end();
});
