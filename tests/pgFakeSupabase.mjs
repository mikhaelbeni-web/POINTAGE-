// Faux client Supabase pour les tests : traduit le petit sous-ensemble utilisé par
// src/lib/db.js (from/select/eq/gte/lte/in/order/range/maybeSingle, rpc) en SQL, sur un
// vrai Postgres où supabase/schema.sql a été exécuté. Les requêtes passent par le rôle
// « anon », avec les mêmes droits que l'application en production (RLS).
import pg from "pg";

export function createPgFake(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  async function run(sql, params) {
    const c = await pool.connect();
    try { await c.query("set role anon"); return await c.query(sql, params); }
    finally { try { await c.query("reset role"); } catch (_) { /* rien */ } c.release(); }
  }
  const asErr = (e) => ({ message: e.message, code: e.code });
  const colSql = (c) => (c.startsWith("data->>") ? `data->>'${c.slice(7).replace(/'/g, "")}'` : `"${c.replace(/"/g, "")}"`);
  function from(table) {
    const where = []; const params = []; let cols = "*"; let order = ""; let limit = ""; let single = false;
    const add = (c, op, v) => { params.push(v); where.push(`${colSql(c)} ${op} $${params.length}`); return q; };
    const q = {
      select(c) { cols = c; return q; },
      eq: (c, v) => add(c, "=", v), gte: (c, v) => add(c, ">=", v), lte: (c, v) => add(c, "<=", v),
      in: (c, v) => { params.push(v); where.push(`${colSql(c)} = any($${params.length})`); return q; },
      order(c) { order = ` order by ${colSql(c)}`; return q; },
      range(a, b) { limit = ` offset ${a} limit ${b - a + 1}`; return q; },
      maybeSingle() { single = true; return q; },
      then(res, rej) {
        const sql = `select ${cols} from public.${table}${where.length ? " where " + where.join(" and ") : ""}${order}${limit}`;
        return run(sql, params).then(
          (r) => ({ data: single ? r.rows[0] || null : r.rows, error: null }),
          (e) => ({ data: null, error: asErr(e) }),
        ).then(res, rej);
      },
    };
    return q;
  }
  return {
    from,
    async rpc(name, args) {
      try {
        const r = await run(`select public.${name}($1::jsonb, $2::jsonb) as r`, [JSON.stringify(args.p_ops), JSON.stringify(args.p_preconds || [])]);
        return { data: r.rows[0].r, error: null };
      } catch (e) { return { data: null, error: asErr(e) }; }
    },
    channel() { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel() {},
    pool,
  };
}
