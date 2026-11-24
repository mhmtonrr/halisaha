import { Icon } from "@/components/Icon";
import Link from "next/link";
import { openDm } from "@/lib/actions";
import { RegionSelect } from "@/components/RegionSelect";
import { Button, Card, Input, Label, cx } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { FOOT_NAME, POSITIONS, POSITION_NAME } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { reliability } from "@/lib/reliability";
import { ALL_SKILLS } from "@/lib/skills";
import { activeFilterCount, type PlayerCandidate, type PlayerFilter, type PlayerSort } from "@/lib/player-search";

const select =
  "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none focus:border-accent";
const chip =
  "flex min-h-9 cursor-pointer items-center justify-center rounded-full border border-line bg-pitch-950 px-3 text-xs font-medium has-checked:border-accent has-checked:bg-accent/15 has-checked:text-accent";

const RATING_STEPS = [50, 55, 60, 65, 70, 75, 80, 85, 90];
const SKILL_STEPS = [60, 65, 70, 75, 80, 85, 90];

export const PAGE_SIZE = 20;

function Choice({ name, value, defaultChecked, children }: { name: string; value: string; defaultChecked: boolean; children: React.ReactNode }) {
  return (
    <label className={chip}>
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />
      {children}
    </label>
  );
}

function Check({ name, defaultChecked, children }: { name: string; defaultChecked: boolean; children: React.ReactNode }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className="h-4 w-4 accent-[var(--color-accent)]" />
      {children}
    </label>
  );
}

