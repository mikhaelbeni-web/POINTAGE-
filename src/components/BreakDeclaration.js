"use client";
import { useEffect, useRef, useState } from "react";
import { fmtMin } from "../lib/planLogic";

// Écran de déclaration de pause, affiché au départ UNIQUEMENT quand un planning existe.
// Le salarié n'a rien à calculer : le temps attendu est affiché. Il choisit ce qui est
// vrai (prises / partielles / non prises) puis coche la case de confirmation.
// Jamais d'obligation de certifier une pause non prise : « non prise » est une réponse valide.
// Le bouton « à régulariser » enregistre quand même le départ (panne, oubli) et laisse
// une trace visible par la direction.
export default function BreakDeclaration({ emp, expected, measured, onConfirm, onCancel }) {
  const [choice, setChoice] = useState(measured != null && measured < expected ? "partial" : "taken");
  const [minutes, setMinutes] = useState(measured != null && measured < expected ? String(measured) : "");
  const [checked, setChecked] = useState(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const partialOk = choice !== "partial" || (minutes !== "" && Number(minutes) >= 0);
  const canSubmit = checked && partialOk;
  const submit = () => {
    if (!canSubmit || Date.now() - mountedAt.current < 400) return;
    onConfirm({ status: choice, declaredMinutes: choice === "partial" ? Number(minutes) : choice === "none" ? 0 : expected });
  };

  const opt = (key, label) => (
    <button key={key} onClick={() => setChoice(key)} style={{
      padding: "16px 18px", borderRadius: 12, fontSize: 17, fontWeight: 600, textAlign: "left",
      background: choice === key ? "color-mix(in srgb, var(--brass) 16%, var(--ink-2))" : "var(--ink-2)",
      border: `1.5px solid ${choice === key ? "var(--brass)" : "var(--line)"}`, color: "var(--text)",
    }}>{choice === key ? "● " : "○ "}{label}</button>
  );

  return (
    <div data-testid="break-declaration" style={{ maxWidth: 480, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600 }}>{emp.displayName}</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 15, marginTop: 6 }}>Avant de pointer votre départ</p>
      <div style={{ margin: "16px 0", padding: "14px 16px", borderRadius: 12, background: "var(--ink-2)", border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Temps de pause attendu pour aujourd'hui : {expected} minutes.</div>
        {measured != null && <div style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 6 }}>Pause badgée aujourd'hui : {fmtMin(measured)}</div>}
      </div>

      <div style={{ display: "grid", gap: 10, textAlign: "left" }}>
        {opt("taken", `J'ai pris mes pauses prévues (${expected} min)`)}
        {opt("partial", "J'ai pris une partie de ma pause")}
        {choice === "partial" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 6 }}>
            <input inputMode="numeric" value={minutes} autoFocus
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))}
              style={{ width: 90, padding: 12, borderRadius: 10, fontSize: 20, textAlign: "center", background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)" }} />
            <span style={{ color: "var(--text-dim)" }}>minutes réellement prises</span>
          </div>
        )}
        {opt("none", "Je n'ai pas pris de pause")}
      </div>

      <label style={{ display: "flex", gap: 12, alignItems: "center", margin: "18px 0 14px", textAlign: "left", fontSize: 16, cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 26, height: 26, accentColor: "var(--brass)" }} />
        <span>Je confirme que cette déclaration correspond à ce que j'ai réellement fait.</span>
      </label>

      <button onClick={submit} disabled={!canSubmit} style={{
        width: "100%", padding: "18px", borderRadius: 14, fontSize: 20, fontWeight: 700,
        background: canSubmit ? "var(--red)" : "var(--ink-3)", color: canSubmit ? "#fff" : "var(--text-faint)",
        border: "none", opacity: canSubmit ? 1 : 0.7,
      }}>Valider et pointer mon départ</button>

      <button onClick={() => onConfirm({ status: "pending", declaredMinutes: null })} style={{ marginTop: 16, color: "var(--text-dim)", fontSize: 14, textDecoration: "underline" }}>
        Je ne peux pas déclarer maintenant : enregistrer mon départ, à régulariser
      </button>
      <div><button onClick={onCancel} style={{ marginTop: 12, padding: "10px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button></div>
    </div>
  );
}
