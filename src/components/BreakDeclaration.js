"use client";
import { useEffect, useRef, useState } from "react";
import { fmtMin } from "../lib/planLogic";

// Écran de déclaration de pause, affiché au départ UNIQUEMENT quand un planning existe.
// Une seule réponse : « J'ai pris ma pause de X minutes » (case à cocher = confirmation).
// Le bouton « à régulariser » enregistre quand même le départ (panne, oubli, pause non prise ou
// partielle) et laisse une trace visible par la direction, qui saisit la valeur réelle ensuite.
export default function BreakDeclaration({ emp, expected, measured, onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    if (!checked || Date.now() - mountedAt.current < 400) return;
    onConfirm({ status: "taken", declaredMinutes: expected });
  };
  const canSubmit = checked;

  return (
    <div data-testid="break-declaration" style={{ maxWidth: 480, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600 }}>{emp.displayName}</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 15, marginTop: 6 }}>Avant de pointer votre départ</p>
      <div style={{ margin: "16px 0", padding: "14px 16px", borderRadius: 12, background: "var(--ink-2)", border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Temps de pause attendu pour aujourd'hui : {expected} minutes.</div>
        {measured != null && <div style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 6 }}>Pause badgée aujourd'hui : {fmtMin(measured)}</div>}
      </div>

      <label style={{ display: "flex", gap: 14, alignItems: "center", margin: "18px 0 14px", textAlign: "left", fontSize: 19, fontWeight: 600, cursor: "pointer", padding: "16px 18px", borderRadius: 12, background: checked ? "color-mix(in srgb, var(--brass) 16%, var(--ink-2))" : "var(--ink-2)", border: `1.5px solid ${checked ? "var(--brass)" : "var(--line)"}` }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 28, height: 28, accentColor: "var(--brass)", flexShrink: 0 }} />
        <span>J'ai pris ma pause de {expected} minutes</span>
      </label>

      <button onClick={submit} disabled={!canSubmit} style={{
        width: "100%", padding: "18px", borderRadius: 14, fontSize: 20, fontWeight: 700,
        background: canSubmit ? "var(--red)" : "var(--ink-3)", color: canSubmit ? "#fff" : "var(--text-faint)",
        border: "none", opacity: canSubmit ? 1 : 0.7,
      }}>Valider et pointer mon départ</button>

      <button onClick={() => onConfirm({ status: "pending", declaredMinutes: null })} style={{ marginTop: 16, color: "var(--text-dim)", fontSize: 14, textDecoration: "underline" }}>
        Pause différente ou impossible à déclarer : enregistrer mon départ, à régulariser
      </button>
      <div><button onClick={onCancel} style={{ marginTop: 12, padding: "10px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button></div>
    </div>
  );
}
