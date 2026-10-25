"use client";
import { useEffect, useMemo, useState } from "react";
import { inp, btnPrimary, btnGhost, Modal, ScopeFilters, useScope, groupBySite } from "./PlanUi";
import {
  periodState, periodMinutes, plannedWorkMinutes, planSettings, fmtMin, mondayOf, addDays, weekDates,
  strToDate, paginateRows, dateToStr, PRESETS_MORNING, PRESETS_EVENING, EMP_COLORS, parseRange,
  contractMonthMinutes, weeksOfMonth, MONTHS_FR,
} from "../lib/planLogic";

// Planning du personnel : même thème, mêmes filtres et mêmes composants que le reste du logiciel.
// Fonctionnement repris du calendrier de la résidence Le Belleville (saisie groupée, duplication,
// compteur d'heures, créneaux rapides). Différences voulues : matin et soir indépendants,
// « à planifier » (rien de saisi) ≠ « non travaillé », aucun envoi d'e-mail.

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAYS_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const fmtDay = (s) => { const d = strToDate(s); return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fmtLong = (s) => strToDate(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const navBtn = { padding: "9px 14px", borderRadius: 9, background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--text)", fontSize: 15, fontWeight: 600 };
const chip = (on) => ({ padding: "7px 11px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: on ? "var(--brass)" : "var(--ink-2)", color: on ? "#1a1204" : "var(--text-dim)", border: `1px solid ${on ? "var(--brass)" : "var(--line)"}` });
const colorOf = (id, all) => EMP_COLORS[Math.max(0, all.findIndex((e) => e.id === id)) % EMP_COLORS.length];
const mapPlans = (list) => { const m = {}; list.forEach((p) => (m[`${p.employeeId}_${p.date}`] = p)); return m; };
const normalise = (p) => (p && p.state ? (p.state === "off" ? { state: "off" } : { state: "worked", start: p.start, end: p.end }) : null);

export default function Planning({ employees, sites, allowedSiteIds, canEdit = true, api, managerName, today }) {
  const scope = useScope(employees, sites, allowedSiteIds);
  const { staff, scoped } = scope;
  const todayS = today || dateToStr(new Date());
  const [monday, setMonday] = useState(mondayOf(todayS));
  const [plans, setPlans] = useState({});
  const [days, setDays] = useState([]);
  const [settings, setSettings] = useState(null);
  const [panel, setPanel] = useState(null); // {type:"cell",emp,date} | "bulk" | "duplicate" | "hours"
  const [msg, setMsg] = useState(null);
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => { api.getSettings().then((s) => setSettings(planSettings(s))); }, [api]);

  const dates = useMemo(() => weekDates(monday), [monday]);
  useEffect(() => {
    const unsub = api.watchPlannings(dates[0], dates[6], (list) => setPlans(mapPlans(list)));
    api.getDaysRange(dates[0], dates[6]).then(setDays).catch(() => setDays([]));
    return () => unsub && unsub();
  }, [api, dates]);

  const actualByEmp = useMemo(() => {
    const m = {};
    days.forEach((d) => { if (typeof d.workedMinutes === "number") m[d.employeeId] = (m[d.employeeId] || 0) + d.workedMinutes; });
    return m;
  }, [days]);

  const mid = strToDate(dates[3]); // le jeudi décide du mois affiché (règle ISO)
  const curMonth = { year: mid.getFullYear(), month: mid.getMonth() + 1 };
  const monthWeeks = weeksOfMonth(curMonth.year, curMonth.month);
  const goMonth = (d) => { let m = curMonth.month + d, y = curMonth.year; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } setMonday(weeksOfMonth(y, m)[0]); };
  const groups = useMemo(() => groupBySite(staff, sites), [staff, sites]);

  async function savePlans(list, okText) {
    setMsg(null);
    try {
      const r = await api.savePlannings(list, managerName);
      setMsg({ ok: true, t: `${okText} · ${r.changed} jour(s) modifié(s), écarts et compteurs recalculés. Historique conservé, pointages intacts.` });
    } catch (e) { setMsg({ ok: false, t: `Enregistrement impossible : ${e.message}` }); }
  }
  const withSite = (list) => list.map((x) => ({ siteId: employees.find((e) => e.id === x.employeeId)?.siteId || null, ...x }));

  return (
    <div>
      <div className="no-print">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Planning du personnel</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => window.print()} style={btnPrimary}>Imprimer la semaine</button>
            <button onClick={() => window.print()} style={btnGhost} title="Dans la fenêtre d'impression, choisir « Enregistrer au format PDF »">Télécharger en PDF</button>
          </div>
        </div>

        <ScopeFilters scope={scope}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setMonday(addDays(monday, -7))} style={navBtn} aria-label="Semaine précédente">←</button>
            <input type="date" style={{ ...inp, width: "auto", minWidth: 160 }} value={monday} onChange={(e) => e.target.value && setMonday(mondayOf(e.target.value))} aria-label="Choisir la semaine" />
            <button onClick={() => setMonday(addDays(monday, 7))} style={navBtn} aria-label="Semaine suivante">→</button>
            {monday !== mondayOf(todayS) && <button onClick={() => setMonday(mondayOf(todayS))} style={{ ...navBtn, color: "var(--brass)" }}>Cette semaine</button>}
          </div>
        </ScopeFilters>

        <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 6, marginBottom: 12 }}>
          <button style={navBtn} onClick={() => goMonth(-1)} aria-label="Mois précédent">‹</button>
          <b style={{ minWidth: 120, textAlign: "center", fontSize: 14 }}>{MONTHS_FR[curMonth.month - 1]} {curMonth.year}</b>
          <button style={navBtn} onClick={() => goMonth(1)} aria-label="Mois suivant">›</button>
          {monthWeeks.map((w, i) => <button key={w} onClick={() => setMonday(w)} style={{ ...chip(w === monday), flexShrink: 0 }}>Sem. {i + 1}</button>)}
          <span style={{ fontSize: 13, color: "var(--text-faint)", marginLeft: 8, flexShrink: 0 }}>du {fmtLong(dates[0])} au {fmtLong(dates[6])}</span>
        </div>

        {settings && (
          <PresetBar settings={settings} open={showPresets} setOpen={setShowPresets} canEdit={canEdit}
            onSave={async (patch) => { await api.saveSettings(patch); setSettings(planSettings(await api.getSettings())); setMsg({ ok: true, t: "Horaires habituels enregistrés." }); }} />
        )}
        {msg && <p style={{ color: msg.ok ? "var(--green)" : "var(--red)", fontSize: 14, margin: "10px 0" }}>{msg.t}</p>}

        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 880 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                <th style={th({ textAlign: "left", minWidth: 130 })}>Salarié</th>
                {dates.map((d, i) => (
                  <th key={d} style={th({ textAlign: "center", color: d === todayS ? "var(--brass)" : undefined })}>{DAYS[i]} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>{fmtDay(d)}</span></th>
                ))}
                <th style={th({ textAlign: "left", minWidth: 130 })}>Semaine</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && <tr><td colSpan={9} style={{ padding: 20, color: "var(--text-dim)" }}>Aucun salarié pour ces filtres.</td></tr>}
              {groups.map((g) => (
                <GroupRows key={g.siteId} group={g} showHeader={groups.length > 1} all={scoped} dates={dates} plans={plans} canEdit={canEdit} actualByEmp={actualByEmp} todayS={todayS} onCell={(emp, date) => setPanel({ type: "cell", emp, date })} />
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <button onClick={() => setPanel("bulk")} style={btnPrimary}>Saisie groupée</button>
            <button onClick={() => setPanel("duplicate")} style={btnGhost}>Dupliquer une semaine</button>
            <button onClick={() => setPanel("hours")} style={btnGhost}>Compteur d'heures</button>
          </div>
        )}
        <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          Touchez un créneau pour le modifier. « À planifier » = rien n'a encore été saisi (le salarié peut quand même pointer) ; « Non travaillé » = période explicitement sans service.
          Toute modification, même rétroactive, conserve l'historique et recalcule les écarts ; les pointages réels ne sont jamais modifiés.
        </p>
      </div>

      {panel?.type === "cell" && settings && (
        <CellEditor emp={panel.emp} date={panel.date} plan={plans[`${panel.emp.id}_${panel.date}`]} settings={settings} color={colorOf(panel.emp.id, scoped)}
          onClose={() => setPanel(null)}
          onSave={async (p) => { setPanel(null); await savePlans(withSite([{ employeeId: panel.emp.id, date: panel.date, ...p }]), "Planning enregistré"); }} />
      )}
      {panel === "bulk" && settings && (
        <BulkEdit staff={staff} all={scoped} dates={dates} curMonth={curMonth} settings={settings} onClose={() => setPanel(null)}
          onSave={async (list, label) => { setPanel(null); await savePlans(withSite(list), label); }} />
      )}
      {panel === "duplicate" && (
        <Duplicate monday={monday} staff={staff} api={api} onClose={() => setPanel(null)}
          onSave={async (list) => { setPanel(null); await savePlans(withSite(list), "Semaine dupliquée"); }} />
      )}
      {panel === "hours" && <HoursPanel staff={staff} all={scoped} api={api} curMonth={curMonth} onClose={() => setPanel(null)} />}

      <PrintSheets dates={dates} groups={groups} plans={plans} />
    </div>
  );
}

