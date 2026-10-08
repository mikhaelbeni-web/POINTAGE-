"use client";
import { useEffect, useRef, useState } from "react";
import { badgePunch, watchDaySite, healDirtyDays, findByMatricule, setCadreHalfDay } from "../lib/store";
import { minutesToHHhMM } from "../lib/timeLogic";
import { LEAVE_TYPES, leaveLabel } from "./ui";

// Date LOCALE (jamais toISOString qui bascule en UTC) : sinon en soirée en
// France, le badgeage risque de s'enregistrer sur le mauvais jour.
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const todayStr = () => toLocalDateStr(new Date());
const TABLET_SITE_KEY = "pointage_tablet_site";
const TABLET_UNLOCK_KEY = "pointage_tablet_unlock";

// Raccourcis clavier de l'écran d'action (clavier physique / pavé numérique).
const SHORTCUT = { arrival: "1", breakOut: "2", breakIn: "3", departure: "4" };
// Sans action pendant ce délai, l'écran employé se referme (évite qu'une session
// restée ouverte reçoive les chiffres de la personne suivante).
const IDLE_RESET_MS = 12000;

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
  // Départ déjà badgé = journée terminée, avec ou sans pause : plus rien à proposer
  // ce jour-là. Le lendemain, la badgeuse repart d'une journée vide (Arrivée).
  if (has("departure")) return [];
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
  const [today, setToday] = useState(todayStr());
  // Pointages déjà envoyés mais pas encore relus depuis la base : permet d'afficher
  // l'état à jour tout de suite, sans attendre les allers-retours réseau.
  const [pending, setPending] = useState({});
  const toastTimer = useRef(null);

  useEffect(() => {
    setTabletSite(localStorage.getItem(TABLET_SITE_KEY));
    setUnlockedCode(localStorage.getItem(TABLET_UNLOCK_KEY));
    setReady(true);
  }, []);

  // Le jour suit l'horloge : une badgeuse allumée toute la nuit passe seule au lendemain
  // (avant, elle restait sur la journée de la veille jusqu'au prochain rechargement).
  useEffect(() => {
    const t = setInterval(() => setToday(todayStr()), 30000);
    return () => clearInterval(t);
  }, []);

  // Écoute limitée aux jours de CE magasin (les pointages faits ici sont toujours
  // enregistrés sous le magasin de la tablette). Repli automatique géré par store.js.
  useEffect(() => {
    setDays({}); setPending({});
    if (!tabletSite) return;
    const unsub = watchDaySite(today, tabletSite, (list) => {
      healDirtyDays(list); // relance les recalculs restés en suspens
      const map = {}; list.forEach((d) => (map[d.employeeId] = d)); setDays(map);
      // Les pointages en attente que la base confirme sont retirés.
      setPending((prev) => {
        const next = {};
        for (const [id, p] of Object.entries(prev)) {
          const rest = {};
          for (const [k, v] of Object.entries(p)) if (!map[id]?.[k]) rest[k] = v;
          if (Object.keys(rest).length) next[id] = rest;
        }
        return next;
      });
    });
    return () => unsub();
  }, [today, tabletSite]);

  // Chiffres oubliés sur le pavé : effacés après 15 s d'inactivité.
  useEffect(() => {
    if (!matricule) return;
    const t = setTimeout(() => setMatricule(""), 15000);
    return () => clearTimeout(t);
  }, [matricule]);

  // Écran employé : se referme après IDLE_RESET_MS sans touche ni toucher.
  useEffect(() => {
    if (!current) return;
    let t = setTimeout(() => setCurrent(null), IDLE_RESET_MS);
    const reset = () => { clearTimeout(t); t = setTimeout(() => setCurrent(null), IDLE_RESET_MS); };
    window.addEventListener("keydown", reset);
    window.addEventListener("pointerdown", reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("pointerdown", reset);
    };
  }, [current]);

  function showToast(text, error = false) {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 3500);
  }

  function addPending(empId, key, value) {
    setPending((p) => ({ ...p, [empId]: { ...(p[empId] || {}), [key]: value } }));
  }
  function dropPending(empId, key) {
    setPending((p) => {
      if (!p[empId]) return p;
      const rest = { ...p[empId] }; delete rest[key];
      const n = { ...p }; if (Object.keys(rest).length) n[empId] = rest; else delete n[empId];
      return n;
    });
  }
  // Jour de l'employé = données de la base + pointages en attente de confirmation.
  function viewDay(empId) {
    const base = days[empId];
    const p = pending[empId];
    if (!p) return base;
    const merged = { ...(base || {}) };
    for (const [k, v] of Object.entries(p)) if (!merged[k]) merged[k] = v;
    return merged;
  }

  async function identify(val) {
    setError(null);
    const m = String(val ?? matricule).trim();
    if (!m) return;
    // Recherche locale (la liste des salariés est synchronisée en direct) : instantané.
    // La requête réseau ne sert de secours que si la liste n'est pas encore chargée.
    let emp = employees.find((e) => e.active !== false && String(e.matricule ?? "").trim() === m) || null;
    if (!emp && employees.length === 0) {
      try { emp = await findByMatricule(m); }
      catch { setError("Réseau indisponible"); setMatricule(""); return; }
    }
    if (!emp) { setError("Matricule inconnu"); setMatricule(""); return; }
    setCurrent(emp); setMatricule("");
  }

  // Confirmation immédiate : l'heure du pointage est celle du clic ; l'enregistrement
  // (badgePunch : une seule écriture groupée) se termine en arrière-plan.
  function doPunch(type, label) {
    const emp = current;
    if (!emp) return;
    const at = new Date();
    addPending(emp.id, type, at);
    showToast(`${emp.displayName} — ${label} ${at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
    setCurrent(null);
    badgePunch(emp, toLocalDateStr(at), type, at, tabletSite).catch((e) => {
      dropPending(emp.id, type);
      showToast(`${emp.displayName} : pointage « ${label} » NON enregistré (${e.message}). Recommencez.`, true);
    });
  }

  function doHalfDay(half, value, label) {
    const emp = current;
    if (!emp) return;
    addPending(emp.id, half, value);
    showToast(`${emp.displayName} — ${label} enregistré`);
    setCurrent(null);
    setCadreHalfDay(emp.id, todayStr(), half, value, "badge", null, tabletSite).catch((e) => {
      dropPending(emp.id, half);
      showToast(`${emp.displayName} : déclaration NON enregistrée (${e.message}). Recommencez.`, true);
    });
  }

  if (!ready) return null;

  // Écran unique : entrer le code. Le code identifie le magasin.
  // AUCUN nom de magasin n'est affiché. Un appareil sans code valide ne peut rien faire.
  const activeSite = tabletSite ? sites.find((s) => s.id === tabletSite) : null;
  const isSetUp = activeSite && (!activeSite.code || unlockedCode === activeSite.code);

  function submitSetupCode() {
    const entered = codeInput.trim();
    if (!entered) return;
    const match = sites.find((s) => (s.code || "") === entered && entered !== "");
    if (!match) { setCodeError("Code incorrect"); return; }
    localStorage.setItem(TABLET_SITE_KEY, match.id);
    localStorage.setItem(TABLET_UNLOCK_KEY, match.code);
    setTabletSite(match.id);
    setUnlockedCode(match.code);
    setCodeError(null); setCodeInput("");
  }

  if (!isSetUp) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Déverrouiller la tablette</h1>
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginBottom: 22 }}>
            Code réservé au responsable. À saisir une seule fois sur cette tablette.
          </p>
          <input style={{ width: "100%", padding: "14px", borderRadius: 10, fontSize: 18, textAlign: "center",
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", letterSpacing: 2 }}
            value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitSetupCode()} placeholder="Code" autoFocus />
          {codeError && <p style={{ color: "var(--red)", fontSize: 14, marginTop: 12 }}>{codeError}</p>}
          <button onClick={submitSetupCode} style={{ marginTop: 16, width: "100%", padding: "14px", borderRadius: 10,
            fontSize: 16, fontWeight: 600, background: "var(--brass)", color: "#1a1204", border: "none" }}>Déverrouiller</button>
        </div>
      </div>
    );
  }

  const currentSite = activeSite;
  const siteName = currentSite?.name || "";
  const isUnlocked = true; // déverrouillage géré par l'écran code unique ci-dessus

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "24px 20px 40px" }}>
      <div style={{ padding: "4px 0 22px" }}><LiveClock /></div>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink-3)", border: `1px solid ${toast.error ? "var(--red)" : "var(--green)"}`, color: "var(--text)",
          padding: "12px 22px", borderRadius: 12, zIndex: 50, fontSize: 16, fontWeight: 500, maxWidth: "90vw",
          boxShadow: "0 8px 30px rgba(0,0,0,.4)" }}>{toast.error ? "⚠" : "✓"} {toast.text}</div>
      )}

      {/* 3. Saisie matricule (aucun nom affiché) */}
      {!current && (
        <MatriculePad value={matricule} setValue={setMatricule} onEnter={identify} onType={() => setError(null)} error={error} />
      )}

      {/* 4a. Écran employé (horaire) */}
      {current && current.category !== "cadre" && (
        <ActionScreen emp={current} day={viewDay(current.id)} onPunch={doPunch} onCancel={() => setCurrent(null)} />
      )}

      {/* 4b. Écran cadre (demi-journées) */}
      {current && current.category === "cadre" && (
        <CadreScreen emp={current} day={viewDay(current.id)} onHalfDay={doHalfDay} onCancel={() => setCurrent(null)} />
      )}
    </div>
  );
}

function MatriculePad({ value, setValue, onEnter, onType, error }) {
  // Les refs gardent la valeur la plus récente même si des touches arrivent très vite
  // (lecteur de badges USB, qui "tape" le matricule puis Entrée en quelques ms).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const onTypeRef = useRef(onType);
  onTypeRef.current = onType;
  const update = (v) => { valueRef.current = v; setValue(v); };
  // Une frappe efface l'ancien message d'erreur (« Matricule inconnu »).
  const press = (d) => { onTypeRef.current && onTypeRef.current(); update((valueRef.current + d).slice(0, 6)); };
  const back = () => update(valueRef.current.slice(0, -1));
  const submit = () => onEnterRef.current(valueRef.current);

  // Clavier physique : chiffres, Retour arrière, Échap (tout effacer), Entrée (valider).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); if (!e.repeat) press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); back(); }
      else if (e.key === "Escape") { e.preventDefault(); update(""); }
      else if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) submit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <button onClick={submit} style={{ ...padBtn, background: "var(--brass)", color: "#1a1204", fontWeight: 700 }}>OK</button>
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
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const cb = useRef({});
  cb.current = { onPunch, onCancel };
  const mountedAt = useRef(Date.now());

  // Clavier : 1 Arrivée · 2 Départ pause · 3 Retour pause · 4 Départ.
  // Entrée valide l'action quand il n'y en a qu'une. Échap / Retour arrière : annuler.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const list = actionsRef.current;
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); cb.current.onCancel(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        // Délai de garde : un lecteur de badges qui enverrait deux fois Entrée ne doit pas pointer.
        if (list.length === 1 && Date.now() - mountedAt.current > 700) cb.current.onPunch(list[0][0], list[0][1]);
        return;
      }
      const hit = list.find(([type]) => SHORTCUT[type] === e.key);
      if (hit) { e.preventDefault(); cb.current.onPunch(hit[0], hit[1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
              border: `1.5px solid ${color}`, color: "var(--text)" }}>
              {label}
              <span style={{ marginLeft: 12, fontSize: 14, fontWeight: 500, color: "var(--text-faint)" }}>[{SHORTCUT[type]}]</span>
            </button>
          ))}
        </div>
      )}
      {actions.length === 1 && (
        <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 14 }}>Entrée pour valider</p>
      )}
      <button onClick={onCancel} style={{ marginTop: 22, padding: "12px 24px", color: "var(--text-dim)", fontSize: 15 }}>← Retour</button>
    </div>
  );
}

function CadreScreen({ emp, day, onHalfDay, onCancel }) {
  const [pick, setPick] = useState(null); // {half, label}
  const mDone = day?.morning, aDone = day?.afternoon;

  // Clavier : 1 Matin · 2 Après-midi ; ensuite 1 ou Entrée = Présent. Échap : retour.
  // (Les motifs d'absence restent au toucher.)
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const cb = useRef({});
  cb.current = { onHalfDay, onCancel };
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = pickRef.current;
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        if (p) setPick(null); else cb.current.onCancel();
        return;
      }
      if (!p) {
        if (e.key === "1") { e.preventDefault(); setPick({ half: "morning", label: "Matin" }); }
        else if (e.key === "2") { e.preventDefault(); setPick({ half: "afternoon", label: "Après-midi" }); }
      } else if (e.key === "1" || e.key === "Enter") {
        e.preventDefault();
        cb.current.onHalfDay(p.half, "present", `${p.label} présent`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (pick) {
    return (
      <div style={{ maxWidth: 460, margin: "6px auto 0", textAlign: "center", width: "100%" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}>{emp.displayName}</h2>
        <p style={{ color: "var(--text-dim)", margin: "8px 0 20px" }}>{pick.label} — présent ou motif ?</p>
        <div style={{ display: "grid", gap: 12 }}>
          <button onClick={() => onHalfDay(pick.half, "present", `${pick.label} présent`)} style={{
            padding: "20px", borderRadius: 14, fontSize: 20, fontWeight: 600,
            background: "color-mix(in srgb, var(--green) 18%, var(--ink-2))", border: "1.5px solid var(--green)", color: "var(--text)" }}>
            Présent <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-faint)" }}>[1]</span>
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
        <HalfBtn label="Matin [1]" state={mDone} onClick={() => setPick({ half: "morning", label: "Matin" })} />
        <HalfBtn label="Après-midi [2]" state={aDone} onClick={() => setPick({ half: "afternoon", label: "Après-midi" })} />
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
