// ============================================================
// outbox.js — File d'attente HORS-LIGNE des pointages (remplace la persistance Firestore).
//
// Chaque pointage est d'abord écrit dans la tablette (localStorage), puis envoyé.
// Si le Wi-Fi tombe, il reste dans la file et part tout seul au retour du réseau,
// dans l'ordre, même après un rechargement de la page ou un redémarrage de la tablette.
// Un envoi répété est sans effet (identifiants fixés à l'avance) : aucun doublon possible.
// Capacité : plusieurs milliers de pointages (environ 1 Ko chacun).
// ============================================================
const KEY = "pointage_outbox";
const FAILED_KEY = "pointage_outbox_failed";
const MAX_SERVER_REJECTS = 10;   // refus répétés par la base (donnée invalide) -> mis de côté
const RETRY_MS = 10000;

let _send = null;                // fonction d'envoi (db.rawBatch), branchée par store.js
const _waiters = new Map();      // qid -> { resolve, reject } (pour les pointages de cette session)
let _flushing = false;
let _timer = null;

const hasLS = () => typeof localStorage !== "undefined";
function load(k = KEY) { if (!hasLS()) return []; try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (_) { return []; } }
function save(list, k = KEY) {
  if (!hasLS()) return;
  localStorage.setItem(k, JSON.stringify(list)); // une erreur ici (stockage plein) remonte à l'appelant
}
function notify(tables) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pointage-outbox", { detail: { tables } }));
}

export function configureOutbox(send) { _send = send; }

/** Opérations encore en file pour une table (superposées à l'affichage). */
export function pendingOpsFor(table) {
  const out = [];
  for (const e of load()) for (const o of e.ops) if (o.t === table) out.push(o);
  return out;
}
export const pendingCount = () => load().length;
export const failedEntries = () => load(FAILED_KEY);

/**
 * Met des opérations en file puis tente l'envoi. La promesse se résout quand la base a
 * confirmé (immédiatement si le réseau est là), et n'échoue que si la base refuse
 * définitivement. Sans localStorage (serveur), envoi direct.
 */
export function enqueue(ops) {
  if (!hasLS()) return _send(ops);
  const qid = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const list = load();
  list.push({ qid, ops, at: Date.now(), rejects: 0 });
  save(list);
  notify([...new Set(ops.map((o) => o.t))]);
  const p = new Promise((resolve, reject) => _waiters.set(qid, { resolve, reject }));
  flush();
  return p;
}

const isServerRejection = (e) => !!(e && e.code && /^[0-9A-Z]{5}$/.test(e.code));
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Envoie la file dans l'ordre. Sans danger si appelée plusieurs fois. */
export async function flush() {
  if (_flushing || !_send || !hasLS()) return;
  _flushing = true;
  try {
    for (;;) {
      const list = load();
      if (!list.length) break;
      if (offline()) { arm(); break; }
      const head = list[0];
      try {
        await _send(head.ops);
        save(load().filter((e) => e.qid !== head.qid));
        notify([...new Set(head.ops.map((o) => o.t))]);
        _waiters.get(head.qid)?.resolve(); _waiters.delete(head.qid);
      } catch (e) {
        if (!isServerRejection(e)) { arm(); break; } // réseau : on réessaiera
        const cur = load();
        const h = cur.find((x) => x.qid === head.qid);
        if (!h) continue;
        h.rejects = (h.rejects || 0) + 1; h.lastError = e.message;
        if (h.rejects >= MAX_SERVER_REJECTS) {
          // Mis de côté (jamais effacé) pour ne pas bloquer les pointages suivants.
          save([...load(FAILED_KEY), h], FAILED_KEY);
          save(cur.filter((x) => x.qid !== h.qid));
          console.error("[pointage] pointage refusé par la base, mis de côté :", h, e);
          notify([...new Set(h.ops.map((o) => o.t))]);
          _waiters.get(h.qid)?.reject(e); _waiters.delete(h.qid);
        } else { save(cur); arm(); break; }
      }
    }
  } finally { _flushing = false; }
}
function arm() {
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; flush(); }, RETRY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush());
  setInterval(() => { if (load().length) flush(); }, 30000);
}
