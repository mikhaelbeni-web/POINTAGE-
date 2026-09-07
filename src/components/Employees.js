"use client";
import { useState } from "react";
import { saveEmployee, deleteEmployee, nextMatricule } from "../lib/store";
import { minutesToHHhMM, FULL_TIME_WEEKLY_MINUTES } from "../lib/timeLogic";

const DAYS = [["Lun", 1], ["Mar", 2], ["Mer", 3], ["Jeu", 4], ["Ven", 5], ["Sam", 6], ["Dim", 7]];

const blank = (siteId) => ({
  firstName: "", lastName: "", displayName: "", siteId: siteId || "",
  category: "employee",
  contractType: "full", weeklyContractMinutes: FULL_TIME_WEEKLY_MINUTES,
  workDays: [1, 2, 3, 4, 5], plannedStart: "09:00", plannedEnd: "17:00",
  active: true,
});

export default function Employees({ employees, sites = [], allowedSiteIds = null }) {
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [filterSite, setFilterSite] = useState("all");

  const visibleSites = allowedSiteIds ? sites.filter((s) => allowedSiteIds.includes(s.id)) : sites;

  async function save() {
    setErr(null);
    if (!edit.firstName || !edit.lastName) { setErr("Nom et prénom requis"); return; }
    if (!edit.siteId) { setErr("Magasin requis"); return; }
    if (!edit.matricule || !String(edit.matricule).trim()) { setErr("Matricule requis"); return; }
    const mat = String(edit.matricule).trim();
    // unicité : aucun autre salarié (id différent) ne doit avoir ce matricule
    const clash = employees.find((e) => String(e.matricule) === mat && e.id !== edit.id);
    if (clash) { setErr(`Matricule déjà utilisé par ${clash.displayName}`); return; }
    setSaving(true);
    const emp = {
      ...edit,
      matricule: mat,
      displayName: edit.displayName || `${edit.firstName} ${edit.lastName[0]}.`,
      weeklyContractMinutes: Number(edit.weeklyContractMinutes),
    };
    await saveEmployee(emp);
    setSaving(false);
    setEdit(null);
  }

  async function remove(e) {
    if (!confirm(`Supprimer ${e.displayName} ? Les pointages passés sont conservés.`)) return;
    await deleteEmployee(e.id);
  }

  const siteName = (id) => sites.find((s) => s.id === id)?.name || "—";

  const shown = employees
    .filter((e) => !allowedSiteIds || allowedSiteIds.includes(e.siteId))
    .filter((e) => filterSite === "all" || e.siteId === filterSite);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Salariés</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select style={{ ...inp, width: "auto" }} value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
            <option value="all">Tous mes magasins</option>
            {visibleSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => setEdit(blank(visibleSites.length === 1 ? visibleSites[0].id : (filterSite !== "all" ? filterSite : "")))} style={btnPrimary}>+ Nouveau salarié</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {shown.map((e) => (
          <div key={e.id} style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.displayName}
                <span style={{ color: "var(--brass)", fontSize: 13, fontWeight: 500 }}> · {siteName(e.siteId)}</span>
                {e.active === false && <span style={{ color: "var(--text-faint)", fontSize: 13, fontWeight: 400 }}> · inactif</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Mat. {e.matricule || "—"} · {e.category === "cadre" ? "Cadre (demi-journées)" : (e.contractType === "full" ? "Temps plein" : "Temps partiel") + " · " + minutesToHHhMM(e.weeklyContractMinutes) + "/sem"}
              </div>
            </div>
            <button onClick={() => setEdit({ ...e, newPin: "" })} style={btnGhost}>Modifier</button>
            <button onClick={() => remove(e)} style={{ ...btnGhost, color: "var(--red)" }}>Suppr.</button>
          </div>
        ))}
        {shown.length === 0 && <p style={{ color: "var(--text-faint)" }}>Aucun salarié pour ce filtre.</p>}
      </div>

      {edit && (
        <Modal onClose={() => setEdit(null)} title={edit.id ? "Modifier le salarié" : "Nouveau salarié"}>
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Magasin" hint="Le retard se calcule sur l'horaire prévu ci-dessous">
              <select style={inp} value={edit.siteId} onChange={(ev) => setEdit({ ...edit, siteId: ev.target.value })}>
                <option value="">— Choisir —</option>
                {visibleSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Prénom"><input style={inp} value={edit.firstName} onChange={(ev) => setEdit({ ...edit, firstName: ev.target.value })} /></Field>
              <Field label="Nom"><input style={inp} value={edit.lastName} onChange={(ev) => setEdit({ ...edit, lastName: ev.target.value })} /></Field>
            </div>
            <Field label="Nom affiché (badgeuse)" hint="Laisser vide pour auto (Prénom N.)">
              <input style={inp} value={edit.displayName} onChange={(ev) => setEdit({ ...edit, displayName: ev.target.value })} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Catégorie" hint="Cadre = pointage matin/après-midi (pas d'heures)">
                <select style={inp} value={edit.category} onChange={(ev) => setEdit({ ...edit, category: ev.target.value })}>
                  <option value="employee">Employé (pointage horaire)</option>
                  <option value="cadre">Cadre (demi-journées)</option>
                </select>
              </Field>
              <Field label="Matricule" hint="Code que le salarié tape pour badger. À lui communiquer.">
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={inp} inputMode="numeric" value={edit.matricule || ""}
                    onChange={(ev) => setEdit({ ...edit, matricule: ev.target.value.replace(/\D/g, "") })}
                    placeholder="Ex. 101" />
                  {!edit.id && (
                    <button type="button" onClick={async () => setEdit({ ...edit, matricule: await nextMatricule() })}
                      style={{ ...btnGhost, whiteSpace: "nowrap" }}>Suggérer</button>
                  )}
                </div>
              </Field>
            </div>

            {edit.category === "employee" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Type de contrat">
                    <select style={inp} value={edit.contractType} onChange={(ev) => {
                      const ct = ev.target.value;
                      setEdit({ ...edit, contractType: ct, weeklyContractMinutes: ct === "full" ? FULL_TIME_WEEKLY_MINUTES : edit.weeklyContractMinutes });
                    }}>
                      <option value="full">Temps plein</option>
                      <option value="part">Temps partiel</option>
                    </select>
                  </Field>
                  <Field label="Heures/sem contrat" hint={`Ex. plein = ${minutesToHHhMM(FULL_TIME_WEEKLY_MINUTES)} (36h75 conv.)`}>
                    <MinutesInput value={edit.weeklyContractMinutes} onChange={(v) => setEdit({ ...edit, weeklyContractMinutes: v })} />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Arrivée prévue" hint="Sert au calcul du retard">
                    <input type="time" style={inp} value={edit.plannedStart} onChange={(ev) => setEdit({ ...edit, plannedStart: ev.target.value })} />
                  </Field>
                  <Field label="Départ prévu">
                    <input type="time" style={inp} value={edit.plannedEnd} onChange={(ev) => setEdit({ ...edit, plannedEnd: ev.target.value })} />
                  </Field>
                </div>
              </>
            )}

            <Field label="Jours travaillés">
              <div style={{ display: "flex", gap: 6 }}>
                {DAYS.map(([lbl, n]) => {
                  const on = edit.workDays.includes(n);
                  return (
                    <button key={n} onClick={() => setEdit({
                      ...edit,
                      workDays: on ? edit.workDays.filter((x) => x !== n) : [...edit.workDays, n].sort(),
                    })} style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: on ? "color-mix(in srgb, var(--brass) 20%, var(--ink-2))" : "var(--ink-2)",
                      border: `1px solid ${on ? "var(--brass)" : "var(--line)"}`,
                      color: on ? "var(--text)" : "var(--text-dim)",
                    }}>{lbl}</button>
                  );
                })}
              </div>
            </Field>

            <Field label="Statut">
              <select style={{ ...inp, maxWidth: 200 }} value={edit.active ? "1" : "0"} onChange={(ev) => setEdit({ ...edit, active: ev.target.value === "1" })}>
                <option value="1">Actif</option>
                <option value="0">Inactif</option>
              </select>
            </Field>

            {err && <p style={{ color: "var(--red)", fontSize: 14 }}>{err}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEdit(null)} style={btnGhost}>Annuler</button>
              <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? "…" : "Enregistrer"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Saisie en h:min, stockée en minutes
function MinutesInput({ value, onChange }) {
  const h = Math.floor(value / 60), m = value % 60;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input style={{ ...inp, width: 64 }} inputMode="numeric" value={h}
        onChange={(e) => onChange(Number(e.target.value || 0) * 60 + m)} />
      <span style={{ color: "var(--text-dim)" }}>h</span>
      <input style={{ ...inp, width: 64 }} inputMode="numeric" value={m}
        onChange={(e) => onChange(h * 60 + Number(e.target.value || 0))} />
      <span style={{ color: "var(--text-dim)" }}>min</span>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

export function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 16,
        padding: 24, width: "100%", maxWidth: 560,
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 18 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export const inp = {
  width: "100%", padding: "10px 12px", borderRadius: 9,
  background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 15,
};
export const btnPrimary = {
  padding: "10px 18px", borderRadius: 10, fontWeight: 600, fontSize: 14,
  background: "var(--brass)", color: "#1a1204", border: "none",
};
export const btnGhost = {
  padding: "10px 16px", borderRadius: 10, fontWeight: 500, fontSize: 14,
  background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)",
};
const row = {
  display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
  background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 11,
};
