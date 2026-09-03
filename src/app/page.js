"use client";
import { useEffect, useState } from "react";
import { watchEmployees, getSettings, saveSettings } from "../lib/store";
import { verifyManagerPin, hashManagerPin, isValidPin } from "../lib/pin";
import { PinPad } from "../components/ui";
import Badgeuse from "../components/Badgeuse";
import Dashboard from "../components/Dashboard";
import Employees, { btnPrimary, inp } from "../components/Employees";
import Settings from "../components/Settings";
import Recap from "../components/Recap";
import DayEditor from "../components/DayEditor";

export default function Page() {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState(null);
  const [managerMode, setManagerMode] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [editDay, setEditDay] = useState(null);

  useEffect(() => {
    const unsub = watchEmployees(setEmployees);
    getSettings().then(setSettings);
    return () => unsub();
  }, []);

  async function tryManagerPin(pin) {
    const s = await getSettings();
    const ok = await verifyManagerPin(pin, s.managerPinHash);
    if (!ok) { setPinError("Code incorrect"); return; }
    setPinError(null); setShowPin(false); setManagerMode(true);
  }

  if (!settings) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>Chargement…</div>;
  }

  // Premier lancement : définir le PIN manager
  if (!settings.managerPinHash) {
    return <FirstRun onDone={() => getSettings().then(setSettings)} />;
  }

  if (!managerMode) {
    return (
      <>
        <button className="no-print" onClick={() => { setShowPin(true); setPinError(null); }} style={{
          position: "fixed", top: 16, right: 16, zIndex: 40, padding: "9px 15px",
          borderRadius: 10, background: "var(--ink-2)", border: "1px solid var(--line)",
          color: "var(--text-dim)", fontSize: 14, fontWeight: 500,
        }}>Mode Manager</button>

        <Badgeuse employees={employees} />

        {showPin && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 60, display: "grid", placeItems: "center", padding: 20 }}>
            <div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 18, padding: 30 }}>
              <PinPad title="Mode Manager" subtitle="Code manager à 4 chiffres" error={pinError}
                onSubmit={tryManagerPin} onCancel={() => setShowPin(false)} />
            </div>
          </div>
        )}
      </>
    );
  }

  // Mode Manager
  const tabs = [
    ["dashboard", "Tableau de bord"], ["recap", "Récaps & impression"],
    ["employees", "Salariés"], ["settings", "Paramètres"],
  ];
  return (
    <div style={{ minHeight: "100vh", maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
      <header className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "9px 15px", borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: tab === id ? "var(--brass)" : "var(--ink-2)",
              color: tab === id ? "#1a1204" : "var(--text-dim)",
              border: `1px solid ${tab === id ? "var(--brass)" : "var(--line)"}`,
            }}>{label}</button>
          ))}
        </div>
        <button onClick={() => setManagerMode(false)} style={{
          padding: "9px 15px", borderRadius: 10, fontSize: 14,
          background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text-dim)",
        }}>← Badgeuse</button>
      </header>

      {tab === "dashboard" && <Dashboard employees={employees} onEditDay={(e, d) => setEditDay({ emp: e, date: d })} />}
      {tab === "recap" && <Recap employees={employees} />}
      {tab === "employees" && <Employees employees={employees} />}
      {tab === "settings" && <Settings />}

      {editDay && (
        <DayEditor emp={editDay.emp} date={editDay.date} managerId="manager" onClose={() => setEditDay(null)} />
      )}
    </div>
  );
}

function FirstRun({ onDone }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);

  async function save() {
    if (!isValidPin(pin)) { setErr("Le PIN doit faire 4 chiffres"); return; }
    if (pin !== confirm) { setErr("Les deux codes ne correspondent pas"); return; }
    await saveSettings({ managerPinHash: await hashManagerPin(pin) });
    onDone();
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Configuration initiale</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 15, marginBottom: 24 }}>
          Définissez le code Manager à 4 chiffres. Il protège l'accès aux corrections, aux salariés et aux paramètres.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <input style={inp} inputMode="numeric" maxLength={4} placeholder="Nouveau code" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <input style={inp} inputMode="numeric" maxLength={4} placeholder="Confirmer le code" value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
          {err && <p style={{ color: "var(--red)", fontSize: 14 }}>{err}</p>}
          <button onClick={save} style={btnPrimary}>Valider</button>
        </div>
      </div>
    </div>
  );
}
