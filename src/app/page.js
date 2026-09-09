"use client";
import { useEffect, useState } from "react";
import {
  watchEmployees, watchSites, watchManagers, getAllManagers,
  saveManager, saveSite,
} from "../lib/store";
import { verifyManagerPin, hashManagerPin, isValidPin } from "../lib/pin";
import { PinPad } from "../components/ui";
import Badgeuse from "../components/Badgeuse";
import Dashboard from "../components/Dashboard";
import Employees, { btnPrimary, inp } from "../components/Employees";
import Settings from "../components/Settings";
import Recap from "../components/Recap";
import DayEditor from "../components/DayEditor";
import SitesManagers from "../components/SitesManagers";
import Tablets from "../components/Tablets";
import { sendHeartbeat } from "../lib/store";
import { getDeviceInfo } from "../lib/deviceInfo";

const TABLET_SITE_KEY = "pointage_tablet_site";
const TABLET_ID_KEY = "pointage_tablet_id";
function getTabletId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem(TABLET_ID_KEY);
  if (!id) {
    id = "tab_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(TABLET_ID_KEY, id);
  }
  return id;
}

export default function Page() {
  const [employees, setEmployees] = useState([]);
  const [sites, setSites] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState(null); // manager connecté {name, scope, siteIds}
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [editDay, setEditDay] = useState(null);

  useEffect(() => {
    const u1 = watchEmployees(setEmployees);
    const u2 = watchSites(setSites);
    const u3 = watchManagers((m) => { setManagers(m); setLoaded(true); });
    return () => { u1(); u2(); u3(); };
  }, []);

  // Heartbeat GLOBAL : émis dès que cet appareil est rattaché à un magasin,
  // quel que soit l'écran (badgeuse OU mode manager). Premier signal immédiat.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const siteId = localStorage.getItem(TABLET_SITE_KEY);
    if (!siteId) return;
    const tabletId = getTabletId();
    const info = getDeviceInfo();
    const beat = () => sendHeartbeat(tabletId, siteId, {
      siteName: sites.find((s) => s.id === siteId)?.name || null,
      model: info.model || null, os: info.os || null,
      browser: info.browser || null, screen: info.screen || null,
      online: navigator.onLine,
    });
    beat();
    const iv = setInterval(beat, 60 * 1000); // toutes les minutes
    return () => clearInterval(iv);
  }, [sites, session]);

  async function tryManagerPin(pin) {
    const all = await getAllManagers();
    for (const m of all) {
      if (m.pin && await verifyManagerPin(pin, m.pin)) {
        setPinError(null); setShowPin(false);
        const role = m.role || (m.scope === "all" ? "admin" : "supervisor");
        setSession({ id: m.id, name: m.name, role, siteIds: m.siteIds || [] });
        setTab("dashboard");
        return;
      }
    }
    setPinError("Code incorrect");
  }

  if (!loaded) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>Chargement…</div>;
  }

  if (managers.length === 0) {
    return <FirstRun onDone={() => {}} />;
  }

  const role = session?.role;
  const isAdmin = role === "admin";
  const canEdit = isAdmin || role === "director"; // superviseur = lecture seule
  const allowedSiteIds = (!session || isAdmin) ? null : session.siteIds;

  if (!session) {
    return (
      <>
        <button className="no-print" onClick={() => { setShowPin(true); setPinError(null); }} style={{
          position: "fixed", top: 16, right: 16, zIndex: 40, padding: "9px 15px",
          borderRadius: 10, background: "var(--ink-2)", border: "1px solid var(--line)",
          color: "var(--text-dim)", fontSize: 14, fontWeight: 500,
        }}>Mode Manager</button>

        <Badgeuse employees={employees} sites={sites} />

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

  const tabs = [
    ["dashboard", "Tableau de bord"], ["recap", "Récaps & impression"],
    ...(isAdmin ? [["employees", "Salariés"], ["sites", "Magasins & accès"], ["tablets", "État des tablettes"], ["settings", "Paramètres"]] : []),
    ...(role === "director" ? [["employees", "Salariés"]] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
      <header className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 14, color: "var(--brass)", fontWeight: 600, marginRight: 8 }}>{session.name}</span>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "9px 15px", borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: tab === id ? "var(--brass)" : "var(--ink-2)",
              color: tab === id ? "#1a1204" : "var(--text-dim)",
              border: `1px solid ${tab === id ? "var(--brass)" : "var(--line)"}`,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => {
            if (confirm("Changer le magasin de CETTE tablette ? La badgeuse redemandera le magasin et son code.")) {
              localStorage.removeItem("pointage_tablet_site");
              localStorage.removeItem("pointage_tablet_unlock");
              setSession(null);
            }
          }} style={{
            padding: "9px 15px", borderRadius: 10, fontSize: 14,
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text-dim)",
          }}>Changer magasin tablette</button>
          <button onClick={() => setSession(null)} style={{
            padding: "9px 15px", borderRadius: 10, fontSize: 14,
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text-dim)",
          }}>← Badgeuse</button>
        </div>
      </header>

      {tab === "dashboard" && <Dashboard employees={employees} sites={sites} allowedSiteIds={allowedSiteIds} canEdit={canEdit} onEditDay={(e, d) => setEditDay({ emp: e, date: d })} />}
      {tab === "recap" && <Recap employees={employees} sites={sites} allowedSiteIds={allowedSiteIds} />}
      {tab === "employees" && (isAdmin || role === "director") && <Employees employees={employees} sites={sites} allowedSiteIds={allowedSiteIds} />}
      {tab === "sites" && isAdmin && <SitesManagers sites={sites} managers={managers} employees={employees} />}
      {tab === "tablets" && isAdmin && <Tablets sites={sites} />}
      {tab === "settings" && isAdmin && <Settings />}

      {editDay && (
        <DayEditor emp={editDay.emp} date={editDay.date} managerId={session.name} onClose={() => setEditDay(null)} />
      )}
    </div>
  );
}

function FirstRun() {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { setErr("Nom requis"); return; }
    if (!isValidPin(pin)) { setErr("Le PIN doit faire 4 chiffres"); return; }
    if (pin !== confirm) { setErr("Les deux codes ne correspondent pas"); return; }
    setBusy(true);
    await saveManager({ name: name.trim(), role: "admin", scope: "all", siteIds: [], pin: await hashManagerPin(pin) });
    // le watcher managers se met à jour tout seul -> quitte l'écran FirstRun
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ maxWidth: 400, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Configuration initiale</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 15, marginBottom: 24 }}>
          Créez le premier accès manager (périmètre : tous les magasins). C'est votre accès administrateur.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <input style={inp} placeholder="Votre nom (ex. Mikhael)" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={inp} inputMode="numeric" maxLength={4} placeholder="Code PIN 4 chiffres" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <input style={inp} inputMode="numeric" maxLength={4} placeholder="Confirmer le code" value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
          {err && <p style={{ color: "var(--red)", fontSize: 14 }}>{err}</p>}
          <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? "…" : "Créer mon accès"}</button>
        </div>
      </div>
    </div>
  );
}
