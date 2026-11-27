"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { Card, SectionTitle, cx } from "@/components/ui";
import { moveRoster } from "@/lib/match-manage-actions";
import type { Position } from "@/lib/data";

export type Zone = "in" | "reserve" | "out";

export interface BoardPerson {
  /** Üyede hesap id'si, misafirde oyuncu satırı */
  key: string;
  userId: string | null;
  playerId: string | null;
  name: string;
  overall: number;
  position: Position | null;
  zone: Zone;
  photoUrl?: string | null;
  /** Kadro dışındakilerde sebep: "Gelemem dedi", "Yanıt vermedi"… */
  tag?: string;
  /** Yetkim varsa bu kişiyi taşıyabilir miyim */
  movable: boolean;
  /** Misafir veya takım dışından: kadro dışına alınınca maçtan tamamen çıkar */
  leaves: boolean;
}

const ZONES: { id: Zone; title: string; icon: string; empty: string; accent: string }[] = [
  { id: "in", title: "Kadromuz", icon: "groups", empty: "Henüz kimse yok.", accent: "text-primary" },
  { id: "reserve", title: "Yedekler", icon: "chair", empty: "Yedek yok.", accent: "text-amber-300" },
  { id: "out", title: "Kadro dışı", icon: "person_off", empty: "Herkes kadroda veya yedekte.", accent: "text-muted" },
];

/**
 * Planlanmış maçta (`outOnly`) kadro ve yedekler diziliş sahnesindedir: yalnızca "Kadro dışı" listesi,
 * satırda "Kadroya ekle". Toplanırken Kadro / Yedek / Kadro dışı. Yönetenler kişiyi tutamacından sürükleyip bölüme bırakır
 * (sürüklerken altta üç hedef çıkar) ya da adına dokunup hedefi seçer; değişiklik hemen kaydedilir.
 */
