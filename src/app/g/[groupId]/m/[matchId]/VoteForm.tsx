"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { submitVotes } from "@/lib/actions";
import { cx } from "@/components/ui";
import { PositionChip } from "@/components/PlayerCard";
import { Avatar } from "@/components/Avatar";
import { SubmitButton } from "@/components/SubmitButton";
import type { Position } from "@/lib/data";

interface Target {
  id: string;
  name: string;
  photoUrl?: string | null;
  team: "A" | "B";
  goals: number;
  assists: number;
  saves: number;
  position: Position | null;
}

export interface VoteStatus {
  voters: number;
  eligible: number;
  timeLeft: string;
}

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const scoreLabel = (s: number) =>
  s >= 9 ? "Efsane" : s >= 8 ? "Çok iyi" : s >= 7 ? "İyi" : s >= 6 ? "Ortalama" : s >= 4 ? "Zayıf" : "Kötü";

interface Draft {
  scores: Record<string, number>;
  mvp: string | null;
}

/** Cihazdaki taslak; bozuk veya erişilemezse yok sayılır, artık kadroda olmayan oyuncular atılır */
function readDraft(key: string, ids: Set<string>): Draft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (!raw?.scores) return null;
    return {
      scores: Object.fromEntries(Object.entries(raw.scores).filter(([id, n]) => ids.has(id) && SCORES.includes(n))),
      mvp: raw.mvp && ids.has(raw.mvp) ? raw.mvp : null,
    };
  } catch {
    return null;
  }
}

const sameDraft = (a: Draft, b: Draft) =>
  a.mvp === b.mvp &&
  Object.keys(a.scores).length === Object.keys(b.scores).length &&
  Object.entries(a.scores).every(([id, n]) => b.scores[id] === n);

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full transition-all" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
    </div>
  );
}

/** Oylama sahnesinin üstü: süre, oy veren sayısı ve (oy verebiliyorsam) kendi ilerlemem */
export function VoteHeader({ status, title, mine }: { status: VoteStatus; title: string; mine?: { done: number; total: number } }) {
  return (
    <div className="px-4 pb-3 pt-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">{title}</h2>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold tabular-nums">
          <Icon name="schedule" className="text-[15px]" />
          {status.timeLeft}
        </span>
      </div>
      <div className={cx("mt-3 grid gap-4", mine && "grid-cols-2")}>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="t-label-caps uppercase text-white/50">Oy veren</span>
            <span className="font-display text-sm font-black tabular-nums">
              {status.voters}/{status.eligible}
            </span>
          </div>
          <Bar value={status.voters} max={status.eligible} color="#5aa9ff" />
        </div>
        {mine && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="t-label-caps uppercase text-white/50">Senin ilerlemen</span>
              <span className="font-display text-sm font-black tabular-nums text-accent">
                {mine.done}/{mine.total}
              </span>
            </div>
            <Bar value={mine.done} max={mine.total} color="var(--color-accent)" />
          </div>
        )}
      </div>
    </div>
  );
}

