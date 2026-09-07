"use client";
import { useEffect, useState } from "react";
import { getDaysRange, getLeaves, getSettings } from "../lib/store";
import { buildMonthlyRecap, monthBounds } from "../lib/recap";
import { minutesToHHhMM } from "../lib/timeLogic";
import { inp, btnPrimary, btnGhost } from "./Employees";
import { leaveLabel } from "./ui";

const now = new Date();

export default function Recap({ employees, sites = [], allowedSiteIds = null }) {
  const [empId, setEmpId] = useState("all");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [recaps, setRecaps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const scoped = employees.filter((e) => !allowedSiteIds || allowedSiteIds.includes(e.siteId));

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const settings = await getSettings();
      const { start, end } = monthBounds(year, month);
      const targets = empId === "all"
        ? scoped.filter((e) => e.active !== false)
        : scoped.filter((e) => e.id === empId);
      const out = [];
      for (const emp of targets) {
        const days = await getDaysRange(emp.id, start, end);
        const leaves = await getLeaves(emp.id, start, end);
        out.push({ emp, ...buildMonthlyRecap(emp, settings, days, leaves, year, month) });
      }
      setRecaps(out);
    } catch (e) {
      setError("Erreur lors de la génération : " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setRecaps(null); }, [empId, year, month]);

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Salarié<br />
          <select style={{ ...inp, marginTop: 5 }} value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="all">Tous les salariés actifs</option>
            {scoped.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Mois<br />
          <select style={{ ...inp, marginTop: 5 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"].map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Année<br />
          <input style={{ ...inp, marginTop: 5, width: 90 }} inputMode="numeric" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </label>
        <button onClick={generate} style={btnGhost}>{loading ? "…" : "Générer"}</button>
        {recaps && <button onClick={() => window.print()} style={btnPrimary}>Imprimer / PDF</button>}
      </div>

      {error && (
        <div className="no-print" style={{ padding: "11px 14px", borderRadius: 10, marginBottom: 16,
          background: "color-mix(in srgb, var(--red) 12%, var(--ink-2))", border: "1px solid var(--red)", color: "var(--text)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {recaps && recaps.map(({ emp, weeks, totals, cadre }) => (
        cadre
          ? <CadreSheet key={emp.id} emp={emp} weeks={weeks} totals={totals} year={year} month={month} />
          : <RecapSheet key={emp.id} emp={emp} weeks={weeks} totals={totals} year={year} month={month} />
      ))}
      {recaps && recaps.length === 0 && <p style={{ color: "var(--text-dim)" }}>Aucun salarié sélectionné.</p>}
    </div>
  );
}

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function RecapSheet({ emp, weeks, totals, year, month }) {
  return (
    <div className="print-sheet" style={{
      background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 14,
      padding: 22, marginBottom: 24,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{emp.displayName}</h2>
        <div style={{ color: "var(--text-dim)", fontSize: 15 }}>{MONTHS[month - 1]} {year}</div>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 16 }}>
        {emp.contractType === "full" ? "Temps plein" : "Temps partiel"} · contrat {minutesToHHhMM(emp.weeklyContractMinutes)}/semaine
      </div>

      {weeks.map((w) => (
        <div key={w.weekKey} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brass)", marginBottom: 6 }}>
            Semaine {w.weekKey.split("-W")[1]}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                {["Date", "Arrivée", "Départ", "Pause", "Travaillé", "Retard", "Statut"].map((h) => (
                  <th key={h} style={cellH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.date}>
                  <td style={cell}>{new Date(r.date).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
                  <td style={cell}>{fmt(r.arrival)}</td>
                  <td style={cell}>{fmt(r.departure)}</td>
                  <td style={cell}>{r.breakMinutes ? minutesToHHhMM(r.breakMinutes) : "—"}</td>
                  <td style={cell}>{r.worked ? minutesToHHhMM(r.worked) : "—"}</td>
                  <td style={{ ...cell, color: r.late ? "var(--amber)" : "inherit" }}>{r.late ? minutesToHHhMM(r.late) : "—"}</td>
                  <td style={cell}>{statusText(r)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td style={cell} colSpan={4}>Total semaine</td>
                <td style={cell}>{minutesToHHhMM(w.workedMinutes)}</td>
                <td style={cell}></td>
                <td style={cell}>
                  {w.overtimeMinutes > 0
                    ? `+${minutesToHHhMM(w.overtimeMinutes)} ${w.overtimeType === "complementary" ? "compl." : "supp."}`
                    : w.deficitMinutes > 0 ? `−${minutesToHHhMM(w.deficitMinutes)}` : "à l'équilibre"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: 8, padding: "12px 0", borderTop: "2px solid var(--line)", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
        <Total label="Total travaillé" value={minutesToHHhMM(totals.workedMinutes)} />
        <Total label={totals.overtimeType === "complementary" ? "H. complémentaires" : "H. supplémentaires"} value={minutesToHHhMM(totals.overtimeMinutes)} />
        <Total label="Retards cumulés" value={minutesToHHhMM(totals.lateMinutes)} />
        <Total label="Absences" value={String(totals.absences)} />
      </div>

      <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", gap: 40 }}>
        <Sign label="Signature du salarié" />
        <Sign label="Signature du manager" />
      </div>
    </div>
  );
}

function Total({ label, value }) {
  return <div><div style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div></div>;
}
function Sign({ label }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 40 }}>{label}</div>
      <div style={{ borderTop: "1px solid var(--text-faint)" }} />
    </div>
  );
}
function statusText(r) {
  if (r.leaveType) return leaveLabel(r.leaveType);
  return { present: "Présent", incomplete: "Incomplet", absent: "Absent", off: "Repos" }[r.status] || "";
}
function fmt(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
const cellH = { padding: "5px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500 };
const cell = { padding: "5px 8px", borderBottom: "1px solid var(--ink-3)" };

function CadreSheet({ emp, weeks, totals, year, month }) {
  const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const half = (v) => v === "present" ? "Présent" : v ? leaveLabel(v) : "—";
  return (
    <div className="print-sheet" style={{ background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 14, padding: 22, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{emp.displayName}</h2>
        <div style={{ color: "var(--text-dim)", fontSize: 15 }}>{MONTHS[month - 1]} {year}</div>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 16 }}>Cadre · relevé par demi-journées</div>

      {weeks.map((w) => (
        <div key={w.weekKey} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brass)", marginBottom: 6 }}>Semaine {w.weekKey.split("-W")[1]}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                {["Date", "Matin", "Après-midi", "Jour"].map((h) => <th key={h} style={cellH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.date}>
                  <td style={cell}>{new Date(r.date).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
                  <td style={cell}>{half(r.morning)}</td>
                  <td style={cell}>{half(r.afternoon)}</td>
                  <td style={cell}>{r.fraction === 1 ? "1" : r.fraction === 0.5 ? "½" : "0"}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td style={cell} colSpan={3}>Jours présents (semaine)</td>
                <td style={cell}>{w.daysPresent}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: 8, padding: "12px 0", borderTop: "2px solid var(--line)", display: "flex", gap: 24, fontSize: 14 }}>
        <div><div style={{ fontSize: 12, color: "var(--text-dim)" }}>Jours présents (mois)</div><div style={{ fontSize: 18, fontWeight: 700 }}>{totals.daysPresent}</div></div>
        <div><div style={{ fontSize: 12, color: "var(--text-dim)" }}>Demi-journées absentes</div><div style={{ fontSize: 18, fontWeight: 700 }}>{totals.absences}</div></div>
      </div>

      <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", gap: 40 }}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 40 }}>Signature du salarié</div><div style={{ borderTop: "1px solid var(--text-faint)" }} /></div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 40 }}>Signature du manager</div><div style={{ borderTop: "1px solid var(--text-faint)" }} /></div>
      </div>
    </div>
  );
}
