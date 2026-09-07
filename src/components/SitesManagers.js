"use client";
import { useState } from "react";
import { saveSite, deleteSite, saveManager, deleteManager } from "../lib/store";
import { hashManagerPin, isValidPin } from "../lib/pin";
import { Modal, Field, inp, btnPrimary, btnGhost } from "./Employees";

export default function SitesManagers({ sites, managers }) {
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <SitesPanel sites={sites} />
      <ManagersPanel sites={sites} managers={managers} />
    </div>
  );
}

// ---------------- Magasins ----------------
function SitesPanel({ sites }) {
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function save() {
    if (!edit.name?.trim()) { setErr("Nom requis"); return; }
    await saveSite(edit);
    setEdit(null); setErr(null);
  }
  async function remove(s) {
    if (!confirm(`Supprimer le magasin "${s.name}" ? Les salariés rattachés resteront mais sans magasin valide.`)) return;
    await deleteSite(s.id);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Magasins</h2>
        <button onClick={() => setEdit({ name: "" })} style={btnPrimary}>+ Nouveau magasin</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {sites.map((s) => (
          <div key={s.id} style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Code tablette : <strong style={{ color: "var(--brass)", letterSpacing: 1 }}>{s.code || "— non défini —"}</strong>
              </div>
            </div>
            <button onClick={() => setEdit({ ...s })} style={btnGhost}>Modifier</button>
            <button onClick={() => remove(s)} style={{ ...btnGhost, color: "var(--red)" }}>Suppr.</button>
          </div>
        ))}
        {sites.length === 0 && <p style={{ color: "var(--text-faint)" }}>Aucun magasin. Créez-en un.</p>}
      </div>

      {edit && (
        <Modal title={edit.id ? "Modifier le magasin" : "Nouveau magasin"} onClose={() => setEdit(null)}>
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Nom du magasin">
              <input style={inp} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ex. Magasin République" />
            </Field>
            <Field label="Code tablette" hint="Saisi UNE fois par le responsable pour déverrouiller la tablette du magasin. Empêche le badgeage depuis un autre appareil. Visible de tous les admins.">
              <input style={inp} value={edit.code || ""} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="Ex. REP-4821" />
            </Field>
            {err && <p style={{ color: "var(--red)", fontSize: 14 }}>{err}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEdit(null)} style={btnGhost}>Annuler</button>
              <button onClick={save} style={btnPrimary}>Enregistrer</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Managers ----------------
const blankMgr = () => ({ name: "", role: "director", siteIds: [], newPin: "" });

const ROLE_LABEL = {
  admin: "Admin (tout)",
  supervisor: "Superviseur (consultation, plusieurs magasins)",
  director: "Directeur (consultation + correction, 1 magasin)",
};

function ManagersPanel({ sites, managers }) {
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);

  async function save() {
    setErr(null);
    if (!edit.name?.trim()) { setErr("Nom requis"); return; }
    if (edit.newPin && !isValidPin(edit.newPin)) { setErr("PIN = 4 chiffres"); return; }
    if (!edit.id && !edit.newPin) { setErr("PIN requis à la création"); return; }
    if (edit.role === "director" && (edit.siteIds || []).length !== 1) { setErr("Le directeur gère exactement 1 magasin"); return; }
    if (edit.role === "supervisor" && (edit.siteIds || []).length === 0) { setErr("Sélectionnez au moins un magasin"); return; }
    const mgr = {
      id: edit.id, name: edit.name.trim(), role: edit.role,
      siteIds: edit.role === "admin" ? [] : edit.siteIds,
      // compat : scope dérivé du rôle (admin = tout)
      scope: edit.role === "admin" ? "all" : "sites",
    };
    if (edit.newPin) mgr.pin = await hashManagerPin(edit.newPin);
    await saveManager(mgr);
    setEdit(null);
  }
  async function remove(m) {
    if (!confirm(`Supprimer le manager "${m.name}" ?`)) return;
    await deleteManager(m.id);
  }

  const scopeText = (m) =>
    (m.role === "admin" || m.scope === "all") ? "Tous les magasins"
      : (m.siteIds || []).map((id) => sites.find((s) => s.id === id)?.name || "?").join(", ") || "Aucun magasin";

  const roleName = (m) => ROLE_LABEL[m.role] || (m.scope === "all" ? ROLE_LABEL.admin : ROLE_LABEL.supervisor);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Accès managers</h2>
        <button onClick={() => setEdit(blankMgr())} style={btnPrimary}>+ Nouvel accès</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {managers.map((m) => (
          <div key={m.id} style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{m.name}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{roleName(m)} · {scopeText(m)}</div>
            </div>
            <button onClick={() => setEdit({ ...m, role: m.role || (m.scope === "all" ? "admin" : "supervisor"), newPin: "" })} style={btnGhost}>Modifier</button>
            <button onClick={() => remove(m)} style={{ ...btnGhost, color: "var(--red)" }}>Suppr.</button>
          </div>
        ))}
        {managers.length === 0 && <p style={{ color: "var(--text-faint)" }}>Aucun accès. Créez au moins un admin pour vous.</p>}
      </div>

      {edit && (
        <Modal title={edit.id ? "Modifier l'accès" : "Nouvel accès"} onClose={() => setEdit(null)}>
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Nom"><input style={inp} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ex. Recep" /></Field>
            <Field label="Rôle">
              <select style={inp} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value, siteIds: [] })}>
                <option value="admin">Admin — accès total (magasins, salariés, paramètres)</option>
                <option value="supervisor">Superviseur — consultation, plusieurs magasins</option>
                <option value="director">Directeur — consultation + correction, 1 magasin</option>
              </select>
            </Field>
            {edit.role !== "admin" && (
              <Field label={edit.role === "director" ? "Magasin géré (un seul)" : "Magasins autorisés"}>
                <div style={{ display: "grid", gap: 6 }}>
                  {sites.map((s) => {
                    const on = (edit.siteIds || []).includes(s.id);
                    return (
                      <button key={s.id} onClick={() => {
                        if (edit.role === "director") setEdit({ ...edit, siteIds: [s.id] });
                        else setEdit({ ...edit, siteIds: on ? edit.siteIds.filter((x) => x !== s.id) : [...(edit.siteIds || []), s.id] });
                      }} style={{
                        padding: "10px 12px", borderRadius: 8, textAlign: "left", fontWeight: 500,
                        background: on ? "color-mix(in srgb, var(--brass) 20%, var(--ink-2))" : "var(--ink-2)",
                        border: `1px solid ${on ? "var(--brass)" : "var(--line)"}`, color: "var(--text)" }}>
                        {on ? "☑" : "☐"} {s.name}
                      </button>
                    );
                  })}
                  {sites.length === 0 && <span style={{ color: "var(--text-faint)", fontSize: 13 }}>Créez d'abord des magasins.</span>}
                </div>
              </Field>
            )}
            <Field label={edit.id ? "Nouveau PIN (si changement)" : "PIN 4 chiffres"} hint={edit.id ? "Laisser vide = garder l'actuel" : "Code de connexion"}>
              <input style={inp} inputMode="numeric" maxLength={4} value={edit.newPin}
                onChange={(e) => setEdit({ ...edit, newPin: e.target.value.replace(/\D/g, "") })} placeholder="••••" />
            </Field>
            {err && <p style={{ color: "var(--red)", fontSize: 14 }}>{err}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEdit(null)} style={btnGhost}>Annuler</button>
              <button onClick={save} style={btnPrimary}>Enregistrer</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const rowStyle = {
  display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
  background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 11,
};
