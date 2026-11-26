"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { PlayerCard } from "@/components/PlayerCard";
import { cardSkills } from "@/lib/skills";
import { TeamBadge } from "@/components/TeamBadge";
import { Icon } from "@/components/Icon";
import { HomeTabs } from "@/components/home/HomeTabs";
import { DragStrip } from "@/components/home/DragStrip";
import { RegionFilter } from "@/components/home/RegionFilter";
import { ErrorNote, SectionTitle, cx } from "@/components/ui";
import { formatRegion } from "@/lib/regions";
import { fetchFeatured } from "@/lib/actions";
import type { Featured, RankedTeam } from "@/lib/featured-data";
import { regionLabel } from "@/lib/featured-rules";
import type { PlayerCandidate } from "@/lib/player-search";

export interface Viewer {
  /** Gösterilen bölge (varsayılan profildeki il/ilçe); il boşsa Türkiye */
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

function TeamsList({ rows, unit, empty, v }: { rows: RankedTeam[]; unit: string; empty: string; v: Viewer }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const canChallenge = v.challengerTeamIds.length > 0;
  return (
    <div className={listBox}>
      {rows.slice(0, 5).map(({ team: t, value }, i) => (
        <div key={t.id} className="flex items-center gap-2.5 p-3">
          <span className={rankClass(i)}>#{i + 1}</span>
          <Link href={`/g/${t.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <TeamBadge id={t.id} name={t.name} color={t.color} logo={t.logo} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold">{t.name}</span>
              <span className="truncate text-xs text-on-surface-variant">
                {formatRegion(t.city, t.district)} · {t.members} oyuncu
              </span>
            </span>
          </Link>
          <span className="flex min-w-9 shrink-0 flex-col items-center rounded-lg bg-surface-high px-2 py-1">
            <span className="font-display text-[9px] font-bold tracking-wider text-on-surface-variant">{unit}</span>
            <span className="font-display text-lg font-bold leading-5 tabular-nums">{value}</span>
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
  );
}

function TeamsTabs({ f, where, v }: { f: Featured; where: string; v: Viewer }) {
  return (
    <HomeTabs
      variant="chips"
      label="Takım sıralaması"
      initial="rating"
      tabs={[
        {
          key: "rating",
          label: "Rating",
          content: (
            <TeamsList rows={f.teams.map((team) => ({ team, value: team.rating }))} unit="PUAN" v={v} empty={`${where} için henüz sıralanacak takım yok. Takımlar maç oynadıkça burada sıralanır.`} />
          ),
        },
        {
          key: "seri",
          label: "Galibiyet serisi",
          content: <TeamsList rows={f.streaks} unit="SERİ" v={v} empty={`${where} için süren galibiyet serisi yok (uygulamadaki takımlarla oynanan maçlar sayılır).`} />,
        },
        {
          key: "aktif",
          label: "En aktif",
          content: <TeamsList rows={f.actives} unit="MAÇ" v={v} empty={`${where} için son 30 günde uygulamadaki takımlar arasında maç yok.`} />,
        },
      ]}
    />
  );
}

function PlayersTabs({ f, where }: { f: Featured; where: string }) {
  return (
    <HomeTabs
      variant="chips"
      label="Oyuncu sıralaması"
      initial="puan"
      tabs={[
        {
          key: "puan",
          label: "En yüksek",
          content: f.players.length ? (
            <DragStrip>
              {f.players.map((c, i) => (
                <MiniCard key={c.userId} c={c} i={i}>
                  {c.matches ? `${c.matches} maç` : "henüz maç yok"}
                </MiniCard>
              ))}
            </DragStrip>
          ) : (
            <Empty>{where} için henüz kayıtlı oyuncu yok. Arkadaşlarını davet et, burada sen ol!</Empty>
          ),
        },
        {
          key: "mvp",
          label: "Haftanın MVP'leri",
          content: f.mvps.length ? (
            <DragStrip>
              {f.mvps.map((m, i) => (
                <MiniCard key={m.player.userId} c={m.player} i={i}>
                  <span className="font-semibold text-gold-1">MVP</span> · {m.team.name}
                  {m.opponent ? ` vs ${m.opponent}` : ""}
                  {m.score ? ` (${m.score})` : ""}
                </MiniCard>
              ))}
            </DragStrip>
          ) : (
            <Empty>{where} için bu hafta takım maçlarında MVP seçilen olmadı.</Empty>
          ),
        },
        {
          key: "yukselen",
          label: "Yükselenler",
          content: f.risers.length ? (
            <DragStrip>
              {f.risers.map((r, i) => (
                <MiniCard key={r.player.userId} c={r.player} i={i}>
                  <span className="font-semibold text-primary">+{r.delta}</span> son 30 gün
                </MiniCard>
              ))}
            </DragStrip>
          ) : (
            <Empty>{where} için son 30 günde puanı yükselen oyuncu yok (en az 2 puanlı maç gerekir).</Empty>
          ),
        },
      ]}
    />
  );
}

/** Alt başlık (Takımlar / Oyuncular) ve o bölgenin Keşfet'ine giden "Tümü" */
function SubTitle({ icon, iconClass, href, children }: { icon: string; iconClass: string; href: string; children: ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between gap-3">
      <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
        <Icon name={icon} fill className={cx("text-[18px]", iconClass)} />
        {children}
      </h3>
      <Link href={href} className="flex min-h-9 shrink-0 items-center text-sm font-semibold text-primary">
        Tümü
        <Icon name="chevron_right" className="text-[18px]" />
      </Link>
    </div>
  );
}

/**
 * Ana sayfa "öne çıkanlar": bölge seçici, takımlar ve oyuncular tek bölümde. Bölge değişince yalnızca bu bölümün
 * verisi çekilir (sayfa yenilenmez, adres değişmez); açılışta profildeki il/ilçe gösterilir.
 */
export function FeaturedPanel({ initial, ...own }: Viewer & { initial: Featured }) {
  const [picked, setPicked] = useState<{ city: string; district: string; data: Featured } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  const v: Viewer = picked ? { ...own, city: picked.city || null, district: picked.district || null } : own;
  const f = picked?.data ?? initial;
  const region = new URLSearchParams({ il: v.city ?? "", ...(v.city && v.district ? { ilce: v.district } : {}) }).toString();
  const where = regionLabel(v.city, v.district);

  const select = (city: string, district: string) => {
    const request = ++latest.current;
    setFailed(false);
    startTransition(async () => {
      const data = await fetchFeatured(city, district).catch(() => null);
      if (request !== latest.current) return; // arada başka bölge seçildi
      if (data) setPicked({ city, district, data });
      else setFailed(true);
    });
  };

  return (
    <section>
      <SectionTitle action={<RegionFilter city={v.city ?? ""} district={v.district ?? ""} label={where} pending={pending} onSelect={select} />}>
        Öne çıkanlar
      </SectionTitle>
      {failed && <ErrorNote message="Bölge yüklenemedi, tekrar dene." />}
      <div aria-busy={pending} className={cx("transition-opacity", pending && "opacity-50")}>
        <SubTitle icon="military_tech" iconClass="text-gold-1" href={`/kesfet?${region}`}>
          Takımlar
        </SubTitle>
        <TeamsTabs f={f} where={where} v={v} />
        <SubTitle icon="stars" iconClass="text-primary" href={`/kesfet?${region}&sekme=oyuncu`}>
          Oyuncular
        </SubTitle>
        <PlayersTabs f={f} where={where} />
      </div>
    </section>
  );
}
