import Link from "next/link";
import type { ReactNode } from "react";
import { PlayerCard } from "@/components/PlayerCard";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { FOOT_NAME, POSITION_LABEL, POSITION_NAME, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { cardSkills, skillSet } from "@/lib/skills";
import { reliability } from "@/lib/reliability";
import { computeBadges } from "@/lib/badges";
import { computeProfileStats, type Outcome, type ProfileMatch } from "@/lib/profile-stats";
import type { Person, UpcomingMatch } from "@/lib/profile-data";
import { FlipCard } from "./FlipCard";
import { MatchesList } from "./MatchesList";
import { RadarChart } from "./RadarChart";
import { ShareButton } from "./ShareButton";

export type ProfileTab = "genel" | "istatistik" | "maclar" | "ayarlar";

const TAB_LABEL: Record<ProfileTab, string> = { genel: "Genel", istatistik: "İstatistik", maclar: "Maçlar", ayarlar: "Ayarlar" };

export function parseTab(raw: string | undefined, isMe: boolean): ProfileTab {
  const t = (raw ?? "genel") as ProfileTab;
  if (t === "ayarlar") return isMe ? "ayarlar" : "genel";
  return t in TAB_LABEL ? t : "genel";
}

const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : "–");

/** Bölüm başlığı: sol yeşil çubuk + büyük harf */
function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span className="h-4 w-1.5 rounded-full bg-primary" />
        <h3 className="t-headline-sm font-bold uppercase tracking-wider text-on-surface">{children}</h3>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

