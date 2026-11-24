import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PlayerCard } from "@/components/PlayerCard";
import { cardSkills } from "@/lib/skills";
import { TeamBadge } from "@/components/TeamBadge";
import { Icon } from "@/components/Icon";
import { HomeTabs } from "@/components/home/HomeTabs";
import { SectionTitle, cx } from "@/components/ui";
import { formatRegion } from "@/lib/regions";
import { loadFeatured, type Featured } from "@/lib/featured-data";
import { availableLevels, levelLabel, type FeaturedLevel } from "@/lib/featured-rules";
import type { PlayerCandidate } from "@/lib/player-search";

interface Viewer {
  city: string | null;
  district: string | null;
  /** Kaptan/yetkili olduğum takımlar: "Meydan oku" sadece bunlar varsa görünür */
  challengerTeamIds: string[];
  /** Üyesi olduğum takımlar: kendi takımıma meydan okunmaz */
  myTeamIds: string[];
}

const rankClass = (i: number) => cx("w-6 shrink-0 font-display text-sm font-bold tabular-nums", i < 3 ? "text-gold-1" : "text-on-surface-variant");
const listBox = "overflow-hidden rounded-xl border border-line bg-surface-low divide-y divide-white/[0.06]";

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-on-surface-variant">{children}</p>;
}

/** Yatay kaydırmalı kart şeridi; kenarlara taşar (ana sayfadaki "Yaklaşan maçlar" ile aynı düzen) */
function Strip({ children }: { children: ReactNode }) {
  return <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">{children}</div>;
}

/** Öne çıkan oyuncu: profildeki oyuncu kartının küçüğü + altında sıra ve neden öne çıktığı */
function MiniCard({ c, i, children }: { c: PlayerCandidate; i: number; children: ReactNode }) {
  return (
    <Link href={`/oyuncu/${c.userId}`} className="w-36 shrink-0 snap-start">
      <PlayerCard
        size="sm"
        name={c.name}
        cardName={c.cardName}
        photoUrl={c.photoUrl}
        overall={c.overall}
        position={c.position}
        skills={cardSkills(c.skills, c.position === "GK")}
        city={c.city}
        district={c.district}
        team={c.teams[0] ?? null}
        unrated={c.matches === 0}
      />
      <div className="mt-1 flex items-center justify-center gap-1 text-center text-[11px] leading-tight text-on-surface-variant">
        <span className={cx("font-display font-bold", i < 3 ? "text-gold-1" : "text-on-surface-variant")}>#{i + 1}</span>
        <span className="truncate">{children}</span>
      </div>
    </Link>
  );
}

