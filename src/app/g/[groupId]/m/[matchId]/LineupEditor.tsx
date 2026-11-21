"use client";

import { useMemo, useRef, useState } from "react";
import { setLineup } from "@/lib/actions";
import { autoLineup, formationsFor, getFormation, type Role } from "@/lib/formations";
import { Button, Card, cx } from "@/components/ui";
import { EmptySlot, MiniCard, Pitch, SlotBox, type PitchPlayer } from "@/components/LineupPitch";
import { OvrBadge, PositionChip, shortName } from "@/components/PlayerCard";

type Assign = Record<string, number | null>;

/**
 * Diziliş editörü: formasyonu seç, oyuncu kartlarını sahaya sürükle-bırak (dokununca seç, boş yere/oyuncuya dokununca yerleştir).
 * Sürükleme Pointer Events ile (dokunmatikte de çalışır). Kaydedince sahadaki oyuncunun maç mevkisi slotun rolü olur.
 */
export function LineupEditor({
  groupId,
  matchId,
  team,
  size,
  players,
  initialFormation,
  initialAssign,
}: {
  groupId: string;
  matchId: string;
  team: "A" | "B";
  size: number;
  players: (PitchPlayer & { position: Role | null })[];
  initialFormation: string | null;
  initialAssign: Assign;
}) {
  const formations = useMemo(() => formationsFor(size), [size]);
  const [formationId, setFormationId] = useState(
    getFormation(size, initialFormation)?.id ?? formations[0].id,
  );
  const formation = getFormation(size, formationId) ?? formations[0];

  // Hiç diziliş kaydedilmemişse mevkilere göre otomatik başla
  const [assign, setAssign] = useState<Assign>(() => {
    const hasSaved = Object.values(initialAssign).some((s) => s !== null);
    return hasSaved ? { ...initialAssign } : autoLineup(players, formation);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const gesture = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const owner = useMemo(() => {
    const m = new Map<number, string>();
    for (const [id, slot] of Object.entries(assign)) if (slot !== null) m.set(slot, id);
    return m;
  }, [assign]);
  const bench = players.filter((p) => assign[p.id] === null || assign[p.id] === undefined);
  const placedCount = players.length - bench.length;

  /** Oyuncuyu bir slota ya da yedeğe taşır; dolu slottaki oyuncu eski yerine geçer (takas) */
  function place(id: string, target: number | "bench") {
    setAssign((cur) => {
      const next = { ...cur };
      const from = cur[id] ?? null;
      if (target === "bench") {
        next[id] = null;
      } else {
        const occupant = [...Object.entries(cur)].find(([, s]) => s === target)?.[0];
        if (occupant && occupant !== id) next[occupant] = from;
        next[id] = target;
      }
      return next;
    });
  }

  // --- Dokunma ve sürükleme -------------------------------------------------
  function dropTarget(x: number, y: number): string | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const t = (el as HTMLElement).dataset?.drop;
      if (t) return t;
    }
    return null;
  }

  function applyTarget(id: string, target: string) {
    place(id, target === "bench" ? "bench" : Number(target.replace("slot:", "")));
  }

  function onTokenDown(e: React.PointerEvent, id: string) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
  }
  function onTokenMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6) return;
    g.moved = true;
    setDrag({ id: g.id, x: e.clientX, y: e.clientY, over: dropTarget(e.clientX, e.clientY) });
  }
  function onTokenUp(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      const target = dropTarget(e.clientX, e.clientY);
      setDrag(null);
      setSelected(null);
      if (target) applyTarget(g.id, target);
      return;
    }
    // Dokunma: seçili varsa o oyuncunun yerine geçir (takas), yoksa seç
    if (selected && selected !== g.id) {
      const slot = assign[g.id];
      place(selected, slot === null || slot === undefined ? "bench" : slot);
      setSelected(null);
    } else {
      setSelected(selected === g.id ? null : g.id);
    }
  }
  function onTokenCancel() {
    gesture.current = null;
    setDrag(null);
  }

  function chooseFormation(id: string) {
    setFormationId(id);
    const f = getFormation(size, id)!;
    // Sahadakiler eşit uygunlukta sahada kalır
    setAssign(autoLineup(players, f, Object.keys(assign).filter((p) => assign[p] !== null)));
    setSelected(null);
  }

  const tokenProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => onTokenDown(e, id),
    onPointerMove: onTokenMove,
    onPointerUp: onTokenUp,
    onPointerCancel: onTokenCancel,
    // Dokunuşun click'i, token'ı saran slot/yedek alanının "seçiliyi buraya koy" işleyicisine ulaşmasın
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    style: { touchAction: "none" as const },
    className: "cursor-grab select-none active:cursor-grabbing",
  });

  const dragging = drag ? byId.get(drag.id) : null;

  return (
    <form action={setLineup} onSubmit={() => setPending(true)} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="team" value={team} />
      <input type="hidden" name="formation" value={formation.id} />
      <input type="hidden" name="lineup" value={JSON.stringify(assign)} />

      <div className="-mx-1 flex flex-wrap gap-1.5 px-1" role="radiogroup" aria-label="Diziliş">
        {formations.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === formation.id}
            onClick={() => chooseFormation(f.id)}
            className={cx(
              "min-h-9 rounded-lg border px-3 text-sm font-bold tabular-nums transition",
              f.id === formation.id ? "border-accent bg-accent text-pitch-950" : "border-line text-muted hover:bg-pitch-800",
            )}
          >
            {f.id}
          </button>
        ))}
      </div>

      <Pitch>
        {formation.slots.map((slot) => {
          const id = owner.get(slot.index);
          const p = id ? byId.get(id) : undefined;
          const over = drag?.over === `slot:${slot.index}`;
          return (
            <SlotBox
              key={slot.index}
              at={slot}
              data-drop={`slot:${slot.index}`}
              onClick={() => {
                if (selected) {
                  place(selected, slot.index);
                  setSelected(null);
                }
              }}
              className={cx("rounded-xl p-0.5", over && "bg-accent/30 ring-2 ring-accent")}
            >
              {p ? (
                <div {...tokenProps(p.id)} className={cx(tokenProps(p.id).className, selected === p.id && "scale-110 drop-shadow-[0_0_6px_rgba(61,220,132,0.9)]", drag?.id === p.id && "opacity-30")}>
                  <MiniCard player={p} />
                </div>
              ) : (
                <EmptySlot role={slot.role} active={over || !!selected} />
              )}
            </SlotBox>
          );
        })}
      </Pitch>

      <Card
        data-drop="bench"
        onClick={() => {
          if (selected) {
            place(selected, "bench");
            setSelected(null);
          }
        }}
        className={cx("p-3", drag?.over === "bench" && "border-accent bg-accent/10")}
      >
        <div className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-muted">
          <span>Yedekler · {bench.length}</span>
          <span className={placedCount > size ? "text-red-300" : ""}>
            Sahada {placedCount}/{size}
          </span>
        </div>
        {bench.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted">Kadronun tamamı sahada. Birini yedeğe almak için buraya sürükle.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {bench.map((p) => (
              <li key={p.id}>
                <div
                  {...tokenProps(p.id)}
                  className={cx(
                    tokenProps(p.id).className,
                    "flex items-center gap-1.5 rounded-lg border border-line bg-pitch-950 py-1 pl-1 pr-2",
                    selected === p.id && "border-accent ring-1 ring-accent",
                    drag?.id === p.id && "opacity-30",
                  )}
                >
                  <OvrBadge overall={p.overall} className="h-7 w-7 text-xs" />
                  <span className="text-sm">{shortName(p.name)}</span>
                  <PositionChip position={p.position} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-xs text-muted">
        Kartı sahaya sürükle ya da kartı seçip yerine dokun. Dolu yere bırakırsan iki oyuncu yer değiştirir.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setAssign(autoLineup(players, formation, Object.keys(assign).filter((id) => assign[id] !== null)));
            setSelected(null);
          }}
        >
          ✨ Otomatik diz
        </Button>
        <Button disabled={pending}>{pending ? "Kaydediliyor…" : "Dizilişi kaydet"}</Button>
      </div>

      {/* Sürüklenen kartın imleci izleyen kopyası */}
      {drag && dragging && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 scale-110 opacity-90" style={{ left: drag.x, top: drag.y }}>
          <MiniCard player={dragging} />
        </div>
      )}
    </form>
  );
}