export function VoteForm({
  groupId,
  matchId,
  voterId,
  myTeam,
  targets,
  initialScores,
  initialMvp,
  status,
  colors,
  rivalLabel = "Rakipler",
}: {
  groupId: string;
  matchId: string;
  voterId: string;
  myTeam: "A" | "B";
  targets: Target[];
  initialScores: Record<string, number>;
  initialMvp: string | null;
  status: VoteStatus;
  colors: Record<"A" | "B", string>;
  /** Rakip grubun başlığı (takımlar arası maçta rakip takımın adı) */
  rivalLabel?: string;
}) {
  // Puanlar boş başlar; herkes puanlanmadan gönderilemez
  const [scores, setScores] = useState<Record<string, number>>(initialScores);
  const [mvp, setMvp] = useState<string | null>(initialMvp);

  const groups = [
    { key: "mine", label: "Takım arkadaşların", color: colors[myTeam], list: targets.filter((t) => t.team === myTeam) },
    { key: "rival", label: rivalLabel, color: colors[myTeam === "A" ? "B" : "A"], list: targets.filter((t) => t.team !== myTeam) },
  ].filter((g) => g.list.length > 0);
  const [tab, setTab] = useState(() => (groups.find((g) => g.list.some((t) => !initialScores[t.id])) ?? groups[0])?.key);

  // Gönderilmemiş oylar cihazda saklanır (sayfadan çıkılsa da kaybolmaz); sunucudakiyle aynıysa taslak silinir
  const draftKey = `hs-oy-${matchId}-${voterId}`;
  const [restored, setRestored] = useState(false);
  const unsaved = restored && !sameDraft({ scores, mvp }, { scores: initialScores, mvp: initialMvp });

  useEffect(() => {
    const draft = readDraft(draftKey, new Set(targets.map((t) => t.id)));
    if (draft) {
      const merged = { ...initialScores, ...draft.scores };
      setScores(merged);
      setMvp(draft.mvp);
      setTab((cur) => (groups.find((g) => g.list.some((t) => !merged[t.id]))?.key ?? cur));
    }
    setRestored(true);
    // Sadece ilk açılışta; canlı yenilemeler girilen puanların üstüne yazmasın
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      if (unsaved) localStorage.setItem(draftKey, JSON.stringify({ scores, mvp }));
      else localStorage.removeItem(draftKey);
    } catch {
      // Gizli sekme / dolu depolama: taslaksız devam
    }
  }, [restored, unsaved, draftKey, scores, mvp]);

  const done = targets.filter((t) => scores[t.id]).length;
  const left = targets.length - done;
  const nextGroup = groups.find((g) => g.key !== tab && g.list.some((t) => !scores[t.id]));
  const tabDone = !!groups.find((g) => g.key === tab)?.list.every((t) => scores[t.id]);

  return (
    <form action={submitVotes}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      {mvp && <input type="hidden" name="mvp" value={mvp} />}
      {targets.map((t) => (scores[t.id] ? <input key={t.id} type="hidden" name={`score_${t.id}`} value={scores[t.id]} /> : null))}

      <section aria-label="Oylama" className="-mx-4 bg-[#060d14] pb-3 sm:mx-0 sm:rounded-3xl sm:border sm:border-white/10">
        <VoteHeader
          status={status}
          title={Object.keys(initialScores).length ? "Oylarını güncelle" : "Arkadaşlarını puanla"}
          mine={{ done, total: targets.length }}
        />

        {groups.length > 1 && (
          <div role="tablist" className="flex gap-1 px-3 pb-3">
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={tab === g.key}
                onClick={() => setTab(g.key)}
                className={cx(
                  "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-bold transition-colors",
                  tab === g.key ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
                <span className="truncate">{g.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-white/50">
                  {g.list.filter((t) => scores[t.id]).length}/{g.list.length}
                </span>
              </button>
            ))}
          </div>
        )}

        {groups.map((g) => (
          <ul key={g.key} hidden={groups.length > 1 && tab !== g.key} className="space-y-2 px-3">
            {g.list.map((t) => {
              const score = scores[t.id];
              const stats = [t.goals > 0 && `${t.goals} gol`, t.assists > 0 && `${t.assists} asist`, t.saves > 0 && `${t.saves} kurtarış`].filter(Boolean);
              return (
                <li
                  key={t.id}
                  data-vote-row
                  className={cx("rounded-2xl border p-3 text-white", mvp === t.id ? "border-amber-400/70 bg-amber-400/10" : "border-white/10 bg-white/5")}
                >
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${g.color}` }}>
                      <Avatar name={t.name} photoUrl={t.photoUrl} className="h-11 w-11 bg-white/10 text-sm text-white" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{t.name}</span>
                        <PositionChip position={t.position} />
                      </div>
                      {stats.length > 0 && <div className="truncate text-xs text-white/55">{stats.join(" · ")}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMvp(mvp === t.id ? null : t.id)}
                      className={cx(
                        "flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold",
                        mvp === t.id ? "bg-amber-400 text-pitch-950" : "border border-white/15 text-white/60 hover:bg-white/10",
                      )}
                      aria-pressed={mvp === t.id}
                    >
                      <Icon name="star" fill={mvp === t.id} className="text-[16px]" />
                      MVP
                    </button>
                  </div>
                  <div role="radiogroup" aria-label={`${t.name} puanı`} className="mt-2.5 grid grid-cols-10 gap-1">
                    {SCORES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={score === n}
                        onClick={() => setScores((s) => ({ ...s, [t.id]: n }))}
                        className={cx(
                          "h-10 rounded-lg font-display text-sm font-bold tabular-nums transition-colors",
                          score === n ? "bg-accent text-pitch-950" : "bg-white/10 text-white/70 hover:bg-white/20",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className={cx("mt-1.5 text-right text-[11px]", score ? "font-semibold text-accent" : "text-white/40")}>
                    {score ? scoreLabel(score) : "Puan ver"}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

        {tabDone && nextGroup && (
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={() => setTab(nextGroup.key)}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-bold text-white"
            >
              <span className="truncate">Sıradaki: {nextGroup.label}</span>
              <Icon name="arrow_forward" className="shrink-0 text-[18px]" />
            </button>
          </div>
        )}
        <p className="px-4 pt-3 text-center text-xs text-white/45">Oylar anonim. Kimse kime kaç verdiğini göremez.</p>
      </section>

      {/* Alt menünün üstünde sabit gönder çubuğu */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-3 rounded-2xl border border-line bg-pitch-900/95 p-2 shadow-lg backdrop-blur">
        <div className="mb-1.5 px-1 text-center text-xs text-muted">
          {left > 0 ? `${left} oyuncu daha puanlamalısın` : mvp ? "Hazırsın" : "MVP seçmeyi unutma"}
          {unsaved && " · Taslak bu cihazda saklanıyor"}
        </div>
        <SubmitButton className="w-full" disabled={left > 0} pendingLabel="Kaydediliyor…">
          Oylarımı gönder
        </SubmitButton>
      </div>
    </form>
  );
}
