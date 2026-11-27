"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteToMatch } from "@/lib/actions";
import { trPattern } from "@/lib/search";
import { Avatar } from "@/components/Avatar";
import { RegionSelect } from "@/components/RegionSelect";
import { Card, Input, SectionTitle, cx } from "@/components/ui";
import { GuestForm } from "./GuestForm";

export interface Person {
  id: string;
  name: string;
  photoUrl: string | null;
  city: string | null;
  district: string | null;
}

type Tab = "friends" | "app" | "guest";

const STATUS: Record<string, string> = { in: "Kadroda", reserve: "Yedekte", invited: "Davet edildi", pending: "Başvurdu" };

/** Oyuncu ekle (yöneten): arkadaş listesinden veya uygulamada arayarak davet; misafiri doğrudan kadroya yazma */
export function AddPlayer({
  groupId,
  matchId,
  meId,
  friends,
  statuses,
  homeCity,
  canAddGuest,
}: {
  groupId: string;
  matchId: string;
  meId: string;
  friends: Person[];
  /** Maçta etkin kaydı olanlar: hesap → durum */
  statuses: Record<string, string>;
  homeCity: string;
  canAddGuest: boolean;
}) {
  const [tab, setTab] = useState<Tab>("friends");
  const [friendQ, setFriendQ] = useState("");
  const [search, setSearch] = useState({ q: "", city: homeCity, district: "" });
  const [results, setResults] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { q, city, district } = search;
  // Sunucudaki kayıt düşünce (davet geri çekildi) "Davet edildi" etiketi de kalkar
  const statusKey = Object.keys(statuses).sort().join();
  const [seenKey, setSeenKey] = useState(statusKey);
  if (seenKey !== statusKey) {
    const before = seenKey.split(",");
    setSeenKey(statusKey);
    setSent((s) => s.filter((id) => statuses[id] || !before.includes(id)));
  }
  const searching = tab === "app";

  useEffect(() => {
    if (!searching) return;
    let stale = false;
    setResults(null);
    setFailed(false);
    const timer = setTimeout(async () => {
      // Sadece profilini aramaya açanlar (Keşfet oyuncu aramasıyla aynı kural)
      let query = createClient()
        .from("profiles")
        .select("id, display_name, photo_url, city, district")
        .eq("discoverable", true)
        .is("frozen_at", null)
        .neq("id", meId);
      if (city) query = query.eq("city", city);
      if (district) query = query.filter("district", "imatch", `^${trPattern(district)}$`);
      if (q.trim()) query = query.filter("display_name", "imatch", trPattern(q));
      const { data, error } = await query.order("display_name").limit(30);
      if (stale) return;
      setFailed(!!error);
      setResults(
        (data ?? [])
          .map((p) => ({ id: p.id as string, name: p.display_name as string, photoUrl: p.photo_url as string | null, city: p.city as string | null, district: p.district as string | null }))
          .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      );
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searching, meId, q, city, district]);

  const invite = (userId: string) => {
    setError(null);
    setBusy(userId);
    startTransition(async () => {
      const res = await inviteToMatch(groupId, matchId, userId);
      if (res.error) setError(res.error);
      else setSent((s) => [...s, userId]);
    });
  };

  const list = (people: Person[]) => (
    <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
      {people.map((p) => {
        const label = statuses[p.id] ? STATUS[statuses[p.id]] : sent.includes(p.id) ? "Davet edildi" : null;
        return (
          <li key={p.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
            <Avatar name={p.name} photoUrl={p.photoUrl} className="h-9 w-9 bg-pitch-700 text-xs" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.name}</div>
              {p.city && <div className="truncate text-xs text-muted">{[p.district, p.city].filter(Boolean).join(" · ")}</div>}
            </div>
            {label ? (
              <span className="shrink-0 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-bold text-accent">✓ {label}</span>
            ) : (
              <button type="button" onClick={() => invite(p.id)} disabled={pending} className="min-h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-bold text-pitch-950 disabled:opacity-50">
                {pending && busy === p.id ? "…" : "Davet et"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: "friends", label: "Arkadaşlar" },
    { id: "app", label: "Uygulamada ara" },
    ...(canAddGuest ? [{ id: "guest" as const, label: "Misafir" }] : []),
  ];
  const needle = friendQ.trim() ? new RegExp(trPattern(friendQ), "i") : null;
  const shownFriends = needle ? friends.filter((f) => needle.test(f.name)) : friends;

  return (
    <section className="mb-4 space-y-2">
      <SectionTitle>Oyuncu ekle</SectionTitle>
      <Card className="space-y-3">
        <div className="flex gap-1 rounded-full bg-surface-low p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              aria-pressed={tab === t.id}
              className={cx("min-h-10 flex-1 rounded-full px-2 text-[13px] font-semibold", tab === t.id ? "bg-primary text-on-primary" : "text-muted")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-error">{error}</p>}

        {tab === "friends" &&
          (friends.length === 0 ? (
            <p className="text-sm text-muted">Henüz arkadaşın yok.</p>
          ) : (
            <>
              <Input type="search" value={friendQ} onChange={(e) => setFriendQ(e.target.value)} placeholder="Arkadaş ara" aria-label="Arkadaş ara" />
              {shownFriends.length ? list(shownFriends) : <p className="text-sm text-muted">Eşleşen arkadaş yok.</p>}
            </>
          ))}

        {tab === "app" && (
          <>
            <Input type="search" value={q} onChange={(e) => setSearch({ ...search, q: e.target.value })} placeholder="Oyuncu adı ara" aria-label="Oyuncu ara" />
            <RegionSelect
              defaultCity={city}
              defaultDistrict={district}
              cityName="oyuncuIl"
              districtName="oyuncuIlce"
              requireCity={false}
              anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
              showLabels={false}
              onValue={(c, d) => setSearch((s) => ({ ...s, city: c, district: d }))}
            />
            {failed ? (
              <p className="text-sm text-error">Oyuncular yüklenemedi, tekrar dene.</p>
            ) : results === null ? (
              <p className="text-sm text-muted">Aranıyor…</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted">Oyuncu bulunamadı. İl/ilçeyi genişletmeyi dene.</p>
            ) : (
              list(results)
            )}
          </>
        )}

        {tab === "guest" ? (
          <GuestForm groupId={groupId} matchId={matchId} />
        ) : (
          <p className="text-xs text-muted">Davet edilen kişiye sohbetten maç kartı gider; &quot;Geliyorum&quot; derse kadroya girer (kadro doluysa yedeğe).</p>
        )}
      </Card>
    </section>
  );
}
