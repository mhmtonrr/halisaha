"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { setupMatch } from "@/lib/match-actions";
import { defaultCapacity, feeText, matchWhen, opensConfirmed } from "@/lib/match-rules";
import { trPattern } from "@/lib/search";
import { SIZES } from "@/lib/formations";
import { POSITIONS, parseLocalDateTime, type Position } from "@/lib/data";
import { Button, Card, ErrorNote, Header, Input, Label, cx } from "@/components/ui";
import { BackLink } from "@/components/NavHistory";
import { SubmitButton } from "@/components/SubmitButton";
import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/Avatar";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { RivalPicker, type RivalSearch, type RivalTeam } from "@/components/RivalPicker";

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";
const textareaCls = "w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent";
const POS_TR: Record<Position, string> = { GK: "Kaleci", DEF: "Defans", MID: "Orta saha", FWD: "Forvet" };
const QUICK_TIMES = ["19:00", "20:00", "21:00", "22:00", "23:00"];

interface Member {
  userId: string;
  name: string;
  overall: number;
  position: Position | null;
}
interface Friend {
  userId: string;
  name: string;
  photoUrl: string | null;
}
type StepKey = "info" | "rival" | "roster" | "review";
const TITLES: Record<StepKey, string> = { info: "Maç bilgileri", rival: "Rakip", roster: "Gelenler", review: "Son kontrol" };

/** "2026-11-28" → gün kartı için parçalar (tarih takvim günü olduğundan UTC ile biçimlenir) */
function dayParts(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("tr-TR", { timeZone: "UTC", ...o });
  return { week: f({ weekday: "short" }), day: f({ day: "numeric" }), month: f({ month: "short" }) };
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function Chip({ on, className, ...props }: { on: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx(
        "min-h-11 rounded-xl border border-line bg-surface-container px-3 font-display text-sm font-semibold transition active:scale-[0.97] disabled:opacity-35",
        on && "border-primary bg-primary text-on-primary",
        className,
      )}
      {...props}
    />
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <Label hint={hint}>{label}</Label>
      {children}
    </section>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border", on ? "border-accent bg-accent text-pitch-950" : "border-line")}>
      {on && <Icon name="check" className="text-[18px]" />}
    </span>
  );
}

