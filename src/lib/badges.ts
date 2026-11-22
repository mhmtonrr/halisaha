/**
 * Profil rozetleri: maç kayıtlarından hesaplanır (saf, badges.test.ts). Veritabanında saklanmaz;
 * kurallar değişirse herkesin rozeti kendiliğinden güncellenir.
 */
import type { MatchRecord } from "./attributes";

export interface Badge {
  id: string;
  title: string;
  description: string;
  /** Sağ üstte gösterilen değer ("x3 kez", "5 maç") */
  value: string;
  icon: string;
  tone: "primary" | "secondary" | "tertiary";
}

/** Eskiden yeniye sıralı kayıtlarda en uzun ardışık dizi */
function longest(records: MatchRecord[], ok: (r: MatchRecord) => boolean) {
  let best = 0;
  let cur = 0;
  for (const r of records) {
    cur = ok(r) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function computeBadges(records: MatchRecord[], noShows: number): Badge[] {
  const chrono = [...records].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const played = chrono.length;
  const goals = chrono.reduce((s, r) => s + r.goals, 0);
  const assists = chrono.reduce((s, r) => s + r.assists, 0);
  const saves = chrono.reduce((s, r) => s + r.saves, 0);
  const mvps = chrono.filter((r) => r.mvp).length;
  const hatTricks = chrono.filter((r) => r.goals >= 3).length;
  const unbeaten = longest(chrono, (r) => r.outcome !== "loss");
  const wins = longest(chrono, (r) => r.outcome === "win");

  const out: Badge[] = [];
  if (hatTricks >= 1)
    out.push({ id: "hattrick", title: "Hat-trick Kahramanı", description: "Bir maçta 3 ve üzeri gol atanlar kulübü.", value: `x${hatTricks} kez`, icon: "sports_and_outdoors", tone: "primary" });
  if (unbeaten >= 5)
    out.push({ id: "unbeaten", title: "Yenilmezlik Serisi", description: "Üst üste 5 ve üzeri maçta mağlubiyet almadı.", value: `${unbeaten} maç`, icon: "shield_with_heart", tone: "secondary" });
  if (wins >= 3)
    out.push({ id: "winstreak", title: "Galibiyet Serisi", description: "Üst üste 3 ve üzeri maç kazandı.", value: `${wins} maç`, icon: "local_fire_department", tone: "primary" });
  if (mvps >= 10)
    out.push({ id: "mvp10", title: "Maçın Efendisi", description: "10 ve üzeri maçta maçın adamı seçildi.", value: `${mvps} kez`, icon: "workspace_premium", tone: "primary" });
  else if (mvps >= 3)
    out.push({ id: "mvp3", title: "MVP Avcısı", description: "3 ve üzeri maçta maçın adamı seçildi.", value: `${mvps} kez`, icon: "military_tech", tone: "primary" });
  if (goals >= 25)
    out.push({ id: "goals25", title: "Gol Makinesi", description: "Toplam 25 ve üzeri gol attı.", value: `${goals} gol`, icon: "sports_soccer", tone: "primary" });
  if (assists >= 10)
    out.push({ id: "assists10", title: "Asist Kralı", description: "Toplam 10 ve üzeri asist yaptı.", value: `${assists} asist`, icon: "conversion_path", tone: "tertiary" });
  if (saves >= 20)
    out.push({ id: "saves20", title: "Kale Bekçisi", description: "Toplam 20 ve üzeri kurtarış yaptı.", value: `${saves} kurtarış`, icon: "sports_handball", tone: "tertiary" });
  if (played >= 25)
    out.push({ id: "played25", title: "Sahanın Müdavimi", description: "25 ve üzeri maç oynadı.", value: `${played} maç`, icon: "stadium", tone: "secondary" });
  else if (played >= 10)
    out.push({ id: "played10", title: "Düzenli Oyuncu", description: "10 ve üzeri maç oynadı.", value: `${played} maç`, icon: "stadium", tone: "secondary" });
  if (played >= 10 && noShows === 0)
    out.push({ id: "reliable", title: "Tam Güvenilir", description: "10 ve üzeri maç oynadı, hiç gelmemezlik yapmadı.", value: "%100", icon: "verified", tone: "primary" });
  return out;
}
