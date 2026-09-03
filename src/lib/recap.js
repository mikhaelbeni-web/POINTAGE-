// ============================================================
// recap.js — Agrégation hebdo & mensuelle à partir des jours.
// ============================================================
import { weekKey, classifyWeek, isoWeekday } from "./timeLogic";

/** Toutes les dates "YYYY-MM-DD" d'un mois (year, month 1-12). */
export function monthDates(year, month) {
  const dates = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return dates;
}

export function monthBounds(year, month) {
  const last = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

/**
 * Construit le récap mensuel d'UN salarié.
 * @param emp     employé
 * @param settings réglages
 * @param days    docs days/ du mois (peut être partiel)
 * @param leaves  congés chevauchant le mois
 * @returns { weeks:[...], totals:{...} }
 */
export function buildMonthlyRecap(emp, settings, days, leaves, year, month) {
  const byDate = {};
  days.forEach((d) => (byDate[d.date] = d));

  const leaveByDate = {};
  leaves.forEach((l) => {
    let cur = new Date(l.startDate);
    const end = new Date(l.endDate);
    while (cur <= end) {
      leaveByDate[cur.toISOString().slice(0, 10)] = l.type;
      cur.setDate(cur.getDate() + 1);
    }
  });

  // Regrouper par semaine ISO
  const weeksMap = {};
  for (const date of monthDates(year, month)) {
    const wk = weekKey(date);
    if (!weeksMap[wk]) weeksMap[wk] = { weekKey: wk, rows: [], workedMinutes: 0 };
    const d = byDate[date];
    const leave = leaveByDate[date];
    const worksToday = (emp.workDays || []).includes(isoWeekday(date));

    let status = "off";
    let worked = 0, late = 0, restViolation = false;
    if (leave) status = "leave";
    else if (d) {
      status = d.status;
      worked = d.workedMinutes || 0;
      late = d.lateMinutes || 0;
      restViolation = d.restViolation || false;
    } else if (worksToday) status = "absent";

    weeksMap[wk].rows.push({
      date, status, worked, late, restViolation, leaveType: leave || null,
      arrival: d?.arrival || null, departure: d?.departure || null,
      breakMinutes: d?.breakMinutes || 0,
    });
    weeksMap[wk].workedMinutes += worked;
  }

  const weeks = Object.values(weeksMap)
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
    .map((w) => {
      const cls = classifyWeek(w.workedMinutes, emp, settings);
      const lateTotal = w.rows.reduce((s, r) => s + r.late, 0);
      const absences = w.rows.filter((r) => r.status === "absent").length;
      const restViolations = w.rows.filter((r) => r.restViolation).length;
      return { ...w, ...cls, lateTotal, absences, restViolations };
    });

  const totals = weeks.reduce(
    (t, w) => ({
      workedMinutes: t.workedMinutes + w.workedMinutes,
      overtimeMinutes: t.overtimeMinutes + w.overtimeMinutes,
      lateMinutes: t.lateMinutes + w.lateTotal,
      absences: t.absences + w.absences,
      restViolations: t.restViolations + w.restViolations,
    }),
    { workedMinutes: 0, overtimeMinutes: 0, lateMinutes: 0, absences: 0, restViolations: 0 }
  );
  totals.overtimeType = emp.contractType === "part" ? "complementary" : "supplementary";

  return { weeks, totals };
}