/** Adım adım "Maç ayarla": bilgiler → rakip (takım) → gelenler → son kontrol. Adım adreste (?adim=) tutulur, telefonun geri tuşu önceki adıma döner. */
export function MatchSetupForm({
  group,
  meId,
  isAdmin,
  members,
  friends,
  homeCity,
  today,
  rival,
  error,
}: {
  group: { id: string; name: string; kind: "team" | "community" };
  meId: string;
  isAdmin: boolean;
  members: Member[];
  friends: Friend[];
  homeCity: string;
  today: string;
  rival: { id: string; name: string } | null;
  error?: string;
}) {
  const team = group.kind === "team";
  const kind = team ? "external" : "internal";
  const steps: StepKey[] = team ? ["info", "rival", "roster", "review"] : ["info", "roster", "review"];

  const [day, setDay] = useState(today);
  const [timeMode, setTimeMode] = useState<"quick" | "other" | "tbd" | null>(null);
  const [time, setTime] = useState("");
  const [size, setSize] = useState(7);
  const [venue, setVenue] = useState("");
  const [fee, setFee] = useState("");
  const [rivalKnown, setRivalKnown] = useState(!!rival);
  const [rivalSource, setRivalSource] = useState<"app" | "name">("app");
  const [rivalTeam, setRivalTeam] = useState<RivalTeam | null>(rival);
  const [rivalName, setRivalName] = useState("");
  const [rivalSearch, setRivalSearch] = useState<RivalSearch>({ q: "", city: homeCity, district: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set([meId]));
  const [friendQuery, setFriendQuery] = useState("");
  const [guests, setGuests] = useState<{ name: string; position: string }[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestPos, setGuestPos] = useState("");
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(true);

  const capacity = defaultCapacity(kind, size);
  const count = selected.size + guests.length;
  const over = count > capacity;
  const hasTime = (timeMode === "quick" || timeMode === "other") && !!time;
  // Saatler Türkiye saati (+03:00)
  const timePassed = (t: string) => !!day && !!t && Date.parse(parseLocalDateTime(`${day}T${t}`)) <= Date.now();
  const appRival = team && rivalKnown && rivalSource === "app" ? rivalTeam : null;
  const typedRival = team && rivalKnown && rivalSource === "name" ? rivalName.trim() : "";
  const direct = !over && opensConfirmed({ count, capacity, hasTime, kind, hasOpponent: typedRival.length >= 2 });

  // Her adımın "İleri" koşulu ve neden pasif olduğu
  const problem: Record<StepKey, string | null> = {
    info:
      !day || day < today
        ? "Bugün veya sonrası bir gün seç"
        : timeMode === "tbd"
          ? null
          : !hasTime
            ? "Saati seç"
            : timePassed(time)
              ? "Bu saat geçti"
              : fee && !(Number(fee) >= 1 && Number(fee) <= 100000)
                ? "Saha ücretini kontrol et"
                : null,
    rival: !rivalKnown ? null : rivalSource === "app" ? (rivalTeam ? null : "Rakip takımı seç") : typedRival.length >= 2 ? null : "Rakip adını yaz",
    roster: over ? `${count - capacity} kişi fazla seçtin` : null,
    review: null,
  };

  // Adresteki adım; önceki adımlardan biri eksikse (ör. sayfa yenilendi) ona dönülür
  const params = useSearchParams();
  const asked = Math.min(Math.max(Number(params.get("adim")) || 1, 1), steps.length) - 1;
  const blocked = steps.findIndex((s) => problem[s]);
  const index = blocked >= 0 ? Math.min(asked, blocked) : asked;
  const step = steps[index];
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [index]);
  const goTo = (i: number) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    if (i > 0) url.searchParams.set("adim", String(i + 1));
    else url.searchParams.delete("adim");
    window.history.pushState(null, "", url);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const addGuest = () => {
    if (guestName.trim().length < 2) return;
    setGuests([...guests, { name: guestName.trim().slice(0, 40), position: guestPos }]);
    setGuestName("");
    setGuestPos("");
  };

  const quickDays = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const friendRe = new RegExp(trPattern(friendQuery), "i");
  const shownFriends = friends.filter((f) => selected.has(f.userId) || friendRe.test(f.name));
  const names = [...members, ...friends].filter((p) => selected.has(p.userId)).map((p) => p.name).concat(guests.map((g) => g.name));
  const rivalLabel = appRival ? appRival.name : typedRival || "Belli değil";
  const whenLabel = day ? matchWhen(parseLocalDateTime(`${day}T${hasTime ? time : "12:00"}`), !hasTime) : "";

  const summary: { label: string; value: string; step: StepKey }[] = [
    { label: "Ne zaman", value: whenLabel, step: "info" },
    { label: "Format", value: `${size}v${size} · ${capacity} kişilik kadro`, step: "info" },
    { label: "Saha", value: venue.trim() || "Belirtilmedi", step: "info" },
    { label: "Saha ücreti", value: fee ? feeText(Number(fee)) : "Belirtilmedi", step: "info" },
    ...(team ? [{ label: "Rakip", value: appRival ? `${rivalLabel} (teklif gidecek)` : rivalLabel, step: "rival" as const }] : []),
    { label: `Gelenler ${count}/${capacity}`, value: names.join(", ") || "Henüz kimse yok", step: "roster" },
  ];

  return (
    <form
      action={setupMatch}
      // Klavyedeki "Enter" formu erken göndermesin
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
      className="flex min-h-[calc(100dvh-6rem)] flex-col"
    >
      <Header
        title={
          <>
            Maç ayarla
            <span className="block truncate font-sans text-xs font-medium text-muted">
              {group.name} · {team ? "Takım" : "Grup"}
            </span>
          </>
        }
        back={`/g/${group.id}`}
        leading={
          index > 0 ? (
            <button type="button" onClick={() => window.history.back()} aria-label="Geri" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-900 shadow-sm">
              <Icon name="arrow_back" className="text-[22px]" />
            </button>
          ) : (
            <BackLink fallback={`/g/${group.id}`}>
              <Icon name="arrow_back" className="text-[22px]" />
            </BackLink>
          )
        }
      />

      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="timeMode" value={timeMode === "tbd" ? "tbd" : "time"} />
      <input type="hidden" name="time" value={hasTime ? time : ""} />
      <input type="hidden" name="size" value={size} />
      <input type="hidden" name="venue" value={venue} />
      <input type="hidden" name="fee" value={fee} />
      <input type="hidden" name="note" value={note} />
      <input type="hidden" name="withMe" value={selected.has(meId) ? "1" : "0"} />
      <input type="hidden" name="announce" value={announce ? "1" : "0"} />
      {appRival && <input type="hidden" name="rivalTeam" value={appRival.id} />}
      {typedRival && <input type="hidden" name="opponent" value={typedRival} />}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="confirmed" value={id} />
      ))}
      {guests.map((g, i) => (
        <span key={i}>
          <input type="hidden" name="guestName" value={g.name} />
          <input type="hidden" name="guestPos" value={g.position} />
        </span>
      ))}

      <div className="mb-5">
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={cx("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-primary" : "bg-surface-highest")} />
          ))}
        </div>
        <p className="t-label-caps mt-3 uppercase text-primary">
          Adım {index + 1}/{steps.length}
        </p>
        <h2 className="t-headline-md">{TITLES[step]}</h2>
      </div>

      <ErrorNote message={error} />

      <div key={step} className="hs-page-in space-y-5 pb-6">
        {step === "info" && (
          <>
            <Group label="Gün">
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
                {quickDays.map((d, i) => {
                  const p = dayParts(d);
                  const on = day === d;
                  return (
                    <Chip
                      key={d}
                      on={on}
                      onClick={() => setDay(d)}
                      className="flex min-w-16 shrink-0 flex-col items-center justify-center py-2 leading-tight"
                    >
                      <span className="text-[11px] font-medium">{i === 0 ? "Bugün" : i === 1 ? "Yarın" : p.week}</span>
                      <span className="text-xl font-bold">{p.day}</span>
                      <span className="text-[11px] font-medium">{p.month}</span>
                    </Chip>
                  );
                })}
              </div>
              {/* Kartlarda olmayan (daha ileri) bir gün buradan girilir */}
              <Input type="date" value={day} min={today} onChange={(e) => setDay(e.target.value)} aria-label="Maç günü" className="mt-2" />
            </Group>

            <Group label="Saat">
              <div className="grid grid-cols-5 gap-2">
                {QUICK_TIMES.map((t) => (
                  <Chip
                    key={t}
                    on={timeMode === "quick" && time === t}
                    disabled={timePassed(t)}
                    onClick={() => {
                      setTimeMode("quick");
                      setTime(t);
                    }}
                    className="px-0"
                  >
                    {t}
                  </Chip>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Chip
                  on={timeMode === "other"}
                  onClick={() => {
                    setTimeMode("other");
                    setTime("");
                  }}
                >
                  Başka saat
                </Chip>
                <Chip on={timeMode === "tbd"} onClick={() => setTimeMode("tbd")}>
                  Belli değil
                </Chip>
              </div>
              {timeMode === "other" && <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Saat" className="mt-2" />}
              {timeMode === "tbd" && <p className="mt-2 px-1 text-xs text-muted">Saati kadro toplanınca seçersin.</p>}
            </Group>

            <Group label="Kaç kişilik?" hint="her takım">
              <div className="grid grid-cols-4 gap-2">
                {SIZES.map((n) => (
                  <Chip key={n} on={size === n} onClick={() => setSize(n)} className="px-0 text-base">
                    {n}v{n}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 px-1 text-xs text-muted">
                {team ? `Bizim takımdan ${capacity} kişi oynar.` : `İki taraf gruptan: toplam ${capacity} kişi.`}
              </p>
            </Group>

            <label className="block">
              <Label hint="isteğe bağlı">Saha</Label>
              <Input value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={80} placeholder="Örn. Petroller Halısaha" aria-label="Saha" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Saha ücreti (kişi başı, TL)</Label>
              <Input
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Örn. 150"
                aria-label="Saha ücreti"
              />
            </label>
          </>
        )}

        {step === "rival" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                { known: false, icon: "help", title: "Belli değil", text: "Sonra belirlerim" },
                { known: true, icon: "swords", title: "Rakip belli", text: "Takımı seç veya yaz" },
              ].map((o) => (
                <button
                  key={o.title}
                  type="button"
                  onClick={() => setRivalKnown(o.known)}
                  aria-pressed={rivalKnown === o.known}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface-container px-2 py-5 text-center",
                    rivalKnown === o.known && "border-primary bg-primary/10",
                  )}
                >
                  <Icon name={o.icon} className={cx("text-[30px]", rivalKnown === o.known ? "text-primary" : "text-muted")} />
                  <span className="font-display font-bold">{o.title}</span>
                  <span className="text-xs text-muted">{o.text}</span>
                </button>
              ))}
            </div>
            {rivalKnown ? (
              <RivalPicker
                groupId={group.id}
                source={rivalSource}
                onSource={setRivalSource}
                team={rivalTeam}
                onTeam={setRivalTeam}
                name={rivalName}
                onName={setRivalName}
                search={rivalSearch}
                onSearch={setRivalSearch}
              />
            ) : (
              <p className="px-1 text-sm text-muted">Maç ekranından sonra rakip ekleyebilir veya bir takıma teklif gönderebilirsin.</p>
            )}
          </>
        )}

        {step === "roster" && (
          <>
            <section className="space-y-2">
              <p className="px-1 text-sm text-muted">Gelmesi kesin olanları işaretle; bildirim alırlar, gelemezlerse kendileri çıkar.</p>
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {members.map((p) => (
                    <li key={p.userId}>
                      <button type="button" onClick={() => toggle(p.userId)} aria-pressed={selected.has(p.userId)} className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left">
                        <CheckBox on={selected.has(p.userId)} />
                        <OvrBadge overall={p.overall} />
                        <span className="min-w-0 flex-1 truncate">
                          {p.name}
                          {p.userId === meId && <span className="text-xs text-muted"> (sen)</span>}
                        </span>
                        <PositionChip position={p.position} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            <Card className="space-y-3">
              <div>
                <h3 className="font-display text-sm font-bold">Misafir / dışarıdan oyuncu</h3>
                <p className="text-xs text-muted">
                  {team ? "Takımda" : "Grupta"} olmayan arkadaşını seç; doğrudan kadroya girer ve bildirim alır.
                  {isAdmin && " Uygulamayı kullanmayan birini adını yazarak ekleyebilirsin."}
                </p>
              </div>

              {friends.length === 0 ? (
                <p className="text-sm text-muted">{team ? "Takım" : "Grup"} dışında ekleyebileceğin arkadaşın yok.</p>
              ) : (
                <div className="space-y-2">
                  {friends.length > 5 && <Input type="search" value={friendQuery} onChange={(e) => setFriendQuery(e.target.value)} placeholder="Arkadaşlarında ara" aria-label="Arkadaş ara" />}
                  <ul className="max-h-60 divide-y divide-line overflow-y-auto">
                    {shownFriends.map((f) => (
                      <li key={f.userId}>
                        <button type="button" onClick={() => toggle(f.userId)} aria-pressed={selected.has(f.userId)} className="flex min-h-12 w-full items-center gap-3 py-1.5 text-left">
                          <CheckBox on={selected.has(f.userId)} />
                          <Avatar name={f.name} photoUrl={f.photoUrl} className="h-8 w-8 bg-pitch-700 text-xs" />
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="text-xs text-muted">arkadaş</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isAdmin && (
                <div className="space-y-2 border-t border-line pt-3">
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
                    <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Misafir adı" maxLength={40} aria-label="Misafir adı" className="flex-1" />
                    <select value={guestPos} onChange={(e) => setGuestPos(e.target.value)} aria-label="Misafir mevkisi" className={cx(selectCls, "w-24")}>
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
                </div>
              )}
            </Card>
          </>
        )}

        {step === "review" && (
          <>
            <Card className="divide-y divide-line p-0">
              {summary.map((row) => (
                <button key={row.label} type="button" onClick={() => goTo(steps.indexOf(row.step))} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="t-label-caps block uppercase text-on-surface-variant">{row.label}</span>
                    <span className="block text-sm font-medium">{row.value}</span>
                  </span>
                  <Icon name="edit" className="text-[18px] text-muted" />
                </button>
              ))}
            </Card>
            <label className="block">
              <Label hint="isteğe bağlı">Not</Label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Örn. Kaleci lazım!" aria-label="Not" className={textareaCls} />
            </label>
            <Card>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="mt-0.5 h-5 w-5 accent-accent" />
                <span>
                  <span className="block font-medium">{team ? "Takıma" : "Gruba"} duyur</span>
                  <span className="block text-xs text-muted">Üyeler &quot;Geliyorum / Gelemem&quot; der; geliyorum diyen yer varsa kadroya, yoksa yedeğe girer.</span>
                </span>
              </label>
            </Card>
            <p className="px-1 text-center text-xs text-muted">
              {direct ? "Kadro tam ve saat belli: maç direkt kesinleşir." : "Maç toplanmaya açılır; eksik için adam arayabilir, sonra kesinleştirirsin."}
            </p>
          </>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-auto space-y-2 border-t border-line bg-pitch-950/95 px-4 pb-4 pt-3 backdrop-blur">
        {(step === "roster" || problem[step]) && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              {step === "roster" && (
                <>
                  Kadro <b>{count}/{capacity}</b>
                </>
              )}
            </span>
            <span className={cx("text-xs", over && step === "roster" ? "text-amber-300" : "text-muted")}>
              {problem[step] ?? (count >= capacity ? "Kadro tamam" : `${capacity - count} kişi eksik`)}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          {index > 0 && (
            <Button type="button" variant="secondary" onClick={() => window.history.back()} className="min-h-12">
              Geri
            </Button>
          )}
          {/* Ayrı key: "İleri" düğmesi tıklanırken gönder düğmesine dönüşüp formu yollamasın */}
          {step === "review" ? (
            <SubmitButton key="submit" className="min-h-12 flex-1" pendingLabel="Oluşturuluyor…" disabled={blocked >= 0}>
              {direct ? "Maçı kur" : "Maçı oluştur"}
            </SubmitButton>
          ) : (
            <Button key="next" type="button" onClick={() => goTo(index + 1)} disabled={!!problem[step]} className="min-h-12 flex-1">
              İleri
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
