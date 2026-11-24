"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { submitVotes } from "@/lib/actions";
import { Button, Card, cx } from "@/components/ui";
import { PositionChip } from "@/components/PlayerCard";
import { Avatar } from "@/components/Avatar";
import type { Position } from "@/lib/data";

interface Target {
  id: string;
  name: string;
  photoUrl?: string | null;
  team: "A" | "B";
  goals: number;
  assists: number;
  position: Position | null;
}

const scoreLabel = (s: number) =>
  s >= 9 ? "Efsane" : s >= 8 ? "Çok iyi" : s >= 7 ? "İyi" : s >= 6 ? "Ortalama" : s >= 4 ? "Zayıf" : "Kötü";

export function VoteForm({
  groupId,
  matchId,
  myTeam,
  targets,
  initialScores,
  initialMvp,
  rivalLabel = "Rakipler",
}: {
  groupId: string;
  matchId: string;
  myTeam: "A" | "B";
  targets: Target[];
  initialScores: Record<string, number>;
  initialMvp: string | null;
  /** Rakip grubun başlığı (takımlar arası maçta rakip takımın adı) */
  rivalLabel?: string;
}) {
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(targets.map((t) => [t.id, initialScores[t.id] ?? 6])),
  );
  const [mvp, setMvp] = useState<string | null>(initialMvp);
  const [pending, setPending] = useState(false);

  const groups = [
    { label: "Takım arkadaşların", list: targets.filter((t) => t.team === myTeam) },
    { label: rivalLabel, list: targets.filter((t) => t.team !== myTeam) },
  ].filter((g) => g.list.length > 0);

  return (
    <form action={submitVotes} onSubmit={() => setPending(true)} className="space-y-4">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      {mvp && <input type="hidden" name="mvp" value={mvp} />}

      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <div key={g.label}>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted">{g.label}</div>
              <Card className="space-y-4">
                {g.list.map((t) => (
                  <div key={t.id}>
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={t.name}
                        photoUrl={t.photoUrl}
                        className={cx("h-9 w-9 text-xs text-pitch-950", t.team === "A" ? "bg-team-a" : "bg-team-b")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{t.name}</span>
                          <PositionChip position={t.position} />
                        </div>
                        {(t.goals > 0 || t.assists > 0) && (
                          <div className="text-xs text-muted">
                            {t.goals > 0 && `${t.goals} gol `}
                            {t.assists > 0 && `${t.assists} asist`}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setMvp(mvp === t.id ? null : t.id)}
                        className={cx(
                          "rounded-lg px-2 py-1 text-xs font-semibold",
                          mvp === t.id ? "bg-amber-400 text-pitch-950" : "text-muted hover:bg-pitch-800",
                        )}
                        aria-pressed={mvp === t.id}
                      >
                        <Icon name="star" fill className="text-[14px]" />
                        MVP
                      </button>
                      <div className="w-16 text-right">
                        <div className="text-xl font-black tabular-nums">{scores[t.id]}</div>
                        <div className="text-[10px] text-muted">{scoreLabel(scores[t.id])}</div>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      name={`score_${t.id}`}
                      value={scores[t.id]}
                      onChange={(e) => setScores({ ...scores, [t.id]: Number(e.target.value) })}
                      className="mt-2 w-full"
                      aria-label={`${t.name} puanı`}
                    />
                  </div>
                ))}
              </Card>
            </div>
          ),
      )}

      <p className="text-center text-xs text-muted">
        Oylar anonim. Kimse kime kaç verdiğini göremez.
        {!mvp && " MVP seçmeyi unutma!"}
      </p>
      <Button className="sticky bottom-4 w-full shadow-lg" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Oylarımı gönder"}
      </Button>
    </form>
  );
}
