"use client";

import { useMemo, useState } from "react";
import { createMatch } from "@/lib/actions";
import { balanceTeams } from "@/lib/teams";
import { Button, Card, Input, Label, cx } from "@/components/ui";
import { OvrBadge, shortName } from "@/components/PlayerCard";

interface P {
  id: string;
  name: string;
  overall: number;
  isGoalkeeper: boolean;
  guest: boolean;
}

export function NewMatchForm({ groupId, players, defaultWhen }: { groupId: string; players: P[]; defaultWhen: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gks, setGks] = useState<Set<string>>(new Set(players.filter((p) => p.isGoalkeeper).map((p) => p.id)));
  const [pending, setPending] = useState(false);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const chosen = players.filter((p) => selected.has(p.id));
  const preview = useMemo(() => {
    if (chosen.length < 4) return null;
    return balanceTeams(chosen.map((p) => ({ ...p, isGoalkeeper: gks.has(p.id) })), 1)[0];
  }, [chosen, gks]);

  const half = Math.floor(chosen.length / 2);

  return (
    <form action={createMatch} onSubmit={() => setPending(true)} className="space-y-4">
      <input type="hidden" name="groupId" value={groupId} />
      {chosen.map((p) => (
        <input key={p.id} type="hidden" name="players" value={p.id} />
      ))}
      {chosen
        .filter((p) => gks.has(p.id))
        .map((p) => (
          <input key={p.id} type="hidden" name="gk" value={p.id} />
        ))}

      <Card className="grid grid-cols-2 gap-3">
        <label className="col-span-2 sm:col-span-1">
          <Label>Tarih ve saat</Label>
          <Input type="datetime-local" name="playedAt" defaultValue={defaultWhen} required />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <Label hint="isteğe bağlı">Saha</Label>
          <Input name="venue" placeholder="Örn. Yıldız Halısaha" />
        </label>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Gelenler · {chosen.length}
          {chosen.length >= 2 && (
            <span className="ml-1 normal-case">
              ({half}&apos;e {chosen.length - half})
            </span>
          )}
        </h2>
        <button
          type="button"
          className="text-sm text-accent"
          onClick={() =>
            setSelected(selected.size === players.length ? new Set() : new Set(players.map((p) => p.id)))
          }
        >
          {selected.size === players.length ? "Hiçbiri" : "Hepsi"}
        </button>
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-line">
          {players.map((p) => {
            const on = selected.has(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                <button
                  type="button"
                  onClick={() => setSelected(toggle(selected, p.id))}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                  aria-pressed={on}
                >
                  <span
                    className={cx(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm",
                      on ? "border-accent bg-accent text-pitch-950" : "border-line",
                    )}
                  >
                    {on && "✓"}
                  </span>
                  <OvrBadge overall={p.overall} />
                  <span className="truncate">
                    {p.name}
                    {p.guest && <span className="ml-1 text-xs text-muted">misafir</span>}
                  </span>
                </button>
                {on && (
                  <button
                    type="button"
                    onClick={() => setGks(toggle(gks, p.id))}
                    className={cx(
                      "rounded-lg px-2 py-1 text-xs font-semibold",
                      gks.has(p.id) ? "bg-amber-400/20 text-amber-300" : "text-muted hover:bg-pitch-800",
                    )}
                    title="Kaleci olarak işaretle"
                  >
                    🧤 KL
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {preview && (
        <Card>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted">Önerilen takımlar</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { team: preview.teamA, avg: preview.averageA, color: "text-team-a", label: "Sarı" },
              { team: preview.teamB, avg: preview.averageB, color: "text-team-b", label: "Mavi" },
            ].map((t) => (
              <div key={t.label}>
                <div className={cx("mb-1 font-bold", t.color)}>
                  {t.label} · {t.avg}
                </div>
                <ul className="space-y-0.5 text-muted">
                  {t.team.map((p) => (
                    <li key={p.id} className="truncate">
                      {p.isGoalkeeper && "🧤 "}
                      {shortName(p.name ?? "")}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Maçı oluşturduktan sonra takımları karıştırabilir veya elle değiştirebilirsin.</p>
        </Card>
      )}

      <Button className="w-full" disabled={chosen.length < 4 || pending}>
        {pending ? "Oluşturuluyor…" : chosen.length < 4 ? "En az 4 oyuncu seç" : "Maçı oluştur"}
      </Button>
    </form>
  );
}
