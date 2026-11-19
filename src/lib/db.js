// ============================================================
// db.js — Accès à la base Supabase (Postgres), avec la même logique qu'avant :
//  - lecture par requêtes simples (salarié / date / magasin) ;
//  - écriture groupée « tout ou rien » (batch) via la fonction SQL batch_write ;
//  - transaction sûre (runTransaction) : relit, calcule, écrit seulement si rien
//    n'a changé entre-temps, sinon recommence (comme Firestore) ;
//  - écoutes en direct (watchQuery) : Supabase Realtime + copie locale, pour que
//    tablettes et tableaux de bord affichent les données même hors-ligne.
//
// Format des documents : identique à Firestore, sauf les heures, stockées en
// millisecondes (nombres). Toute la logique métier accepte déjà ce format.
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { pendingOpsFor } from "./outbox";

// Nom de « collection » (ancien Firestore) -> table Postgres.
export const TABLE = {
  settings: "settings", sites: "sites", managers: "managers", tablets: "tablets", employees: "employees",
  punches: "punches", days: "days", plannings: "plannings", breakDeclarations: "break_declarations",
  pauseLedger: "pause_ledger", planningHistory: "planning_history", ledgerHistory: "ledger_history", leaves: "leaves",
};
// Champ du document -> colonne indexée (pour filtrer côté base).
const COLUMN = { employeeId: "employee_id", date: "date", siteId: "site_id", matricule: "matricule", ledgerId: "ledger_id" };
const col = (f) => COLUMN[f] || `data->>${f}`;
const tbl = (c) => { const t = TABLE[c]; if (!t) throw new Error(`Collection inconnue : ${c}`); return t; };

let _client = null;
export function supabase() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configuration Supabase manquante (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}
/** Pour les scripts et les tests : injecte un client déjà créé. */
export function setClient(c) { _client = c; }

/** Heure du serveur (remplace serverTimestamp de Firestore). */
export const serverTimestamp = () => ({ $st: 1 });

/** Identifiant aléatoire de 20 caractères (même forme qu'un id Firestore). */
export function newId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 20; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = ""; for (const b of bytes) s += chars[b % chars.length];
  return s;
}

/** Instant -> millisecondes (Date, nombre, ancien Timestamp Firestore). */
export function toMs(t) {
  if (t == null) return null;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t.toMillis === "function") return t.toMillis();
  const n = new Date(t).getTime();
  return isNaN(n) ? null : n;
}

const fromRow = (r) => ({ id: r.id, ...r.data });
const REV = Symbol("rev"); // version de la ligne, invisible pour l'application (non copiée par { ...doc })
const fromRowRev = (r) => Object.defineProperty(fromRow(r), REV, { value: Number(r.rev || 0), enumerable: false });

// ---------- Lecture ----------
// filters = [[champ, "==" | ">=" | "<=" | "in", valeur], ...]
function applyFilters(q, filters) {
  for (const [f, op, v] of filters || []) {
    const c = col(f);
    if (op === "==") q = q.eq(c, v);
    else if (op === ">=") q = q.gte(c, v);
    else if (op === "<=") q = q.lte(c, v);
    else if (op === "in") q = q.in(c, v);
    else throw new Error(`Opérateur non géré : ${op}`);
  }
  return q;
}
const PAGE = 1000; // limite de lignes par réponse de l'API Supabase

