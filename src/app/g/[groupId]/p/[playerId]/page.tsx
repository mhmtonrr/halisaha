import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { FOOT_NAME, POSITION_NAME, byRanking, formatDate, getGroupSummaries, type Position } from "@/lib/data";
import { Badge, Card, Header, LinkButton, SectionTitle, cx } from "@/components/ui";
import { PlayerCard, PositionChip } from "@/components/PlayerCard";
import { formatRegion } from "@/lib/regions";
import { skillSet } from "@/lib/skills";
import { ROLE_LABEL, type GroupKind, type Role } from "@/lib/teams-data";

// Özellikler 40 (hiç yok) ile 99 arasında; çubuk bu aralığa göre dolar
const barWidth = (v: number) => Math.max(3, ((v - 40) / 59) * 100);
function barColor(v: number) {
  if (v >= 80) return "bg-accent";
  if (v >= 65) return "bg-accent/60";
  return "bg-muted/50";
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ groupId: string; playerId: string }>;
}) {
  const { groupId, playerId } = await params;
  const { supabase, user } = await requireUser();

  const [players, { data: group }] = await Promise.all([
    getGroupSummaries(supabase, groupId),
    supabase.from("groups").select("kind").eq("id", groupId).maybeSingle(),
  ]);
  const roleLabels = ROLE_LABEL[(group?.kind ?? "community") as GroupKind];
  const player = players.find((p) => p.id === playerId);
  if (!player) notFound();

  const t = player.totals;
  const ranked = players.filter((p) => p.matches_played > 0).sort(byRanking);
  const rank = ranked.findIndex((p) => p.id === playerId) + 1;
  const isMe = player.user_id === user.id;
  const form = player.history.filter((h) => h.matchScore !== null && h.weight > 0).slice(0, 5).reverse();
  const winRate = t.played ? Math.round((t.wins / t.played) * 100) : 0;

  // Maçlarda en çok oynadığı mevki
  const posCounts = new Map<string, number>();
  for (const h of player.history) if (h.position) posCounts.set(h.position, (posCounts.get(h.position) ?? 0) + 1);
  const mostPlayed = [...posCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const facts: { label: string; value: string }[] = [
    player.city ? { label: "Bölge", value: formatRegion(player.city, player.district) } : null,
    player.position ? { label: "Ana mevki", value: POSITION_NAME[player.position] } : null,
    player.secondary_positions.length
      ? { label: "Diğer mevkiler", value: player.secondary_positions.map((p) => POSITION_NAME[p]).join(", ") }
      : null,
    player.preferred_foot ? { label: "Ayak", value: FOOT_NAME[player.preferred_foot] } : null,
    player.shirt_number ? { label: "Forma", value: `#${player.shirt_number}` } : null,
    mostPlayed ? { label: "En çok oynadığı", value: `${POSITION_NAME[mostPlayed[0] as Position]} (${mostPlayed[1]} maç)` } : null,
  ].filter((x): x is { label: string; value: string } => !!x);

  return (
    <main>
      <Header
        title={player.display_name}
        back={`/g/${groupId}/kadro`}
        right={
          isMe ? (
            <LinkButton href="/profil" variant="ghost">
              Düzenle
            </LinkButton>
          ) : undefined
        }
      />

      <PlayerCard
        name={player.display_name}
        overall={player.overall}
        position={player.position}
        shirtNumber={player.shirt_number}
        provisional={player.matches_played > 0 && player.confidence < 0.6}
        skills={player.skills}
        city={player.city}
        district={player.district}
        unrated={player.matches_played === 0}
      />

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {rank > 0 && <Badge tone="accent">Grupta {rank}. sırada</Badge>}
        {!player.user_id && <Badge>Misafir</Badge>}
        {player.role !== "member" && <Badge tone={player.role === "captain" ? "warn" : "default"}>{roleLabels[player.role as Role]}</Badge>}
      </div>
      {player.bio && <p className="mt-3 text-center text-sm italic text-muted">“{player.bio}”</p>}

      {player.matches_played === 0 && (
        <p className="mt-4 text-center text-sm text-muted">
          Henüz puanlanmış maçı yok. Herkes 65 puanla başlar, birkaç maçta gerçek seviyesine oturur.
        </p>
      )}

      <SectionTitle>Yetenekler</SectionTitle>
      <Card className="space-y-3">
        {skillSet(player.position === "GK").map((sk) => {
          const v = player.skills.find((x) => x.key === sk.key)?.value ?? null;
          return (
            <div key={sk.key}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span>
                  <b className="mr-2 inline-block w-9 text-xs text-muted">{sk.key}</b>
                  {sk.label}
                </span>
                <span className="text-lg font-black tabular-nums">{v ?? "–"}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-pitch-950">
                {v !== null && <div className={cx("h-full rounded-full", barColor(v))} style={{ width: `${barWidth(v)}%` }} />}
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted">
          Birlikte en az 2 maç oynayanlar (rakipler dahil) 1-10 puanlar; kimin ne verdiği görünmez. En az 2 farklı kişi puan verince değer görünür.</p>
      </Card>

      <SectionTitle>Performans göstergeleri</SectionTitle>
      <Card className="space-y-3">
        {player.attributes.map((a) => (
          <div key={a.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>
                <b className="mr-2 inline-block w-8 text-xs text-muted">{a.key}</b>
                {a.label}
              </span>
              <span className="text-lg font-black tabular-nums">{a.value ?? "–"}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-pitch-950">
              {a.value !== null && (
                <div className={cx("h-full rounded-full", barColor(a.value))} style={{ width: `${barWidth(a.value)}%` }} />
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{a.hint}</div>
          </div>
        ))}
      </Card>

      <SectionTitle>İstatistikler</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Maç", value: t.played },
          { label: "Gol", value: t.goals },
          { label: "Asist", value: t.assists },
          { label: player.position === "GK" ? "Kurtarış" : "Gol+Asist", value: player.position === "GK" ? t.saves : t.goals + t.assists },
          { label: "MVP", value: t.mvps },
          { label: "Galibiyet", value: `%${winRate}` },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <div className="text-2xl font-black tabular-nums">{s.value}</div>
            <div className="text-xs text-muted">{s.label}</div>
          </Card>
        ))}
      </div>
      {t.played > 0 && (
        <Card className="mt-2 flex items-center justify-around py-3 text-sm">
          <span>
            <b className="text-accent">{t.wins}</b> <span className="text-muted">G</span>
          </span>
          <span>
            <b>{t.draws}</b> <span className="text-muted">B</span>
          </span>
          <span>
            <b className="text-red-300">{t.losses}</b> <span className="text-muted">M</span>
          </span>
        </Card>
      )}

      {facts.length > 0 && (
        <>
          <SectionTitle>Oyuncu bilgisi</SectionTitle>
          <Card className="p-0">
            <dl className="divide-y divide-line text-sm">
              {facts.map((f) => (
                <div key={f.label} className="flex justify-between px-4 py-2.5">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}

      {form.length > 0 && (
        <>
          <SectionTitle>Form · son {form.length} maç</SectionTitle>
          <Card>
            <div className="flex h-32 items-end justify-around gap-2">
              {form.map((f) => (
                <div key={f.matchId} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-bold tabular-nums">{f.matchScore!.toFixed(1)}</span>
                  <div
                    className={cx(
                      "w-full max-w-10 rounded-t-md",
                      f.matchScore! >= 7.5 ? "bg-accent" : f.matchScore! >= 5.5 ? "bg-accent/50" : "bg-red-400/60",
                    )}
                    style={{ height: `${Math.max(8, f.matchScore! * 9)}px` }}
                  />
                  <span className="text-[10px] text-muted">
                    {new Date(f.playedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "numeric", timeZone: "Europe/Istanbul" })}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {player.history.length > 0 && (
        <>
          <SectionTitle>Maç geçmişi</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {player.history.slice(0, 30).map((h) => {
                const res = h.outcome === "win" ? "G" : h.outcome === "loss" ? "M" : "B";
                return (
                  <li key={h.matchId}>
                    <Link
                      href={`/g/${groupId}/m/${h.matchId}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800"
                    >
                      <span
                        className={cx(
                          "flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold",
                          res === "G" ? "bg-accent/20 text-accent" : res === "M" ? "bg-red-400/20 text-red-300" : "bg-pitch-700 text-muted",
                        )}
                      >
                        {res}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{h.kind === "external" ? `vs ${h.opponentName}` : "Kendi aramızda"}</span>
                          <PositionChip position={h.position as Position | null} />
                          {h.mvp && "⭐"}
                        </div>
                        <div className="text-xs text-muted">
                          {formatDate(h.playedAt)}
                          {h.goals > 0 && ` · ${h.goals} gol`}
                          {h.assists > 0 && ` · ${h.assists} asist`}
                          {h.saves > 0 && ` · ${h.saves} kurtarış`}
                        </div>
                      </div>
                      <div className="font-black tabular-nums">{h.matchScore !== null && h.weight > 0 ? h.matchScore.toFixed(1) : "–"}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </main>
  );
}
