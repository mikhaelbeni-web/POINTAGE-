"use client";
import { useCallback, useEffect, useState } from "react";
import { classifyWeek, minutesToHHhMM } from "../lib/timeLogic";
import { computeBalance } from "../lib/planLogic";
import { groupBySite } from "./PlanUi";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const hhmm = (ts) => {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

/**
 * Vue « Semaine » du tableau de bord : une ligne par salarié, les heures de chaque jour, le total de la semaine
 * et le solde de pauses. Un clic sur un jour ouvre la fenêtre « Corriger » existante (onEditDay) : mêmes
 * écritures, mêmes recalculs ; la ligne se met à jour dès que la correction est enregistrée (refreshKey).
 */
export default function WeekView({ staff, sites, dates, source, settings, pset, balances, canEdit, onEditDay, onOpenBalance, refreshKey }) {
  const [byEmp, setByEmp] = useState(null);
  const from = dates[0], to = dates[6];

  const load = useCallback(async () => {
    const out = {};
    for (let i = 0; i < staff.length; i += 8) {
      await Promise.all(staff.slice(i, i + 8).map(async (e) => {
        const ds = await source.getDaysRange(e.id, from, to);
        out[e.id] = Object.fromEntries(ds.map((d) => [d.date, d]));
      }));
    }
    setByEmp(out);
  }, [staff, source, from, to]);
  useEffect(() => { setByEmp(null); load().catch((err) => { console.error("WeekView", err); setByEmp({}); }); }, [load, refreshKey]);

  const groups = groupBySite(staff, sites);
  const th = { padding: "8px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500, textAlign: "left", whiteSpace: "nowrap" };

  return (
    <div style={{ overflowX: "auto" }} data-testid="week-view">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ color: "var(--text-dim)" }}>
            <th style={th}>Salarié</th>
            {dates.map((d, i) => <th key={d} style={{ ...th, textAlign: "center" }}>{JOURS[i]} {d.slice(8)}/{d.slice(5, 7)}</th>)}
            <th style={th}>Total semaine</th>
            <th style={th}>Contrat</th>
            <th style={th}>Écart</th>
            <th style={th}>Solde pauses</th>
          </tr>
        </thead>
        <tbody>
          {!byEmp && <tr><td colSpan={12} style={{ padding: 16, color: "var(--text-dim)" }}>Chargement…</td></tr>}
          {byEmp && staff.length === 0 && <tr><td colSpan={12} style={{ padding: 16, color: "var(--text-dim)" }}>Aucun salarié pour ces filtres.</td></tr>}
          {byEmp && groups.map((g) => [
            groups.length > 1 && (
              <tr key={"h" + g.siteId}><td colSpan={12} style={{ padding: "10px 10px 4px", color: "var(--brass)", fontSize: 13, fontWeight: 600 }}>{g.name}</td></tr>
            ),
            ...g.staff.map((e) => {
              const days = byEmp[e.id] || {};
              const total = dates.reduce((s, d) => s + (days[d]?.workedMinutes || 0), 0);
              const cls = classifyWeek(total, e, settings);
              const bal = computeBalance(balances[e.id] || [], pset);
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--ink-3)" }}>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}><strong>{e.displayName}</strong></td>
                  {dates.map((d) => {
                    const x = days[d];
                    const a = hhmm(x?.arrival), b = hhmm(x?.departure);
                    const label = x?.workedMinutes ? minutesToHHhMM(x.workedMinutes) : a && !b ? "en cours" : "—";
                    return (
                      <td key={d} style={{ padding: "4px 4px", textAlign: "center" }}>
                        <button disabled={!canEdit} onClick={() => onEditDay && onEditDay(e, d)}
                          aria-label={`Corriger ${e.displayName}, ${d}`} title={canEdit ? "Corriger les heures de ce jour" : ""}
                          style={{
                            width: "100%", minWidth: 78, padding: "6px 6px", borderRadius: 8, background: "var(--ink-2)", border: "1px solid var(--line)",
                            color: x ? "var(--text)" : "var(--text-faint)", fontSize: 13, fontWeight: 600, cursor: canEdit ? "pointer" : "default",
                          }}>
                          {label}
                          {(a || b) && <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>{a || "?"}–{b || "?"}</div>}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ padding: "9px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{minutesToHHhMM(total)}</td>
                  <td style={{ padding: "9px 10px", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{minutesToHHhMM(cls.contractMinutes)}</td>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: cls.excessMinutes > 0 ? "var(--amber)" : cls.deficitMinutes > 0 ? "var(--text-dim)" : "var(--text)" }}>
                    {cls.excessMinutes > 0 ? `+${minutesToHHhMM(cls.excessMinutes)}` : cls.deficitMinutes > 0 ? `−${minutesToHHhMM(cls.deficitMinutes)}` : "0"}
                  </td>
                  <td style={{ padding: "9px 10px" }}>
                    <button onClick={() => onOpenBalance(e)} aria-label={`Compteur de pauses de ${e.displayName}`} style={{
                      color: bal.missingTotal > 0 ? "var(--red)" : bal.extraTotal > 0 ? "var(--green)" : "var(--text)", fontSize: 13, fontWeight: 600,
                      padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--ink-2)", whiteSpace: "nowrap",
                    }}>
                      {bal.daysCounted ? (bal.missingTotal === 0 && bal.extraTotal === 0 ? "0 min" : <>{bal.missingTotal > 0 && `−${bal.missingTotal}`}{bal.missingTotal > 0 && bal.extraTotal > 0 && " / "}{bal.extraTotal > 0 && `+${bal.extraTotal}`} min</>) : "Détail"} ›
                    </button>
                  </td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
      <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
        Cliquez sur un jour pour corriger ses heures (arrivée, pauses, départ). Le total de la semaine se met à jour à l'enregistrement. Les jours sans pointage affichent « — ».
      </p>
    </div>
  );
}
