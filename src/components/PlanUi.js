"use client";
import { useEffect, useMemo, useState } from "react";
import { inp, btnPrimary, btnGhost } from "./Employees";

export { inp, btnPrimary, btnGhost };

// Filtres habituels de l'application (comme « Récaps & impression ») :
// magasins en boutons à cocher (aucun coché = tous mes magasins) + liste de salariés.
export function useScope(employees, sites, allowedSiteIds) {
  const visibleSites = allowedSiteIds ? sites.filter((s) => allowedSiteIds.includes(s.id)) : sites;
  const [selectedSites, setSelectedSites] = useState([]);
  const [empId, setEmpId] = useState("all");
  const scoped = useMemo(() => employees
    .filter((e) => e.active !== false)
    .filter((e) => !allowedSiteIds || allowedSiteIds.includes(e.siteId))
    .filter((e) => selectedSites.length === 0 || selectedSites.includes(e.siteId)),
  [employees, allowedSiteIds, selectedSites]);
  useEffect(() => { if (empId !== "all" && !scoped.find((e) => e.id === empId)) setEmpId("all"); }, [scoped, empId]);
  const staff = useMemo(() => (empId === "all" ? scoped : scoped.filter((e) => e.id === empId)), [scoped, empId]);
  return { visibleSites, selectedSites, setSelectedSites, empId, setEmpId, scoped, staff };
}

export function ScopeFilters({ scope, children }) {
  const { visibleSites, selectedSites, setSelectedSites, empId, setEmpId, scoped } = scope;
  const toggle = (id) => setSelectedSites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <div className="no-print" style={{ marginBottom: 16 }}>
      {visibleSites.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>Magasins (aucun sélectionné = tous)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {visibleSites.map((s) => {
              const on = selectedSites.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggle(s.id)} style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 14, fontWeight: 500,
                  background: on ? "color-mix(in srgb, var(--brass) 22%, var(--ink-2))" : "var(--ink-2)",
                  border: `1px solid ${on ? "var(--brass)" : "var(--line)"}`, color: "var(--text)",
                }}>{on ? "☑" : "☐"} {s.name}</button>
              );
            })}
            {selectedSites.length > 0 && (
              <button onClick={() => setSelectedSites([])} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 14, color: "var(--text-dim)", background: "transparent", border: "1px solid var(--line)" }}>Tout afficher</button>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Salarié<br />
          <select style={{ ...inp, marginTop: 5, width: "auto", minWidth: 190 }} value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="all">Tous les salariés{selectedSites.length ? " (magasins filtrés)" : " actifs"}</option>
            {scoped.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
          </select>
        </label>
        {children}
      </div>
    </div>
  );
}

// Fenêtre dans le style de l'application (comme celle des salariés).
export function Modal({ title, children, onClose, width = 560 }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px", overflow: "auto",
    }}>
      <div role="dialog" aria-label={title || "Fenêtre"} style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 16, padding: 24, width: "100%", maxWidth: width }}>
        {title && <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 18 }}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// Groupe les salariés par magasin (ordre des magasins de l'application).
export function groupBySite(staff, sites) {
  const order = sites.map((s) => s.id);
  const map = new Map();
  staff.forEach((e) => { if (!map.has(e.siteId)) map.set(e.siteId, []); map.get(e.siteId).push(e); });
  return [...map.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    .map(([siteId, list]) => ({ siteId, name: sites.find((s) => s.id === siteId)?.name || "—", staff: list }));
}
