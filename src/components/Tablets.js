"use client";
import { useEffect, useState } from "react";
import { watchTablets, deleteTablet } from "../lib/store";

// Seuil : sans battement depuis plus de 6 min -> considérée hors ligne.
// (battement toutes les 2 min ; on tolère 3 cycles manqués)
const OFFLINE_AFTER_MS = 6 * 60 * 1000;

export default function Tablets({ sites = [] }) {
  const [tablets, setTablets] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsub = watchTablets(setTablets);
    const iv = setInterval(() => setNow(Date.now()), 30 * 1000); // rafraîchit l'état every 30s
    return () => { unsub(); clearInterval(iv); };
  }, []);

  const siteName = (id) => sites.find((s) => s.id === id)?.name || "—";

  function lastSeenMs(t) {
    const ls = t.lastSeen;
    if (!ls) return null;
    return ls.toMillis ? ls.toMillis() : new Date(ls).getTime();
  }

  function fmtAgo(ms) {
    if (ms == null) return "jamais";
    const diff = now - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    return `il y a ${d} j`;
  }

  const rows = tablets
    .map((t) => {
      const ms = lastSeenMs(t);
      const online = ms != null && (now - ms) < OFFLINE_AFTER_MS;
      return { ...t, ms, online };
    })
    .sort((a, b) => (b.ms || 0) - (a.ms || 0));

  async function forget(t) {
    if (!confirm("Retirer cette tablette de la liste ? Elle réapparaîtra si elle se reconnecte.")) return;
    await deleteTablet(t.id);
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>État des tablettes</h2>
      <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 18 }}>
        Chaque tablette signale sa présence toutes les 2 minutes. Une tablette sans signal depuis plus de 6 minutes est considérée hors ligne (Wi-Fi coupé, éteinte, ou app fermée). La détection a quelques minutes de délai — c'est normal, une tablette sans réseau ne peut pas signaler qu'elle est hors ligne.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>Aucune tablette ne s'est encore signalée. Ouvre l'app sur une tablette pour la voir apparaître ici.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((t) => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
              background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 11,
              borderLeft: `4px solid ${t.online ? "var(--green)" : "var(--red)"}`,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {t.siteName || siteName(t.siteId)}
                  <span style={{
                    marginLeft: 10, fontSize: 12, fontWeight: 600,
                    color: t.online ? "var(--green)" : "var(--red)",
                  }}>
                    {t.online ? "● En ligne" : "● Hors ligne"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>
                  Dernier contact : {fmtAgo(t.ms)}
                  {!t.online && t.ms && " — vérifier le Wi-Fi de ce magasin"}
                </div>
              </div>
              <button onClick={() => forget(t)} style={{
                fontSize: 13, color: "var(--text-faint)", padding: "6px 10px",
                background: "transparent", border: "1px solid var(--line)", borderRadius: 8,
              }}>Retirer</button>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 18 }}>
        Note : les badges faits pendant une coupure Wi-Fi ne sont pas perdus — ils sont gardés dans la tablette et envoyés automatiquement au retour du réseau.
      </p>
    </div>
  );
}
