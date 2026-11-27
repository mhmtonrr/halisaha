"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { trPattern } from "@/lib/search";
import { Card, Input, cx } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { TeamBadge } from "@/components/TeamBadge";
import { RegionSelect } from "@/components/RegionSelect";

export interface RivalTeam {
  id: string;
  name: string;
  city?: string | null;
  district?: string | null;
  color?: string | null;
  logo?: string | null;
}
export interface RivalSearch {
  q: string;
  city: string;
  district: string;
}

const place = (t: RivalTeam) => [t.district, t.city].filter(Boolean).join(" · ");

/** Rakip seçimi (Maç ayarla ve maç ekranı): uygulamadaki takımlarda ad/il/ilçe araması veya uygulamada olmayan takımın adı */
export function RivalPicker({
  groupId,
  source,
  onSource,
  team,
  onTeam,
  name,
  onName,
  search,
  onSearch,
  teamHint = "Maç açılınca teklif gider",
  canOffer,
}: {
  groupId: string;
  source: "app" | "name";
  onSource: (v: "app" | "name") => void;
  team: RivalTeam | null;
  onTeam: (t: RivalTeam | null) => void;
  name: string;
  onName: (v: string) => void;
  search: RivalSearch;
  onSearch: (v: RivalSearch) => void;
  /** Seçilen takımın konumu yoksa altında yazan */
  teamHint?: string;
  /** Teklifi sadece kaptan/yetkili gönderir (create_challenge_v2); diğerlerine arama yerine not */
  canOffer: boolean;
}) {
  const [results, setResults] = useState<RivalTeam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { q, city, district } = search;
  const searching = canOffer && source === "app" && !team;

  useEffect(() => {
    if (!searching) return;
    let stale = false;
    setResults(null);
    setFailed(false);
    const timer = setTimeout(async () => {
      let query = createClient()
        .from("groups")
        .select("id, name, city, district, color, logo")
        .eq("kind", "team")
        .eq("is_temporary", false)
        .is("archived_at", null)
        .neq("id", groupId);
      if (city) query = query.eq("city", city);
      if (district) query = query.filter("district", "imatch", `^${trPattern(district)}$`);
      if (q.trim()) query = query.filter("name", "imatch", trPattern(q));
      const { data, error } = await query.order("name").limit(30);
      if (stale) return;
      setFailed(!!error);
      setResults(((data ?? []) as RivalTeam[]).sort((a, b) => a.name.localeCompare(b.name, "tr")));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searching, groupId, q, city, district]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-full bg-surface-low p-1">
        {(["app", "name"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSource(s)}
            aria-pressed={source === s}
            className={cx("min-h-10 rounded-full px-2 text-[13px] font-semibold", source === s ? "bg-primary text-on-primary" : "text-muted")}
          >
            {s === "app" ? "Uygulamadaki takım" : "Uygulamada yok"}
          </button>
        ))}
      </div>

      {source === "name" ? (
        <div className="space-y-2">
          <Input value={name} onChange={(e) => onName(e.target.value)} maxLength={60} placeholder="Örn. Yıldızspor" aria-label="Rakip adı" />
          <p className="px-1 text-xs text-muted">Uygulamayı kullanmayan takımın adını yaz.</p>
        </div>
      ) : !canOffer ? (
        <p className="rounded-xl bg-amber-400/10 p-3 text-sm">
          Uygulamadaki takıma teklifi takımın kaptanı veya yetkilisi gönderir. Sen &quot;Uygulamada yok&quot; ile rakip adını yazabilirsin.
        </p>
      ) : team ? (
        <Card className="flex items-center gap-3 border-primary bg-primary/10">
          <TeamBadge id={team.id} name={team.name} color={team.color ?? null} logo={team.logo ?? null} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display font-bold">{team.name}</div>
            <div className="truncate text-xs text-muted">{place(team) || teamHint}</div>
          </div>
          <button type="button" onClick={() => onTeam(null)} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
            Değiştir
          </button>
        </Card>
      ) : (
        <div className="space-y-3">
          <Input type="search" value={q} onChange={(e) => onSearch({ ...search, q: e.target.value })} placeholder="Takım adı ara" aria-label="Takım ara" />
          <RegionSelect
            defaultCity={city}
            defaultDistrict={district}
            cityName="rakipIl"
            districtName="rakipIlce"
            requireCity={false}
            anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
            showLabels={false}
            onValue={(c, d) => onSearch({ ...search, city: c, district: d })}
          />
          {failed ? (
            <p className="px-1 text-sm text-error">Takımlar yüklenemedi, tekrar dene.</p>
          ) : results === null ? (
            <p className="px-1 text-sm text-muted">Aranıyor…</p>
          ) : results.length === 0 ? (
            <p className="px-1 text-sm text-muted">Takım bulunamadı. İl/ilçeyi genişlet veya &quot;Uygulamada yok&quot; ile adını yaz.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onTeam(t)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-container p-3 text-left">
                    <TeamBadge id={t.id} name={t.name} color={t.color ?? null} logo={t.logo ?? null} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-muted">{place(t)}</span>
                    </span>
                    <Icon name="chevron_right" className="text-[20px] text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
