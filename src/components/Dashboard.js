"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as store from "../lib/store";
import { realApi } from "../lib/planStore";
import { StatusPill } from "./ui";
import { useScope, ScopeFilters } from "./PlanUi";
import PauseDetail, { Pill, signed } from "./PauseDetail";
import { computeBalance, fmtMin, periodState, hasPlanning, planSettings } from "../lib/planLogic";
import { minutesToHHhMM, isoWeekday, weekKey, classifyWeek } from "../lib/timeLogic";

// Toujours raisonner en date LOCALE (jamais toISOString, qui bascule en UTC
// et décale le jour en soirée en France).
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayStr = () => toLocalDateStr(new Date());

function mondayOf(dateStr) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  const wd = isoWeekday(dateStr);
  d.setDate(d.getDate() - (wd - 1));
  return toLocalDateStr(d);
}

function addDays(dateStr, n) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

const planText = (p) => {
  if (!p || !hasPlanning(p)) return null;
  const f = (x, l) => (periodState(x) === "worked" ? `${l} ${x.start}–${x.end}` : periodState(x) === "off" ? `${l} –` : `${l} ?`);
  return `${f(p.morning, "M")} · ${f(p.evening, "S")}`;
};

// `source` (fonctions du store) et `planApi` (planning/pauses) sont injectables : la page /demo les remplace par des données fictives.
export default function Dashboard({ employees, sites = [], allowedSiteIds = null, canEdit = true, onEditDay, source = store, planApi = realApi, managerName = "", initialDate = null }) {
  const { watchDay, getDaysRange, getSettings, healDirtyDays } = source;
  const [days, setDays] = useState({});
  const [settings, setSettings] = useState(null);
  const [weekAlerts, setWeekAlerts] = useState([]);
  const [viewDate, setViewDate] = useState(initialDate || todayStr());
  const [sit, setSit] = useState(null);
  const [balances, setBalances] = useState({});
  const [detail, setDetail] = useState(null);
  const scope = useScope(employees, sites, allowedSiteIds);
  const today = todayStr();
  const isToday = viewDate === today;
  const pset = useMemo(() => planSettings(settings || {}), [settings]);

  useEffect(() => { getSettings().then(setSettings); }, []);

  useEffect(() => {
    const unsub = watchDay(viewDate, (list) => {
      healDirtyDays(list); // relance les recalculs restés en suspens
      const map = {};
      list.forEach((d) => (map[d.employeeId] = d));
      setDays(map);
    });
    return () => unsub();
  }, [viewDate]);

  // Alertes hebdo (heures supp au seuil) — recalcul à l'ouverture
  useEffect(() => {
    if (!settings) return;
    (async () => {
      const start = mondayOf(today);
      const alerts = [];
      const pool = scope.staff;
      for (const e of pool) {
        const ds = await getDaysRange(e.id, start, today);
        const worked = ds.reduce((s, d) => s + (d.workedMinutes || 0), 0);
        const cls = classifyWeek(worked, e, settings);
        if (cls.overtimeAlert) {
          alerts.push({ emp: e.displayName, minutes: cls.overtimeMinutes, type: cls.overtimeType });
        }
      }
      setWeekAlerts(alerts);
    })();
  }, [settings, scope.staff, today]);

  // Planning / pauses du jour : lecture séparée, jamais bloquante pour l'affichage des pointages.
  const activeIds = scope.staff.map((e) => e.id).join(",");
  const loadPlan = useCallback(async () => {
    const [d, b] = await Promise.all([planApi.getDaySituations(viewDate), planApi.getBalances(scope.staff.map((e) => e.id))]);
    setSit(d); setBalances(b);
  }, [planApi, viewDate, activeIds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let off = false;
    (async () => {
      try { await planApi.recomputeStale(scope.staff.map((e) => e.id), viewDate, managerName); } catch (_) { /* on affiche quand même */ }
      if (!off) { try { await loadPlan(); } catch (_) { /* planning indisponible : le reste du tableau reste affiché */ } }
    })();
    return () => { off = true; };
  }, [planApi, viewDate, managerName, loadPlan]); // eslint-disable-line react-hooks/exhaustive-deps
  const by = (arr) => Object.fromEntries((arr || []).map((x) => [x.employeeId, x]));
  const P = useMemo(() => by(sit?.plans), [sit]);
  const L = useMemo(() => by(sit?.ledger), [sit]);
  const C = useMemo(() => by(sit?.declarations), [sit]);

  const active = scope.staff;
  const present = active.filter((e) => days[e.id]?.status === "present" || days[e.id]?.status === "incomplete");
  const absent = active.filter((e) => !days[e.id] || days[e.id].status === "absent");
  const late = active.filter((e) => (days[e.id]?.lateMinutes || 0) > 0);
  const restViol = active.filter((e) => days[e.id]?.restViolation);
  const spanViol = active.filter((e) => days[e.id]?.spanViolation);
  const toFix = active.filter((e) => ["to-regularise", "declaration-missing"].includes(L[e.id]?.state));
  const gaps = active.filter((e) => L[e.id] && (L[e.id].arrivalFlag === "late" || L[e.id].departureFlag === "over" || L[e.id].departureFlag === "early"));
  const unplanned = active.filter((e) => !(P[e.id] && hasPlanning(P[e.id])) && days[e.id]);

  if (!settings) return <p style={{ color: "var(--text-dim)" }}>Chargement…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setViewDate(addDays(viewDate, -1))} style={navBtn} aria-label="Jour précédent">←</button>
          <input type="date" style={{ ...tdInp, minWidth: 160 }} value={viewDate} max={today} onChange={(e) => setViewDate(e.target.value)} />
          <button onClick={() => setViewDate(addDays(viewDate, 1))} disabled={isToday} style={{ ...navBtn, opacity: isToday ? 0.4 : 1 }} aria-label="Jour suivant">→</button>
          {!isToday && (
            <button onClick={() => setViewDate(today)} style={{ ...navBtn, color: "var(--brass)" }}>Aujourd'hui</button>
          )}
        </div>
      </div>
      <ScopeFilters scope={scope} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        <Kpi label="En poste" value={present.length} color="var(--green)" />
        <Kpi label="Absents" value={absent.length} color={absent.length ? "var(--red)" : "var(--text-dim)"} />
        <Kpi label="Retards" value={late.length} color={late.length ? "var(--amber)" : "var(--text-dim)"} />
        <Kpi label="Pauses à régulariser" value={toFix.length} color={toFix.length ? "var(--amber)" : "var(--text-dim)"} />
        <Kpi label="Effectif actif" value={active.length} color="var(--text-dim)" />
      </div>

      {(restViol.length > 0 || spanViol.length > 0 || weekAlerts.length > 0 || toFix.length > 0 || gaps.length > 0) && (
        <div style={{ marginBottom: 20, display: "grid", gap: 8 }}>
          {restViol.map((e) => (
            <Alert key={e.id} color="var(--red)">
              Repos minimum non respecté — {e.displayName} ({minutesToHHhMM(days[e.id].restMinutes)} depuis la veille, minimum {minutesToHHhMM(settings.restMinMinutes)})
            </Alert>
          ))}
          {spanViol.map((e) => (
            <Alert key={"sp" + e.id} color="var(--red)">
              Amplitude maximale dépassée — {e.displayName} ({minutesToHHhMM(days[e.id].spanMinutes)} sur place, maximum {minutesToHHhMM(settings.maxSpanMinutes)})
            </Alert>
          ))}
          {toFix.map((e) => (
            <Alert key={"pz" + e.id} color="var(--amber)">
              Déclaration de pause à régulariser — {e.displayName}{" "}
              <button style={{ color: "var(--brass)", textDecoration: "underline" }} onClick={() => setDetail(e)}>ouvrir le compteur</button>
            </Alert>
          ))}
          {gaps.map((e) => {
            const l = L[e.id];
            return (
              <Alert key={"gp" + e.id} color="var(--amber)">
                Écart au planning — {e.displayName} :{" "}
                {[l.arrivalFlag === "late" && `retard de ${l.arrivalDeltaMinutes} min`, l.departureFlag === "early" && `départ ${Math.abs(l.departureDeltaMinutes)} min avant l'heure prévue`, l.departureFlag === "over" && `départ ${l.departureDeltaMinutes} min après l'heure prévue`].filter(Boolean).join(", ")}
              </Alert>
            );
          })}
          {weekAlerts.map((a, i) => (
            <Alert key={i} color="var(--amber)">
              Seuil heures {a.type === "complementary" ? "complémentaires" : "supplémentaires"} atteint — {a.emp} : {minutesToHHhMM(a.minutes)} cette semaine
            </Alert>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Journée du {new Date(viewDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}{isToday ? " (aujourd'hui)" : ""}</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
              {["Salarié", "Statut", "Planning", "Arrivée", "Pause", "Retour", "Départ", "Durée pause", "Pause attendue", "Pause déclarée", "Travaillé", "Solde pauses", ""].map((h, i, all) => (
                <th key={h + i} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500, ...(i === all.length - 1 ? stickyEnd : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={13} style={{ ...td, color: "var(--text-dim)" }}>Aucun salarié pour ces filtres.</td></tr>}
            {active.map((e) => {
              const d = days[e.id];
              const status = d?.status || "absent";
              const l = L[e.id], c = C[e.id], plan = P[e.id];
              const bal = computeBalance(balances[e.id] || [], pset);
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--ink-3)" }}>
                  <td style={td}><strong>{e.displayName}</strong>{scope.visibleSites.length > 1 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{sites.find((x) => x.id === e.siteId)?.name}</div>}</td>
                  <td style={td}><StatusPill status={status} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: planText(plan) ? "var(--text)" : "var(--text-faint)" }}>{planText(plan) || (d ? "Sans planning" : "—")}</td>
                  <td style={td}>{fmt(d?.arrival)}</td>
                  <td style={td}>{fmt(d?.breakOut)}</td>
                  <td style={td}>{fmt(d?.breakIn)}</td>
                  <td style={td}>{fmt(d?.departure)}</td>
                  <td style={{ ...td, color: "var(--amber)" }}>{d?.breakMinutes ? minutesToHHhMM(d.breakMinutes) : "—"}</td>
                  <td style={td}>{l && planText(plan) ? fmtMin(l.expectedBreakMinutes) : "—"}</td>
                  <td style={td}>
                    {c ? (l?.state === "to-regularise" || l?.state === "declaration-missing" ? <Pill s={l.state} /> : <>{l?.declaredBreakMinutes != null ? fmtMin(l.declaredBreakMinutes) : "—"}{l?.counted && l.deltaBreakMinutes !== 0 && <span style={{ marginLeft: 6, color: l.deltaBreakMinutes < 0 ? "var(--red)" : l.deltaBreakMinutes > 0 ? "var(--green)" : "var(--text-faint)", fontSize: 12 }}>{signed(l.deltaBreakMinutes)}</span>}</>) : l && ["to-regularise", "declaration-missing"].includes(l.state) ? <Pill s={l.state} /> : "—"}
                  </td>
                  <td style={td}>{d?.workedMinutes ? minutesToHHhMM(d.workedMinutes) : "—"}</td>
                  <td style={td}>
                    <button onClick={() => setDetail(e)} title="Ouvrir le compteur de pauses" aria-label={`Compteur de pauses de ${e.displayName}`} style={{
                      color: bal.missingTotal > 0 ? "var(--red)" : bal.extraTotal > 0 ? "var(--green)" : "var(--text)", fontSize: 13, fontWeight: 600,
                      padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--ink-2)", whiteSpace: "nowrap",
                    }}>
                      {bal.daysCounted ? (bal.missingTotal === 0 && bal.extraTotal === 0 ? "0 min" : <>{bal.missingTotal > 0 && `−${bal.missingTotal}`}{bal.missingTotal > 0 && bal.extraTotal > 0 && " / "}{bal.extraTotal > 0 && `+${bal.extraTotal}`} min</>) : "Détail"} ›
                    </button>
                  </td>
                  <td style={{ ...td, ...stickyEnd }}>
                    {canEdit ? (
                      <button onClick={() => onEditDay && onEditDay(e, viewDate)} style={{
                        fontSize: 13, color: "var(--brass)", padding: "4px 8px",
                      }}>Corriger</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
        Planning, pauses attendues et déclarées viennent du planning du personnel. Sans planning, seules les heures réelles sont conservées : aucun écart n'est calculé.
        Pour voir le détail du compteur de pauses d'un salarié, son historique et régulariser : cliquez sur le bouton de la colonne « Solde pauses » (à droite du tableau, faites défiler si besoin).
      </p>
      {detail && (
        <PauseDetail emp={detail} api={planApi} settings={pset} canEdit={canEdit} managerName={managerName} date={viewDate}
          onClose={() => setDetail(null)} onChanged={loadPlan} />
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ padding: "16px 18px", background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 13 }}>
      <div style={{ fontSize: 30, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Alert({ color, children }) {
  return (
    <div style={{
      padding: "11px 14px", borderRadius: 10, fontSize: 14,
      background: `color-mix(in srgb, ${color} 12%, var(--ink-2))`,
      border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, color: "var(--text)",
    }}>⚠ {children}</div>
  );
}
// Colonne « Corriger » toujours visible, même quand le tableau défile horizontalement.
const stickyEnd = { position: "sticky", right: 0, background: "var(--ink)", boxShadow: "-8px 0 8px -8px rgba(0,0,0,.6)" };
const td = { padding: "9px 10px", whiteSpace: "nowrap" };
const tdInp = { padding: "9px 12px", borderRadius: 9, background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 14 };
const navBtn = { padding: "9px 14px", borderRadius: 9, background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 15, fontWeight: 600 };
function fmt(ts) {
  if (!ts) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
