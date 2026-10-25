"use client";
import { useEffect, useState } from "react";
import { Field, inp, btnPrimary } from "./Employees";
import { getSettings, saveSettings } from "../lib/store";
import { minutesToHHhMM } from "../lib/timeLogic";
import { planSettings } from "../lib/planLogic";
import { invalidatePlanSettings } from "../lib/planStore";

export default function Settings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { getSettings().then((x) => setS({ ...x, ...planSettings(x) })); }, []);
  if (!s) return <p style={{ color: "var(--text-dim)" }}>Chargement…</p>;

  async function save() {
    setMsg(null);
    await saveSettings({
      restMinMinutes: Number(s.restMinMinutes),
      lateToleranceMinutes: Number(s.lateToleranceMinutes),
      weeklyOvertimeAlertMinutes: Number(s.weeklyOvertimeAlertMinutes),
      maxSpanMinutes: Number(s.maxSpanMinutes),
      fullTimeWeeklyMinutes: Number(s.fullTimeWeeklyMinutes),
      breakMode: s.breakMode,
      breakPercent: Number(s.breakPercent),
      breakLegalMinutes: Number(s.breakLegalMinutes),
      breakLegalThresholdMinutes: Number(s.breakLegalThresholdMinutes),
      breakCompensation: s.breakCompensation,
    });
    invalidatePlanSettings();
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
        {numField("maxSpanMinutes", "Amplitude horaire maximum / jour", "Défaut 720 min = 12h. Au-delà : alerte")}
        {numField("fullTimeWeeklyMinutes", "Base hebdo temps plein", "36h75 convention = 2205 min = 36h45")}

        <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Pauses (déclaration au départ)</h3>
        <Field label="Règle de calcul de la pause attendue" hint="Le calcul à 5 % n'est pas la seule obligation : le droit commun impose 20 min consécutives dès 6 h de travail. À valider selon votre convention collective.">
          <select style={inp} value={s.breakMode} onChange={(e) => setS({ ...s, breakMode: e.target.value })}>
            <option value="max">Le plus favorable : 5 % du temps de travail, avec le minimum légal</option>
            <option value="pct">Pourcentage seul</option>
            <option value="legal">Minimum légal seul</option>
          </select>
        </Field>
        <Field label="Pourcentage du temps de travail prévu" hint="Défaut 5 % (arrondi à la minute supérieure : 8 h → 24 min)">
          <input style={{ ...inp, width: 90 }} inputMode="numeric" value={s.breakPercent} onChange={(e) => setS({ ...s, breakPercent: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Pause minimale légale (minutes)" hint="Défaut 20 min">
          <input style={{ ...inp, width: 90 }} inputMode="numeric" value={s.breakLegalMinutes} onChange={(e) => setS({ ...s, breakLegalMinutes: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Seuil du minimum légal (minutes de travail par jour)" hint="Défaut 360 min = 6 h">
          <input style={{ ...inp, width: 90 }} inputMode="numeric" value={s.breakLegalThresholdMinutes} onChange={(e) => setS({ ...s, breakLegalThresholdMinutes: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Compensation des écarts" hint="Une pause en plus ne rattrape pas automatiquement une pause manquante, sauf si vous choisissez le solde net.">
          <select style={inp} value={s.breakCompensation} onChange={(e) => setS({ ...s, breakCompensation: e.target.value })}>
            <option value="none">Aucune : manquantes et supplémentaires séparées</option>
            <option value="net">Solde net : les supplémentaires compensent les manquantes</option>
          </select>
        </Field>

        {msg && <p style={{ color: msg.t === "ok" ? "var(--green)" : "var(--red)", fontSize: 14 }}>{msg.m}</p>}
        <div><button onClick={save} style={btnPrimary}>Enregistrer</button></div>
      </div>
      <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 18 }}>
        Les PIN managers et les magasins se gèrent dans l'onglet « Magasins & accès ».
      </p>
    </div>
  );
}
