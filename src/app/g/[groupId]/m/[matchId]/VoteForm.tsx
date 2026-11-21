"use client";

import { useState } from "react";
import { submitVotes } from "@/lib/actions";
import { Button, Card, cx } from "@/components/ui";
import { initials, PositionChip, shortName } from "@/components/PlayerCard";
import { FIELD_SKILLS, KEEPER_SKILLS, SKILL_CONFIG } from "@/lib/skills";
import type { Position } from "@/lib/data";

interface Target {
  id: string;
  name: string;
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
  initialSkillPicks = {},
  rivalLabel = "Rakipler",
}: {
  groupId: string;
  matchId: string;
  myTeam: "A" | "B";
  targets: Target[];
  initialScores: Record<string, number>;
  initialMvp: string | null;
  /** Daha önce işaretlediğin yetenekler: kategori → oyuncu id'leri */
  initialSkillPicks?: Record<string, string[]>;
  /** Rakip grubun başlığı (takımlar arası maçta rakip takımın adı) */
  rivalLabel?: string;
}) {
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(targets.map((t) => [t.id, initialScores[t.id] ?? 6])),
  );
  const [mvp, setMvp] = useState<string | null>(initialMvp);
  const [pending, setPending] = useState(false);
  const [picks, setPicks] = useState<Record<string, string[]>>(initialSkillPicks);
  const [touched, setTouched] = useState(false);

  const togglePick = (cat: string, id: string) => {
    setTouched(true);
    setPicks((cur) => {
      const list = cur[cat] ?? [];
      if (list.includes(id)) return { ...cur, [cat]: list.filter((x) => x !== id) };
      if (list.length >= SKILL_CONFIG.MAX_PICKS) return cur;
      return { ...cur, [cat]: [...list, id] };
    });
  };
  const fieldTargets = targets.filter((t) => t.position !== "GK");
  const keeperTargets = targets.filter((t) => t.position === "GK");
  const skillBlocks = [
    { title: "Sahadaki oyuncular", skills: FIELD_SKILLS, list: fieldTargets },
    { title: "Kaleciler", skills: KEEPER_SKILLS, list: keeperTargets },
  ].filter((b) => b.list.length > 0);

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
                      <span
                        className={cx(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-pitch-950",
                          t.team === "A" ? "bg-team-a" : "bg-team-b",
                        )}
                      >
                        {initials(t.name)}
                      </span>
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
                        ⭐ MVP
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

      {touched && <input type="hidden" name="skillsTouched" value="1" />}
      {Object.entries(picks).flatMap(([cat, ids]) =>
        ids.map((id) => <input key={`${cat}:${id}`} type="hidden" name={`skill_${cat}`} value={id} />),
      )}
      <details className="rounded-2xl border border-line bg-pitch-900">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
          Yetenekler: kim öne çıktı? <span className="font-normal text-muted">(isteğe bağlı)</span>
        </summary>
        <div className="space-y-5 px-4 pb-4">
          <p className="text-xs text-muted">
            Her soruda en fazla {SKILL_CONFIG.MAX_PICKS} kişi seç. Kimseyi işaretlemek zorunda değilsin. İşaretler anonimdir ve
            oyuncunun kartındaki yetenekleri (HIZ, ŞUT, PAS…) oluşturur.
          </p>
          {skillBlocks.map((b) => (
            <div key={b.title} className="space-y-4">
              {skillBlocks.length > 1 && <div className="text-xs uppercase tracking-wide text-muted">{b.title}</div>}
              {b.skills.map((sk) => {
                const chosen = picks[sk.key] ?? [];
                return (
                  <div key={sk.key}>
                    <div className="mb-1.5 text-sm">
                      <b className="mr-1.5 text-xs text-accent">{sk.key}</b>
                      {sk.question}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {b.list.map((t) => {
                        const on = chosen.includes(t.id);
                        const full = !on && chosen.length >= SKILL_CONFIG.MAX_PICKS;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={full}
                            aria-pressed={on}
                            onClick={() => togglePick(sk.key, t.id)}
                            className={cx(
                              "rounded-full border px-2.5 py-1 text-xs",
                              on ? "border-accent bg-accent text-pitch-950 font-bold" : "border-line text-muted hover:bg-pitch-800",
                              full && "opacity-40",
                            )}
                          >
                            {shortName(t.name)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </details>

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
