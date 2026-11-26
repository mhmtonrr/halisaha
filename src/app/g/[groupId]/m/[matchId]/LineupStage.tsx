"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { PitchCard, type PitchPlayer } from "@/components/LineupPitch";
import { initials, shortName } from "@/components/PlayerCard";
import { cx } from "@/components/ui";
import { movePlayer, reshuffleTeams, setLineup } from "@/lib/actions";
import { autoLineup, cardWidthPct, formationsFor, getFormation, type Formation, type Slot } from "@/lib/formations";
import { Field, project } from "./StageField";

type Assign = Record<string, number | null>;

export interface StagePlayer extends PitchPlayer {
  /** Kaydedilmiş yeri; boşsa kulübede */
  slot: number | null;
}

export interface StageSide {
  key: "A" | "B" | "opp";
  title: string;
  /** Takım rengi (ışık ve halka) */
  color: string;
  /** Oyuncu kartı bağlantısının grubu */
  groupId: string;
  size: number;
  formationId: string | null;
  /** Takım gücü (en iyi 7) */
  rating: number;
  players: StagePlayer[];
  editable: boolean;
}

interface Draft {
  sig: string;
  formationId: string;
  assign: Assign;
}

/** Sunucudaki durumun imzası: kadro veya kayıtlı diziliş değişince yereldeki taslak düşer */
const signature = (s: StageSide) => `${s.size}:${s.formationId}:${s.players.map((p) => `${p.id}=${p.slot}`).join()}`;

const isSaved = (s: StageSide) => s.players.some((p) => p.slot !== null);

/** Kayıtlı diziliş; hiç kaydedilmemişse mevkilere göre otomatik taslak */
function initialDraft(s: StageSide): Draft {
  const formation = getFormation(s.size, s.formationId) ?? formationsFor(s.size)[0];
  const assign: Assign = isSaved(s) ? Object.fromEntries(s.players.map((p) => [p.id, p.slot])) : autoLineup(s.players, formation);
  return { sig: signature(s), formationId: formation.id, assign };
}

const formationOf = (s: StageSide, d: Draft): Formation => getFormation(s.size, d.formationId) ?? formationsFor(s.size)[0];

/**
 * Maç ekranının sahnesi: gece maçı sahası. Herkes görür; yöneten kartları doğrudan sahada sürükler
 * (ya da seçip hedefe dokunur) ve alttaki çubuktan kaydeder. Kendi aramızda maçta iki taraf ve
 * "Karşılaşma" görünümü, takımlar arası maçta iki takım sekmesi vardır.
 */
