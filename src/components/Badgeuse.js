"use client";
import { useEffect, useState } from "react";
import { PinPad } from "./ui";
import { verifyEmployeePin } from "../lib/pin";
import { addPunch, watchDay } from "../lib/store";
import { minutesToHHhMM } from "../lib/timeLogic";

const todayStr = () => new Date().toISOString().slice(0, 10);
const TABLET_SITE_KEY = "pointage_tablet_site";
const TABLET_UNLOCK_KEY = "pointage_tablet_unlock"; // code validé mémorisé sur l'appareil

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateFmt = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div style={{ textAlign: "center" }}>
      <div className="clock-face" style={{ fontSize: "clamp(56px, 12vw, 104px)", lineHeight: 1 }}>
        {hh}<span style={{ color: "var(--brass)" }}>:</span>{mm}
        <span style={{ fontSize: "0.4em", color: "var(--text-faint)" }}> {ss}</span>
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 17, marginTop: 8, textTransform: "capitalize" }}>{dateFmt}</div>
    </div>
  );
}

function nextActions(day) {
  const has = (k) => day && day[k];
  if (!has("arrival")) return [["arrival", "Arrivée", "var(--green)"]];
  if (!has("breakOut")) return [
    ["breakOut", "Départ pause", "var(--amber)"],
    ["departure", "Départ", "var(--red)"],
  ];
  if (!has("breakIn")) return [["breakIn", "Retour pause", "var(--green)"]];
  if (!has("departure")) return [["departure", "Départ", "var(--red)"]];
  return [];
}