/** Dört sekmede de aynı çubuk: eşit genişlikli hap sekmeler, sayfa değişince yer değiştirmez */
function Tabs({ base, active, isMe }: { base: string; active: ProfileTab; isMe: boolean }) {
  const tabs: ProfileTab[] = isMe ? ["genel", "istatistik", "maclar", "ayarlar"] : ["genel", "istatistik", "maclar"];
  return (
    <div className="py-2">
      <div className="flex items-center gap-1" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t}
            href={t === "genel" ? base : `${base}?sekme=${t}`}
            replace
            role="tab"
            aria-selected={active === t}
            className={cx(
              "t-body-md min-w-0 flex-1 truncate rounded-full border border-transparent px-2 py-2 text-center transition-colors",
              active === t ? "t-headline-sm !text-[14px] bg-primary text-on-primary" : "border-line text-on-surface-variant hover:border-primary/50 hover:text-on-surface",
            )}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genel
// ---------------------------------------------------------------------------

const outcomeLetter: Record<Outcome, string> = { win: "G", draw: "B", loss: "M" };

/** Kartın arka yüzü (titanyum): gol/asist, boy-kilo-ayak, kazanma oranı, son 5 maç formu */
function CardBack({ person, stats, last5 }: { person: Person; stats: ReturnType<typeof computeProfileStats> | null; last5: ProfileMatch[] }) {
  const p = person.profile;
  const t = stats?.totals;
  const rate = t && t.played ? Math.round((t.wins / t.played) * 100) : 0;
  const posCodes = [p.position, ...p.secondary.slice(0, 1)].filter((x): x is Position => !!x).map((x) => POSITION_LABEL[x]).join(" / ");
  const year = new Date().getFullYear();
  return (
    <div className="h-full w-full rounded-[22px] bg-gradient-to-b from-slate-200 via-slate-400 to-slate-700 p-[2.5px] shadow-[0_14px_30px_rgba(0,0,0,0.85)]">
      <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[19.5px] border border-slate-600/40 bg-gradient-to-b from-[#182330] via-[#0f1722] to-[#080d14] p-3 text-slate-100">
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-slate-300/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-slate-400/10 blur-2xl" />
        <div className="relative z-10 flex items-start justify-between gap-1 border-b border-slate-700/70 pb-2">
          <div className="flex min-w-0 flex-col text-left">
            <span className="t-label-caps text-[9px] font-bold tracking-wider text-slate-400">SEZON {year} • PRO İSTATİSTİK</span>
            <h2 className="truncate text-[16px] font-bold leading-tight text-white">{p.cardName || p.displayName}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-500/40 bg-slate-800/90 px-2 py-0.5 shadow-inner">
            <span className="font-display text-[16px] font-bold leading-none text-white">{person.overall}</span>
            {posCodes && <span className="text-[11px] font-bold leading-none text-slate-300">{posCodes}</span>}
          </div>
        </div>
        <div className="relative z-10 my-1 grid grid-cols-2 gap-2">
          {[
            { label: "Goller", value: `${t?.goals ?? 0} Gol`, icon: "sports_soccer" },
            { label: "Asistler", value: `${t?.assists ?? 0} Asist`, icon: "steps" },
          ].map((x) => (
            <div key={x.label} className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/80 p-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-600/40 bg-slate-800 text-slate-200">
                <Icon name={x.icon} className="text-[16px]" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[10px] font-medium text-slate-400">{x.label}</span>
                <span className="font-display text-[14px] font-bold text-white">{x.value}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-1 rounded-lg border border-slate-700/50 bg-slate-900/70 px-1 py-1 text-center">
          <div className="flex flex-col"><span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">Boy</span><span className="text-[11px] font-bold text-slate-100">{p.heightCm ? `${(p.heightCm / 100).toFixed(2)} m` : "–"}</span></div>
          <div className="flex flex-col border-x border-slate-700/60"><span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">Kilo</span><span className="text-[11px] font-bold text-slate-100">{p.weightKg ? `${p.weightKg} kg` : "–"}</span></div>
          <div className="flex flex-col"><span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">Ayak</span><span className="text-[11px] font-bold text-slate-100">{p.foot ? FOOT_NAME[p.foot] : "–"}</span></div>
        </div>
        <div className="relative z-10 flex flex-col gap-1.5 rounded-lg border border-slate-700/50 bg-slate-900/80 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Icon name="trending_up" className="text-[15px] text-slate-300" />
              <span className="text-[11px] font-semibold text-slate-200">Kazanma Oranı</span>
            </div>
            <span className="rounded border border-slate-600/40 bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold text-slate-100">{t && t.played ? `%${rate} Galibiyet` : "–"}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full border border-slate-700/50 bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-slate-400 via-slate-200 to-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" style={{ width: `${rate}%` }} />
          </div>
          <div className="flex justify-between pt-0.5 text-[10px] text-slate-400">
            <span>Toplam: <strong className="text-slate-200">{t?.played ?? 0} Maç</strong></span>
            <span>MVP: <strong className="text-slate-100">{t?.mvps ?? 0} Kez Seçildi</strong></span>
          </div>
        </div>
        <div className="relative z-10 flex flex-col gap-1">
          <span className="text-left text-[9px] font-semibold uppercase tracking-wider text-slate-400">Son 5 Maç Formu</span>
          <div className="flex items-center justify-between px-1">
            {last5.length === 0 && <span className="text-[10px] text-slate-500">Henüz maç yok</span>}
            {last5.map((m) => (
              <span
                key={m.matchId}
                className={cx(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shadow-sm",
                  m.outcome === "win" && "border border-slate-100 bg-gradient-to-b from-slate-200 to-slate-400 text-slate-950",
                  m.outcome === "draw" && "border border-slate-500/40 bg-slate-700 text-slate-200",
                  m.outcome === "loss" && "border border-red-500/40 bg-red-950 text-red-200",
                )}
              >
                {outcomeLetter[m.outcome]}
              </span>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-center gap-1 border-t border-slate-700/60 pt-1 text-[10px] font-medium text-slate-400">
          <span>Kartı tekrar çevir</span>
          <Icon name="sync" className="text-[13px] text-slate-300" />
        </div>
      </div>
    </div>
  );
}

const SKILL_STYLE: Record<string, { icon: string; text: string; bar: string; iconText: string }> = {
  HIZ: { icon: "sprint", text: "text-primary", bar: "bg-primary", iconText: "text-primary" },
  ŞUT: { icon: "sports_soccer", text: "text-secondary", bar: "bg-secondary", iconText: "text-secondary" },
  PAS: { icon: "alt_route", text: "text-primary", bar: "bg-primary", iconText: "text-primary" },
  DRİ: { icon: "rebase_edit", text: "text-tertiary", bar: "bg-tertiary", iconText: "text-tertiary" },
  DEF: { icon: "security", text: "text-on-surface", bar: "bg-on-surface-variant", iconText: "text-on-surface-variant" },
  FİZ: { icon: "fitness_center", text: "text-secondary", bar: "bg-secondary", iconText: "text-secondary" },
  REF: { icon: "bolt", text: "text-primary", bar: "bg-primary", iconText: "text-primary" },
  ATL: { icon: "flight", text: "text-secondary", bar: "bg-secondary", iconText: "text-secondary" },
  HAV: { icon: "air", text: "text-tertiary", bar: "bg-tertiary", iconText: "text-tertiary" },
  YER: { icon: "my_location", text: "text-primary", bar: "bg-primary", iconText: "text-primary" },
  DAĞ: { icon: "share", text: "text-secondary", bar: "bg-secondary", iconText: "text-secondary" },
  İLT: { icon: "campaign", text: "text-on-surface", bar: "bg-on-surface-variant", iconText: "text-on-surface-variant" },
};

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { weekday: "short", timeZone: "Europe/Istanbul" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

function GeneralPanel({
  person,
  isMe,
  stats,
  last5,
  upcoming,
}: {
  person: Person;
  isMe: boolean;
  stats: ReturnType<typeof computeProfileStats> | null;
  last5: ProfileMatch[];
  upcoming: UpcomingMatch[];
}) {
  const p = person.profile;
  const keeper = p.position === "GK";
  const team = person.groups.find((g) => g.kind === "team" && !g.isLoan && !g.left);
  const skills = cardSkills(person.skills, keeper);

  return (
    <>
      <div className="flex flex-col items-center pt-4">
        <FlipCard
          back={<CardBack person={person} stats={stats} last5={last5} />}
          front={
            <PlayerCard
              name={p.displayName}
              cardName={p.cardName}
              photoUrl={p.photoUrl}
              overall={person.overall}
              position={p.position}
              skills={skills}
              city={p.city}
              district={p.district}
              team={team ? { name: team.name, color: team.color } : null}
              unrated={person.matchesPlayed === 0}
            />
          }
        />
      </div>

      <div className="mt-5">
        <ShareButton path={`/oyuncu/${p.id}`} title={`${p.displayName} · Halısaha kartı`} />
      </div>

      <div className="mt-7 flex flex-col gap-3">
        <Heading
          action={
            isMe ? (
              <Link href="/yetenek" className="t-body-sm flex items-center gap-1 font-medium text-primary hover:text-primary-fixed-dim">
                <span>Arkadaşlarını puanla</span>
                <Icon name="arrow_forward" className="text-[16px]" />
              </Link>
            ) : undefined
          }
        >
          Yetenekler
        </Heading>
        <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-md">
          {skillSet(keeper).map((sk) => {
            const v = skills.find((x) => x.key === sk.key)?.value ?? null;
            const st = SKILL_STYLE[sk.key];
            return (
              <div key={sk.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="t-body-md flex items-center gap-1.5 font-semibold text-on-surface">
                    <Icon name={st.icon} className={cx("text-[18px]", st.iconText)} /> {sk.label}
                  </span>
                  <span className={cx("t-stat-md", st.text)}>{v ?? "–"}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-highest">
                  {v !== null && <div className={cx("h-full rounded-full transition-all duration-700 ease-out", st.bar)} style={{ width: `${v}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-2">
        <Heading>Oyuncu bilgileri</Heading>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 rounded-xl border border-slate-700/50 bg-surface-container p-3 shadow-sm">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon name="location_on" className="text-[16px] text-tertiary" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Bölge</span>
            </div>
            <span className="truncate text-[13px] font-semibold text-white">{p.city ? formatRegion(p.city, p.district).replace(", ", " / ") : "–"}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-slate-700/50 bg-surface-container p-3 shadow-sm">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon name="sports" className="text-[16px] text-primary" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Ana Mevki</span>
            </div>
            {p.position ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-white">{POSITION_NAME[p.position]}</span>
                <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{POSITION_LABEL[p.position]}</span>
              </div>
            ) : (
              <span className="text-[13px] font-semibold text-white">–</span>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-slate-700/50 bg-surface-container p-3 shadow-sm">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon name="swap_horiz" className="text-[16px] text-secondary" />
              <span className="text-[11px] font-medium uppercase tracking-wider">İkinci Mevki</span>
            </div>
            {p.secondary.length ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {p.secondary.map((x) => (
                  <span key={x} className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-white">{POSITION_NAME[x]}</span>
                    <span className="rounded border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[10px] font-bold text-secondary">{POSITION_LABEL[x]}</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[13px] font-semibold text-white">–</span>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-slate-700/50 bg-surface-container p-3 shadow-sm">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon name="steps" className="text-[16px] text-slate-300" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Ayak</span>
            </div>
            <span className="text-[13px] font-semibold text-white">{p.foot ? (p.foot === "B" ? "İki ayak" : `${FOOT_NAME[p.foot]} Ayak`) : "–"}</span>
          </div>
        </div>
      </div>

      {isMe && upcoming.length > 0 && (
        <div className="mt-7">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-4 w-1.5 rounded-full bg-primary" />
            <h3 className="t-headline-sm font-bold uppercase tracking-wider text-on-surface">Planlanmış maçlar</h3>
          </div>
          <div className="flex flex-col gap-2">
            {upcoming.slice(0, 3).map((u) => (
              <Link key={u.matchId} href={`/g/${u.groupId}/m/${u.matchId}`} className="flex items-center justify-between rounded-xl bg-surface-container p-3.5 shadow-md">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container/20 text-primary">
                    <Icon name="calendar_month" className="text-[22px]" />
                  </div>
                  <span className="t-body-md truncate font-medium text-on-surface">
                    {u.venue || u.groupName} • {shortDay(u.playedAt)} {clock(u.playedAt)}
                  </span>
                </div>
                <span className="t-label-sm whitespace-nowrap rounded-full bg-surface-high px-2.5 py-1 text-secondary">Kadroda</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// İstatistik
// ---------------------------------------------------------------------------

const FORM_CHIP: Record<Outcome, { chip: string; score: string }> = {
  win: { chip: "bg-primary text-on-primary shadow-[0_0_8px_rgba(75,226,119,0.3)]", score: "text-primary" },
  draw: { chip: "bg-tertiary-container text-on-tertiary-container", score: "text-tertiary" },
  loss: { chip: "bg-error-container text-on-error-container", score: "text-error" },
};

const BADGE_TONE = {
  primary: { box: "from-primary-container to-surface-lowest text-on-primary-container", text: "text-primary" },
  secondary: { box: "from-secondary-container to-surface-lowest text-on-secondary-container", text: "text-secondary" },
  tertiary: { box: "from-tertiary-container to-surface-lowest text-on-tertiary-container", text: "text-tertiary" },
} as const;

function StatsPanel({
  person,
  stats,
  noShows,
  isMe,
  allMatches,
}: {
  person: Person;
  stats: ReturnType<typeof computeProfileStats>;
  noShows: number;
  isMe: boolean;
  allMatches: ProfileMatch[];
}) {
  const t = stats.totals;
  const keeper = person.profile.position === "GK";
  const rel = reliability(t.played, noShows);

  if (t.played === 0) {
    return (
      <div className="rounded-xl bg-surface-container p-4 text-center text-sm text-on-surface-variant">
        {isMe ? "Henüz sonucu girilmiş maçın yok." : "Henüz sonucu girilmiş maçı yok."} İlk maçtan sonra gol, asist, galibiyet ve form burada görünür.
      </div>
    );
  }

  // Son 5 maç: eskiden yeniye (soldan sağa)
  const last5 = allMatches.slice(0, 5).reverse();
  const scored = last5.filter((m) => m.matchScore !== null && m.weight > 0);
  const avg = scored.length ? scored.reduce((s, m) => s + m.matchScore!, 0) / scored.length : null;
  let trend: { icon: string; text: string } = { icon: "trending_flat", text: "Form eğilimi dengeli" };
  if (scored.length >= 3) {
    const lastScore = scored[scored.length - 1].matchScore!;
    const prev = scored.slice(0, -1).reduce((s, m) => s + m.matchScore!, 0) / (scored.length - 1);
    if (lastScore - prev > 0.3) trend = { icon: "trending_up", text: "Son maç form eğilimi yükselişte" };
    else if (prev - lastScore > 0.3) trend = { icon: "trending_down", text: "Son maç form eğilimi düşüşte" };
  }
  const cnt = (o: Outcome) => last5.filter((m) => m.outcome === o).length;
  const badges = computeBadges(allMatches, noShows);
  const perMatch = (x: number) => (t.played ? (x / t.played).toFixed(2) : "0.00");

  return (
    <div className="flex flex-col gap-5 pt-3">
      <div className="relative flex flex-col gap-3.5 overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-md">
        <div className="pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-primary/10 blur-2xl" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-headline-sm font-bold text-on-surface">PERFORMANS DAĞILIMI</h2>
          {t.mvps > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-surface-high px-3 py-1.5 shadow-[0_0_12px_rgba(75,226,119,0.2)]">
              <Icon name="military_tech" fill className="text-[18px] text-primary" />
              <div className="flex flex-col leading-none">
                <span className="t-label-caps text-[9px] uppercase text-on-surface-variant">MAÇIN ADAMI</span>
                <span className="t-stat-md !text-[13px] font-bold text-primary">{t.mvps} KEZ MVP</span>
              </div>
            </div>
          )}
        </div>
        <div className="relative flex w-full items-center justify-center py-2">
          <RadarChart skills={cardSkills(person.skills, keeper)} keeper={keeper} />
        </div>
      </div>

      <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-md">
        <div className="flex items-center justify-between">
          <h2 className="t-headline-sm font-bold text-on-surface">FORM VE PERFORMANS</h2>
          {avg !== null && <div className="t-label-caps rounded-full bg-secondary/10 px-2 py-1 font-bold text-secondary">ORT. {avg.toFixed(1)}</div>}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {last5.map((m) => {
            const st = FORM_CHIP[m.outcome];
            const sc = m.matchScore !== null && m.weight > 0 ? m.matchScore.toFixed(1) : "–";
            return (
              <div key={m.matchId} className={cx("relative flex flex-col items-center gap-2 overflow-hidden rounded-xl bg-surface-high p-2.5", m.mvp && "ring-1 ring-primary/40")}>
                {m.mvp && <div className="absolute right-0 top-0 h-3 w-3 rounded-bl-md bg-primary/30" />}
                <span className={cx("t-headline-sm flex h-7 w-7 items-center justify-center rounded-full !text-[13px] font-bold", st.chip, m.mvp && "shadow-[0_0_12px_rgba(75,226,119,0.5)]")}>{outcomeLetter[m.outcome]}</span>
                <div className="flex flex-col items-center">
                  <span className={cx("t-stat-md !text-[14px] font-bold", st.score)}>{sc}</span>
                  <span className={cx("t-label-caps text-[9px]", m.mvp ? "font-bold text-primary" : "text-on-surface-variant")}>
                    {m.mvp ? "★ MVP" : m.goals > 0 ? `${m.goals} GOL` : m.assists > 0 ? `${m.assists} ASİST` : m.saves > 0 ? `${m.saves} KRT` : "-"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="t-body-sm flex items-center justify-between gap-2 pt-1 text-on-surface-variant">
          <span className="flex items-center gap-1">
            <Icon name={trend.icon} className="text-[15px] text-primary" />
            {trend.text}
          </span>
          <span className="t-label-caps shrink-0 text-on-surface-variant">
            {last5.length} MAÇ: {cnt("win")}G {cnt("draw")}B {cnt("loss")}M
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="t-label-caps uppercase tracking-wider">Oynanan Maç</span>
            <Icon name="stadium" className="text-[18px] text-primary" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="t-stat-lg font-bold tracking-tight text-on-surface">{t.played}</span>
            <span className="t-body-sm text-on-surface-variant">maç</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-primary">
            <Icon name="timelapse" className="text-[13px]" />
            <span className="t-body-sm font-semibold">≈ {(t.played * 60).toLocaleString("tr-TR")} dk saha</span>
          </div>
        </div>
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="t-label-caps uppercase tracking-wider">{keeper ? "Kurtarış" : "Toplam Gol"}</span>
            <Icon name={keeper ? "sports_handball" : "sports_soccer"} className="text-[18px] text-primary" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="t-stat-lg font-bold tracking-tight text-primary">{keeper ? t.saves : t.goals}</span>
            <span className="t-body-sm text-on-surface-variant">{keeper ? "kurtarış" : "gol"}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-on-surface-variant">
            <span className="t-label-caps font-bold text-secondary">{perMatch(keeper ? t.saves : t.goals)}</span>
            <span className="t-body-sm">maç başı</span>
          </div>
        </div>
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="t-label-caps uppercase tracking-wider">Toplam Asist</span>
            <Icon name="conversion_path" className="text-[18px] text-tertiary" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="t-stat-lg font-bold tracking-tight text-tertiary">{t.assists}</span>
            <span className="t-body-sm text-on-surface-variant">asist</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-on-surface-variant">
            <span className="t-label-caps font-bold text-tertiary-fixed-dim">{perMatch(t.assists)}</span>
            <span className="t-body-sm">maç başı</span>
          </div>
        </div>
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="t-label-caps uppercase tracking-wider">Galibiyet</span>
            <Icon name="verified" className="text-[18px] text-secondary" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="t-stat-lg font-bold tracking-tight text-secondary">{pct(t.wins, t.played)}</span>
            <span className="t-body-sm text-on-surface-variant">oran</span>
          </div>
          <div className="t-label-caps mt-1 flex items-center gap-1 tracking-tighter">
            <span className="font-bold text-primary">{t.wins}G</span>
            <span className="text-on-surface-variant">-</span>
            <span className="font-bold text-tertiary">{t.draws}B</span>
            <span className="text-on-surface-variant">-</span>
            <span className="font-bold text-error">{t.losses}M</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-md">
        <div className="flex items-center justify-between">
          <h2 className="t-headline-sm font-bold text-on-surface">KAZANILAN ROZETLER</h2>
          <span className="t-label-caps rounded-full bg-primary/10 px-2.5 py-1 font-bold text-primary">{badges.length} ROZET</span>
        </div>
        {badges.length === 0 ? (
          <p className="t-body-sm text-on-surface-variant">Henüz rozet yok. Hat-trick, galibiyet serisi, MVP ve maç sayısı gibi hedeflere ulaştıkça burada görünür.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {badges.map((b) => {
              const tone = BADGE_TONE[b.tone];
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-xl bg-surface-high p-2">
                  <div className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-md", tone.box)}>
                    <Icon name={b.icon} className="text-[26px]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <span className="t-headline-sm truncate !text-[15px] font-bold text-on-surface">{b.title}</span>
                      <span className={cx("t-label-caps shrink-0 font-bold uppercase", tone.text)}>{b.value}</span>
                    </div>
                    <p className="t-body-sm line-clamp-1 text-on-surface-variant">{b.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-2 flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-md">
        <div className="flex items-center justify-between">
          <h2 className="t-headline-sm font-bold text-on-surface">GÜVENİLİRLİK</h2>
          {rel.pct !== null && rel.tone !== "new" && (
            <div className="t-label-caps flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-bold text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span>%{rel.pct} GÜVEN SKORU</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-high p-2 shadow-sm">
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="t-label-caps uppercase tracking-wider">Oynadığı Maç</span>
              <Icon name="event_available" className="text-[18px] text-primary" />
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="t-stat-lg font-bold tracking-tight text-primary">{rel.played}</span>
              <span className="t-body-sm text-on-surface-variant">maç</span>
            </div>
          </div>
          <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-high p-2 shadow-sm">
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="t-label-caps uppercase tracking-wider">Gelmediği Maç</span>
              <Icon name="event_busy" className="text-[18px] text-error" />
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="t-stat-lg font-bold tracking-tight text-error">{rel.noShows}</span>
              <span className="t-body-sm text-on-surface-variant">maç</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maçlar
// ---------------------------------------------------------------------------

function UpcomingCard({ u }: { u: UpcomingMatch }) {
  const day = new Date(u.playedAt).toLocaleDateString("tr-TR", { weekday: "long", timeZone: "Europe/Istanbul" });
  const date = new Date(u.playedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
  return (
    <div className="relative flex flex-col gap-3.5 overflow-hidden rounded-xl bg-surface-container p-3.5 shadow-lg">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 text-on-surface">
          <Icon name="stadium" className="text-[15px] text-primary" />
          <span className="t-body-sm truncate font-semibold">{u.venue || u.groupName}</span>
        </div>
        <div className="t-label-caps flex shrink-0 items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-bold text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span>Kadroda{u.position ? ` • ${POSITION_NAME[u.position]}` : ""}</span>
        </div>
      </div>
      <div className="relative z-10 flex items-center justify-between rounded-lg bg-surface-high p-2">
        <div className="flex min-w-0 flex-1 flex-col items-center px-1">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="bolt" className="text-[20px]" />
          </div>
          <span className="t-headline-sm w-full truncate text-center text-on-surface">{u.groupName}</span>
          <span className="t-label-caps text-[10px] uppercase text-primary">{u.groupKind === "team" ? "Senin Takımın" : "Senin Grubun"}</span>
        </div>
        <div className="flex shrink-0 flex-col items-center px-2">
          <span className="t-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">{day}</span>
          <div className="my-0.5 rounded-md bg-surface-lowest px-2.5 py-1">
            <span className="t-stat-md font-bold tracking-tight text-primary">{clock(u.playedAt)}</span>
          </div>
          <span className="t-label-caps text-[10px] text-on-surface-variant">{date}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center px-1">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant text-on-surface-variant">
            <Icon name="shield" className="text-[20px]" />
          </div>
          <span className="t-headline-sm w-full truncate text-center text-on-surface">{u.kind === "external" ? (u.opponentName ?? "Rakip") : "Kendi aramızda"}</span>
          <span className="t-label-caps text-[10px] uppercase text-on-surface-variant">{u.kind === "external" ? "Rakip Takım" : "Karşı Kadro"}</span>
        </div>
      </div>
      <Link href={`/g/${u.groupId}/m/${u.matchId}`} className="t-headline-sm relative z-10 flex items-center justify-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 text-on-primary shadow-[0_0_16px_rgba(75,226,119,0.3)] hover:opacity-95 active:scale-[0.98]">
        <Icon name="group" className="text-[18px]" />
        <span>Maç Detayı &amp; Kadro</span>
      </Link>
    </div>
  );
}

/** Yaklaşan maç bölümü (Maçlar sekmesinde filtrelerin altında) */
function UpcomingSection({ upcoming }: { upcoming: UpcomingMatch[] }) {
  if (upcoming.length === 0) return null;
  return (
    <section className="mb-5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        <h2 className="t-label-caps uppercase tracking-widest text-on-surface-variant">YAKLAŞAN MAÇ</h2>
      </div>
      {upcoming.slice(0, 3).map((u) => (
        <UpcomingCard key={u.matchId} u={u} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bütün
// ---------------------------------------------------------------------------

/** Sekmeli profil: kendi profilim (`/profil`) ve başkasının profili (`/oyuncu/[id]`) aynı bileşeni kullanır */
export function ProfileView({
  base,
  tab,
  person,
  isMe,
  stats,
  matches,
  noShows,
  viewerGroups,
  upcoming = [],
  settings,
}: {
  base: string;
  tab: ProfileTab;
  person: Person;
  isMe: boolean;
  /** İstatistikleri göremiyorsa null */
  stats: ReturnType<typeof computeProfileStats> | null;
  matches: ProfileMatch[] | null;
  noShows: number | null;
  viewerGroups: Set<string>;
  /** Yaklaşan maçlar (sadece kendi profilinde dolu) */
  upcoming?: UpcomingMatch[];
  /** Ayarlar sekmesi içeriği (sadece kendi profil) */
  settings?: ReactNode;
}) {
  const locked = stats === null || matches === null;
  const last5 = (matches ?? []).slice(0, 5).reverse();
  return (
    <>
      <Tabs base={base} active={tab} isMe={isMe} />
      {tab === "genel" && <GeneralPanel person={person} isMe={isMe} stats={stats} last5={last5} upcoming={upcoming} />}
      {tab === "istatistik" &&
        (locked ? <LockedCard name={person.profile.displayName} /> : <StatsPanel person={person} stats={stats} noShows={noShows ?? 0} isMe={isMe} allMatches={matches ?? []} />)}
      {tab === "maclar" &&
        (locked ? (
          <LockedCard name={person.profile.displayName} />
        ) : (
          <div className="pt-1">
            <MatchesList matches={matches} isMe={isMe} viewerGroups={[...viewerGroups]} between={isMe ? <UpcomingSection upcoming={upcoming} /> : undefined} />
          </div>
        ))}
      {tab === "ayarlar" && isMe && settings}
    </>
  );
}

function LockedCard({ name }: { name: string }) {
  return (
    <div className="mt-3 rounded-xl bg-surface-container p-4 text-center text-sm text-on-surface-variant">
      <Icon name="lock" className="text-3xl" />
      <p className="mt-2">
        {name} istatistiklerini ve maç geçmişini sadece takım arkadaşlarına açık tutuyor. Kartı ve yetenekleri herkese görünür.
      </p>
    </div>
  );
}
