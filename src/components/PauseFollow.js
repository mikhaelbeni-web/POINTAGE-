"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { inp } from "./Employees";
import { Modal, btnPrimary } from "./Planning";
import {
  computeBalance, fmtMin, periodState, hasPlanning, planSettings, dateToStr, addDays, strToDate,
} from "../lib/planLogic";

const btn = { padding: "9px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: "var(--ink-3)", border: "1px solid var(--line)", color: "var(--text)" };
const tsMin = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : typeof t === "number" ? t : null);
const hhmm = (t) => { const m = tsMin(t); return m == null ? "—" : new Date(m).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
const signed = (m) => (m == null ? "—" : m === 0 ? "0 min" : `${m > 0 ? "+" : "−"}${fmtMin(Math.abs(m))}`);
const planText = (p) => {
  if (!p || !hasPlanning(p)) return "Pas de planning";
  const f = (x, l) => (periodState(x) === "worked" ? `${l} ${x.start}–${x.end}` : periodState(x) === "off" ? `${l} non travaillé` : `${l} à planifier`);
  return `${f(p.morning, "Matin")} · ${f(p.evening, "Soir")}`;
};
const STATE = {
  counted: ["Compté", "var(--green)"],
  "to-regularise": ["À régulariser", "var(--amber)"],
  "declaration-missing": ["Déclaration manquante", "var(--amber)"],
  "in-progress": ["En cours", "var(--blue)"],
  "no-punch": ["Pas de pointage", "var(--text-faint)"],
  "no-planning": ["Sans planning", "var(--text-faint)"],
};
const DECL = { taken: "Pauses prévues prises", partial: "Pause partielle", none: "Pause non prise", pending: "À régulariser" };

function Pill({ s }) {
  const [t, c] = STATE[s] || [s, "var(--text-faint)"];
  return <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: c, border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)`, whiteSpace: "nowrap" }}>{t}</span>;
}

/**
 * Suivi quotidien du directeur : pour chaque salarié, planning prévu / pointages réels / pause attendue
 * et déclarée / solde cumulé. Toutes les valeurs viennent des calculs différés (pauseLedger) ou, à défaut,
 * sont recalculées à l'ouverture (reprise après erreur). Aucune donnée de pointage n'est modifiée ici.
 */
export default function PauseFollow({ employees, sites, allowedSiteIds, canEdit = true, api, managerName, today }) {
  const visibleSites = allowedSiteIds ? sites.filter((s) => allowedSiteIds.includes(s.id)) : sites;
  const [siteId, setSiteId] = useState(visibleSites[0]?.id || "");
  const [date, setDate] = useState(today || dateToStr(new Date()));
  const [data, setData] = useState(null);
  const [balances, setBalances] = useState({});
  const [settings, setSettings] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!siteId && visibleSites[0]) setSiteId(visibleSites[0].id); }, [visibleSites, siteId]);
  useEffect(() => { api.getSettings().then((s) => setSettings(planSettings(s))); }, [api]);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [d, b] = await Promise.all([api.getDaySituations(siteId, date), api.getBalances(siteId)]);
    setData(d); setBalances(b);
  }, [api, siteId, date]);

  // Reprise après erreur : recalcule d'abord les lignes manquantes ou en retard, puis affiche.
  useEffect(() => {
    let off = false;
    setData(null);
    (async () => {
      try { await api.recomputeStale(siteId, date, managerName); } catch (_) { /* on affiche quand même */ }
      if (!off) await load();
    })();
    return () => { off = true; };
  }, [api, siteId, date, managerName, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const by = (arr) => Object.fromEntries(arr.map((x) => [x.employeeId, x]));
    const P = by(data.plans), D = by(data.days), L = by(data.ledger), C = by(data.declarations);
    return employees.filter((e) => e.siteId === siteId && (e.active !== false || D[e.id])).map((e) => ({
      emp: e, plan: P[e.id], day: D[e.id], ledger: L[e.id], decl: C[e.id],
      balance: computeBalance(balances[e.id] || [], settings),
    }));
  }, [data, employees, siteId, balances, settings]);

  const toFix = rows.filter((r) => r.ledger && (r.ledger.state === "to-regularise" || r.ledger.state === "declaration-missing")).length;
  const gaps = rows.filter((r) => r.ledger && (r.ledger.arrivalFlag === "late" || r.ledger.departureFlag === "over" || r.ledger.departureFlag === "early" || r.ledger.overtimeMinutes > 0)).length;

  return (
    <div className="plan-light">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Suivi des pauses et des horaires</h2>
        <button style={btn} disabled={busy} onClick={async () => { setBusy(true); try { await api.recomputeStale(siteId, date, managerName); await load(); } finally { setBusy(false); } }}>
          {busy ? "Recalcul…" : "Recalculer ce jour"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {visibleSites.length > 1 && (
          <select style={{ ...inp, width: "auto" }} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {visibleSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <button style={btn} onClick={() => setDate(addDays(date, -1))} aria-label="Jour précédent">‹</button>
        <input type="date" style={{ ...inp, width: "auto" }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button style={btn} onClick={() => setDate(addDays(date, 1))} aria-label="Jour suivant">›</button>
        <span style={{ color: "var(--text-dim)", fontSize: 14, textTransform: "capitalize" }}>{strToDate(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>

      {data && (toFix > 0 || gaps > 0) && (
        <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 12, background: "color-mix(in srgb, var(--amber) 12%, var(--ink-2))", border: "1px solid var(--amber)", fontSize: 14 }}>
          {toFix > 0 && <div>⚠ {toFix} déclaration(s) de pause à régulariser.</div>}
          {gaps > 0 && <div>{gaps} salarié(s) avec un écart d'horaire ou un dépassement ce jour.</div>}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000, fontSize: 13 }}>
          <thead>
            <tr>{["Salarié", "Planning prévu", "Arrivée / Départ réels", "Travail prévu → réel", "Dépassement", "Pause attendue", "Pause déclarée", "Écart du jour", "Solde cumulé", "État"].map((h) => (
              <th key={h} style={{ padding: "10px 8px", textAlign: "left", fontSize: 12, color: "var(--text-dim)", background: "var(--ink-2)", borderBottom: "1px solid var(--line)" }}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={10} style={{ padding: 20, color: "var(--text-dim)" }}>Chargement…</td></tr>}
            {data && rows.length === 0 && <tr><td colSpan={10} style={{ padding: 20, color: "var(--text-dim)" }}>Aucun salarié.</td></tr>}
            {rows.map(({ emp, plan, day, ledger, decl, balance }) => {
              const l = ledger;
              const hasPlan = plan && hasPlanning(plan);
              const state = l ? l.state : day ? (hasPlan ? "in-progress" : "no-planning") : hasPlan ? "no-punch" : "no-planning";
              return (
                <tr key={emp.id} onClick={() => setDetail(emp)} style={{ cursor: "pointer" }} data-testid={`row-${emp.id}`}>
                  <td style={cell({ fontWeight: 600 })}>{emp.displayName}</td>
                  <td style={cell({ color: hasPlan ? "var(--text)" : "var(--text-faint)" })}>{planText(plan)}</td>
                  <td style={cell({})}>
                    {day ? <>{hhmm(day.arrival)} → {hhmm(day.departure)}{l?.arrivalFlag === "late" && <Tag c="var(--red)">+{l.arrivalDeltaMinutes} min retard</Tag>}{l?.arrivalFlag === "early" && <Tag c="var(--blue)">{Math.abs(l.arrivalDeltaMinutes)} min avance</Tag>}{l?.departureFlag === "early" && <Tag c="var(--amber)">départ −{Math.abs(l.departureDeltaMinutes)} min</Tag>}</> : <span style={{ color: "var(--text-faint)" }}>—</span>}
                  </td>
                  <td style={cell({})}>{hasPlan ? <>{fmtMin(l?.plannedWorkMinutes)} → <b>{l?.actualWorkMinutes != null ? fmtMin(l.actualWorkMinutes) : "—"}</b></> : day ? <span>Réel : <b>{day.workedMinutes != null ? fmtMin(day.workedMinutes) : "—"}</b></span> : "—"}</td>
                  <td style={cell({ color: l?.overtimeMinutes > 0 ? "var(--amber)" : "var(--text-faint)" })}>{l?.overtimeMinutes > 0 ? `+${fmtMin(l.overtimeMinutes)}` : l?.departureFlag === "over" ? `+${fmtMin(l.departureDeltaMinutes)}` : "—"}</td>
                  <td style={cell({})}>{hasPlan ? fmtMin(l?.expectedBreakMinutes) : "—"}</td>
                  <td style={cell({})}>{decl ? <>{l?.declaredBreakMinutes != null ? fmtMin(l.declaredBreakMinutes) : "—"}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{DECL[decl.status]}{decl.source === "regularisation" ? " · régularisé" : ""}</div></> : "—"}</td>
                  <td style={cell({ color: !l?.counted ? "var(--text-faint)" : l.deltaBreakMinutes < 0 ? "var(--red)" : l.deltaBreakMinutes > 0 ? "var(--green)" : "var(--text)" })}>{l?.counted ? signed(l.deltaBreakMinutes) : "—"}</td>
                  <td style={cell({})}>{balance.daysCounted ? (balance.missingTotal === 0 && balance.extraTotal === 0 ? "0 min" : <>{balance.missingTotal > 0 && <span style={{ color: "var(--red)" }}>−{balance.missingTotal}</span>}{balance.missingTotal > 0 && balance.extraTotal > 0 && " / "}{balance.extraTotal > 0 && <span style={{ color: "var(--green)" }}>+{balance.extraTotal}</span>} min</>) : "—"}</td>
                  <td style={cell({})}><Pill s={state} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
        Solde cumulé = minutes manquantes (rouge) / minutes supplémentaires (vert) sur toutes les journées comptées. Cliquez une ligne pour voir le détail du calcul, l'historique et régulariser.
        Sans planning, seules les heures réelles sont conservées : aucun écart n'est calculé.
      </p>

      {detail && (
        <Detail emp={detail} api={api} settings={settings} canEdit={canEdit} managerName={managerName} date={date}
          onClose={() => setDetail(null)} onChanged={load} />
      )}
    </div>
  );
}
const cell = (e) => ({ padding: "9px 8px", borderBottom: "1px solid var(--line)", verticalAlign: "top", ...e });
const Tag = ({ c, children }) => <div style={{ fontSize: 11, color: c }}>{children}</div>;

// ---------- Détail d'un salarié : comment le solde est calculé ----------
function Detail({ emp, api, settings, canEdit, managerName, date, onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [planHist, setPlanHist] = useState([]);
  const [openLedger, setOpenLedger] = useState(null);
  const [ledgerHist, setLedgerHist] = useState([]);
  const [reg, setReg] = useState(null);

  const reload = useCallback(async () => {
    const [r, h] = await Promise.all([api.getLedgerRows(emp.id), api.getPlanningHistory(emp.id)]);
    setRows(r); setPlanHist(h);
  }, [api, emp.id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (openLedger) api.getLedgerHistory(openLedger).then(setLedgerHist); }, [api, openLedger]);

  const bal = useMemo(() => computeBalance(rows || [], settings), [rows, settings]);
  const pending = (rows || []).filter((r) => r.state === "to-regularise" || r.state === "declaration-missing");
  let run = 0;

  return (
    <Modal title={`Compteur de pauses · ${emp.displayName}`} onClose={onClose}>
      {!rows ? <p style={{ color: "var(--text-dim)" }}>Chargement…</p> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            <Stat label="Manquantes cumulées" value={`${bal.missingTotal} min`} c="var(--red)" />
            <Stat label="Supplémentaires cumulées" value={`${bal.extraTotal} min`} c="var(--green)" />
            <Stat label={bal.compensation === "net" ? "Solde net (compensé)" : "Solde net (information)"} value={signed(bal.netBalance)} c="var(--text)" />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
            Calcul : pour chaque journée comptée, pause déclarée − pause attendue. Les minutes manquantes et supplémentaires sont {bal.compensation === "net" ? "compensées entre elles (règle « solde net »)" : "gardées séparées : une pause en plus ne compense pas une pause manquante (règle actuelle)"}. Le solde n'est jamais remis à zéro ; {bal.daysCounted} journée(s) comptée(s)
            {bal.pendingDays > 0 ? `, ${bal.pendingDays} en attente de régularisation (non comptée${bal.pendingDays > 1 ? "s" : ""})` : ""}.
            Il est recalculable à tout moment depuis le planning, les pointages et les déclarations.
          </p>

          <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>Journées</h4>
          <div style={{ maxHeight: 250, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>{["Date", "Attendue", "Déclarée", "Écart", "Cumul net", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: 6, color: "var(--text-dim)", background: "var(--ink-2)" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.filter((r) => r.hasPlanning).map((r) => {
                  if (r.counted) run += r.deltaBreakMinutes;
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: 6 }}>{strToDate(r.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</td>
                      <td style={{ padding: 6 }}>{fmtMin(r.expectedBreakMinutes)}</td>
                      <td style={{ padding: 6 }}>{r.declaredBreakMinutes != null ? fmtMin(r.declaredBreakMinutes) : <Pill s={r.state} />}</td>
                      <td style={{ padding: 6, color: r.deltaBreakMinutes < 0 ? "var(--red)" : r.deltaBreakMinutes > 0 ? "var(--green)" : "var(--text)" }}>{r.counted ? signed(r.deltaBreakMinutes) : "—"}</td>
                      <td style={{ padding: 6 }}>{r.counted ? signed(run) : ""}</td>
                      <td style={{ padding: 6 }}>
                        <button style={{ color: "var(--brass)" }} onClick={() => setOpenLedger(openLedger === r.id ? null : r.id)}>historique</button>
                        {canEdit && (r.state === "to-regularise" || r.state === "declaration-missing") && <button style={{ color: "var(--amber)", marginLeft: 8 }} onClick={() => setReg(r)}>régulariser</button>}
                      </td>
                    </tr>
                  );
                })}
                {rows.filter((r) => r.hasPlanning).length === 0 && <tr><td colSpan={6} style={{ padding: 10, color: "var(--text-faint)" }}>Aucune journée planifiée avec pointage.</td></tr>}
              </tbody>
            </table>
          </div>
          {pending.length > 0 && <p style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>{pending.length} journée(s) sans déclaration définitive : à régulariser.</p>}

          {openLedger && (
            <div style={{ marginTop: 10, fontSize: 12, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
              <b>Historique des changements de cette journée</b>
              {ledgerHist.length === 0 ? <div style={{ color: "var(--text-faint)" }}>Aucun changement enregistré.</div> : ledgerHist.map((h) => (
                <div key={h.id} style={{ marginTop: 4 }}>
                  {new Date(h.atMs).toLocaleString("fr-FR")} · {h.reason}{h.by ? ` (${h.by})` : ""} : attendue {h.before ? fmtMin(h.before.expectedBreakMinutes) : "—"} → {fmtMin(h.after.expectedBreakMinutes)}, écart {h.before ? signed(h.before.deltaBreakMinutes) : "—"} → {signed(h.after.deltaBreakMinutes)} ({h.after.state})
                </div>
              ))}
            </div>
          )}

          <h4 style={{ margin: "14px 0 6px", fontSize: 14 }}>Modifications du planning</h4>
          <div style={{ maxHeight: 150, overflowY: "auto", fontSize: 12 }}>
            {planHist.length === 0 && <div style={{ color: "var(--text-faint)" }}>Aucune modification enregistrée.</div>}
            {planHist.map((h) => (
              <div key={h.id} style={{ padding: "5px 0", borderTop: "1px solid var(--line)" }}>
                <b>{h.date}</b> · modifié le {new Date(h.atMs).toLocaleString("fr-FR")}{h.by ? ` par ${h.by}` : ""}<br />
                avant : {planText(h.before)} → après : {planText(h.after)}
                {h.impact && <div style={{ color: "var(--text-dim)" }}>Conséquence : temps prévu {fmtMin(h.impact.plannedBefore)} → {fmtMin(h.impact.plannedAfter)}, pause attendue {fmtMin(h.impact.expectedBefore)} → {fmtMin(h.impact.expectedAfter)}, écart de pause {signed(h.impact.deltaBefore)} → {signed(h.impact.deltaAfter)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ textAlign: "right", marginTop: 14 }}><button style={btn} onClick={onClose}>Fermer</button></div>

      {reg && (
        <Regularise row={reg} onClose={() => setReg(null)} onSave={async (v) => {
          await api.regularise({ siteId: reg.siteId, empId: emp.id, date: reg.date, by: managerName, ...v });
          setReg(null); await reload(); onChanged && onChanged();
        }} />
      )}
    </Modal>
  );
}
const Stat = ({ label, value, c }) => (
  <div style={{ background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{value}</div>
  </div>
);

// ---------- Régularisation (oubli, panne) ----------
function Regularise({ row, onSave, onClose }) {
  const [status, setStatus] = useState("taken");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState(null);
  return (
    <Modal title={`Régulariser la pause du ${row.date}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
        Pause attendue : {fmtMin(row.expectedBreakMinutes)}. L'heure réelle de départ du pointage n'est pas modifiée. Saisir ce que le salarié a réellement déclaré ou confirmé ; la trace (qui, quand, pourquoi) est conservée.
      </p>
      <select style={{ ...inp, marginBottom: 10 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="taken">Pauses prévues prises</option>
        <option value="partial">Pause partielle</option>
        <option value="none">Pause non prise</option>
      </select>
      {status === "partial" && <input style={{ ...inp, marginBottom: 10 }} inputMode="numeric" placeholder="Minutes réellement prises" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />}
      <input style={{ ...inp, marginBottom: 10 }} placeholder="Motif (obligatoire) : oubli, panne tablette…" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={btn} onClick={onClose}>Annuler</button>
        <button style={btnPrimary} onClick={() => {
          if (!note.trim()) return setErr("Le motif est obligatoire.");
          if (status === "partial" && minutes === "") return setErr("Indiquez les minutes prises.");
          onSave({ status, declaredMinutes: status === "partial" ? Number(minutes) : null, note: note.trim() });
        }}>Enregistrer</button>
      </div>
    </Modal>
  );
}