/** Oyuncu arama formu (GET: adres çubuğundaki parametreler süzgeçtir, sayfa paylaşılabilir) */
export function PlayerFilters({
  city,
  district,
  filter,
  sort,
}: {
  city: string;
  district?: string;
  filter: PlayerFilter;
  sort: PlayerSort;
}) {
  const count = activeFilterCount(filter) - (filter.q ? 1 : 0); // ad kutusu zaten dışarıda
  return (
    <form className="space-y-2" action="/kesfet">
      <input type="hidden" name="sekme" value="oyuncu" />
      <RegionSelect
        key={`${city}-${district ?? ""}`}
        cityName="il"
        districtName="ilce"
        defaultCity={city}
        defaultDistrict={district}
        requireCity={false}
        showLabels={false}
        anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
      />
      <div className="flex gap-2">
        <Input name="q" defaultValue={filter.q ?? ""} placeholder="Oyuncu adı ara" />
        <Button>Ara</Button>
      </div>

      <details open={count > 0} className="rounded-2xl border border-line bg-pitch-900/80 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
          <span>Filtreler{count > 0 && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{count}</span>}</span>
          <span className="text-muted">▾</span>
        </summary>
        <div className="space-y-4 border-t border-line p-4">
          <div>
            <Label>Mevki</Label>
            <div className="flex flex-wrap gap-2">
              <Choice name="mevki" value="" defaultChecked={!filter.position}>Hepsi</Choice>
              {POSITIONS.map((p) => (
                <Choice key={p} name="mevki" value={p} defaultChecked={filter.position === p}>{POSITION_NAME[p]}</Choice>
              ))}
            </div>
            <div className="mt-1">
              <Check name="ikinci" defaultChecked={!!filter.includeSecondary}>İkinci mevkisi de olsun</Check>
            </div>
          </div>

          <div>
            <Label hint="en az maçı olanlar">Rating aralığı</Label>
            <div className="grid grid-cols-2 gap-3">
              <select name="min" defaultValue={filter.minOverall ?? ""} className={select} aria-label="En düşük rating">
                <option value="">En az: hepsi</option>
                {RATING_STEPS.map((n) => <option key={n} value={n}>En az {n}</option>)}
              </select>
              <select name="max" defaultValue={filter.maxOverall ?? ""} className={select} aria-label="En yüksek rating">
                <option value="">En çok: hepsi</option>
                {RATING_STEPS.map((n) => <option key={n} value={n}>En çok {n}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>Deneyim</Label>
              <select name="mac" defaultValue={filter.minMatches ?? ""} className={select}>
                <option value="">Fark etmez</option>
                {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}+ puanlı maç</option>)}
              </select>
            </label>
            <label className="block">
              <Label>Ayak</Label>
              <select name="ayak" defaultValue={filter.foot ?? ""} className={select}>
                <option value="">Fark etmez</option>
                {(Object.keys(FOOT_NAME) as (keyof typeof FOOT_NAME)[]).map((f) => <option key={f} value={f}>{FOOT_NAME[f]}</option>)}
              </select>
            </label>
          </div>

          <div>
            <Label hint="oylamayla oluşur">Yetenek</Label>
            <div className="grid grid-cols-2 gap-3">
              <select name="yetenek" defaultValue={filter.skill ?? ""} className={select} aria-label="Yetenek">
                <option value="">Hepsi</option>
                <optgroup label="Saha oyuncusu">
                  {ALL_SKILLS.slice(0, 6).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </optgroup>
                <optgroup label="Kaleci">
                  {ALL_SKILLS.slice(6).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </optgroup>
              </select>
              <select name="ymin" defaultValue={filter.skill ? (filter.minSkill ?? 60) : ""} className={select} aria-label="En az yetenek değeri">
                {SKILL_STEPS.map((n) => <option key={n} value={n}>En az {n}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Check name="guvenilir" defaultChecked={!!filter.reliable}>Güvenilir (maça gelir, %90+)</Check>
            <Check name="takimsiz" defaultChecked={!!filter.teamless}>Takımsız (takım arayanlar)</Check>
          </div>

          <label className="block">
            <Label>Sırala</Label>
            <select name="sirala" defaultValue={sort} className={select}>
              <option value="rating">Rating (yüksekten)</option>
              <option value="mac">En çok maç</option>
              <option value="isim">İsim (A-Z)</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Button className="w-full">Uygula</Button>
            <Link href="/kesfet?sekme=oyuncu&il=" className="flex min-h-11 items-center justify-center rounded-xl border border-line bg-pitch-800 text-sm hover:bg-pitch-700">
              Temizle
            </Link>
          </div>
        </div>
      </details>
    </form>
  );
}

/** Arama sonucu satırı */
export function PlayerRow({ c, me, skill }: { c: PlayerCandidate; me: boolean; skill?: string }) {
  const rel = reliability(c.matches, c.noShows);
  const topSkills = Object.entries(c.skills)
    .filter((e): e is [string, number] => typeof e[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const shown = skill && typeof c.skills[skill] === "number" ? [[skill, c.skills[skill] as number] as [string, number]] : topSkills;
  return (
    <div className="flex items-center transition hover:bg-pitch-800">
    <Link href={me ? "/profil" : `/oyuncu/${c.userId}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4">
      <OvrBadge overall={c.overall} className={c.matches === 0 ? "opacity-50" : ""} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{c.name}</span>
          {me && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent">Sen</span>}
          <PositionChip position={c.position} />
          {c.secondary.map((p) => <PositionChip key={p} position={p} className="opacity-60" />)}
        </div>
        <div className="truncate text-xs text-muted">
          {formatRegion(c.city, c.district) || "Bölge yok"}
          {" · "}
          {c.matches > 0 ? `${c.matches} maç` : "yeni oyuncu"}
          {rel.pct !== null && rel.tone !== "new" && <span className={cx(rel.tone === "bad" && "text-red-300")}>{` · %${rel.pct} güvenilir`}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          {c.teams.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 text-muted">
              <span className="inline-block h-3 w-3 shrink-0 rounded" style={{ background: c.teams[0].color ?? "#1a5a36" }} />
              <span className="truncate">{c.teams[0].name}{c.teams.length > 1 ? ` +${c.teams.length - 1}` : ""}</span>
            </span>
          ) : (
            <span className="text-emerald-300/90">Takımsız</span>
          )}
          {shown.map(([k, v]) => (
            <span key={k} className="shrink-0 rounded bg-pitch-700 px-1.5 py-0.5 font-semibold">{k} {v}</span>
          ))}
        </div>
      </div>
      <span className="text-muted">›</span>
    </Link>
    {!me && (
      <form action={openDm} className="shrink-0 pl-1 pr-3">
        <input type="hidden" name="userId" value={c.userId} />
        <button aria-label={`${c.name} ile mesajlaş`} className="rounded-lg bg-pitch-800 px-2.5 py-1.5 text-sm hover:text-accent">
          <Icon name="chat" className="text-[18px]" />
        </button>
      </form>
    )}
    </div>
  );
}

export function PlayerResults({
  items,
  total,
  userId,
  skill,
  moreHref,
}: {
  items: PlayerCandidate[];
  total: number;
  userId: string;
  skill?: string;
  moreHref: string | null;
}) {
  if (total === 0) {
    return <Card className="text-center text-sm text-muted">Bu süzgeçlere uyan oyuncu bulunamadı. Filtreleri gevşetmeyi veya bölgeyi genişletmeyi dene.</Card>;
  }
  return (
    <>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.userId}>
              <PlayerRow c={c} me={c.userId === userId} skill={skill} />
            </li>
          ))}
        </ul>
      </Card>
      {moreHref && (
        <Link href={moreHref} className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-line bg-pitch-800 text-sm hover:bg-pitch-700">
          Daha fazla göster ({total - items.length} oyuncu daha)
        </Link>
      )}
    </>
  );
}
