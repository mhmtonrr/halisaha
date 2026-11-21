"use client";

import { useState } from "react";
import { submitSkillRating } from "@/lib/actions";
import { Card, cx } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { initials } from "@/components/PlayerCard";
import { skillSet } from "@/lib/skills";

const level = (v: number) => (v >= 9 ? "Efsane" : v >= 8 ? "Çok iyi" : v >= 7 ? "İyi" : v >= 5 ? "Orta" : v >= 3 ? "Zayıf" : "Çok zayıf");

/** Bir oyuncunun 6 yeteneği için kaydırıcılar. Dokunulmayan veya "bilmiyorum" denen yetenek boş gider. */
export function SkillRateForm({
  playerId,
  name,
  isGuest,
  keeper,
  matches,
}: {
  playerId: string;
  name: string;
  isGuest: boolean;
  keeper: boolean;
  matches: number;
}) {
  const skills = skillSet(keeper);
  const [scores, setScores] = useState<Record<string, number | null>>(() => Object.fromEntries(skills.map((s) => [s.key, null])));
  const given = Object.values(scores).filter((v) => v !== null).length;

  return (
    <Card>
      <form action={submitSkillRating} className="space-y-4">
        <input type="hidden" name="playerId" value={playerId} />
        <input type="hidden" name="keeper" value={keeper ? "1" : "0"} />
        {skills.map((s) => {
          const v = scores[s.key];
          return (
            <input key={s.key} type="hidden" name={`score_${s.key}`} value={v ?? ""} />
          );
        })}

        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-700 text-sm font-bold">{initials(name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-xs text-muted">
              {matches} maç birlikte{isGuest ? " · misafir" : ""}
              {keeper ? " · kaleci" : ""}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {skills.map((s) => {
            const v = scores[s.key];
            return (
              <div key={s.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>
                    <b className="mr-1.5 inline-block w-9 text-xs text-accent">{s.key}</b>
                    {s.label}
                  </span>
                  {v === null ? (
                    <span className="text-xs text-muted">Puan vermedin</span>
                  ) : (
                    <span className="flex items-baseline gap-2">
                      <span className="text-[10px] text-muted">{level(v)}</span>
                      <b className="text-lg tabular-nums">{v}</b>
                      <button
                        type="button"
                        onClick={() => setScores({ ...scores, [s.key]: null })}
                        className="text-[11px] text-muted underline"
                      >
                        bilmiyorum
                      </button>
                    </span>
                  )}
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={v ?? 6}
                  onChange={(e) => setScores({ ...scores, [s.key]: Number(e.target.value) })}
                  // Kaydırıcıya ilk dokunuş değeri verir; tek tıklamayla 6'da kalmak için de basılabilsin
                  onPointerDown={() => v === null && setScores((cur) => ({ ...cur, [s.key]: cur[s.key] ?? 6 }))}
                  className={cx("mt-1 w-full", v === null && "opacity-40")}
                  aria-label={`${name} ${s.label}`}
                />
              </div>
            );
          })}
        </div>

        <SubmitButton className="w-full" disabled={given === 0} pendingLabel="Kaydediliyor…">
          {given === 0 ? "En az bir yeteneği puanla" : "Kaydet"}
        </SubmitButton>
      </form>
    </Card>
  );
}
