"use client";
import { useEffect, useState } from "react";
import { Field, inp, btnPrimary } from "./Employees";
import { getSettings, saveSettings } from "../lib/store";
import { hashManagerPin, isValidPin } from "../lib/pin";
import { minutesToHHhMM } from "../lib/timeLogic";

export default function Settings() {
  const [s, setS] = useState(null);
  const [newPin, setNewPin] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => { getSettings().then(setS); }, []);
  if (!s) return <p style={{ color: "var(--text-dim)" }}>Chargement…</p>;

  async function save() {
    setMsg(null);
    if (newPin && !isValidPin(newPin)) { setMsg({ t: "err", m: "PIN manager = 4 chiffres" }); return; }
    const patch = {
      restMinMinutes: Number(s.restMinMinutes),
      lateToleranceMinutes: Number(s.lateToleranceMinutes),
      weeklyOvertimeAlertMinutes: Number(s.weeklyOvertimeAlertMinutes),
      fullTimeWeeklyMinutes: Number(s.fullTimeWeeklyMinutes),
    };
    if (newPin) patch.managerPinHash = await hashManagerPin(newPin);
    await saveSettings(patch);
    setNewPin("");
    setMsg({ t: "ok", m: "Paramètres enregistrés" });
  }

  const numField = (key, label, hint) => (
    <Field label={label} hint={hint}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input style={{ ...inp, width: 90 }} inputMode="numeric" value={s[key]}
          onChange={(e) => setS({ ...s, [key]: e.target.value.replace(/\D/g, "") })} />
        <span style={{ color: "var(--text-dim)", fontSize: 14 }}>min · {minutesToHHhMM(Number(s[key]) || 0)}</span>
      </div>
    </Field>
  );

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 18 }}>Paramètres</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {numField("restMinMinutes", "Repos minimum entre deux journées", "Défaut 660 min = 11h")}
        {numField("lateToleranceMinutes", "Tolérance de retard", "Défaut 5 min")}
        {numField("weeklyOvertimeAlertMinutes", "Seuil d'alerte heures supp./sem.", "Défaut 240 min = 4h")}
        {numField("fullTimeWeeklyMinutes", "Base hebdo temps plein", "36h75 convention = 2205 min = 36h45")}

        <hr style={{ border: "none", borderTop: "1px solid var(--line)" }} />
        <Field label="Changer le PIN manager" hint="Laisser vide pour garder l'actuel. 4 chiffres.">
          <input style={{ ...inp, width: 140 }} inputMode="numeric" maxLength={4} value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
        </Field>

        {msg && <p style={{ color: msg.t === "ok" ? "var(--green)" : "var(--red)", fontSize: 14 }}>{msg.m}</p>}
        <div><button onClick={save} style={btnPrimary}>Enregistrer</button></div>
      </div>
    </div>
  );
}
