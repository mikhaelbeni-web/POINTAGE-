"use client";
import { useState } from "react";

export function StatusPill({ status, leaveType }) {
  const map = {
    present: ["Présent", "var(--green)"],
    partial: ["Demi-journée", "var(--amber)"],
    incomplete: ["Badge incomplet", "var(--amber)"],
    absent: ["Absent", "var(--red)"],
    leave: [leaveLabel(leaveType), "var(--blue)"],
    off: ["Repos", "var(--text-faint)"],
  };
  const [label, color] = map[status] || [status, "var(--text-faint)"];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 12, fontWeight: 600, color,
      background: "color-mix(in srgb, " + color + " 15%, transparent)",
      border: "1px solid color-mix(in srgb, " + color + " 40%, transparent)",
    }}>{label}</span>
  );
}

export const LEAVE_TYPES = [
  ["cp", "Congés payés"],
  ["rtt", "RTT"],
  ["sick", "Arrêt maladie"],
  ["unjustified", "Absence injustifiée"],
  ["parental", "Congé parental"],
  ["paternity", "Congé paternité"],
  ["conventional", "Congé conventionnel"],
  ["rest", "Repos"],
  ["unpaid", "Sans solde"],
  ["other", "Autre"],
];

export function leaveLabel(t) {
  const found = LEAVE_TYPES.find(([k]) => k === t);
  return found ? found[1] : "Congé";
}

/** Pavé PIN 4 chiffres. onSubmit(pin) appelé à 4 chiffres. */
export function PinPad({ title, subtitle, onSubmit, onCancel, error }) {
  const [pin, setPin] = useState("");
  const press = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => { onSubmit(next); setPin(""); }, 120);
    }
  };
  const back = () => setPin((p) => p.slice(0, -1));

  return (
    <div style={{ textAlign: "center", maxWidth: 340, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600 }}>{title}</h2>
      {subtitle && <p style={{ color: "var(--text-dim)", marginTop: 6, fontSize: 15 }}>{subtitle}</p>}

      <div style={{ display: "flex", justifyContent: "center", gap: 14, margin: "26px 0" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: 999,
            background: i < pin.length ? "var(--brass)" : "var(--ink-3)",
            border: "1px solid var(--line)", transition: "background .12s",
          }} />
        ))}
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} onClick={() => press(String(n))} style={padBtn}>{n}</button>
        ))}
        <button onClick={onCancel} style={{ ...padBtn, fontSize: 15, color: "var(--text-dim)" }}>Annuler</button>
        <button onClick={() => press("0")} style={padBtn}>0</button>
        <button onClick={back} style={{ ...padBtn, fontSize: 22 }}>⌫</button>
      </div>
    </div>
  );
}

const padBtn = {
  height: 68, borderRadius: 12, background: "var(--ink-2)",
  border: "1px solid var(--line)", color: "var(--text)",
  fontSize: 26, fontWeight: 500, transition: "background .1s",
};
