"use client";
import { useEffect, useState } from "react";
import { addPunch, watchDay, findByMatricule, setCadreHalfDay } from "../lib/store";
import { minutesToHHhMM } from "../lib/timeLogic";
import { LEAVE_TYPES, leaveLabel } from "./ui";

const todayStr = () => new Date().toISOString().slice(0, 10);
const TABLET_SITE_KEY = "pointage_tablet_site";
const TABLET_UNLOCK_KEY = "pointage_tablet_unlock";

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateFmt = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div style={{ textAlign: "center" }}>
      <div className="clock-face" style={{ fontSize: "clamp(48px, 10vw, 88px)", lineHeight: 1 }}>
        {hh}<span style={{ color: "var(--brass)" }}>:</span>{mm}
        <span style={{ fontSize: "0.4em", color: "var(--text-faint)" }}> {ss}</span>
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 16, marginTop: 6, textTransform: "capitalize" }}>{dateFmt}</div>
    </div>
  );
}

function nextActions(day) {
  const has = (k) => day && day[k];
  if (!has("arrival")) return [["arrival", "Arrivée", "var(--green)"]];
  if (!has("breakOut")) return [["breakOut", "Départ pause", "var(--amber)"], ["departure", "Départ", "var(--red)"]];
  if (!has("breakIn")) return [["breakIn", "Retour pause", "var(--green)"]];
  if (!has("departure")) return [["departure", "Départ", "var(--red)"]];
  return [];
}