function TeamsList({ s, where, v }: { s: Featured["teams"]; where: string; v: Viewer }) {
  if (!s.length) return <Empty>{where} için henüz sıralanacak takım yok. Takımlar maç oynadıkça burada sıralanır.</Empty>;
  const canChallenge = v.challengerTeamIds.length > 0;
  return (
    <>
      <div className={listBox}>
        {s.slice(0, 5).map((t, i) => (
          <div key={t.id} className="flex items-center gap-2.5 p-3">
            <span className={rankClass(i)}>#{i + 1}</span>
            <Link href={`/g/${t.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
              <TeamBadge name={t.name} color={t.color} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{t.name}</span>
                <span className="truncate text-xs text-on-surface-variant">
                  {formatRegion(t.city, t.district)} · {t.members} oyuncu
                </span>
              </span>
            </Link>
            <span className="flex min-w-9 shrink-0 flex-col items-center rounded-lg bg-surface-high px-2 py-1">
              <span className="font-display text-[9px] font-bold tracking-wider text-on-surface-variant">PUAN</span>
              <span className="font-display text-lg font-bold leading-5 tabular-nums">{t.rating}</span>
            </span>
            {canChallenge && !v.myTeamIds.includes(t.id) && (
              <Link
                href={`/g/${t.id}/teklif`}
                aria-label={`${t.name} takımına meydan oku`}
                className="flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-xs font-bold text-primary transition hover:bg-primary/20"
              >
                <Icon name="swords" className="text-[16px]" />
                <span className="hidden min-[400px]:inline">Meydan oku</span>
              </Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function PlayersTabs({ f, where }: { f: Featured; where: string }) {
  return (
    <HomeTabs
      initial="puan"
      tabs={[
        {
          key: "puan",
          label: "En yüksek",
          content: f.players.length ? (
            <>
              <Strip>
                {f.players.map((c, i) => (
                  <MiniCard key={c.userId} c={c} i={i}>
                    {c.matches ? `${c.matches} maç` : "henüz maç yok"}
                  </MiniCard>
                ))}
              </Strip>
            </>
          ) : (
            <Empty>{where} için henüz kayıtlı oyuncu yok. Arkadaşlarını davet et, burada sen ol!</Empty>
          ),
        },
        {
          key: "mvp",
          label: "Haftanın MVP'leri",
          content: f.mvps.length ? (
            <>
              <Strip>
                {f.mvps.map((m, i) => (
                  <MiniCard key={m.player.userId} c={m.player} i={i}>
                    <span className="font-semibold text-gold-1">MVP</span> · {m.team.name}
                    {m.opponent ? ` vs ${m.opponent}` : ""}
                    {m.score ? ` (${m.score})` : ""}
                  </MiniCard>
                ))}
              </Strip>
            </>
          ) : (
            <Empty>{where} için bu hafta takım maçlarında MVP seçilen olmadı.</Empty>
          ),
        },
        {
          key: "yukselen",
          label: "Yükselenler",
          content: f.risers.length ? (
            <>
              <Strip>
                {f.risers.map((r, i) => (
                  <MiniCard key={r.player.userId} c={r.player} i={i}>
                    <span className="font-semibold text-primary">+{r.delta}</span> son 30 gün
                  </MiniCard>
                ))}
              </Strip>
            </>
          ) : (
            <Empty>{where} için son 30 günde puanı yükselen oyuncu yok (en az 2 puanlı maç gerekir).</Empty>
          ),
        },
      ]}
    />
  );
}

function LevelBody({ f, level, v }: { f: Featured; level: FeaturedLevel; v: Viewer }) {
  const region = new URLSearchParams(level === "tr" ? { il: "" } : { il: v.city ?? "", ...(level === "ilce" && v.district ? { ilce: v.district } : {}) }).toString();
  const where = levelLabel(level, v.city, v.district);
  return (
    <>
      <SectionTitle
        action={
          <Link href={`/kesfet?${region}`} className="flex items-center text-sm font-semibold text-primary">
            Tümü
            <Icon name="chevron_right" className="text-[18px]" />
          </Link>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name="military_tech" fill className="text-[18px] text-gold-1" />
          Öne çıkan takımlar
        </span>
      </SectionTitle>
      <TeamsList s={f.teams} where={where} v={v} />

      <SectionTitle
        action={
          <Link href={`/kesfet?${region}&sekme=oyuncu`} className="flex items-center text-sm font-semibold text-primary">
            Ara
            <Icon name="chevron_right" className="text-[18px]" />
          </Link>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name="stars" fill className="text-[18px] text-primary" />
          Öne çıkan oyuncular
        </span>
      </SectionTitle>
      <PlayersTabs f={f} where={where} />
    </>
  );
}

function Skeleton() {
  return (
    <div aria-hidden className="mt-8 space-y-3">
      <div className="h-4 w-48 animate-pulse rounded bg-surface-high" />
      <div className="h-40 animate-pulse rounded-xl bg-surface-high" />
    </div>
  );
}

async function FeaturedAsync(v: Viewer) {
  const levels = availableLevels(v.city, v.district);
  // Hata ana sayfayı bozmasın: öne çıkanlar süs, asıl içerik değil
  const all = await Promise.all(levels.map((l) => loadFeatured(v.city, v.district, l))).catch((e) => {
    console.error("[öne çıkanlar]", e);
    return null;
  });
  if (!all) return null;
  if (levels.length === 1) return <LevelBody f={all[0]} level="tr" v={v} />;
  return (
    <div className="mt-8">
      <HomeTabs
        variant="chips"
        label="Öne çıkanların bölgesi"
        initial={levels[0]}
        tabs={levels.map((l, i) => ({ key: l, label: levelLabel(l, v.city, v.district), content: <div className="[&>div:first-child]:mt-1"><LevelBody f={all[i]} level={l} v={v} /></div> }))}
      />
    </div>
  );
}

/** Ana sayfa "öne çıkanlar": ana içeriği bekletmesin diye akışla gelir; bölge seçici İlçe · İl · Türkiye */
export function FeaturedSections(props: Viewer) {
  return (
    <Suspense fallback={<Skeleton />}>
      <FeaturedAsync {...props} />
    </Suspense>
  );
}