/** Tous les documents qui correspondent (pagination automatique). */
export async function queryDocs(collection, filters = [], _withRev = false) {
  // « in » avec beaucoup de valeurs : découpé pour ne pas dépasser la longueur d'URL.
  const inF = filters.find((f) => f[1] === "in");
  if (inF && inF[2].length > 100) {
    const out = [];
    for (let i = 0; i < inF[2].length; i += 100) {
      out.push(...(await queryDocs(collection, filters.map((f) => (f === inF ? [f[0], "in", f[2].slice(i, i + 100)] : f)), _withRev)));
    }
    return out;
  }
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const q = applyFilters(supabase().from(tbl(collection)).select(_withRev ? "id,data,rev" : "id,data"), filters).order("id").range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data.map(_withRev ? fromRowRev : fromRow));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Un document : { exists, id, rev, data() } (même forme qu'un DocumentSnapshot Firestore). */
export async function getDoc(collection, id) {
  const { data, error } = await supabase().from(tbl(collection)).select("id,data,rev").eq("id", id).maybeSingle();
  if (error) throw error;
  return snapOf(id, data);
}
function snapOf(id, row) {
  return { id, exists: () => !!row, rev: row ? Number(row.rev) : 0, data: () => (row ? row.data : undefined) };
}

// ---------- Écriture ----------
async function rpcBatch(ops, preconds = []) {
  const { data, error } = await supabase().rpc("batch_write", { p_ops: ops, p_preconds: preconds });
  if (error) throw toAppError(error);
  return data;
}
/** Messages lisibles pour les erreurs connues. */
function toAppError(error) {
  const msg = error?.message || String(error);
  if (error?.code === "23505" && /matricule/.test(msg)) return new Error("Ce matricule est déjà utilisé par un autre salarié.");
  const e = new Error(msg); e.code = error?.code; return e;
}
const op = (o, collection, id, data) => ({ t: tbl(collection), id, op: o, ...(data !== undefined ? { data: clean(data) } : {}) });
// Les Date deviennent des millisecondes ; les undefined disparaissent (comme Firestore les refuse).
function clean(v) {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = clean(x);
    return o;
  }
  return v;
}

/** Écriture groupée : tout est écrit, ou rien. merge = fusion avec le document existant. */
export function writeBatch() {
  const ops = [];
  return {
    ops,
    set(collection, id, data, opts = {}) { ops.push(op(opts.merge ? "merge" : "set", collection, id, data)); return this; },
    update(collection, id, data) { ops.push(op("update", collection, id, data)); return this; },
    delete(collection, id) { ops.push(op("delete", collection, id)); return this; },
    async commit() { if (ops.length) await rpcBatch(ops); },
  };
}
export async function setDoc(collection, id, data, opts = {}) { await writeBatch().set(collection, id, data, opts).commit(); }
export async function deleteDoc(collection, id) { await writeBatch().delete(collection, id).commit(); }
/** Opérations brutes (file hors-ligne). */
export const rawBatch = (ops) => rpcBatch(ops);
export const batchOps = { op };

/**
 * Transaction sûre : fn(tx) lit avec tx.get puis écrit avec tx.set / tx.update / tx.delete.
 * L'écriture n'a lieu que si aucun document relu n'a changé ; sinon fn est rejouée sur
 * les données à jour (jusqu'à 8 fois). Même garantie que runTransaction de Firestore.
 */
export async function runTransaction(fn, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reads = new Map();
    const b = writeBatch();
    const tx = {
      async get(collection, id) {
        const s = await getDoc(collection, id);
        reads.set(`${tbl(collection)}/${id}`, { t: tbl(collection), id, rev: s.rev });
        return s;
      },
      set: (c, id, d, o) => { b.set(c, id, d, o); return tx; },
      update: (c, id, d) => { b.update(c, id, d); return tx; },
      delete: (c, id) => { b.delete(c, id); return tx; },
    };
    const result = await fn(tx);
    if (!b.ops.length) return result;
    const r = await rpcBatch(b.ops, [...reads.values()]);
    if (r && r.ok) return result;
    await new Promise((res) => setTimeout(res, 50 + Math.random() * 200 * (attempt + 1)));
  }
  throw new Error("Transaction abandonnée : trop de modifications simultanées");
}

// ---------- Écoutes en direct ----------
const cacheGet = (k) => { try { const v = localStorage.getItem("pg_cache_" + k); return v ? JSON.parse(v) : null; } catch (_) { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem("pg_cache_" + k, JSON.stringify(v)); } catch (_) { /* stockage plein : sans gravité */ } };
// Relecture complète de secours : le temps réel transmet déjà chaque changement, et une
// relecture a lieu à chaque reconnexion / retour à l'écran. 30 min suffit et limite le
// volume de données transférées (quota mensuel Supabase).
const REFRESH_MS = 30 * 60 * 1000;

function matches(doc, filters) {
  return (filters || []).every(([f, o, v]) => {
    const x = doc[f];
    if (o === "==") return x === v;
    if (o === ">=") return x != null && x >= v;
    if (o === "<=") return x != null && x <= v;
    if (o === "in") return v.includes(x);
    return false;
  });
}
function mergeDeep(a, b) {
  if (!a || typeof a !== "object" || Array.isArray(a) || !b || typeof b !== "object" || Array.isArray(b)) return b;
  const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = k in a ? mergeDeep(a[k], v) : v;
  return o;
}

