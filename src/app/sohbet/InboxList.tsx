"use client";
import { Icon } from "@/components/Icon";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import { Card, cx } from "@/components/ui";

export interface InboxRow {
  key: string;
  href: string;
  title: string;
  preview: string;
  /** Hazır biçimlenmiş zaman (sunucu TR saatiyle yazar) */
  time: string;
  unread: number;
  hint?: string;
  kind: "group" | "dm";
  color?: string | null;
  photoUrl?: string | null;
  /** Tanımadığından gelen mesaj isteği */
  request?: boolean;
}

type Filter = "all" | "unread" | "people" | "groups";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "unread", label: "Okunmamış" },
  { key: "people", label: "Kişiler" },
  { key: "groups", label: "Gruplar" },
];

// Türkçe büyük/küçük harf ve aksan farkı olmadan arama
const norm = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

function Row({ r }: { r: InboxRow }) {
  return (
    <Link href={r.href}>
      <Card className={cx("flex items-center gap-3 transition hover:border-accent/50", r.request && "border-amber-400/40 bg-amber-400/5")}>
        <div className="shrink-0">
          {r.kind === "group" ? (
            <TeamBadge name={r.title} color={r.color ?? null} size="sm" />
          ) : (
            <Avatar name={r.title} photoUrl={r.photoUrl} className="h-10 w-10 bg-pitch-700 text-sm" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cx("truncate", r.unread ? "font-bold" : "font-medium")}>
              {r.title}
              {r.hint && <span className="ml-2 text-[11px] font-normal text-muted">{r.hint}</span>}
            </span>
            {r.time && <span className="shrink-0 text-[11px] text-muted">{r.time}</span>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={cx("truncate text-sm", r.unread ? "text-on-surface" : "text-muted")}>{r.preview}</p>
            {r.unread > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-black text-pitch-950">
                {r.unread > 99 ? "99+" : r.unread}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

/** Sohbet listesi: arama + süzgeç (anında, istemci tarafında); mesaj istekleri üstte */
export function InboxList({ rows }: { rows: InboxRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const needle = norm(q.trim());
    return rows.filter((r) => {
      if (needle && !norm(r.title).includes(needle) && !norm(r.preview).includes(needle)) return false;
      if (filter === "unread") return r.unread > 0;
      if (filter === "people") return r.kind === "dm";
      if (filter === "groups") return r.kind === "group";
      return true;
    });
  }, [rows, q, filter]);

  const requests = visible.filter((r) => r.request);
  const chats = visible.filter((r) => !r.request);
  const unreadTotal = rows.filter((r) => r.unread > 0).length;

  return (
    <>
      <div className="relative mb-3">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sohbetlerde ara"
          aria-label="Sohbetlerde ara"
          className="w-full rounded-full border border-line bg-pitch-900 py-2.5 pl-10 pr-4 text-[15px] outline-none placeholder:text-muted/60 focus:border-accent"
        />
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Süzgeç">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filter === f.key ? "border-accent bg-accent text-pitch-950" : "border-line text-muted hover:text-white",
            )}
          >
            {f.label}
            {f.key === "unread" && unreadTotal > 0 && <span className="ml-1.5 text-xs">{unreadTotal}</span>}
          </button>
        ))}
      </div>

      {requests.length > 0 && (
        <section className="mb-4 space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-amber-300">Mesaj istekleri ({requests.length})</h2>
          {requests.map((r) => <Row key={r.key} r={r} />)}
        </section>
      )}

      {rows.length === 0 ? (
        <Card className="space-y-2 text-center text-sm text-muted">
          <Icon name="forum" className="text-[36px] text-primary" />
          <p>Henüz sohbetin yok. Bir takıma/gruba katıl ya da Keşfet’ten bir oyuncuya mesaj gönder.</p>
          <Link href="/kesfet" className="text-accent">
            Keşfet ›
          </Link>
        </Card>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Eşleşen sohbet yok.</p>
      ) : (
        <div className="space-y-2">{chats.map((r) => <Row key={r.key} r={r} />)}</div>
      )}
    </>
  );
}