export function LineupStage({
  groupId,
  matchId,
  sides,
  faceOff = false,
  canShuffle = false,
  initialTab,
}: {
  groupId: string;
  matchId: string;
  sides: StageSide[];
  /** Kendi aramızda: iki takım karşı karşıya görünümü */
  faceOff?: boolean;
  canShuffle?: boolean;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab ?? sides[0].key);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftOf = (s: StageSide) => (drafts[s.key]?.sig === signature(s) ? drafts[s.key] : initialDraft(s));
  const side = sides.find((s) => s.key === tab);
  const showFaceOff = faceOff && sides.length === 2;
  const tabs = [...sides.map((s) => ({ id: s.key as string, label: s.title, color: s.color })), ...(showFaceOff ? [{ id: "vs", label: "Karşılaşma", color: null }] : [])];

  return (
    <section id="dizilis" aria-label="Diziliş" className="-mx-4 mb-4 scroll-mt-4 sm:mx-0">
      <div className="bg-[#060d14] sm:rounded-3xl sm:border sm:border-white/10">
        {tabs.length > 1 && (
          <div role="tablist" className="flex gap-1 px-3 pt-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  "flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-bold transition",
                  tab === t.id ? "bg-white/12 text-white" : "text-white/50",
                )}
              >
                {t.color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} /> : <Icon name="swords" className="text-[18px]" />}
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {side ? (
          <SideStage
            key={side.key}
            groupId={groupId}
            matchId={matchId}
            side={side}
            draft={draftOf(side)}
            touched={drafts[side.key]?.sig === signature(side)}
            onDraft={(d) => setDrafts((all) => ({ ...all, [side.key]: d }))}
            onReset={() =>
              setDrafts((all) => {
                const next = { ...all };
                delete next[side.key];
                return next;
              })
            }
            canSwitchTeam={faceOff && side.editable}
          />
        ) : (
          <FaceOff sides={sides.map((s) => ({ side: s, draft: draftOf(s) }))} />
        )}

        {canShuffle && (
          <form action={reshuffleTeams} className="px-3 pb-3">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="matchId" value={matchId} />
            <SubmitButton variant="secondary" className="w-full border-white/15 bg-white/5 text-white" pendingLabel="Karıştırılıyor…">
              <Icon name="shuffle" className="text-[20px]" />
              Takımları yeniden karıştır
            </SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}

function SideStage({
  groupId,
  matchId,
  side,
  draft,
  touched,
  onDraft,
  onReset,
  canSwitchTeam,
}: {
  groupId: string;
  matchId: string;
  side: StageSide;
  draft: Draft;
  touched: boolean;
  onDraft: (d: Draft) => void;
  onReset: () => void;
  canSwitchTeam: boolean;
}) {
  const { editable, players, color } = side;
  const formation = formationOf(side, draft);
  const { assign } = draft;
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const gesture = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  const slotOf = (id: string) => {
    const s = assign[id];
    return s === null || s === undefined ? null : (formation.slots[s] ?? null);
  };
  const onPitch = players.filter((p) => slotOf(p.id));
  const bench = players.filter((p) => !slotOf(p.id));
  const taken = new Set(onPitch.map((p) => assign[p.id]));
  const picked = players.find((p) => p.id === selected);
  const dragged = drag ? players.find((p) => p.id === drag.id) : null;
  const cardPct = cardWidthPct(formation);
  const draftOnly = !isSaved(side) && players.length > 0;

  /** Oyuncuyu bir slota ya da kulübeye taşır; dolu slottaki oyuncu eski yerine geçer (takas) */
  function place(id: string, target: number | null) {
    const next = { ...assign };
    const from = assign[id] ?? null;
    // Kendi yerine bırakmak değişiklik sayılmaz
    if (target === from) return setSelected(null);
    if (target !== null) {
      const occupant = Object.keys(next).find((k) => next[k] === target);
      if (occupant && occupant !== id) next[occupant] = from;
    }
    next[id] = target;
    onDraft({ ...draft, assign: next });
    setSelected(null);
  }

  function chooseFormation(id: string) {
    const f = getFormation(side.size, id);
    if (!f) return;
    // Sahadakiler eşit uygunlukta sahada kalır
    onDraft({ ...draft, formationId: id, assign: autoLineup(players, f, onPitch.map((p) => p.id)) });
    setSelected(null);
  }

  // --- Dokunma ve sürükleme (Pointer Events: fare ve dokunmatik) --------------
  function dropAt(x: number, y: number): string | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const t = (el as HTMLElement).dataset?.drop;
      if (t) return t;
    }
    return null;
  }
  function tap(id: string) {
    if (selected && selected !== id) place(selected, assign[id] ?? null);
    else setSelected(selected === id ? null : id);
  }
  const tokenProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6) return;
      g.moved = true;
      setDrag({ id: g.id, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      setDrag(null);
      if (!g) return;
      if (!g.moved) return tap(g.id);
      const target = dropAt(e.clientX, e.clientY);
      if (target) place(g.id, target === "bench" ? null : Number(target.slice(5)));
    },
    onPointerCancel: () => {
      gesture.current = null;
      setDrag(null);
    },
    // Dokunuşun click'i, token'ı saran kulübe alanının "seçiliyi buraya koy" işleyicisine ulaşmasın
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tap(id);
      }
    },
    role: "button",
    tabIndex: 0,
    style: { touchAction: "none" as const },
    className: "block cursor-grab select-none active:cursor-grabbing",
  });

  /** Sahadaki ya da kulübedeki kart: yöneten için sürüklenir, diğerleri için oyuncu sayfasına bağlantı */
  const card = (p: StagePlayer, fontSize?: string) =>
    editable ? (
      <div
        {...tokenProps(p.id)}
        aria-label={`${p.name} kartı`}
        aria-pressed={selected === p.id}
        className={cx(
          tokenProps(p.id).className,
          "transition-[transform,filter,opacity] duration-150",
          selected === p.id && "scale-110 drop-shadow-[0_0_10px_rgba(255,255,255,0.85)]",
          drag?.id === p.id && "opacity-25",
        )}
      >
        <PitchCard player={p} fontSize={fontSize} />
      </div>
    ) : (
      <Link href={`/g/${side.groupId}/p/${p.id}`} aria-label={`${p.name} kartı`} className="block">
        <PitchCard player={p} fontSize={fontSize} />
      </Link>
    );

  return (
    <div>
      {/* Skorbord şeridi */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-3 text-white">
        <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 14px ${color}` }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-bold leading-tight">{side.title}</div>
          <div className="text-xs text-white/55">
            Sahada {onPitch.length}/{side.size}
            {draftOnly && " · taslak diziliş"}
          </div>
        </div>
        <div className="text-center">
          <div className="font-display text-2xl font-black tabular-nums leading-none">{players.length ? side.rating : "–"}</div>
          <div className="t-label-caps mt-1 uppercase text-white/50">Güç</div>
        </div>
        <div className="min-w-16 text-center">
          <div className="font-display text-2xl font-black tabular-nums leading-none" style={{ color }}>
            {formation.id}
          </div>
          <div className="t-label-caps mt-1 uppercase text-white/50">Diziliş</div>
        </div>
      </div>

      {editable && (
        <div role="radiogroup" aria-label="Diziliş seç" className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2">
          {formationsFor(side.size).map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={f.id === formation.id}
              onClick={() => chooseFormation(f.id)}
              className={cx(
                "min-h-9 shrink-0 rounded-full border px-4 text-sm font-bold tabular-nums transition",
                f.id === formation.id ? "border-transparent bg-white text-[#060d14]" : "border-white/15 text-white/70",
              )}
            >
              {f.id}
            </button>
          ))}
        </div>
      )}

      <Field aspect={7 / 5} top={0.8} color={color} cardPct={cardPct}>
        {/* Boş yerler ve bırakma hedefleri */}
        {formation.slots.map((slot) => {
          const empty = !taken.has(slot.index);
          if (!editable && !empty) return null;
          const over = drag?.over === `slot:${slot.index}`;
          return (
            <Spot key={`slot-${slot.index}`} slot={slot} top={0.8}>
              <div
                data-drop={editable ? `slot:${slot.index}` : undefined}
                onClick={() => selected && place(selected, slot.index)}
                className="flex items-center justify-center"
                style={{ width: "calc(var(--cw) * 1cqw)", height: "calc(var(--cw) * 1.35cqw)" }}
              >
                {empty && <Marker role={slot.role} active={over || !!selected} color={color} />}
              </div>
            </Spot>
          );
        })}
        {/* Kartlar oyuncuya göre anahtarlı: diziliş değişince yeni yerine kayar */}
        {players.map((p) => {
          const slot = slotOf(p.id);
          if (!slot) return null;
          const over = drag?.over === `slot:${slot.index}` && drag.id !== p.id;
          return (
            <Spot key={p.id} slot={slot} top={0.8} z={selected === p.id ? 200 : undefined}>
              <div className="hs-slot-in relative" style={{ animationDelay: `${slot.index * 45}ms` }}>
                {/* Kartın altındaki ışık halkası */}
                <span className="pointer-events-none absolute -bottom-[6%] left-1/2 h-[16%] w-[92%] -translate-x-1/2 rounded-[100%] blur-[3px]" style={{ background: color, opacity: 0.55 }} />
                <div data-drop={editable ? `slot:${slot.index}` : undefined} className={cx("relative rounded-xl", over && "ring-2 ring-white")}>
                  {card(p)}
                </div>
              </div>
            </Spot>
          );
        })}
        {players.length === 0 && (
          <p className="absolute left-1/2 top-1/2 w-max max-w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-sm font-semibold text-white">
            Kadro bekleniyor
          </p>
        )}
      </Field>

      {/* Seçili oyuncunun işlemleri */}
      {picked && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm text-white">
          <span className="min-w-0 flex-1 truncate">
            <b>{shortName(picked.name)}</b> <span className="text-white/55">seçili · hedefe dokun</span>
          </span>
          {slotOf(picked.id) && (
            <button type="button" onClick={() => place(picked.id, null)} className="min-h-9 rounded-full border border-white/20 px-3 font-semibold">
              Kulübeye
            </button>
          )}
          {canSwitchTeam &&
            (touched ? (
              <span className="text-xs text-amber-300">Takım değiştirmeden önce kaydet</span>
            ) : (
              <form action={movePlayer}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="matchId" value={matchId} />
                <input type="hidden" name="playerId" value={picked.id} />
                <input type="hidden" name="team" value={side.key} />
                <SubmitButton variant="secondary" className="min-h-9 border-white/20 bg-transparent px-3 text-sm text-white" pendingLabel="…">
                  {side.key === "A" ? "Maviye geçir" : "Sarıya geçir"}
                </SubmitButton>
              </form>
            ))}
          <Link href={`/g/${side.groupId}/p/${picked.id}`} className="flex min-h-9 items-center px-1 font-semibold text-accent">
            Kartı gör
          </Link>
        </div>
      )}

      {/* Yedek kulübesi */}
      {(bench.length > 0 || (editable && players.length > 0)) && (
        <div
          data-drop={editable ? "bench" : undefined}
          onClick={() => selected && place(selected, null)}
          className={cx("mx-3 my-3 rounded-2xl border border-white/10 bg-white/5 p-2.5 transition", drag?.over === "bench" && "border-white bg-white/15")}
        >
          <div className="t-label-caps mb-2 flex items-center gap-1.5 uppercase text-white/55">
            <Icon name="chair" className="text-[16px]" />
            Kulübe · {bench.length}
          </div>
          {bench.length === 0 ? (
            <p className="py-1 text-xs text-white/45">Herkes sahada. Birini kenara almak için buraya sürükle.</p>
          ) : (
            <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {bench.map((p) => (
                <li key={p.id} className="shrink-0">
                  {card(p, "6.5px")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editable && players.length > 0 && (touched || draftOnly) && (
        <form action={setLineup} className="sticky bottom-20 z-30 mx-3 mb-3 flex items-center gap-2 rounded-2xl border border-white/15 bg-[#0d1a26]/95 p-2 shadow-xl backdrop-blur">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="matchId" value={matchId} />
          <input type="hidden" name="team" value={side.key} />
          <input type="hidden" name="formation" value={formation.id} />
          <input type="hidden" name="lineup" value={JSON.stringify(assign)} />
          <span className="min-w-0 flex-1 pl-2 text-sm font-semibold text-white">{touched ? "Kaydedilmemiş değişiklik" : "Taslak diziliş"}</span>
          {touched && (
            <button type="button" onClick={onReset} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-white/60">
              Geri al
            </button>
          )}
          <SubmitButton className="min-h-10 px-5" pendingLabel="Kaydediliyor…">
            Kaydet
          </SubmitButton>
        </form>
      )}
      {editable && players.length > 0 && !selected && (
        <p className="px-4 pb-3 text-center text-xs text-white/45">Kartı sürükle ya da dokunup hedefi seç. Dolu yere bırakırsan yer değiştirirler.</p>
      )}
      {!editable && <div className="h-3" />}

      {/* Sürüklenen kartın parmağı izleyen kopyası */}
      {drag && dragged && (
        <div className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-[70%] rotate-3 scale-110" style={{ left: drag.x, top: drag.y }}>
          <PitchCard player={dragged} fontSize="8px" />
        </div>
      )}
    </div>
  );
}

/** Sahada perspektife göre konum: arkadakiler biraz küçük, öndekiler üstte */
function Spot({ slot, top, z, children }: { slot: Pick<Slot, "x" | "y">; top: number; z?: number; children: React.ReactNode }) {
  const at = project(slot.x, slot.y, top);
  const scale = 0.88 + (0.12 * slot.y) / 100;
  return (
    <div
      className="absolute transition-[left,top,transform] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
      style={{ left: `${at.x}%`, top: `${at.y}%`, transform: `translate(-50%, -50%) scale(${scale})`, zIndex: z ?? Math.round(slot.y) }}
    >
      {children}
    </div>
  );
}

/** Boş mevki: parlayan halka ve rol */
function Marker({ role, active, color }: { role: Slot["role"]; active: boolean; color: string }) {
  const label = { GK: "KL", DEF: "DEF", MID: "OS", FWD: "FV" }[role];
  return (
    <span
      className={cx("flex aspect-square w-3/4 items-center justify-center rounded-full border-2 border-dashed bg-black/35 text-[3.2cqw] font-bold text-white/75 transition", active && "scale-110 border-solid text-white")}
      style={{ borderColor: active ? color : "rgba(255,255,255,0.45)", boxShadow: active ? `0 0 16px ${color}` : undefined }}
    >
      {label}
    </span>
  );
}

/** İki takım aynı sahada karşı karşıya: altta ilk takım, üstte rakibi (küçük yuvarlak oyuncular) */
function FaceOff({ sides }: { sides: { side: StageSide; draft: Draft }[] }) {
  const [home, away] = sides;
  return (
    <div className="pb-3">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <TeamHead {...home} />
        <span className="font-display text-sm font-black text-white/40">VS</span>
        <TeamHead {...away} right />
      </div>
      <Field aspect={8 / 5} top={0.84} color={away.side.color} bottomColor={home.side.color}>
        {sides.map(({ side, draft }, i) => {
          const formation = formationOf(side, draft);
          return side.players.map((p) => {
            const s = draft.assign[p.id];
            const slot = s === null || s === undefined ? null : formation.slots[s];
            if (!slot) return null;
            // Alt takım alt yarıda; üst takım aynalanır (kalesi yukarıda)
            const at = i === 0 ? { x: slot.x, y: 50 + slot.y * 0.5 } : { x: 100 - slot.x, y: 50 - slot.y * 0.5 };
            return (
              <Spot key={p.id} slot={at} top={0.84}>
                <Link href={`/g/${side.groupId}/p/${p.id}`} className="hs-slot-in flex w-[17cqw] flex-col items-center" style={{ animationDelay: `${slot.index * 45}ms` }}>
                  <Token player={p} color={side.color} />
                </Link>
              </Spot>
            );
          });
        })}
      </Field>
    </div>
  );
}

function TeamHead({ side, draft, right }: { side: StageSide; draft: Draft; right?: boolean }) {
  return (
    <div className={cx("min-w-0 flex-1", right && "text-right")}>
      <div className="truncate font-display font-bold" style={{ color: side.color }}>
        {side.title}
      </div>
      <div className="text-xs text-white/55">
        Güç <b className="text-white">{side.players.length ? side.rating : "–"}</b> · {formationOf(side, draft).id}
      </div>
    </div>
  );
}

function Token({ player, color }: { player: StagePlayer; color: string }) {
  return (
    <>
      <span className="relative flex h-[11cqw] w-[11cqw] items-center justify-center rounded-full border-2 bg-[#0b1620]" style={{ borderColor: color, boxShadow: `0 0 12px ${color}80` }}>
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.photoUrl} alt="" className="h-full w-full rounded-full object-contain object-bottom" draggable={false} />
        ) : (
          <span className="text-[3.6cqw] font-bold text-white">{initials(player.name)}</span>
        )}
        <span className="absolute -right-[2cqw] -top-[1cqw] rounded-md px-[1cqw] text-[3cqw] font-black leading-snug text-[#060d14]" style={{ background: color }}>
          {player.overall}
        </span>
      </span>
      <span className="mt-[0.5cqw] max-w-full truncate rounded bg-black/65 px-[1.2cqw] text-[3cqw] font-semibold leading-snug text-white">
        {player.cardName || shortName(player.name)}
      </span>
    </>
  );
}