export default function Badgeuse({ employees, sites }) {
  const [tabletSite, setTabletSite] = useState(null);
  const [unlockedCode, setUnlockedCode] = useState(null);
  const [ready, setReady] = useState(false);
  const [days, setDays] = useState({});
  const [selected, setSelected] = useState(null);
  const [pinError, setPinError] = useState(null);
  const [toast, setToast] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(null);

  useEffect(() => {
    setTabletSite(localStorage.getItem(TABLET_SITE_KEY));
    setUnlockedCode(localStorage.getItem(TABLET_UNLOCK_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    const unsub = watchDay(todayStr(), (list) => {
      const map = {};
      list.forEach((d) => (map[d.employeeId] = d));
      setDays(map);
    });
    return () => unsub();
  }, []);

  function chooseSite(id) {
    localStorage.setItem(TABLET_SITE_KEY, id);
    localStorage.removeItem(TABLET_UNLOCK_KEY);
    setUnlockedCode(null);
    setTabletSite(id);
  }

  async function onPin(pin) {
    const ok = await verifyEmployeePin(pin, selected.pin);
    if (!ok) { setPinError("Code incorrect"); return; }
    setPinError(null);
    setSelected({ ...selected, unlocked: true });
  }

  async function doPunch(type, label) {
    try {
      await addPunch(selected.id, todayStr(), type, "badge");
      setToast(`${label} enregistré — ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) {
      setToast("Erreur : " + e.message);
    }
    setSelected(null);
    setTimeout(() => setToast(null), 3500);
  }

  if (!ready) return null;

  // Choix du magasin de la tablette (une fois)
  if (!tabletSite || !sites.find((s) => s.id === tabletSite)) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Magasin de cette tablette</h1>
          <p style={{ color: "var(--text-dim)", marginBottom: 24 }}>
            Choisissez le magasin. Ce réglage reste mémorisé sur cet appareil.
          </p>
          {sites.length === 0 ? (
            <p style={{ color: "var(--text-faint)" }}>
              Aucun magasin créé. Un responsable doit d'abord en créer un dans le mode Manager.
            </p>
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

  // Porte de déverrouillage : si le magasin a un code, la tablette doit l'avoir validé.
  // Empêche de badger depuis un appareil non déverrouillé (ex. domicile d'un salarié).
  const siteCode = currentSite?.code || "";
  const isUnlocked = !siteCode || unlockedCode === siteCode;

  function submitCode() {
    if (codeInput.trim() === siteCode) {
      localStorage.setItem(TABLET_UNLOCK_KEY, siteCode);
      setUnlockedCode(siteCode);
      setCodeError(null); setCodeInput("");
    } else {
      setCodeError("Code du magasin incorrect");
    }
  }

  if (!isUnlocked) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Déverrouiller la tablette</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 4 }}>{siteName}</p>
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginBottom: 20 }}>
            Code réservé au responsable. À saisir une seule fois sur la tablette du magasin.
          </p>
          <input style={{
            width: "100%", padding: "14px", borderRadius: 10, fontSize: 18, textAlign: "center",
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", letterSpacing: 2,
          }} value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCode()} placeholder="Code magasin" autoFocus />
          {codeError && <p style={{ color: "var(--red)", fontSize: 14, marginTop: 12 }}>{codeError}</p>}
          <button onClick={submitCode} style={{
            marginTop: 16, width: "100%", padding: "14px", borderRadius: 10, fontSize: 16, fontWeight: 600,
            background: "var(--brass)", color: "#1a1204", border: "none",
          }}>Déverrouiller</button>
          <button onClick={() => { localStorage.removeItem(TABLET_SITE_KEY); setTabletSite(null); }}
            style={{ marginTop: 14, color: "var(--text-faint)", fontSize: 13, textDecoration: "underline" }}>
            Changer de magasin
          </button>
        </div>
      </div>
    );
  }

  const active = employees.filter((e) => e.active !== false && (e.siteId || "main") === tabletSite);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "28px 20px 40px" }}>
      <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13, marginBottom: 4 }}>
        {siteName} · <button onClick={() => { localStorage.removeItem(TABLET_SITE_KEY); setTabletSite(null); }}
          style={{ color: "var(--text-faint)", textDecoration: "underline", fontSize: 13 }}>changer</button>
      </div>
      <div style={{ padding: "6px 0 26px" }}><LiveClock /></div>

      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink-3)", border: "1px solid var(--green)", color: "var(--text)",
          padding: "12px 22px", borderRadius: 12, zIndex: 50, fontSize: 16, fontWeight: 500,
          boxShadow: "0 8px 30px rgba(0,0,0,.4)",
        }}>✓ {toast}</div>
      )}

      {!selected && (
        <>
          <p style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 16, marginBottom: 18 }}>
            Touchez votre nom pour pointer
          </p>
          <div style={{
            display: "grid", gap: 12, maxWidth: 720, width: "100%", margin: "0 auto",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          }}>
            {active.map((e) => {
              const d = days[e.id];
              const done = d && d.arrival && d.departure;
              const working = d && d.arrival && !d.departure;
              return (
                <button key={e.id} onClick={() => { setSelected(e); setPinError(null); }} style={{
                  padding: "18px 14px", borderRadius: 14, textAlign: "left",
                  background: "var(--ink-2)", border: "1px solid var(--line)",
                  borderLeft: `3px solid ${working ? "var(--brass)" : done ? "var(--green)" : "var(--line)"}`,
                }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{e.displayName}</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
                    {working ? "En poste depuis " + fmtTs(d.arrival)
                      : done ? "Journée terminée · " + minutesToHHhMM(d.workedMinutes)
                      : "Pas encore pointé"}
                  </div>
                </button>
              );
            })}
          </div>
          {active.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--text-faint)", marginTop: 30 }}>
              Aucun salarié pour ce magasin. Ajoutez-en dans le mode Manager.
            </p>
          )}
        </>
      )}

      {selected && !selected.unlocked && (
        <div style={{ marginTop: 20 }}>
          <PinPad title={selected.displayName} subtitle="Entrez votre code à 4 chiffres"
            error={pinError} onSubmit={onPin} onCancel={() => setSelected(null)} />
        </div>
      )}

      {selected && selected.unlocked && (
        <ActionScreen emp={selected} day={days[selected.id]} onPunch={doPunch} onCancel={() => setSelected(null)} />
      )}
    </div>
  );
}

function ActionScreen({ emp, day, onPunch, onCancel }) {
  const actions = nextActions(day);
  return (
    <div style={{ maxWidth: 460, margin: "10px auto 0", textAlign: "center" }}>
      <h2 style={{ fontSize: 24, fontWeight: 600 }}>{emp.displayName}</h2>
      <DayStrip day={day} />
      {actions.length === 0 ? (
        <p style={{ color: "var(--green)", fontSize: 18, margin: "30px 0" }}>✓ Journée complète. Rien à pointer.</p>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 26 }}>
          {actions.map(([type, label, color]) => (
            <button key={type} onClick={() => onPunch(type, label)} style={{
              padding: "22px", borderRadius: 14, fontSize: 22, fontWeight: 600,
              background: `color-mix(in srgb, ${color} 18%, var(--ink-2))`,
              border: `1.5px solid ${color}`, color: "var(--text)",
            }}>{label}</button>
          ))}
        </div>
      )}
      <button onClick={onCancel} style={{ marginTop: 22, padding: "12px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button>
    </div>
  );
}

function DayStrip({ day }) {
  const items = [
    ["Arrivée", day?.arrival], ["Pause", day?.breakOut],
    ["Retour", day?.breakIn], ["Départ", day?.departure],
  ];
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
