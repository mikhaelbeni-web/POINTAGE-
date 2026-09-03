"use client";
import { useEffect, useState } from "react";
import { watchDay, getDaysRange, getSettings } from "../lib/store";
import { StatusPill } from "./ui";
import { minutesToHHhMM, isoWeekday, weekKey, classifyWeek } from "../lib/timeLogic";

const todayStr = () => new Date().toISOString().slice(0, 10);

function mondayOf(dateStr) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  const wd = isoWeekday(dateStr);
  d.setDate(d.getDate() - (wd - 1));
  return d.toISOString().slice(0, 10);
}

export default function Dashboard({ employees, onEditDay }) {
  const [days, setDays] = useState({});
  const [settings, setSettings] = useState(null);
  const [weekAlerts, setWeekAlerts] = useState([]);
  const today = todayStr();

  useEffect(() => { getSettings().then(setSettings); }, []);

  useEffect(() => {
    const unsub = watchDay(today, (list) => {
      const map = {};
      list.forEach((d) => (map[d.employeeId] = d));
      setDays(map);
    });
    return () => unsub();
  }, [today]);

  // Alertes hebdo (heures supp au seuil) — recalcul à l'ouverture
  useEffect(() => {
    if (!settings) return;
    (async () => {
      const start = mondayOf(today);
      const alerts = [];
      for (const e of employees.filter((x) => x.active !== false)) {
        const ds = await getDaysRange(e.id, start, today);
        const worked = ds.reduce((s, d) => s + (d.workedMinutes || 0), 0);
        const cls = classifyWeek(worked, e, settings);
        if (cls.overtimeAlert) {
          alerts.push({ emp: e.displayName, minutes: cls.overtimeMinutes, type: cls.overtimeType });
        }
      }
      setWeekAlerts(alerts);
    })();
  }, [settings, employees, today]);

  const active = employees.filter((e) => e.active !== false);
  const present = active.filter((e) => days[e.id]?.status === "present" || days[e.id]?.status === "incomplete");
  const worksToday = active.filter((e) => (e.workDays || []).includes(isoWeekday(today)));
  const absent = worksToday.filter((e) => !days[e.id] || days[e.id].status === "absent");
  const late = active.filter((e) => (days[e.id]?.lateMinutes || 0) > 0);
  const restViol = active.filter((e) => days[e.id]?.restViolation);

  if (!settings) return <p style={{ color: "var(--text-dim)" }}>Chargement…</p>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
        <Kpi label="En poste" value={present.length} color="var(--green)" />
        <Kpi label="Absents" value={absent.length} color={absent.length ? "var(--red)" : "var(--text-dim)"} />
        <Kpi label="Retards" value={late.length} color={late.length ? "var(--amber)" : "var(--text-dim)"} />
        <Kpi label="Prévus aujourd'hui" value={worksToday.length} color="var(--text-dim)" />
      </div>

      {(restViol.length > 0 || weekAlerts.length > 0) && (
        <div style={{ marginBottom: 20, display: "grid", gap: 8 }}>
          {restViol.map((e) => (
            <Alert key={e.id} color="var(--red)">
              Repos minimum non respecté — {e.displayName} ({minutesToHHhMM(days[e.id].restMinutes)} depuis la veille, minimum {minutesToHHhMM(settings.restMinMinutes)})
            </Alert>
          ))}
          {weekAlerts.map((a, i) => (
            <Alert key={i} color="var(--amber)">
              Seuil heures {a.type === "complementary" ? "complémentaires" : "supplémentaires"} atteint — {a.emp} : {minutesToHHhMM(a.minutes)} cette semaine
            </Alert>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Journée du {new Date(today).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
              {["Salarié", "Statut", "Arrivée", "Pause", "Retour", "Départ", "Travaillé", "Retard", ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((e) => {
              const d = days[e.id];
              const worksToday = (e.workDays || []).includes(isoWeekday(today));
              const status = d?.status || (worksToday ? "absent" : "off");
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--ink-3)" }}>
                  <td style={td}><strong>{e.displayName}</strong></td>
                  <td style={td}><StatusPill status={status} /></td>
                  <td style={td}>{fmt(d?.arrival)}</td>
                  <td style={td}>{fmt(d?.breakOut)}</td>
                  <td style={td}>{fmt(d?.breakIn)}</td>
                  <td style={td}>{fmt(d?.departure)}</td>
                  <td style={td}>{d?.workedMinutes ? minutesToHHhMM(d.workedMinutes) : "—"}</td>
                  <td style={{ ...td, color: d?.lateMinutes ? "var(--amber)" : "var(--text-faint)" }}>
                    {d?.lateMinutes ? minutesToHHhMM(d.lateMinutes) : "—"}
                  </td>
                  <td style={td}>
                    <button onClick={() => onEditDay(e, today)} style={{
                      fontSize: 13, color: "var(--brass)", padding: "4px 8px",
                    }}>Corriger</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
const td = { padding: "9px 10px" };
function fmt(ts) {
  if (!ts) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