export default function Badgeuse({ employees, sites }) {
  const [tabletSite, setTabletSite] = useState(null);
  const [unlockedCode, setUnlockedCode] = useState(null);
  const [ready, setReady] = useState(false);
  const [days, setDays] = useState({});
  const [matricule, setMatricule] = useState("");
  const [current, setCurrent] = useState(null); // salarié identifié
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(null);

  useEffect(() => {
    setTabletSite(localStorage.getItem(TABLET_SITE_KEY));
    setUnlockedCode(localStorage.getItem(TABLET_UNLOCK_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    const unsub = watchDay(todayStr(), (list) => {
      const map = {}; list.forEach((d) => (map[d.employeeId] = d)); setDays(map);
    });
    return () => unsub();
  }, []);

  function chooseSite(id) {
    localStorage.setItem(TABLET_SITE_KEY, id);
    localStorage.removeItem(TABLET_UNLOCK_KEY);
    setUnlockedCode(null); setTabletSite(id);
  }

  async function identify() {
    setError(null);
    if (!matricule) return;
    const emp = await findByMatricule(matricule, tabletSite);
    if (!emp) { setError("Matricule inconnu pour ce magasin"); setMatricule(""); return; }
    setCurrent(emp); setMatricule("");
  }

  async function doPunch(type, label) {
    try {
      await addPunch(current.id, todayStr(), type, "badge");
      setToast(`${label} — ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) { setToast("Erreur : " + e.message); }
    setCurrent(null); setTimeout(() => setToast(null), 3500);
  }

  async function doHalfDay(half, value, label) {
    try {
      await setCadreHalfDay(current.id, todayStr(), half, value, "badge");
      setToast(`${label} enregistré`);
    } catch (e) { setToast("Erreur : " + e.message); }
    setCurrent(null); setTimeout(() => setToast(null), 3500);
  }

  if (!ready) return null;

  // 1. Choix magasin (une fois par tablette)
  if (!tabletSite || !sites.find((s) => s.id === tabletSite)) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Magasin de cette tablette</h1>
          <p style={{ color: "var(--text-dim)", marginBottom: 24 }}>Réglage mémorisé sur cet appareil.</p>
          {sites.length === 0 ? (
            <p style={{ color: "var(--text-faint)" }}>Aucun magasin créé. Un responsable doit d'abord en créer un.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {sites.map((s) => (
                <button key={s.id} onClick={() => chooseSite(s.id)} style={{
                  padding: "16px", borderRadius: 12, fontSize: 18, fontWeight: 600,
                  background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)",
                }}>{s.name}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const currentSite = sites.find((s) => s.id === tabletSite);
  const siteName = currentSite?.name || "";
  const siteCode = currentSite?.code || "";
  const isUnlocked = !siteCode || unlockedCode === siteCode;

  function submitCode() {
    if (codeInput.trim() === siteCode) {
      localStorage.setItem(TABLET_UNLOCK_KEY, siteCode);
      setUnlockedCode(siteCode); setCodeError(null); setCodeInput("");
    } else setCodeError("Code du magasin incorrect");
  }

  // 2. Déverrouillage magasin
  if (!isUnlocked) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Déverrouiller la tablette</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 4 }}>{siteName}</p>
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginBottom: 20 }}>Code réservé au responsable. À saisir une seule fois.</p>
          <input style={{ width: "100%", padding: "14px", borderRadius: 10, fontSize: 18, textAlign: "center",
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", letterSpacing: 2 }}
            value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCode()} placeholder="Code magasin" autoFocus />
          {codeError && <p style={{ color: "var(--red)", fontSize: 14, marginTop: 12 }}>{codeError}</p>}
          <button onClick={submitCode} style={{ marginTop: 16, width: "100%", padding: "14px", borderRadius: 10,
            fontSize: 16, fontWeight: 600, background: "var(--brass)", color: "#1a1204", border: "none" }}>Déverrouiller</button>
          <button onClick={() => { localStorage.removeItem(TABLET_SITE_KEY); setTabletSite(null); }}
            style={{ marginTop: 14, color: "var(--text-faint)", fontSize: 13, textDecoration: "underline" }}>Changer de magasin</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "24px 20px 40px" }}>
      <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13, marginBottom: 4 }}>
        {siteName} · <button onClick={() => { localStorage.removeItem(TABLET_SITE_KEY); setTabletSite(null); }}
          style={{ color: "var(--text-faint)", textDecoration: "underline", fontSize: 13 }}>changer</button>
      </div>
      <div style={{ padding: "4px 0 22px" }}><LiveClock /></div>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink-3)", border: "1px solid var(--green)", color: "var(--text)",
          padding: "12px 22px", borderRadius: 12, zIndex: 50, fontSize: 16, fontWeight: 500,
          boxShadow: "0 8px 30px rgba(0,0,0,.4)" }}>✓ {toast}</div>
      )}

      {/* 3. Saisie matricule (aucun nom affiché) */}
      {!current && (
        <MatriculePad value={matricule} setValue={setMatricule} onEnter={identify} error={error} />
      )}

      {/* 4a. Écran employé (horaire) */}
      {current && current.category !== "cadre" && (
        <ActionScreen emp={current} day={days[current.id]} onPunch={doPunch} onCancel={() => setCurrent(null)} />
      )}

      {/* 4b. Écran cadre (demi-journées) */}
      {current && current.category === "cadre" && (
        <CadreScreen emp={current} day={days[current.id]} onHalfDay={doHalfDay} onCancel={() => setCurrent(null)} />
      )}
    </div>
  );
}

function MatriculePad({ value, setValue, onEnter, error }) {
  const press = (d) => setValue((value + d).slice(0, 6));
  const back = () => setValue(value.slice(0, -1));
  return (
    <div style={{ maxWidth: 320, margin: "0 auto", textAlign: "center", width: "100%" }}>
      <p style={{ color: "var(--text-dim)", fontSize: 16, marginBottom: 14 }}>Entrez votre matricule</p>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6, minHeight: 46, color: "var(--text)" }}>
        {value || <span style={{ color: "var(--text-faint)" }}>— — —</span>}
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: 14, margin: "8px 0" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
        {[1,2,3,4,5,6,7,8,9].map((n) => (
          <button key={n} onClick={() => press(String(n))} style={padBtn}>{n}</button>
        ))}
        <button onClick={back} style={{ ...padBtn, fontSize: 22 }}>⌫</button>
        <button onClick={() => press("0")} style={padBtn}>0</button>
        <button onClick={onEnter} style={{ ...padBtn, background: "var(--brass)", color: "#1a1204", fontWeight: 700 }}>OK</button>
      </div>
    </div>
  );
}
const padBtn = {
  height: 66, borderRadius: 12, background: "var(--ink-2)",
  border: "1px solid var(--line)", color: "var(--text)", fontSize: 26, fontWeight: 500,
};

function ActionScreen({ emp, day, onPunch, onCancel }) {
  const actions = nextActions(day);
  return (
    <div style={{ maxWidth: 460, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: 24, fontWeight: 600 }}>{emp.displayName}</h2>
      <DayStrip day={day} />
      {actions.length === 0 ? (
        <p style={{ color: "var(--green)", fontSize: 18, margin: "30px 0" }}>✓ Journée complète.</p>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
          {actions.map(([type, label, color]) => (
            <button key={type} onClick={() => onPunch(type, label)} style={{
              padding: "22px", borderRadius: 14, fontSize: 22, fontWeight: 600,
              background: `color-mix(in srgb, ${color} 18%, var(--ink-2))`,
              border: `1.5px solid ${color}`, color: "var(--text)" }}>{label}</button>
          ))}
        </div>
      )}
      <button onClick={onCancel} style={{ marginTop: 22, padding: "12px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button>
    </div>
  );
}

function CadreScreen({ emp, day, onHalfDay, onCancel }) {
  const [pick, setPick] = useState(null); // {half, label}
  const mDone = day?.morning, aDone = day?.afternoon;

  if (pick) {
    return (
      <div style={{ maxWidth: 460, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>{emp.displayName}</h2>
        <p style={{ color: "var(--text-dim)", margin: "8px 0 20px" }}>{pick.label} — présent ou motif ?</p>
        <div style={{ display: "grid", gap: 12 }}>
          <button onClick={() => onHalfDay(pick.half, "present", `${pick.label} présent`)} style={{
            padding: "20px", borderRadius: 14, fontSize: 20, fontWeight: 600,
            background: "color-mix(in srgb, var(--green) 18%, var(--ink-2))", border: "1.5px solid var(--green)", color: "var(--text)" }}>
            Présent
          </button>
          {LEAVE_TYPES.map(([k, label]) => (
            <button key={k} onClick={() => onHalfDay(pick.half, k, `${pick.label} : ${label}`)} style={{
              padding: "13px", borderRadius: 10, fontSize: 15,
              background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)" }}>{label}</button>
          ))}
        </div>
        <button onClick={() => setPick(null)} style={{ marginTop: 18, color: "var(--text-dim)", fontSize: 15 }}>← Retour</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: 24, fontWeight: 600 }}>{emp.displayName}</h2>
      <p style={{ color: "var(--text-faint)", fontSize: 14, margin: "6px 0 20px" }}>Cadre — déclaration par demi-journée</p>
      <div style={{ display: "grid", gap: 14 }}>
        <HalfBtn label="Matin" state={mDone} onClick={() => setPick({ half: "morning", label: "Matin" })} />
        <HalfBtn label="Après-midi" state={aDone} onClick={() => setPick({ half: "afternoon", label: "Après-midi" })} />
      </div>
      <button onClick={onCancel} style={{ marginTop: 22, padding: "12px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button>
    </div>
  );
}

function HalfBtn({ label, state, onClick }) {
  const txt = state === "present" ? "Présent" : state ? leaveLabel(state) : "Non déclaré";
  const color = state === "present" ? "var(--green)" : state ? "var(--blue)" : "var(--line)";
  return (
    <button onClick={onClick} style={{
      padding: "20px", borderRadius: 14, fontSize: 20, fontWeight: 600, textAlign: "left",
      background: "var(--ink-2)", border: `1.5px solid ${color}`, color: "var(--text)",
      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, color }}>{txt}</span>
    </button>
  );
}

function DayStrip({ day }) {
  const items = [["Arrivée", day?.arrival], ["Pause", day?.breakOut], ["Retour", day?.breakIn], ["Départ", day?.departure]];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
      {items.map(([label, ts]) => (
        <div key={label} style={{ padding: "8px 12px", borderRadius: 9, background: "var(--ink-2)", border: "1px solid var(--line)", minWidth: 74 }}>
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{label}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: ts ? "var(--text)" : "var(--text-faint)" }}>{ts ? fmtTs(ts) : "—"}</div>
        </div>
      ))}
    </div>
  );
}

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
