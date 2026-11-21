import Link from "next/link";
import { Suspense } from "react";
import { PlayerCard, OvrBadge } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";
import { Card, LinkButton, SectionTitle, cx } from "@/components/ui";
import { cardSkills } from "@/lib/skills";
import { formatRegion } from "@/lib/regions";
import { loadFeatured, type Featured } from "@/lib/featured-data";
import type { PlayerCandidate } from "@/lib/player-search";

/** Yatay kaydırmalı şerit; kenarlara taşar (ana sayfadaki "Yaklaşan maçlar" ile aynı düzen) */
function Strip({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">{children}</div>;
}

function MiniCard({ c, children }: { c: PlayerCandidate; children?: React.ReactNode }) {
  return (
    <Link href={`/oyuncu/${c.userId}`} className="w-36 shrink-0 snap-start">
      <PlayerCard
        size="sm"
        name={c.name}
        overall={c.overall}
        position={c.position}
        skills={cardSkills(c.skills, c.position === "GK")}
        shirtNumber={c.shirt}
        city={c.city}
        district={c.district}
        team={c.teams[0] ?? null}
        unrated={c.matches === 0}
      />
      {children}
    </Link>
  );
}

function FeaturedBody({ f, city }: { f: Featured; city: string | null }) {
  const where = city ?? "Türkiye";
  const region = city ? `?il=${encodeURIComponent(city)}` : "?il=";
  return (
    <>
      {f.players.length > 0 && (
        <>
          <SectionTitle
            action={<LinkButton href={`/kesfet${region}&sekme=oyuncu`} variant="ghost" className="min-h-8 px-2 text-accent">Ara ›</LinkButton>}
          >
            ⭐ Öne çıkan oyuncular · {f.playersNational ? "Türkiye" : where}
          </SectionTitle>
          <Strip>{f.players.map((c) => <MiniCard key={c.userId} c={c} />)}</Strip>
        </>
      )}

      {f.teams.length > 0 && (
        <>
          <SectionTitle
            action={<LinkButton href={`/kesfet${region}`} variant="ghost" className="min-h-8 px-2 text-accent">Tümü ›</LinkButton>}
          >
            🏆 Öne çıkan takımlar · {f.teamsNational ? "Türkiye" : where}
          </SectionTitle>
          <Strip>
            {f.teams.map((t, i) => (
              <Link key={t.id} href={`/g/${t.id}`} className="w-40 shrink-0 snap-start">
                <Card className="h-full p-3 transition hover:border-accent/50">
                  <div className="flex items-start justify-between">
                    <TeamBadge name={t.name} color={t.color} />
                    <span className={cx("text-xs font-black", i < 3 ? "text-gold-1" : "text-muted")}>#{i + 1}</span>
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold">{t.name}</div>
                  <div className="truncate text-xs text-muted">{formatRegion(t.city, t.district)}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted">{t.members} oyuncu</span>
                    <OvrBadge overall={t.rating} />
                  </div>
                </Card>
              </Link>
            ))}
          </Strip>
        </>
      )}

      {f.mvps.length > 0 && (
        <>
          <SectionTitle>🔥 Haftanın MVP&apos;leri</SectionTitle>
          <Strip>
            {f.mvps.map((m) => (
              <MiniCard key={m.player.userId} c={m.player}>
                <div className="mt-1 text-center text-[11px] leading-tight text-muted">
                  <span className="font-semibold text-gold-1">MVP</span> · {m.team.name}
                  {m.opponent ? ` vs ${m.opponent}` : ""}
                  {m.score ? ` (${m.score})` : ""}
                </div>
              </MiniCard>
            ))}
          </Strip>
        </>
      )}

      {f.risers.length > 0 && (
        <>
          <SectionTitle>📈 Yükselen yıldızlar</SectionTitle>
          <Strip>
            {f.risers.map((r) => (
              <MiniCard key={r.player.userId} c={r.player}>
                <div className="mt-1 text-center text-[11px] leading-tight text-muted">
                  <span className="font-semibold text-accent">+{r.delta}</span> son 30 gün · {r.matches} maç
                </div>
              </MiniCard>
            ))}
          </Strip>
        </>
      )}
    </>
  );
}

function Skeleton() {
  return (
    <div aria-hidden className="mt-8 space-y-3">
      <div className="h-4 w-48 animate-pulse rounded bg-pitch-800" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => <div key={i} className="h-48 w-36 shrink-0 animate-pulse rounded-2xl bg-pitch-800" />)}
      </div>
    </div>
  );
}

async function FeaturedAsync({ city }: { city: string | null }) {
  // Hata ana sayfayı bozmasın: öne çıkanlar süs, asıl içerik değil
  const f = await loadFeatured(city).catch((e) => {
    console.error("[öne çıkanlar]", e);
    return null;
  });
  return f ? <FeaturedBody f={f} city={city} /> : null;
}

/** Ana sayfa "öne çıkanlar": ana içeriği bekletmesin diye akışla gelir */
export function FeaturedSections({ city }: { city: string | null }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <FeaturedAsync city={city} />
    </Suspense>
  );
}
