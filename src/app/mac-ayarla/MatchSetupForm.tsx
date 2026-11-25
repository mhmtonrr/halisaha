"use client";

import { useState } from "react";
import { setupMatch } from "@/lib/match-actions";
import { defaultCapacity, opensConfirmed } from "@/lib/match-rules";
import { SIZES } from "@/lib/formations";
import { POSITIONS, type Position } from "@/lib/data";
import { Button, Card, Input, Label, cx } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";
const textareaCls = "w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent";
const POS_TR: Record<Position, string> = { GK: "Kaleci", DEF: "Defans", MID: "Orta saha", FWD: "Forvet" };

interface Member {
  userId: string;
  name: string;
  overall: number;
  position: Position | null;
}

export function MatchSetupForm({
  group,
  isAdmin,
  members,
  today,
  maxDay,
  rival,
}: {
  group: { id: string; name: string; kind: "team" | "community" };
  isAdmin: boolean;
  members: Member[];
  today: string;
  maxDay: string;
  rival: { id: string; name: string } | null;
}) {
  const team = group.kind === "team";
  const kind = team ? "external" : "internal";
  const [size, setSize] = useState(7);
  const [capTouched, setCapTouched] = useState<number | null>(null);
  const capacity = capTouched ?? defaultCapacity(kind, size);
  const [timeMode, setTimeMode] = useState<"time" | "tbd">("time");
  const [time, setTime] = useState("");
  const [opponentMode, setOpponentMode] = useState<"later" | "name">("later");
  const [opponent, setOpponent] = useState("");
  const [withMe, setWithMe] = useState(true);
  const [announce, setAnnounce] = useState(true);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<{ name: string; position: string }[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPos, setGuestPos] = useState("");
  const [pending, setPending] = useState(false);

  const count = (withMe ? 1 : 0) + confirmed.size + guests.length;
  const over = count > capacity;
  const hasOpponent = !rival && opponentMode === "name" && opponent.trim().length >= 2;
  const direct = !over && opensConfirmed({ count, capacity, hasTime: timeMode === "time" && !!time, kind, hasOpponent });

  const toggle = (id: string) => {
    const next = new Set(confirmed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setConfirmed(next);
  };
  const addGuest = () => {
    if (guestName.trim().length < 2) return;
    setGuests([...guests, { name: guestName.trim().slice(0, 40), position: guestPos }]);
    setGuestName("");
    setGuestPos("");
  };

  return (
    <form action={setupMatch} onSubmit={() => setPending(true)} className="space-y-4">
      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="timeMode" value={timeMode} />
      <input type="hidden" name="withMe" value={withMe ? "1" : "0"} />
      <input type="hidden" name="announce" value={announce ? "1" : "0"} />
      {capTouched !== null && <input type="hidden" name="capacity" value={capacity} />}
      {rival && <input type="hidden" name="rivalTeam" value={rival.id} />}
      {[...confirmed].map((id) => (
        <input key={id} type="hidden" name="confirmed" value={id} />
      ))}
      {guests.map((g, i) => (
        <span key={i}>
          <input type="hidden" name="guestName" value={g.name} />
          <input type="hidden" name="guestPos" value={g.position} />
        </span>
      ))}

      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label>Gün</Label>
            <Input type="date" name="day" min={today} max={maxDay} defaultValue={today} required />
          </label>
          <div>
            <Label>Saat</Label>
            {timeMode === "time" ? (
              <Input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} required aria-label="Saat" />
            ) : (
              <div className="flex min-h-11 items-center rounded-xl border border-dashed border-line px-3 text-sm text-muted">Sonra belirlenecek</div>
            )}
          </div>
        </div>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={timeMode === "tbd"} onChange={(e) => setTimeMode(e.target.checked ? "tbd" : "time")} className="accent-accent" />
          Saat belli değil (kadro toplanınca seçerim)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label hint="her taraf">Format</Label>
            <select name="size" value={size} onChange={(e) => setSize(Number(e.target.value))} className={selectCls}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}v{n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label hint={team ? "bizim taraf" : "iki taraf toplam"}>Kadro</Label>
            <Input
              type="number"
              min={2}
              max={30}
              value={capacity}
              onChange={(e) => setCapTouched(Math.max(2, Math.min(30, Number(e.target.value) || 2)))}
              aria-label="Kadro sayısı"
            />
          </label>
        </div>
      </Card>

      {team && (
        <Card className="space-y-3">
          <Label>Rakip</Label>
          {rival ? (
            <p className="flex items-center gap-2 text-sm">
              <Icon name="swords" className="text-[18px] text-primary" />
              <span>
                <b>{rival.name}</b> takımına maç teklifi gidecek. Kabul ederlerse maç onlarla bağlanır.
              </span>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["later", "name"] as const).map((m) => (
                  <label key={m} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-2 text-center text-sm has-checked:border-accent has-checked:bg-accent/10">
                    <input type="radio" name="opponentMode" value={m} checked={opponentMode === m} onChange={() => setOpponentMode(m)} className="sr-only" />
                    {m === "later" ? "Sonra belirlerim" : "İsim yaz"}
                  </label>
                ))}
              </div>
              {opponentMode === "name" && (
                <Input name="opponent" value={opponent} onChange={(e) => setOpponent(e.target.value)} minLength={2} maxLength={60} placeholder="Örn. Yıldızspor" aria-label="Rakip adı" />
              )}
              <p className="text-xs text-muted">Rakip uygulamadaysa maç ekranından teklif gönderebilirsin.</p>
            </>
          )}
        </Card>
      )}

      <Card className="space-y-3">
        <label className="block">
          <Label hint="isteğe bağlı">Saha</Label>
          <Input name="venue" maxLength={80} placeholder="Örn. Petroller Halısaha" />
        </label>
        <label className="block">
          <Label hint="isteğe bağlı">Not</Label>
          <textarea name="note" maxLength={300} rows={2} placeholder="Örn. Kişi başı 150 TL. Kaleci lazım!" className={textareaCls} />
        </label>
      </Card>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Kadro</h2>
        <Card className="space-y-1 p-0">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4">
            <input type="checkbox" checked={withMe} onChange={(e) => setWithMe(e.target.checked)} className="h-5 w-5 accent-accent" />
            <span className="font-medium">Ben de oynuyorum</span>
          </label>
        </Card>

        <Card className="p-0">
          <div className="px-4 pt-3 text-sm font-semibold">Kesin gelenler</div>
          <p className="px-4 pb-2 text-xs text-muted">Gelmesi kesin olan üyeleri işaretle; bildirim alırlar, gelemezlerse kendileri çıkar.</p>
          {members.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-muted">Başka üye yok.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {members.map((p) => {
                const on = confirmed.has(p.userId);
                return (
                  <li key={p.userId}>
                    <button type="button" onClick={() => toggle(p.userId)} aria-pressed={on} className="flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left">
                      <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm", on ? "border-accent bg-accent text-pitch-950" : "border-line")}>
                        {on && "✓"}
                      </span>
                      <OvrBadge overall={p.overall} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <PositionChip position={p.position} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {isAdmin && (
          <Card className="space-y-2">
            <div className="text-sm font-semibold">Misafir</div>
            <p className="text-xs text-muted">Uygulamayı kullanmayan, gelmesi kesin biri (örn. bir arkadaşın getirdiği).</p>
            {guests.length > 0 && (
              <ul className="space-y-1">
                {guests.map((g, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-pitch-900 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {g.name} <span className="text-xs text-muted">misafir{g.position ? ` · ${POS_TR[g.position as Position]}` : ""}</span>
                    </span>
                    <button type="button" onClick={() => setGuests(guests.filter((_, j) => j !== i))} aria-label={`${g.name} çıkar`} className="text-muted">
                      <Icon name="close" className="text-[18px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Ad" maxLength={40} aria-label="Misafir adı" className="flex-1" />
              <select value={guestPos} onChange={(e) => setGuestPos(e.target.value)} aria-label="Misafir mevkisi" className={cx(selectCls, "w-28")}>
                <option value="">Mevki</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POS_TR[p]}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" onClick={addGuest} disabled={guestName.trim().length < 2} className="shrink-0 px-3">
                Ekle
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="mt-0.5 h-5 w-5 accent-accent" />
            <span>
              <span className="block font-medium">{team ? "Takıma" : "Gruba"} duyur</span>
              <span className="block text-xs text-muted">Üyeler &quot;Geliyorum / Gelemem&quot; der; geliyorum diyen yer varsa kadroya, yoksa yedeğe girer.</span>
            </span>
          </label>
        </Card>
      </section>

      <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-line bg-pitch-950/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span>
            Kadro <b>{count}/{capacity}</b>
          </span>
          <span className={cx("text-xs", over ? "text-amber-300" : "text-muted")}>
            {over ? "Seçilenler kadroyu aşıyor" : count >= capacity ? "Kadro tamam" : `${capacity - count} kişi eksik`}
          </span>
        </div>
        <Button className="w-full" disabled={over || pending}>
          {pending ? "Ayarlanıyor…" : direct ? "Maçı kur" : "Maçı ayarla"}
        </Button>
        <p className="text-center text-[11px] text-muted">
          {direct ? "Kadro tam ve saat belli: maç direkt kesinleşir." : "Maç toplanmaya açılır; eksik için adam arayabilir, sonra kesinleştirirsin."}
        </p>
      </div>
    </form>
  );
}
