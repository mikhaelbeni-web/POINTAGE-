import { runLoadTest } from "./loadtest-harness";
import { badgePunch } from "../src/lib/store";
const runId = process.env.RUN_ID || Date.now().toString(36);
const N = Number(process.env.N || 60);
const res = await runLoadTest({ label: process.env.LABEL || "avant", N, runId, punch: (e, date, type, at, siteId) => badgePunch(e, date, type, at, siteId) });
console.log("RESULT " + JSON.stringify(res));
process.exit(0);
