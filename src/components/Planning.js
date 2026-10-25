"use client";
import { useEffect, useMemo, useState } from "react";
import { inp } from "./Employees";
import {
  periodState, periodMinutes, plannedWorkMinutes, planSettings, fmtMin, mondayOf, addDays, weekDates,
  strToDate, paginateRows, dateToStr, PRESETS_MORNING, PRESETS_EVENING, EMP_COLORS, parseRange,
  contractMonthMinutes, weeksOfMonth, MONTHS_FR,
} from "../lib/planLogic";

// Présentation reprise du calendrier de la résidence Le Belleville (Planning-RLB) :
// fond clair, une couleur par salarié, semaine en grille, chips « Sem. n », saisie groupée,
// duplication de semaine, compteur d'heures. Différences voulues : matin et soir sont
// indépendants, « À planifier » (rien de créé) ≠ « Non travaillé », pas d'envoi d'e-mail.

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAYS_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const fmtDay = (s) => { const d = strToDate(s); return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fmtLong = (s) => strToDate(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
export const btn = { padding: "9px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: "var(--ink-3)", border: "1px solid var(--line)", color: "var(--text)" };
export const btnPrimary = { padding: "11px 18px", borderRadius: 10, fontWeight: 700, fontSize: 14, background: "#111827", color: "#fff", border: "none" };
const colorOf = (emps, id) => EMP_COLORS[Math.max(0, emps.findIndex((e) => e.id === id)) % EMP_COLORS.length];
const chip = (on, tone = "#111827") => ({ padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", background: on ? tone : "#F3F4F6", color: on ? "#fff" : "#374151" });
const mapPlans = (list) => { const m = {}; list.forEach((p) => (m[`${p.employeeId}_${p.date}`] = p)); return m; };

const periodText = (p) => {
  const st = periodState(p);
  return st === "worked" ? `${p.start}-${p.end}` : st === "off" ? "Non travaillé" : "À planifier";
};

export default function Planning({ employees, sites, allowedSiteIds, canEdit = true, api, managerName, today }) {
  const visibleSites = allowedSiteIds ? sites.filter((s) => allowedSiteIds.includes(s.id)) : sites;
  const todayS = today || dateToStr(new Date());
  const [siteId, setSiteId] = useState(visibleSites[0]?.id || "");
  const [monday, setMonday] = useState(mondayOf(todayS));
  const [plans, setPlans] = useState({});
  const [days, setDays] = useState([]);
  const [settings, setSettings] = useState(null);
  const [panel, setPanel] = useState(null); // {type:"cell",emp,date} | "bulk" | "duplicate" | "hours"
  const [msg, setMsg] = useState(null);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => { if (!siteId && visibleSites[0]) setSiteId(visibleSites[0].id); }, [visibleSites, siteId]);
  useEffect(() => { api.getSettings().then((s) => setSettings(planSettings(s))); }, [api]);

  const dates = useMemo(() => weekDates(monday), [monday]);
  useEffect(() => {
    if (!siteId) return;
    const unsub = api.watchPlannings(siteId, dates[0], dates[6], (list) => setPlans(mapPlans(list)));
    api.getDaysRange(siteId, dates[0], dates[6]).then(setDays).catch(() => setDays([]));
    return () => unsub && unsub();
  }, [api, siteId, dates]);

  const staff = employees.filter((e) => e.siteId === siteId && e.active !== false);
  const actualByEmp = useMemo(() => {
    const m = {};
    days.forEach((d) => { if (typeof d.workedMinutes === "number") m[d.employeeId] = (m[d.employeeId] || 0) + d.workedMinutes; });
    return m;
  }, [days]);

  const mid = strToDate(dates[3]); // le jeudi décide du mois affiché (règle ISO)
  const curMonth = { year: mid.getFullYear(), month: mid.getMonth() + 1 };
  const monthWeeks = weeksOfMonth(curMonth.year, curMonth.month);
  const goMonth = (d) => { let m = curMonth.month + d, y = curMonth.year; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } setMonday(weeksOfMonth(y, m)[0]); };

  async function savePlans(list, okText) {
    setMsg(null);
    try {
      const r = await api.savePlannings(list, managerName);
      setMsg({ ok: true, t: `${okText} · ${r.changed} jour(s) modifié(s), écarts et compteurs recalculés. Historique conservé, pointages intacts.` });
    } catch (e) { setMsg({ ok: false, t: `Enregistrement impossible : ${e.message}` }); }
  }

  const siteName = sites.find((s) => s.id === siteId)?.name || "";
  const actions = canEdit && (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0 4px" }}>
      <button onClick={() => setPanel("bulk")} style={{ ...btnPrimary, background: "#1D4ED8", flex: 1, minWidth: 130 }}>⚡ Saisie groupée</button>
      <button onClick={() => setPanel("duplicate")} style={{ ...btnPrimary, background: "#7C3AED", flex: 1, minWidth: 130 }}>📋 Dupliquer</button>
      <button onClick={() => setPanel("hours")} style={{ ...btnPrimary, background: "#059669", flex: 1, minWidth: 130 }}>📊 Compteur d'heures</button>
    </div>
  );

  return (
    <div className="plan-light">
      <div className="no-print">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>📅 Planning du personnel</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => window.print()} style={btnPrimary}>🖨 Imprimer la semaine</button>
            <button onClick={() => window.print()} style={btn} title="Dans la fenêtre d'impression, choisir « Enregistrer au format PDF »">⬇ Télécharger en PDF</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          {visibleSites.length > 1 && (
            <select style={{ ...inp, width: "auto" }} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {visibleSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button style={btn} onClick={() => goMonth(-1)} aria-label="Mois précédent">‹</button>
          <b style={{ minWidth: 130, textAlign: "center" }}>{MONTHS_FR[curMonth.month - 1]} {curMonth.year}</b>
          <button style={btn} onClick={() => goMonth(1)} aria-label="Mois suivant">›</button>
          <button style={btn} onClick={() => setMonday(mondayOf(todayS))}>Aujourd'hui</button>
          <input type="date" style={{ ...inp, width: "auto" }} value={monday} onChange={(e) => e.target.value && setMonday(mondayOf(e.target.value))} aria-label="Choisir la semaine" />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 4 }}>
          {monthWeeks.map((w, i) => (
            <button key={w} onClick={() => setMonday(w)} style={{ ...chip(w === monday), padding: "6px 14px", borderRadius: 20, flexShrink: 0 }}>Sem. {i + 1}</button>
          ))}
          <span style={{ fontSize: 12, color: "#6B7280", marginLeft: 8, flexShrink: 0 }}>Semaine du {fmtLong(dates[0])} au {fmtLong(dates[6])}</span>
        </div>

        {settings && (
          <PresetBar settings={settings} open={showPresets} setOpen={setShowPresets} canEdit={canEdit}
            onSave={async (patch) => { await api.saveSettings(patch); setSettings(planSettings(await api.getSettings())); setMsg({ ok: true, t: "Horaires habituels enregistrés." }); }} />
        )}
        {msg && <p style={{ color: msg.ok ? "#059669" : "#dc2626", fontSize: 13, margin: "8px 0" }}>{msg.t}</p>}

        <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={th({ textAlign: "left", paddingLeft: 14, minWidth: 120, position: "sticky", left: 0, background: "#F9FAFB", zIndex: 2 })}>Équipe</th>
                {dates.map((d, i) => (
                  <th key={d} style={th({ opacity: 1 })}>
                    <div style={{ fontWeight: 700, color: i >= 5 ? "#EF4444" : "#374151", fontSize: 11 }}>{DAYS[i]}</div>
                    <div style={{ color: "#9CA3AF", fontSize: 10, fontWeight: 400 }}>{fmtDay(d)}</div>
                  </th>
                ))}
                <th style={th({ borderLeft: "2px solid #E5E7EB", background: "#F0FDF4", minWidth: 120 })}><div style={{ color: "#065F46" }}>Semaine</div></th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && <tr><td colSpan={9} style={{ padding: 20, color: "#6B7280" }}>Aucun salarié actif dans ce magasin.</td></tr>}
              {staff.map((e) => {
                const c = colorOf(staff, e.id);
                const planned = dates.reduce((a, d) => a + plannedWorkMinutes(plans[`${e.id}_${d}`]), 0);
                const toDo = dates.filter((d) => { const p = plans[`${e.id}_${d}`]; return !p || periodState(p.morning) === "unset" || periodState(p.evening) === "unset"; }).length;
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px 6px 8px 14px", position: "sticky", left: 0, background: "#fff", zIndex: 1, borderRight: `2px solid ${c.border}` }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: c.text, whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c.dot, marginRight: 5 }} />{e.displayName}
                      </div>
                    </td>
                    {dates.map((d) => (
                      <td key={d} style={{ padding: "4px 2px", textAlign: "center", verticalAlign: "middle" }}>
                        <button disabled={!canEdit} onClick={() => setPanel({ type: "cell", emp: e, date: d })} style={{ width: "100%", padding: 0, display: "grid", gap: 3 }} aria-label={`${e.displayName} ${d}`}>
                          <Slot label="Matin" p={plans[`${e.id}_${d}`]?.morning} c={c} edit={canEdit} />
                          <Slot label="Soir" p={plans[`${e.id}_${d}`]?.evening} c={c} edit={canEdit} />
                        </button>
                      </td>
                    ))}
                    <td style={{ padding: "6px 8px", borderLeft: "2px solid #E5E7EB", background: "#F0FDF4", fontSize: 11, verticalAlign: "middle" }}>
                      <div>Contrat <b>{fmtMin(e.weeklyContractMinutes)}</b></div>
                      <div>Prévu <b style={{ color: "#065F46" }}>{fmtMin(planned)}</b></div>
                      <div>Réel <b>{actualByEmp[e.id] != null ? fmtMin(actualByEmp[e.id]) : "—"}</b></div>
                      {toDo > 0 && <div style={{ color: "#9CA3AF" }}>{toDo} j à compléter</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {staff.map((e) => { const c = colorOf(staff, e.id); return (
            <span key={e.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c.text, background: c.bg, borderRadius: 20, padding: "3px 8px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot }} />{e.displayName}
            </span>); })}
        </div>
        {actions}
        <p style={{ color: "#6B7280", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          ✏️ Touchez un créneau pour l'éditer. « À planifier » = rien n'a encore été saisi (le salarié peut quand même pointer) ; « Non travaillé » = période explicitement sans service.
          Toute modification, même rétroactive, conserve l'historique et recalcule les écarts ; les pointages réels ne sont jamais modifiés.
        </p>
      </div>

      {panel?.type === "cell" && settings && (
        <CellEditor emp={panel.emp} date={panel.date} plan={plans[`${panel.emp.id}_${panel.date}`]} settings={settings} color={colorOf(staff, panel.emp.id)}
          onClose={() => setPanel(null)}
          onSave={async (p) => { setPanel(null); await savePlans([{ siteId, employeeId: panel.emp.id, date: panel.date, ...p }], "Planning enregistré"); }} />
      )}
      {panel === "bulk" && settings && (
        <BulkEdit staff={staff} dates={dates} curMonth={curMonth} settings={settings} onClose={() => setPanel(null)}
          onSave={async (list, label) => { setPanel(null); await savePlans(list.map((x) => ({ siteId, ...x })), label); }} />
      )}
      {panel === "duplicate" && (
        <Duplicate monday={monday} staff={staff} api={api} siteId={siteId} onClose={() => setPanel(null)}
          onSave={async (list) => { setPanel(null); await savePlans(list.map((x) => ({ siteId, ...x })), "Semaine dupliquée"); }} />
      )}
      {panel === "hours" && <HoursPanel staff={staff} api={api} siteId={siteId} curMonth={curMonth} onClose={() => setPanel(null)} />}

      <PrintSheets dates={dates} staff={staff} plans={plans} siteName={siteName} />
    </div>
  );
}

const th = (extra) => ({ padding: "7px 3px", fontWeight: 600, fontSize: 10, color: "#6B7280", borderBottom: "1px solid #E5E7EB", textTransform: "uppercase", letterSpacing: "0.3px", textAlign: "center", ...extra });

// Une période (matin ou soir) dans la grille : 3 états visuellement distincts.
function Slot({ label, p, c, edit }) {
  const st = periodState(p);
  const base = { display: "block", borderRadius: 7, padding: "5px 3px", fontSize: 11, lineHeight: 1.25, cursor: edit ? "pointer" : "default" };
  if (st === "worked") return <span style={{ ...base, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 700 }}><span style={{ fontSize: 9, opacity: 0.6, fontWeight: 600 }}>{label} </span>{p.start}-{p.end}</span>;
  if (st === "off") return <span style={{ ...base, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#6B7280" }}><span style={{ fontSize: 9, opacity: 0.7 }}>{label} </span>Repos</span>;
  return <span style={{ ...base, background: "#fff", border: "1px dashed #D1D5DB", color: "#9CA3AF" }}><span style={{ fontSize: 9 }}>{label} </span>{edit ? "+ à planifier" : "—"}</span>;
}

// ---------- Horaires habituels (présaisie matin / soir) ----------
function PresetBar({ settings, open, setOpen, onSave, canEdit }) {
  const [m, setM] = useState(settings.presetMorning);
  const [e, setE] = useState(settings.presetEvening);
  useEffect(() => { setM(settings.presetMorning); setE(settings.presetEvening); }, [settings]);
  const time = (v, on) => <input type="time" value={v} onChange={(ev) => on(ev.target.value)} style={{ ...inp, width: 110, padding: "7px 8px" }} />;
  return (
    <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 12, padding: "10px 14px", marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>
          🌅 Matin habituel <b>{settings.presetMorning.start}-{settings.presetMorning.end}</b> · 🌆 Soir habituel <b>{settings.presetEvening.start}-{settings.presetEvening.end}</b>
          <span style={{ color: "#9CA3AF" }}> (proposés à chaque saisie, toujours modifiables)</span>
        </span>
        {canEdit && <button onClick={() => setOpen(!open)} style={{ color: "#1D4ED8", fontSize: 13, fontWeight: 600 }}>{open ? "Fermer" : "Modifier"}</button>}
      </div>
      {open && (
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <span>Matin : {time(m.start, (v) => setM({ ...m, start: v }))} → {time(m.end, (v) => setM({ ...m, end: v }))}</span>
          <span>Soir : {time(e.start, (v) => setE({ ...e, start: v }))} → {time(e.end, (v) => setE({ ...e, end: v }))}</span>
          <button style={btnPrimary} onClick={async () => { await onSave({ presetMorning: m, presetEvening: e }); setOpen(false); }}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

// ---------- Sélecteur d'une période : état + horaires (habituel, boutons rapides, saisie libre) ----------
function PeriodPicker({ label, emoji, value, preset, presets, onChange }) {
  const st = periodState(value);
  const cur = st === "worked" ? `${value.start}-${value.end}` : null;
  const habitual = `${preset.start}-${preset.end}`;
  const set = (state) => onChange(state === "unset" ? null : state === "off" ? { state: "off" } : { state: "worked", start: value?.start || preset.start, end: value?.end || preset.end });
  const seg = (key, text) => (
    <button key={key} onClick={() => set(key)} style={{ ...chip(st === key, key === "off" ? "#6B7280" : key === "worked" ? "#111827" : "#9CA3AF"), flex: 1, padding: "9px 4px", fontSize: 13 }}>{text}</button>
  );
  const time = (k) => <input type="time" value={value?.[k] || ""} onChange={(e) => onChange({ ...(value || {}), state: "worked", [k]: e.target.value })} style={{ ...inp, width: 118 }} />;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 7 }}>{emoji} {label}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>{seg("worked", "Travaillé")}{seg("off", "Non travaillé")}{seg("unset", "À planifier")}</div>
      {st === "worked" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 7 }}>
            <button onClick={() => onChange(parseRange(habitual))} style={{ ...chip(cur === habitual, "#1D4ED8"), outline: "1px solid #93C5FD" }}>★ {habitual}</button>
            {presets.filter((p) => p !== habitual).map((p) => <button key={p} onClick={() => onChange(parseRange(p))} style={chip(cur === p)}>{p}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            Arrivée {time("start")} Départ {time("end")}
            <span style={{ color: "#6B7280" }}>{fmtMin(periodMinutes(value))}</span>
          </div>
        </>
      )}
    </div>
  );
}

const normalise = (p) => (p && p.state ? (p.state === "off" ? { state: "off" } : { state: "worked", start: p.start, end: p.end }) : null);

function CellEditor({ emp, date, plan, settings, color, onSave, onClose }) {
  const [morning, setMorning] = useState(plan?.morning || null);
  const [evening, setEvening] = useState(plan?.evening || null);
  const mk = (kind, preset) => (kind === "w" ? { state: "worked", ...preset } : kind === "o" ? { state: "off" } : null);
  const quick = (m, e) => { setMorning(mk(m, settings.presetMorning)); setEvening(mk(e, settings.presetEvening)); };
  const invalid = [morning, evening].some((p) => p?.state === "worked" && (!p.start || !p.end));
  const idx = (strToDate(date).getDay() + 6) % 7;
  return (
    <Modal onClose={onClose} title={null}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color.dot }} />
        <div><div style={{ fontWeight: 700, fontSize: 15 }}>{emp.displayName}</div><div style={{ fontSize: 11, color: "#9CA3AF" }}>{DAYS_LONG[idx]} {fmtDay(date)}</div></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button style={btn} onClick={() => quick("w", "w")}>Matin + soir</button>
        <button style={btn} onClick={() => quick("w", "o")}>Matin seul</button>
        <button style={btn} onClick={() => quick("o", "w")}>Soir seul</button>
        <button style={btn} onClick={() => quick("o", "o")}>Aucun service</button>
      </div>
      <PeriodPicker label="Service du matin" emoji="🌅" value={morning} preset={settings.presetMorning} presets={PRESETS_MORNING} onChange={setMorning} />
      <PeriodPicker label="Service du soir" emoji="🌆" value={evening} preset={settings.presetEvening} presets={PRESETS_EVENING} onChange={setEvening} />
      <p style={{ color: "#4B5563", fontSize: 13, marginBottom: 14 }}>
        Temps prévu : <b>{fmtMin(periodMinutes(morning) + periodMinutes(evening))}</b>. « À planifier » n'est jamais compté comme non travaillé.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btn, flex: 1, background: "#fff" }} onClick={onClose}>Annuler</button>
        <button style={{ ...btnPrimary, flex: 2, opacity: invalid ? 0.4 : 1 }} disabled={invalid} onClick={() => onSave({ morning: normalise(morning), evening: normalise(evening) })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

// ---------- Saisie groupée (qui ? quand ? quel horaire ?) ----------
function BulkEdit({ staff, dates, curMonth, settings, onSave, onClose }) {
  const [step, setStep] = useState(1);
  const [sel, setSel] = useState([]);
  const [selDays, setSelDays] = useState([]);
  const [scope, setScope] = useState("week");
  const [morning, setMorning] = useState({ state: "worked", ...settings.presetMorning });
  const [evening, setEvening] = useState({ state: "worked", ...settings.presetEvening });
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const ok = [morning, evening].every((p) => p?.state !== "worked" || (p.start && p.end));
  const targets = () => {
    const list = scope === "week" ? dates : weeksOfMonth(curMonth.year, curMonth.month).flatMap((w) => weekDates(w)).filter((d) => { const x = strToDate(d); return x.getFullYear() === curMonth.year && x.getMonth() + 1 === curMonth.month; });
    return list.filter((d) => selDays.includes((strToDate(d).getDay() + 6) % 7));
  };
  const go = () => {
    const ds = targets(), out = [];
    sel.forEach((id) => ds.forEach((d) => out.push({ employeeId: id, date: d, morning: normalise(morning), evening: normalise(evening) })));
    onSave(out, "Saisie groupée appliquée");
  };
  return (
    <Modal onClose={onClose} title={null}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>⚡ Saisie groupée</div>
      <div style={{ display: "flex", gap: 4, margin: "10px 0" }}>{[1, 2, 3].map((n) => <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: step >= n ? "#1D4ED8" : "#E5E7EB" }} />)}</div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{["", "Qui travaille ?", "Périmètre et jours", "Quel horaire ?"][step]}</div>
      {step === 1 && (
        <>
          <button onClick={() => setSel(sel.length === staff.length ? [] : staff.map((e) => e.id))} style={{ width: "100%", marginBottom: 10, padding: "8px 0", border: "1px dashed #D1D5DB", borderRadius: 8, background: "#F9FAFB", fontSize: 12, fontWeight: 600 }}>
            {sel.length === staff.length ? "✕ Tout désélectionner" : "✓ Toute l'équipe"}
          </button>
          <div style={{ display: "grid", gap: 8 }}>
            {staff.map((e) => { const c = colorOf(staff, e.id), on = sel.includes(e.id); return (
              <button key={e.id} onClick={() => toggle(sel, setSel, e.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: on ? c.bg : "#F9FAFB", outline: on ? `2px solid ${c.dot}` : "2px solid transparent" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.dot }} /><b style={{ fontSize: 14, color: on ? c.text : "#374151" }}>{e.displayName}</b><span style={{ marginLeft: "auto" }}>{on ? "✓" : ""}</span>
              </button>); })}
          </div>
          <button disabled={!sel.length} onClick={() => setStep(2)} style={{ ...btnPrimary, width: "100%", marginTop: 14, background: sel.length ? "#1D4ED8" : "#E5E7EB", color: sel.length ? "#fff" : "#9CA3AF" }}>Suivant →</button>
        </>
      )}
      {step === 2 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setScope("week")} style={{ ...chip(scope === "week"), padding: 12 }}>📅 Cette semaine<br /><span style={{ fontSize: 10, opacity: 0.7 }}>{fmtDay(dates[0])} – {fmtDay(dates[6])}</span></button>
            <button onClick={() => setScope("month")} style={{ ...chip(scope === "month", "#1D4ED8"), padding: 12 }}>📆 Tout le mois<br /><span style={{ fontSize: 10, opacity: 0.7 }}>{MONTHS_FR[curMonth.month - 1]}</span></button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {[["Lun – Ven", [0, 1, 2, 3, 4]], ["Week-end", [5, 6]], ["Tous", [0, 1, 2, 3, 4, 5, 6]]].map(([l, d]) => <button key={l} onClick={() => setSelDays(d)} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12 }}>{l}</button>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
            {DAYS.map((d, i) => <button key={d} onClick={() => toggle(selDays, setSelDays, i)} style={{ ...chip(selDays.includes(i)), padding: "10px 4px" }}>{d}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ ...btn, flex: 1, background: "#fff" }}>← Retour</button>
            <button disabled={!selDays.length} onClick={() => setStep(3)} style={{ ...btnPrimary, flex: 2, background: selDays.length ? "#1D4ED8" : "#E5E7EB", color: selDays.length ? "#fff" : "#9CA3AF" }}>Suivant →</button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: 12 }}>
            <b style={{ color: "#1E40AF" }}>{staff.filter((e) => sel.includes(e.id)).map((e) => e.displayName).join(", ")}</b>
            <span style={{ color: "#6B7280" }}> · {selDays.sort().map((d) => DAYS[d]).join(", ")} · {scope === "month" ? `tout ${MONTHS_FR[curMonth.month - 1]}` : "cette semaine"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <button style={btn} onClick={() => { setMorning({ state: "worked", ...settings.presetMorning }); setEvening({ state: "worked", ...settings.presetEvening }); }}>Matin + soir</button>
            <button style={btn} onClick={() => { setMorning({ state: "worked", ...settings.presetMorning }); setEvening({ state: "off" }); }}>Matin seul</button>
            <button style={btn} onClick={() => { setMorning({ state: "off" }); setEvening({ state: "worked", ...settings.presetEvening }); }}>Soir seul</button>
            <button style={btn} onClick={() => { setMorning({ state: "off" }); setEvening({ state: "off" }); }}>Aucun service</button>
          </div>
          <PeriodPicker label="Service du matin" emoji="🌅" value={morning} preset={settings.presetMorning} presets={PRESETS_MORNING} onChange={setMorning} />
          <PeriodPicker label="Service du soir" emoji="🌆" value={evening} preset={settings.presetEvening} presets={PRESETS_EVENING} onChange={setEvening} />
          <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 10 }}>⚠ Les journées déjà planifiées pour ces salariés et ces jours seront remplacées (l'ancien planning reste dans l'historique).</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(2)} style={{ ...btn, flex: 1, background: "#fff" }}>← Retour</button>
            <button disabled={!ok} onClick={go} style={{ ...btnPrimary, flex: 2, opacity: ok ? 1 : 0.4 }}>Appliquer</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Dupliquer une semaine ----------
function Duplicate({ monday, staff, api, siteId, onSave, onClose }) {
  const [src, setSrc] = useState(addDays(monday, -7));
  const [dst, setDst] = useState(monday);
  const same = src === dst;
  const sel = (v, set) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button style={btn} onClick={() => set(addDays(v, -7))}>‹</button>
      <div style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700 }}>{fmtDay(v)} – {fmtDay(addDays(v, 6))}</div>
      <button style={btn} onClick={() => set(addDays(v, 7))}>›</button>
    </div>
  );
  async function go() {
    const list = await api.getPlannings(siteId, src, addDays(src, 6));
    const by = mapPlans(list), out = [];
    staff.forEach((e) => weekDates(src).forEach((d, i) => {
      const p = by[`${e.id}_${d}`];
      out.push({ employeeId: e.id, date: addDays(dst, i), morning: normalise(p?.morning), evening: normalise(p?.evening) });
    }));
    onSave(out);
  }
  return (
    <Modal onClose={onClose} title={null}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>📋 Dupliquer une semaine</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#F0FDF4", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, fontWeight: 700, color: "#065F46", marginBottom: 8 }}>📤 Source</div>{sel(src, setSrc)}</div>
        <div style={{ background: "#FEF3C7", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 8 }}>📥 Destination</div>{sel(dst, setDst)}</div>
      </div>
      <p style={{ fontSize: 12, color: same ? "#92400E" : "#6B7280", marginBottom: 14 }}>
        {same ? "⚠ Choisissez deux semaines différentes." : "⚠ La semaine destination sera remplacée pour tous les salariés affichés ; l'ancien planning reste dans l'historique. Un jour « à planifier » reste « à planifier »."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btn, flex: 1, background: "#fff" }} onClick={onClose}>Annuler</button>
        <button disabled={same} style={{ ...btnPrimary, flex: 2, background: same ? "#E5E7EB" : "#7C3AED", color: same ? "#9CA3AF" : "#fff" }} onClick={go}>Dupliquer →</button>
      </div>
    </Modal>
  );
}

// ---------- Compteur d'heures du mois : contrat / prévu / réel ----------
function HoursPanel({ staff, api, siteId, curMonth, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    const from = `${curMonth.year}-${String(curMonth.month).padStart(2, "0")}-01`;
    const to = dateToStr(new Date(curMonth.year, curMonth.month, 0));
    Promise.all([api.getPlannings(siteId, from, to), api.getDaysRange(siteId, from, to)]).then(([p, d]) => setData({ p, d }));
  }, [api, siteId, curMonth]);
  return (
    <Modal onClose={onClose} title={null}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>📊 Compteur d'heures</div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 12 }}>{MONTHS_FR[curMonth.month - 1]} {curMonth.year} · contrat mensuel = heures hebdo × 52 / 12</div>
      {!data ? <p>Chargement…</p> : staff.map((e) => {
        const c = colorOf(staff, e.id);
        const planned = data.p.filter((x) => x.employeeId === e.id).reduce((a, x) => a + plannedWorkMinutes(x), 0);
        const actual = data.d.filter((x) => x.employeeId === e.id).reduce((a, x) => a + (x.workedMinutes || 0), 0);
        const contract = contractMonthMinutes(e.weeklyContractMinutes || 0);
        const diff = planned - contract, pct = contract ? Math.round((planned / contract) * 100) : 0;
        const col = diff < -60 ? "#EF4444" : diff > 60 ? "#F59E0B" : "#10B981";
        return (
          <div key={e.id} style={{ marginBottom: 10, background: c.bg + "55", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
              <b style={{ color: c.text }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.dot, marginRight: 6 }} />{e.displayName}</b>
              <span>Contrat <b>{fmtMin(contract)}</b> · Prévu <b>{fmtMin(planned)}</b> · Réel <b>{fmtMin(actual)}</b></span>
              <b style={{ color: col }}>{diff === 0 ? "±0" : `${diff > 0 ? "+" : "−"}${fmtMin(Math.abs(diff))}`}</b>
            </div>
            <div style={{ marginTop: 6, height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: col }} /></div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{pct} % du contrat planifié {diff < -60 ? "· ⚠ sous le contrat" : diff > 60 ? "· ⚠ au-dessus du contrat" : "· ✅ OK"}</div>
          </div>
        );
      })}
      <div style={{ textAlign: "right", marginTop: 8 }}><button style={btn} onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

// Fenêtre (bottom-sheet sur mobile comme dans le calendrier Le Belleville).
export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="no-print plan-light" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title || "Fenêtre"} style={{ background: "#fff", borderRadius: 16, padding: "22px 22px", width: "min(540px, 100%)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "#F3F4F6", borderRadius: "50%", width: 30, height: 30, fontSize: 14, color: "#6B7280" }}>✕</button>
        </div>
        {title && <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 14 }}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// ---------- Impression hebdomadaire (A4 paysage, blanc, gros caractères) ----------
// Pages équilibrées : jamais de tableau coupé au milieu d'une ligne, jamais de page presque vide.
// La taille du texte s'adapte au nombre de salariés (jamais sous 11 pt).
const MAX_ROWS_PER_PAGE = 12;
function PrintSheets({ dates, staff, plans, siteName }) {
  const sizes = paginateRows(staff.length, MAX_ROWS_PER_PAGE);
  const perPage = sizes.length ? Math.max(...sizes) : 1;
  const pad = perPage <= 6 ? 5 : perPage <= 9 ? 3 : 1.5; // hauteur des lignes : remplit la page quand il y a peu de salariés
  const pt = perPage <= 5 ? 13 : perPage <= 7 ? 12.5 : perPage <= 9 ? 12 : 11;
  let from = 0;
  const pages = sizes.map((n) => { const rows = staff.slice(from, from + n); from += n; return rows; });
  const border = "1px solid #333";
  // Heures compactes (8h-13h, 8h30-12h30) pour tenir dans la colonne d'un jour, même en gros caractères.
  const hh = (t) => { const [h, m] = t.split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };
  const cellTxt = (label, p) => {
    const st = periodState(p);
    return (
      <div style={{ textAlign: "center", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
        <span style={{ fontSize: `${pt - 4}pt`, color: "#666", marginRight: "1.2mm" }}>{label}</span>
        <span style={{ fontWeight: st === "worked" ? 700 : 400, color: st === "worked" ? "#000" : "#666" }}>
          {st === "worked" ? `${hh(p.start)}-${hh(p.end)}` : st === "off" ? "repos" : "\u00a0"}
        </span>
      </div>
    );
  };
  return (
    <div className="print-only plan-print" aria-hidden="true">
      {pages.map((rows, pi) => (
        <section key={pi} style={{ breakAfter: pi === pages.length - 1 ? "auto" : "page", pageBreakAfter: pi === pages.length - 1 ? "auto" : "always", color: "#000", background: "#fff", fontSize: `${pt}pt` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4mm" }}>
            <h1 style={{ fontSize: "20pt", margin: 0 }}>Planning · semaine du {fmtLong(dates[0])} au {fmtLong(dates[6])}</h1>
            <span style={{ fontSize: "11pt", color: "#444" }}>{siteName}{pages.length > 1 ? ` · page ${pi + 1}/${pages.length}` : ""}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead style={{ display: "table-header-group" }}>
              <tr>
                <th style={{ border, padding: "2mm", width: "13%", textAlign: "left", background: "#e8e8e8", fontSize: `${pt}pt` }}>Salarié</th>
                {dates.map((d, i) => <th key={d} style={{ border, padding: "2mm", background: "#e8e8e8", fontSize: `${pt}pt` }}>{DAYS_LONG[i]}<div style={{ fontWeight: 400, fontSize: `${pt - 2}pt` }}>{fmtDay(d)}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                  <td style={{ border, padding: `${pad}mm 2mm`, fontWeight: 700, fontSize: `${pt}pt` }}>{e.displayName}</td>
                  {dates.map((d) => {
                    const p = plans[`${e.id}_${d}`];
                    const both = periodState(p?.morning) === "off" && periodState(p?.evening) === "off";
                    return (
                      <td key={d} style={{ border, padding: `${pad}mm 1mm`, background: both ? "#d9d9d9" : "#fff", fontSize: `${pt}pt`, lineHeight: 1.35 }}>
                        {cellTxt("M", p?.morning)}{cellTxt("S", p?.evening)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "9.5pt", color: "#444", marginTop: "3mm" }}>
            M = matin, S = soir : heures d'arrivée et de départ. « repos » : période non travaillée. Case vide : horaire non communiqué.
          </p>
        </section>
      ))}
      {pages.length === 0 && <p style={{ color: "#000" }}>Aucun salarié à imprimer.</p>}
    </div>
  );
}