export function RosterBoard({
  groupId,
  matchId,
  people,
  capacity,
  canManage,
  onlyRoster = false,
  outOnly = false,
}: {
  groupId: string;
  matchId: string;
  people: BoardPerson[];
  capacity: number | null;
  canManage: boolean;
  /** Takım dışından bakana yalnızca kadro */
  onlyRoster?: boolean;
  outOnly?: boolean;
}) {
  const [shown, applyMove] = useOptimistic(people, (cur, m: { key: string; to: Zone }) => {
    const rest = cur.filter((p) => p.key !== m.key);
    const to = m.to;
    if (to === "out" && cur.some((p) => p.key === m.key && p.leaves)) return rest;
    // Taşınan kişi yeni bölümün sonuna yazılır
    return [...rest, ...cur.filter((p) => p.key === m.key).map((p) => ({ ...p, zone: to, tag: undefined }))];
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number; over: Zone | null } | null>(null);
  const gesture = useRef<{ key: string; sx: number; sy: number; moved: boolean } | null>(null);

  const full = !!capacity && shown.filter((p) => p.zone === "in").length >= capacity;

  function move(key: string, to: Zone) {
    const p = shown.find((x) => x.key === key);
    setSelected(null);
    if (!p || p.zone === to) return;
    if (to === "in" && full) {
      setError(outOnly ? "Kadro dolu; önce sahadan birini kadro dışı bırak." : "Kadro dolu; önce birini yedeklere veya kadro dışına al.");
      return;
    }
    if (to === "out" && p.leaves && !window.confirm(`${p.name} maçtan çıkarılsın mı?`)) return;
    setError(null);
    startTransition(async () => {
      applyMove({ key, to });
      const res = await moveRoster({ groupId, matchId, userId: p.userId, playerId: p.userId ? null : p.playerId, to });
      if (res.error) setError(res.error);
    });
  }

  function zoneAt(x: number, y: number): Zone | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const z = (el as HTMLElement).dataset?.zone;
      if (z) return z as Zone;
    }
    return null;
  }
  const handleProps = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current = { key, sx: e.clientX, sy: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6) return;
      g.moved = true;
      setSelected(null);
      setDrag({ key: g.key, x: e.clientX, y: e.clientY, over: zoneAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      setDrag(null);
      if (!g) return;
      if (!g.moved) return setSelected((s) => (s === g.key ? null : g.key));
      const z = zoneAt(e.clientX, e.clientY);
      if (z) move(g.key, z);
    },
    onPointerCancel: () => {
      gesture.current = null;
      setDrag(null);
    },
  });

  const dragged = drag ? shown.find((p) => p.key === drag.key) : null;

  return (
    <section className="mb-4" aria-busy={pending}>
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-red-950/60 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      {ZONES.filter((z) => (outOnly ? z.id === "out" : !onlyRoster || z.id === "in")).map((z) => {
        const list = shown.filter((p) => p.zone === z.id);
        return (
          <div key={z.id} data-zone={z.id}>
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                <Icon name={z.icon} className={cx("text-[18px]", z.accent)} />
                {z.title} · {list.length}
                {z.id === "in" && capacity ? `/${capacity}` : ""}
              </span>
            </SectionTitle>
            <Card className={cx("mb-3 p-0 transition", drag?.over === z.id && "border-accent bg-accent/10")}>
              {list.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">{z.empty}</p>
              ) : (
                <ul className={cx("divide-y divide-line", z.id === "out" && "max-h-80 overflow-y-auto")}>
                  {list.map((p, i) => {
                    const editable = canManage && p.movable;
                    const open = selected === p.key;
                    return (
                      <li key={p.key} className={cx(drag?.key === p.key && "opacity-40", open && "bg-accent/5")}>
                        <div className="flex min-h-12 items-center gap-2.5 px-3 py-1.5">
                          {z.id === "reserve" && <span className="w-4 text-center text-sm font-bold text-muted">{i + 1}</span>}
                          <button
                            type="button"
                            aria-expanded={editable ? open : undefined}
                            onClick={() => setSelected(open ? null : p.key)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <OvrBadge overall={p.overall} className={cx(z.id === "out" && "opacity-50")} />
                            <span className="min-w-0 flex-1">
                              <span className={cx("block truncate text-sm font-medium", z.id === "out" && "text-on-surface-variant")}>{p.name}</span>
                              {(p.tag || !p.userId) && <span className="block truncate text-xs text-muted">{[!p.userId && "misafir", p.tag].filter(Boolean).join(" · ")}</span>}
                            </span>
                            <PositionChip position={p.position} />
                          </button>
                          {editable && outOnly ? (
                            <button
                              type="button"
                              disabled={pending || full}
                              onClick={() => move(p.key, "in")}
                              className="min-h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold text-primary disabled:opacity-40"
                            >
                              {full ? "Kadro dolu" : "Kadroya ekle"}
                            </button>
                          ) : editable ? (
                            <span
                              {...handleProps(p.key)}
                              style={{ touchAction: "none" }}
                              className="-mr-1 flex h-10 w-8 shrink-0 cursor-grab select-none items-center justify-center text-muted active:cursor-grabbing"
                              aria-label={`${p.name} taşı`}
                            >
                              <Icon name="drag_indicator" className="text-[22px]" />
                            </span>
                          ) : (
                            canManage && !outOnly && <span className="w-7 shrink-0" />
                          )}
                        </div>
                        {open && (
                          <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                            {editable &&
                              ZONES.filter((t) => t.id !== z.id && !(outOnly && t.id === "in")).map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  disabled={t.id === "in" && full}
                                  onClick={() => move(p.key, t.id)}
                                  className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold disabled:opacity-40"
                                >
                                  {t.id === "in" ? (full ? "Kadro dolu" : "Kadroya") : t.id === "reserve" ? (outOnly ? "Yedek kulübesine" : "Yedeğe") : p.leaves ? "Maçtan çıkar" : "Kadro dışına"}
                                </button>
                              ))}
                            {p.playerId && (
                              <Link href={`/g/${groupId}/p/${p.playerId}`} className="flex min-h-9 items-center rounded-lg px-3 text-sm text-accent">
                                Kartı gör
                              </Link>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        );
      })}
      {canManage && !outOnly && <p className="px-1 text-xs text-muted">Kişiyi sağındaki tutamaçtan sürükle ya da adına dokunup nereye gideceğini seç.</p>}

      {/* Sürüklerken ekranın altında üç hedef: uzun listede kaydırmaya gerek kalmaz */}
      {drag && dragged && (
        <>
          <div className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 gap-2 border-t border-line bg-pitch-950/95 p-3 pb-6 backdrop-blur">
            {ZONES.map((z) => (
              <div
                key={z.id}
                data-zone={z.id}
                className={cx(
                  "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-xs font-bold",
                  drag.over === z.id ? "border-accent bg-accent/20 text-accent" : "border-line text-muted",
                  (dragged.zone === z.id || (z.id === "in" && full)) && "opacity-40",
                )}
              >
                <Icon name={z.icon} className="text-[24px]" />
                {z.id === "out" && dragged.leaves ? "Maçtan çıkar" : z.title}
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none fixed z-[60] -translate-x-full -translate-y-full whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-pitch-950 shadow-lg"
            style={{ left: drag.x, top: drag.y }}
          >
            {dragged.name}
          </div>
        </>
      )}
    </section>
  );
}
