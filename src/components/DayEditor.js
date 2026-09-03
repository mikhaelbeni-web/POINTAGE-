"use client";
import { useEffect, useState } from "react";
import { Modal, Field, inp, btnPrimary, btnGhost } from "./Employees";
import { setDayTimes, addLeave, getLeaves, deleteLeave, getDaysRange } from "../lib/store";
import { leaveLabel } from "./ui";

function tsToHHMM(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function DayEditor({ emp, date, managerId, onClose }) {
  const [times, setTimes] = useState({ arrival: "", breakOut: "", breakIn: "", departure: "" });
  const [leaves, setLeaves] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ type: "cp", startDate: date, endDate: date, note: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const ds = await getDaysRange(emp.id, date, date);
      if (ds[0]) {
        setTimes({
          arrival: tsToHHMM(ds[0].arrival), breakOut: tsToHHMM(ds[0].breakOut),
          breakIn: tsToHHMM(ds[0].breakIn), departure: tsToHHMM(ds[0].departure),
        });
      }
      setLeaves(await getLeaves(emp.id, date, date));
    })();
  }, [emp.id, date]);

  async function save() {
    setSaving(true);
    await setDayTimes(emp.id, date, {
      arrival: times.arrival || null, breakOut: times.breakOut || null,
      breakIn: times.breakIn || null, departure: times.departure || null,
    }, managerId);
    setSaving(false);
    onClose();
  }

  async function addLeaveEntry() {
    await addLeave(emp.id, leaveForm.type, leaveForm.startDate, leaveForm.endDate, leaveForm.note);
    setLeaves(await getLeaves(emp.id, date, date));
  }

  return (
    <Modal title={`${emp.displayName} — ${new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
          Correction manuelle des horaires. Laisser vide = non pointé. Recalcul automatique après enregistrement.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Arrivée"><input type="time" style={inp} value={times.arrival} onChange={(e) => setTimes({ ...times, arrival: e.target.value })} /></Field>
          <Field label="Départ pause"><input type="time" style={inp} value={times.breakOut} onChange={(e) => setTimes({ ...times, breakOut: e.target.value })} /></Field>
          <Field label="Retour pause"><input type="time" style={inp} value={times.breakIn} onChange={(e) => setTimes({ ...times, breakIn: e.target.value })} /></Field>
          <Field label="Départ"><input type="time" style={inp} value={times.departure} onChange={(e) => setTimes({ ...times, departure: e.target.value })} /></Field>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? "…" : "Enregistrer les horaires"}</button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "4px 0" }} />

        <h4 style={{ fontSize: 15, fontWeight: 600 }}>Congés / absences</h4>
        {leaves.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {leaves.map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--ink-2)", borderRadius: 9, fontSize: 14 }}>
                <span>{leaveLabel(l.type)} · {l.startDate} → {l.endDate}</span>
                <button onClick={async () => { await deleteLeave(l.id); setLeaves(await getLeaves(emp.id, date, date)); }} style={{ color: "var(--red)", fontSize: 13 }}>Suppr.</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Type">
            <select style={inp} value={leaveForm.type} onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })}>
              <option value="cp">Congés payés</option><option value="rtt">RTT</option>
              <option value="sick">Arrêt maladie</option><option value="unpaid">Sans solde</option><option value="other">Autre</option>
            </select>
          </Field>
          <Field label="Du"><input type="date" style={inp} value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} /></Field>
          <Field label="Au"><input type="date" style={inp} value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} /></Field>
        </div>
        <button onClick={addLeaveEntry} style={btnGhost}>+ Ajouter le congé</button>
      </div>
    </Modal>
  );
}