/**
 * Écoute une requête : cb(liste) au départ (copie locale si disponible), puis à chaque
 * changement. Les écritures encore en file hors-ligne sont superposées (marquées _pending),
 * comme le faisait le cache de Firestore. Renvoie la fonction d'arrêt.
 * opts.cacheKey : garde une copie locale (affichage immédiat, fonctionnement hors-ligne).
 * opts.onError  : appelé si la première lecture échoue et qu'aucune copie locale n'existe.
 */
export function watchQuery(collection, filters, cb, opts = {}) {
  const table = tbl(collection);
  let rows = new Map();
  let stopped = false;
  let channel = null;
  let loadedOnce = false;
  const emit = () => {
    if (stopped) return;
    const view = new Map([...rows].map(([id, d]) => [id, { ...d }]));
    for (const o of pendingOpsFor(table)) {
      const base = view.get(o.id);
      if (o.op === "delete") { view.delete(o.id); continue; }
      const next = o.op === "set" || !base ? { id: o.id, ...o.data } : mergeDeep(base, o.data);
      if (o.op === "update" && !base) continue;
      if (matches(next, filters)) view.set(o.id, { ...next, id: o.id, _pending: true }); else view.delete(o.id);
    }
    cb([...view.values()]);
  };
  if (opts.cacheKey) {
    const c = cacheGet(opts.cacheKey);
    if (c && Array.isArray(c)) { rows = new Map(c.map((d) => [d.id, d])); emit(); }
  }
  const refresh = async () => {
    try {
      const list = await queryDocs(collection, filters, true);
      if (stopped) return;
      // Un changement reçu en direct pendant la relecture est plus récent : on le garde.
      const next = new Map(list.map((d) => [d.id, d]));
      for (const [id, d] of rows) { const n = next.get(id); if (n && (d[REV] || 0) > (n[REV] || 0)) next.set(id, d); }
      rows = next;
      loadedOnce = true;
      if (opts.cacheKey) cacheSet(opts.cacheKey, list);
      emit();
    } catch (e) {
      if (!loadedOnce && !rows.size && opts.onError) opts.onError(e);
    }
  };
  refresh();

  // Temps réel : on applique chaque changement reçu (pas de relecture complète).
  // Un seul filtre est possible côté Supabase : on prend l'égalité la plus sélective.
  try {
    // Magasin d'abord : une tablette ne reçoit que les changements de SON magasin.
    const eqs = (filters || []).filter(([, o]) => o === "==");
    const eq = ["siteId", "date", "employeeId"].map((f) => eqs.find(([g]) => g === f)).find(Boolean);
    const cfg = { event: "*", schema: "public", table, ...(eq ? { filter: `${col(eq[0])}=eq.${eq[2]}` } : {}) };
    channel = supabase().channel(`w_${table}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", cfg, (p) => {
        if (p.eventType === "DELETE") { rows.delete(p.old?.id); }
        else if (p.new) {
          const d = fromRowRev(p.new);
          const cur = rows.get(d.id);
          if (cur && (cur[REV] || 0) > d[REV]) return; // événement en retard
          if (matches(d, filters)) rows.set(d.id, d); else rows.delete(d.id);
        }
        if (opts.cacheKey) cacheSet(opts.cacheKey, [...rows.values()]);
        emit();
      })
      .subscribe((status) => { if (status === "SUBSCRIBED" && loadedOnce) refresh(); }); // reconnexion : on rattrape
  } catch (_) { /* sans temps réel : la relecture périodique suffit */ }

  // Filets de sécurité : relecture périodique, au retour du réseau, au retour à l'écran.
  const timer = setInterval(refresh, REFRESH_MS);
  const onOnline = () => refresh();
  const onVisible = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") refresh(); };
  // File hors-ligne modifiée : affichage immédiat, puis relecture (le badge envoyé ne doit pas
  // « disparaître » le temps que l'événement temps réel arrive).
  const onOutbox = (e) => { if (!e.detail || e.detail.tables?.includes(table)) { emit(); refresh(); } };
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointage-outbox", onOutbox);
  }
  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointage-outbox", onOutbox);
    }
    try { if (channel) supabase().removeChannel(channel); } catch (_) {}
  };
}