const th = (extra) => ({ padding: "8px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500, ...extra });

function GroupRows({ group, showHeader, all, dates, plans, canEdit, actualByEmp, todayS, onCell }) {
  return (
    <>
      {showHeader && (
        <tr><td colSpan={9} style={{ padding: "14px 10px 6px", color: "var(--brass)", fontWeight: 600, fontSize: 13, borderBottom: "1px solid var(--line)" }}>{group.name}</td></tr>
      )}
      {group.staff.map((e) => {
        const c = colorOf(e.id, all);
        const planned = dates.reduce((a, d) => a + plannedWorkMinutes(plans[`${e.id}_${d}`]), 0);
        const toDo = dates.filter((d) => { const p = plans[`${e.id}_${d}`]; return !p || periodState(p.morning) === "unset" || periodState(p.evening) === "unset"; }).length;
        return (
          <tr key={e.id} style={{ borderBottom: "1px solid var(--ink-3)" }}>
            <td style={{ padding: "8px 10px" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.dot, marginRight: 8 }} />
              <strong>{e.displayName}</strong>
            </td>
            {dates.map((d) => (
              <td key={d} style={{ padding: "4px 3px", textAlign: "center", verticalAlign: "middle", background: d === todayS ? "color-mix(in srgb, var(--brass) 6%, transparent)" : undefined }}>
                <button disabled={!canEdit} onClick={() => onCell(e, d)} style={{ width: "100%", padding: 0, display: "grid", gap: 3 }} aria-label={`${e.displayName} ${d}`}>
                  <Slot label="Matin" p={plans[`${e.id}_${d}`]?.morning} c={c} edit={canEdit} />
                  <Slot label="Soir" p={plans[`${e.id}_${d}`]?.evening} c={c} edit={canEdit} />
                </button>
              </td>
            ))}
            <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <div>Contrat <b style={{ color: "var(--text)" }}>{fmtMin(e.weeklyContractMinutes)}</b></div>
              <div>Prévu <b style={{ color: "var(--text)" }}>{fmtMin(planned)}</b></div>
              <div>Réel <b style={{ color: "var(--text)" }}>{actualByEmp[e.id] != null ? fmtMin(actualByEmp[e.id]) : "—"}</b></div>
              {toDo > 0 && <div style={{ color: "var(--text-faint)" }}>{toDo} j à compléter</div>}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// Une période (matin ou soir) dans la grille : 3 états visuellement distincts.
function Slot({ label, p, c, edit }) {
  const st = periodState(p);
  const base = { display: "block", borderRadius: 7, padding: "5px 3px", fontSize: 12, lineHeight: 1.25, cursor: edit ? "pointer" : "default" };
  const lab = <span style={{ fontSize: 10, opacity: 0.6 }}>{label} </span>;
  if (st === "worked") return <span style={{ ...base, background: `color-mix(in srgb, ${c.dot} 20%, var(--ink-2))`, border: `1px solid color-mix(in srgb, ${c.dot} 55%, transparent)`, color: "var(--text)", fontWeight: 600 }}>{lab}{p.start}-{p.end}</span>;
  if (st === "off") return <span style={{ ...base, background: "var(--ink-3)", border: "1px solid var(--line)", color: "var(--text-faint)" }}>{lab}Repos</span>;
  return <span style={{ ...base, background: "transparent", border: "1px dashed var(--line)", color: "var(--text-faint)" }}>{lab}{edit ? "à planifier" : "—"}</span>;
}

// ---------- Horaires habituels (présaisie matin / soir) ----------
function PresetBar({ settings, open, setOpen, onSave, canEdit }) {
  const [m, setM] = useState(settings.presetMorning);
  const [e, setE] = useState(settings.presetEvening);
  useEffect(() => { setM(settings.presetMorning); setE(settings.presetEvening); }, [settings]);
  const time = (v, on) => <input type="time" value={v} onChange={(ev) => on(ev.target.value)} style={{ ...inp, width: 118, padding: "8px 9px", fontSize: 14 }} />;
  return (
    <div style={{ background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14 }}>
          Horaires habituels proposés : matin <b>{settings.presetMorning.start}-{settings.presetMorning.end}</b> · soir <b>{settings.presetEvening.start}-{settings.presetEvening.end}</b>
          <span style={{ color: "var(--text-faint)" }}> (toujours modifiables jour par jour)</span>
        </span>
        {canEdit && <button onClick={() => setOpen(!open)} style={{ color: "var(--brass)", fontSize: 14 }}>{open ? "Fermer" : "Modifier"}</button>}
      </div>
      {open && (
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <span>Matin {time(m.start, (v) => setM({ ...m, start: v }))} → {time(m.end, (v) => setM({ ...m, end: v }))}</span>
          <span>Soir {time(e.start, (v) => setE({ ...e, start: v }))} → {time(e.end, (v) => setE({ ...e, end: v }))}</span>
          <button style={btnPrimary} onClick={async () => { await onSave({ presetMorning: m, presetEvening: e }); setOpen(false); }}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

// ---------- Sélecteur d'une période : état + horaires (habituel, boutons rapides, saisie libre) ----------
function PeriodPicker({ label, value, preset, presets, onChange }) {
  const st = periodState(value);
  const cur = st === "worked" ? `${value.start}-${value.end}` : null;
  const habitual = `${preset.start}-${preset.end}`;
  const set = (state) => onChange(state === "unset" ? null : state === "off" ? { state: "off" } : { state: "worked", start: value?.start || preset.start, end: value?.end || preset.end });
  const time = (k) => <input type="time" value={value?.[k] || ""} onChange={(e) => onChange({ ...(value || {}), state: "worked", [k]: e.target.value })} style={{ ...inp, width: 124 }} />;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 7 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
        {[["worked", "Travaillé"], ["off", "Non travaillé"], ["unset", "À planifier"]].map(([k, t]) => <button key={k} onClick={() => set(k)} style={{ ...chip(st === k), flex: 1, padding: "10px 4px" }}>{t}</button>)}
      </div>
      {st === "worked" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
            <button onClick={() => onChange(parseRange(habitual))} style={chip(cur === habitual)}>★ {habitual}</button>
            {presets.filter((p) => p !== habitual).map((p) => <button key={p} onClick={() => onChange(parseRange(p))} style={chip(cur === p)}>{p}</button>)}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: "var(--text-dim)" }}>
            Arrivée {time("start")} Départ {time("end")} <span>{fmtMin(periodMinutes(value))}</span>
          </div>
        </>
      )}
    </div>
  );
}

function CellEditor({ emp, date, plan, settings, color, onSave, onClose }) {
  const [morning, setMorning] = useState(plan?.morning || null);
  const [evening, setEvening] = useState(plan?.evening || null);
  const mk = (kind, preset) => (kind === "w" ? { state: "worked", ...preset } : kind === "o" ? { state: "off" } : null);
  const quick = (m, e) => { setMorning(mk(m, settings.presetMorning)); setEvening(mk(e, settings.presetEvening)); };
  const invalid = [morning, evening].some((p) => p?.state === "worked" && (!p.start || !p.end));
  const idx = (strToDate(date).getDay() + 6) % 7;
  return (
    <Modal onClose={onClose} title={null}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color.dot }} />
        <div><div style={{ fontWeight: 600, fontSize: 18 }}>{emp.displayName}</div><div style={{ fontSize: 13, color: "var(--text-dim)" }}>{DAYS_LONG[idx]} {fmtDay(date)}</div></div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <button style={btnGhost} onClick={() => quick("w", "w")}>Matin + soir</button>
        <button style={btnGhost} onClick={() => quick("w", "o")}>Matin seul</button>
        <button style={btnGhost} onClick={() => quick("o", "w")}>Soir seul</button>
        <button style={btnGhost} onClick={() => quick("o", "o")}>Aucun service</button>
      </div>
      <PeriodPicker label="Service du matin" value={morning} preset={settings.presetMorning} presets={PRESETS_MORNING} onChange={setMorning} />
      <PeriodPicker label="Service du soir" value={evening} preset={settings.presetEvening} presets={PRESETS_EVENING} onChange={setEvening} />
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 16 }}>
        Temps prévu : <b style={{ color: "var(--text)" }}>{fmtMin(periodMinutes(morning) + periodMinutes(evening))}</b>. « À planifier » n'est jamais compté comme non travaillé.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={btnGhost} onClick={onClose}>Annuler</button>
        <button style={{ ...btnPrimary, opacity: invalid ? 0.4 : 1 }} disabled={invalid} onClick={() => onSave({ morning: normalise(morning), evening: normalise(evening) })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

// ---------- Saisie groupée (qui ? quand ? quel horaire ?) ----------
function BulkEdit({ staff, all, dates, curMonth, settings, onSave, onClose }) {
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
  const stepTitle = ["", "Qui travaille ?", "Périmètre et jours", "Quel horaire ?"][step];
  return (
    <Modal onClose={onClose} title={`Saisie groupée · ${stepTitle}`}>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>{[1, 2, 3].map((n) => <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: step >= n ? "var(--brass)" : "var(--line)" }} />)}</div>
      {step === 1 && (
        <>
          <button onClick={() => setSel(sel.length === staff.length ? [] : staff.map((e) => e.id))} style={{ ...btnGhost, width: "100%", marginBottom: 10, borderStyle: "dashed" }}>
            {sel.length === staff.length ? "Tout désélectionner" : "Toute l'équipe affichée"}
          </button>
          <div style={{ display: "grid", gap: 8 }}>
            {staff.map((e) => { const c = colorOf(e.id, all), on = sel.includes(e.id); return (
              <button key={e.id} onClick={() => toggle(sel, setSel, e.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 11, background: on ? `color-mix(in srgb, ${c.dot} 18%, var(--ink-2))` : "var(--ink-2)", border: `1px solid ${on ? c.dot : "var(--line)"}`, color: "var(--text)" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.dot }} /><b>{e.displayName}</b><span style={{ marginLeft: "auto" }}>{on ? "✓" : ""}</span>
              </button>); })}
          </div>
          <div style={{ textAlign: "right", marginTop: 16 }}><button disabled={!sel.length} onClick={() => setStep(2)} style={{ ...btnPrimary, opacity: sel.length ? 1 : 0.4 }}>Suivant →</button></div>
        </>
      )}
      {step === 2 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <button onClick={() => setScope("week")} style={{ ...chip(scope === "week"), padding: 12 }}>Cette semaine<br /><span style={{ fontSize: 11, opacity: 0.7 }}>{fmtDay(dates[0])} – {fmtDay(dates[6])}</span></button>
            <button onClick={() => setScope("month")} style={{ ...chip(scope === "month"), padding: 12 }}>Tout le mois<br /><span style={{ fontSize: 11, opacity: 0.7 }}>{MONTHS_FR[curMonth.month - 1]}</span></button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {[["Lun – Ven", [0, 1, 2, 3, 4]], ["Week-end", [5, 6]], ["Tous", [0, 1, 2, 3, 4, 5, 6]]].map(([l, d]) => <button key={l} onClick={() => setSelDays(d)} style={btnGhost}>{l}</button>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 16 }}>
            {DAYS.map((d, i) => <button key={d} onClick={() => toggle(selDays, setSelDays, i)} style={{ ...chip(selDays.includes(i)), padding: "10px 4px" }}>{d}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button onClick={() => setStep(1)} style={btnGhost}>← Retour</button>
            <button disabled={!selDays.length} onClick={() => setStep(3)} style={{ ...btnPrimary, opacity: selDays.length ? 1 : 0.4 }}>Suivant →</button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <div style={{ background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 13 }}>
            <b>{staff.filter((e) => sel.includes(e.id)).map((e) => e.displayName).join(", ")}</b>
            <span style={{ color: "var(--text-dim)" }}> · {[...selDays].sort().map((d) => DAYS[d]).join(", ")} · {scope === "month" ? `tout ${MONTHS_FR[curMonth.month - 1]}` : "cette semaine"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button style={btnGhost} onClick={() => { setMorning({ state: "worked", ...settings.presetMorning }); setEvening({ state: "worked", ...settings.presetEvening }); }}>Matin + soir</button>
            <button style={btnGhost} onClick={() => { setMorning({ state: "worked", ...settings.presetMorning }); setEvening({ state: "off" }); }}>Matin seul</button>
            <button style={btnGhost} onClick={() => { setMorning({ state: "off" }); setEvening({ state: "worked", ...settings.presetEvening }); }}>Soir seul</button>
            <button style={btnGhost} onClick={() => { setMorning({ state: "off" }); setEvening({ state: "off" }); }}>Aucun service</button>
          </div>
          <PeriodPicker label="Service du matin" value={morning} preset={settings.presetMorning} presets={PRESETS_MORNING} onChange={setMorning} />
          <PeriodPicker label="Service du soir" value={evening} preset={settings.presetEvening} presets={PRESETS_EVENING} onChange={setEvening} />
          <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>Les journées déjà planifiées pour ces salariés et ces jours seront remplacées (l'ancien planning reste dans l'historique).</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button onClick={() => setStep(2)} style={btnGhost}>← Retour</button>
            <button disabled={!ok} onClick={go} style={{ ...btnPrimary, opacity: ok ? 1 : 0.4 }}>Appliquer</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Dupliquer une semaine ----------
function Duplicate({ monday, staff, api, onSave, onClose }) {
  const [src, setSrc] = useState(addDays(monday, -7));
  const [dst, setDst] = useState(monday);
  const same = src === dst;
  const sel = (v, set) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button style={navBtn} onClick={() => set(addDays(v, -7))}>‹</button>
      <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600 }}>{fmtDay(v)} – {fmtDay(addDays(v, 6))}</div>
      <button style={navBtn} onClick={() => set(addDays(v, 7))}>›</button>
    </div>
  );
  async function go() {
    const list = await api.getPlannings(src, addDays(src, 6));
    const by = mapPlans(list), out = [];
    staff.forEach((e) => weekDates(src).forEach((d, i) => {
      const p = by[`${e.id}_${d}`];
      out.push({ employeeId: e.id, date: addDays(dst, i), morning: normalise(p?.morning), evening: normalise(p?.evening) });
    }));
    onSave(out);
  }
  const box = { background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 11, padding: 12 };
  return (
    <Modal onClose={onClose} title="Dupliquer une semaine">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={box}><div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>Source</div>{sel(src, setSrc)}</div>
        <div style={box}><div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>Destination</div>{sel(dst, setDst)}</div>
      </div>
      <p style={{ fontSize: 13, color: same ? "var(--amber)" : "var(--text-dim)", marginBottom: 16 }}>
        {same ? "Choisissez deux semaines différentes." : `La semaine destination sera remplacée pour les ${staff.length} salarié(s) affiché(s) ; l'ancien planning reste dans l'historique. Un jour « à planifier » reste « à planifier ».`}
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button style={btnGhost} onClick={onClose}>Annuler</button>
        <button disabled={same} style={{ ...btnPrimary, opacity: same ? 0.4 : 1 }} onClick={go}>Dupliquer</button>
      </div>
    </Modal>
  );
}

// ---------- Compteur d'heures du mois : contrat / prévu / réel ----------
function HoursPanel({ staff, all, api, curMonth, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    const from = `${curMonth.year}-${String(curMonth.month).padStart(2, "0")}-01`;
    const to = dateToStr(new Date(curMonth.year, curMonth.month, 0));
    Promise.all([api.getPlannings(from, to), api.getDaysRange(from, to)]).then(([p, d]) => setData({ p, d }));
  }, [api, curMonth]);
  return (
    <Modal onClose={onClose} title={`Compteur d'heures · ${MONTHS_FR[curMonth.month - 1]} ${curMonth.year}`}>
      <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>Contrat mensuel = heures hebdomadaires × 52 / 12.</p>
      {!data ? <p style={{ color: "var(--text-dim)" }}>Chargement…</p> : staff.map((e) => {
        const c = colorOf(e.id, all);
        const planned = data.p.filter((x) => x.employeeId === e.id).reduce((a, x) => a + plannedWorkMinutes(x), 0);
        const actual = data.d.filter((x) => x.employeeId === e.id).reduce((a, x) => a + (x.workedMinutes || 0), 0);
        const contract = contractMonthMinutes(e.weeklyContractMinutes || 0);
        const diff = planned - contract, pct = contract ? Math.round((planned / contract) * 100) : 0;
        const col = diff < -60 ? "var(--red)" : diff > 60 ? "var(--amber)" : "var(--green)";
        return (
          <div key={e.id} style={{ marginBottom: 10, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 11, padding: "11px 13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
              <b><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.dot, marginRight: 8 }} />{e.displayName}</b>
              <span style={{ color: "var(--text-dim)" }}>Contrat <b style={{ color: "var(--text)" }}>{fmtMin(contract)}</b> · Prévu <b style={{ color: "var(--text)" }}>{fmtMin(planned)}</b> · Réel <b style={{ color: "var(--text)" }}>{fmtMin(actual)}</b></span>
              <b style={{ color: col }}>{diff === 0 ? "±0" : `${diff > 0 ? "+" : "−"}${fmtMin(Math.abs(diff))}`}</b>
            </div>
            <div style={{ marginTop: 8, height: 6, background: "var(--ink-3)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: col }} /></div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>{pct} % du contrat planifié{diff < -60 ? " · sous le contrat" : diff > 60 ? " · au-dessus du contrat" : ""}</div>
          </div>
        );
      })}
      <div style={{ textAlign: "right", marginTop: 8 }}><button style={btnGhost} onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

// ---------- Impression hebdomadaire (A4 paysage, blanc, gros caractères) ----------
// Une série de pages par magasin affiché. Pages équilibrées : jamais de tableau coupé au milieu
// d'une ligne, jamais de page presque vide. La taille du texte s'adapte au nombre de salariés (jamais sous 11 pt).
const MAX_ROWS_PER_PAGE = 12;
function PrintSheets({ dates, groups, plans }) {
  const pages = [];
  groups.forEach((g) => {
    let from = 0;
    paginateRows(g.staff.length, MAX_ROWS_PER_PAGE).forEach((n, i, arr) => { pages.push({ name: g.name, rows: g.staff.slice(from, from + n), part: arr.length > 1 ? `${i + 1}/${arr.length}` : "" }); from += n; });
  });
  const perPage = pages.length ? Math.max(...pages.map((p) => p.rows.length)) : 1;
  const pad = perPage <= 6 ? 5 : perPage <= 9 ? 3 : 1.5; // hauteur des lignes : remplit la page quand il y a peu de salariés
  const pt = perPage <= 5 ? 13 : perPage <= 7 ? 12.5 : perPage <= 9 ? 12 : 11;
  const border = "1px solid #333";
  // Heures compactes (8h-13h, 8h30-12h30) pour tenir dans la colonne d'un jour, même en gros caractères.
  const hh = (t) => { const [h, m] = t.split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };
  const cellTxt = (label, p) => {
    const st = periodState(p);
    return (
      <div style={{ textAlign: "center", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
        <span style={{ fontSize: `${pt - 4}pt`, color: "#666", marginRight: "1.2mm" }}>{label}</span>
        <span style={{ fontWeight: st === "worked" ? 700 : 400, color: st === "worked" ? "#000" : "#666" }}>
          {st === "worked" ? `${hh(p.start)}-${hh(p.end)}` : st === "off" ? "repos" : " "}
        </span>
      </div>
    );
  };
  return (
    <div className="print-only plan-print" aria-hidden="true">
      {pages.map((pg, pi) => (
        <section key={pi} style={{ breakAfter: pi === pages.length - 1 ? "auto" : "page", pageBreakAfter: pi === pages.length - 1 ? "auto" : "always", color: "#000", background: "#fff", fontSize: `${pt}pt` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4mm" }}>
            <h1 style={{ fontSize: "20pt", margin: 0 }}>Planning · semaine du {fmtLong(dates[0])} au {fmtLong(dates[6])}</h1>
            <span style={{ fontSize: "11pt", color: "#444" }}>{pg.name}{pg.part ? ` · page ${pg.part}` : ""}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead style={{ display: "table-header-group" }}>
              <tr>
                <th style={{ border, padding: "2mm", width: "13%", textAlign: "left", background: "#e8e8e8", fontSize: `${pt}pt` }}>Salarié</th>
                {dates.map((d, i) => <th key={d} style={{ border, padding: "2mm", background: "#e8e8e8", fontSize: `${pt}pt` }}>{DAYS_LONG[i]}<div style={{ fontWeight: 400, fontSize: `${pt - 2}pt` }}>{fmtDay(d)}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((e) => (
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
