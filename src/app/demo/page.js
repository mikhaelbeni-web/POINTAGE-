"use client";
// Page de démonstration : planning, suivi des pauses et déclaration au départ,
// avec des données FICTIVES gardées en mémoire. Aucune connexion à Firebase,
// aucune écriture : recharger la page remet tout à zéro. Les calculs sont les vrais (planLogic).
import { useMemo, useState } from "react";
import Planning from "../../components/Planning";
import Dashboard from "../../components/Dashboard";
import BreakDeclaration from "../../components/BreakDeclaration";
import { createDemoApi, DEMO_EMPLOYEES, DEMO_SITES } from "../../lib/demoApi";
import { dateToStr, mondayOf, addDays, plannedWorkMinutes, expectedBreakMinutes, hasPlanning, planSettings } from "../../lib/planLogic";

const tabBtn = (on) => ({ padding: "9px 15px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: on ? "#d8a84b" : "#1a1f28", color: on ? "#1a1204" : "#9aa5b4", border: `1px solid ${on ? "#d8a84b" : "#2f3846"}` });

export default function Demo() {
  const todayS = dateToStr(new Date());
  const api = useMemo(() => createDemoApi(todayS), [todayS]);
  const [tab, setTab] = useState("planning");
  const [followDate, setFollowDate] = useState(addDays(mondayOf(todayS), -7));
  const mon = mondayOf(todayS);

  return (
    <div style={{ minHeight: "100vh", maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
      <div className="no-print" style={{ padding: "12px 16px", borderRadius: 12, marginBottom: 16, background: "#2a2312", border: "1px solid #d8a84b", color: "#e8ecf2", fontSize: 14, lineHeight: 1.5 }}>
        <b>Page de démonstration — données fictives.</b> Rien n'est enregistré dans la vraie base : tout reste dans cette page et disparaît au rechargement.
        Les écrans et les calculs sont ceux de la future version (planning, tableau de bord avec pauses, déclaration de pause au départ).
      </div>
      <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        <button style={tabBtn(tab === "planning")} onClick={() => setTab("planning")}>Planning</button>
        <button style={tabBtn(tab === "badge")} onClick={() => setTab("badge")}>Pointeuse (départ)</button>
        <button style={tabBtn(tab === "follow")} onClick={() => setTab("follow")}>Tableau de bord</button>
      </div>
      {tab === "planning" && <Planning employees={DEMO_EMPLOYEES} sites={DEMO_SITES} allowedSiteIds={null} canEdit api={api} managerName="Démo" today={todayS} />}
      {tab === "follow" && <Dashboard key={followDate} employees={DEMO_EMPLOYEES} sites={DEMO_SITES} allowedSiteIds={null} canEdit source={api.dashboardSource} planApi={api} managerName="Démo" initialDate={followDate} onEditDay={() => {}} />}
      {tab === "badge" && <BadgeSim api={api} defaultDate={mon} onSeeFollow={(d) => { setFollowDate(d); setTab("follow"); }} />}
      <p className="no-print" style={{ color: "#6b7583", fontSize: 12, marginTop: 24 }}>
        Jeu d'essai : Sophie (planning complet), Karim (matin ou soir selon le jour), Léa (jeudi et vendredi non planifiés), Marc (aucun planning cette semaine), Inès (pointe sans aucun planning).
        Semaine précédente : pointages et déclarations déjà présents (voir « Tableau de bord »).
      </p>
    </div>
  );
}

// Simulation de l'écran de la pointeuse au moment du départ.
function BadgeSim({ api, defaultDate, onSeeFollow }) {
  const [empId, setEmpId] = useState(DEMO_EMPLOYEES[0].id);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("19:05");
  const [step, setStep] = useState(null); // { expected, measured }
  const [log, setLog] = useState([]);
  const emp = DEMO_EMPLOYEES.find((e) => e.id === empId);
  const plan = api.getPlan(empId, date);
  const day = api.getDayRaw(empId, date);
  const say = (t) => setLog((l) => [t, ...l].slice(0, 6));
  const fmt = (t) => (t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");

  const arrive = () => { api.demoPunch({ empId, date, type: "arrival", time }); say(`✓ ${emp.displayName} — Arrivée ${time} enregistrée${plan && hasPlanning(plan) ? " (planning trouvé : écarts calculés en arrière-plan)" : " (pas de planning : heure réelle conservée, aucun écart calculé)"}.`); };
  const depart = () => {
    if (plan && hasPlanning(plan)) {
      const expected = expectedBreakMinutes(plannedWorkMinutes(plan), planSettings(api.settings()));
      if (expected > 0) { setStep({ expected, measured: null }); return; }
    }
    api.demoPunch({ empId, date, type: "departure", time });
    say(`✓ ${emp.displayName} — Départ ${time} enregistré immédiatement : ${plan && hasPlanning(plan) ? "aucune pause à déclarer" : "pas de planning, aucune déclaration demandée"}.`);
  };
  const confirm = ({ status, declaredMinutes }) => {
    api.demoPunch({ empId, date, type: "departure", time, declaration: { status, declaredMinutes: status === "partial" ? declaredMinutes : status === "none" ? 0 : status === "taken" ? step.expected : null, expectedMinutesAtDeclaration: step.expected } });
    say(`✓ ${emp.displayName} — Départ ${time} enregistré avec déclaration « ${{ taken: "pauses prévues prises", partial: `${declaredMinutes} min`, none: "pause non prise", pending: "à régulariser" }[status]} » (attendu : ${step.expected} min).`);
    setStep(null);
  };

  const sel = { padding: "10px 12px", borderRadius: 9, background: "#1a1f28", border: "1px solid #2f3846", color: "#e8ecf2", fontSize: 15 };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select style={sel} value={empId} onChange={(e) => { setEmpId(e.target.value); setStep(null); }}>{DEMO_EMPLOYEES.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}</select>
        <input type="date" style={sel} value={date} onChange={(e) => { setDate(e.target.value); setStep(null); }} />
        <input type="time" style={sel} value={time} onChange={(e) => setTime(e.target.value)} />
        <span style={{ color: "#9aa5b4", fontSize: 14 }}>Planning ce jour : {plan && hasPlanning(plan) ? `${plannedWorkMinutes(plan)} min prévues` : "aucun"} · Arrivée {fmt(day?.arrival)} · Départ {fmt(day?.departure)}</span>
      </div>
      {!step ? (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={arrive} style={{ ...tabBtn(false), borderColor: "#4caf7d", padding: "18px 28px", fontSize: 18 }}>Arrivée</button>
          <button onClick={depart} style={{ ...tabBtn(false), borderColor: "#e0655f", padding: "18px 28px", fontSize: 18 }}>Départ</button>
        </div>
      ) : (
        <div style={{ background: "#12161c", border: "1px solid #2f3846", borderRadius: 16, padding: 20 }}>
          <BreakDeclaration emp={emp} expected={step.expected} measured={step.measured} onConfirm={confirm} onCancel={() => setStep(null)} />
        </div>
      )}
      <div style={{ color: "#9aa5b4", fontSize: 14, display: "grid", gap: 6 }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
        {log.length > 0 && <button style={{ ...tabBtn(false), width: "fit-content" }} onClick={() => onSeeFollow(date)}>Voir ce jour dans le tableau de bord →</button>}
      </div>
    </div>
  );
}
