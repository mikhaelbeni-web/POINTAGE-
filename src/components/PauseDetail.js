"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { inp, btnPrimary, btnGhost, Modal } from "./PlanUi";
import { computeBalance, fmtMin, periodState, hasPlanning, strToDate } from "../lib/planLogic";

const btn = btnGhost;
export const signed = (m) => (m == null ? "—" : m === 0 ? "0 min" : `${m > 0 ? "+" : "−"}${fmtMin(Math.abs(m))}`);
const planText = (p) => {
  if (!p || !hasPlanning(p)) return "Pas de planning";
  const f = (x, l) => (periodState(x) === "worked" ? `${l} ${x.start}–${x.end}` : periodState(x) === "off" ? `${l} non travaillé` : `${l} à planifier`);
  return `${f(p.morning, "Matin")} · ${f(p.evening, "Soir")}`;
};
export const STATE = {
  counted: ["Compté", "var(--green)"],
  "to-regularise": ["À régulariser", "var(--amber)"],
  "declaration-missing": ["Déclaration manquante", "var(--amber)"],
  "in-progress": ["En cours", "var(--blue)"],
  "no-punch": ["Pas de pointage", "var(--text-faint)"],
  "no-planning": ["Sans planning", "var(--text-faint)"],
};
export function Pill({ s }) {
  const [t, c] = STATE[s] || [s, "var(--text-faint)"];
  return <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: c, border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)`, whiteSpace: "nowrap" }}>{t}</span>;
}

// ---------- Détail d'un salarié : comment le solde est calculé ----------
export default function PauseDetail({ emp, api, settings, canEdit, managerName, date, onClose, onChanged }) {
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
    <Modal title={`Compteur de pauses · ${emp.displayName}`} onClose={onClose} width={680}>
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
          await api.regularise({ empId: emp.id, date: reg.date, by: managerName, ...v });
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
        Pause attendue : {fmtMin(row.expectedBreakMinutes)}. L'heure réelle de départ du pointage n'est pas modifiée. Saisir ce que le salarié a réellement déclaré ou confirmé ; la trace (qui, quand, motif si renseigné) est conservée.
      </p>
      <select style={{ ...inp, marginBottom: 10 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="taken">Pauses prévues prises</option>
        <option value="partial">Pause partielle</option>
        <option value="none">Pause non prise</option>
      </select>
      {status === "partial" && <input style={{ ...inp, marginBottom: 10 }} inputMode="numeric" placeholder="Minutes réellement prises" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />}
      <input style={{ ...inp, marginBottom: 10 }} placeholder="Motif (facultatif) : oubli, panne tablette…" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={btn} onClick={onClose}>Annuler</button>
        <button style={btnPrimary} onClick={() => {
          if (status === "partial" && minutes === "") return setErr("Indiquez les minutes prises.");
          onSave({ status, declaredMinutes: status === "partial" ? Number(minutes) : null, note: note.trim() });
        }}>Enregistrer</button>
      </div>
    </Modal>
  );
}
