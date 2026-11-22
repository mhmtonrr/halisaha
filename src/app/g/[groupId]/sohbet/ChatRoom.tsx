"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifyChatMessage } from "@/lib/actions";
import { Avatar } from "@/components/Avatar";
import { BackLink } from "@/components/NavHistory";
import { TeamBadge } from "@/components/TeamBadge";
import { cx } from "@/components/ui";

export interface ChatMessage {
  id: number;
  author_id: string | null;
  kind: "text" | "system";
  body: string;
  poll_id: string | null;
  match_id: string | null;
  deleted_at: string | null;
  created_at: string;
  /** Gönderiliyor (iyimser) */
  pending?: boolean;
  failed?: boolean;
}

export interface ChatMember {
  id: string;
  name: string;
  photoUrl?: string | null;
  role: string;
  guest: boolean;
}

const MAX = 1000;
const TZ = "Europe/Istanbul";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string) {
  const d = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (d === today) return "Bugün";
  if (d === yesterday) return "Dün";
  return new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", weekday: "long" });
}

/** Mesajdaki linkleri tıklanabilir yap */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

const ROLE_TAG: Record<string, Record<string, string>> = {
  team: { captain: "Kaptan", admin: "Yetkili" },
  community: { captain: "Kurucu", admin: "Yetkili" },
};

export function ChatRoom({
  groupId,
  groupName,
  groupColor,
  kind,
  meId,
  canModerate,
  members: initialMembers,
  initial,
  hasMore: initialHasMore,
}: {
  groupId: string;
  groupName: string;
  groupColor: string | null;
  kind: "team" | "community";
  meId: string;
  canModerate: boolean;
  members: ChatMember[];
  initial: ChatMessage[];
  hasMore: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [members, setMembers] = useState(() => new Map(initialMembers.map((m) => [m.id, m])));
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const tempId = useRef(-1);

  const upsert = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === msg.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = msg;
        return next;
      }
      return [...prev, msg].sort((a, b) => (a.id < 0 ? 1 : b.id < 0 ? -1 : a.id - b.id));
    });
  }, []);

  // Okundu işareti (gelen mesajlarda, sayfa görünürken)
  const markRead = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRead = useCallback(() => {
    if (markRead.current) clearTimeout(markRead.current);
    markRead.current = setTimeout(() => {
      if (document.visibilityState === "visible") supabase.rpc("mark_chat_read", { p_group_id: groupId });
    }, 800);
  }, [supabase, groupId]);

  // Kaçırılan mesajları yakala: (yeniden) bağlanınca ve sekme öne gelince
  const lastId = useRef(0);
  useEffect(() => {
    lastId.current = messages.reduce((a, m) => (m.id > a ? m.id : a), 0);
  }, [messages]);
  const catchUp = useCallback(async () => {
    const { data } = await supabase
      .from("group_messages")
      .select("id, author_id, kind, body, poll_id, match_id, deleted_at, created_at")
      .eq("group_id", groupId)
      .gt("id", lastId.current)
      .order("id")
      .limit(100);
    for (const m of (data ?? []) as ChatMessage[]) upsert(m);
    if (data?.length) scheduleRead();
  }, [supabase, groupId, upsert, scheduleRead]);

  // Gerçek zamanlı abonelik
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      // Kanal kurulmadan önce oturum anahtarını ver; yoksa RLS mesajları bize göndermez
      const { data } = await supabase.auth.getSession();
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`chat:${groupId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
          async (payload) => {
            const msg = payload.new as ChatMessage;
            upsert(msg);
            if (msg.author_id !== meId) scheduleRead();
            // Sonradan katılan biri yazdıysa adını getir
            if (msg.author_id && !members.has(msg.author_id)) {
              const { data } = await supabase.from("group_players").select("id, display_name, photo_url, role, user_id").eq("id", msg.author_id).maybeSingle();
              if (data) setMembers((m) => new Map(m).set(data.id, { id: data.id, name: data.display_name, photoUrl: data.photo_url, role: data.role, guest: !data.user_id }));
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
          (payload) => upsert(payload.new as ChatMessage),
        )
        .subscribe((status) => {
          setLive(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") catchUp();
        });
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
    // members kasıtlı olarak bağımlılık değil: her yeni üyede yeniden abone olmayalım
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, groupId, meId, upsert, scheduleRead, catchUp]);

  // Alta yapışık kal (kullanıcı yukarı kaydırmadıysa)
  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function loadOlder() {
    const oldest = messages.find((m) => m.id > 0);
    if (!oldest) return;
    setLoadingOlder(true);
    const before = document.body.scrollHeight;
    const { data } = await supabase
      .from("group_messages")
      .select("id, author_id, kind, body, poll_id, match_id, deleted_at, created_at")
      .eq("group_id", groupId)
      .lt("id", oldest.id)
      .order("id", { ascending: false })
      .limit(50);
    setLoadingOlder(false);
    if (!data) return;
    setHasMore(data.length === 50);
    stickToBottom.current = false;
    setMessages((prev) => [...(data as ChatMessage[]).reverse(), ...prev]);
    // Kaydırma konumunu koru
    requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight - before + window.scrollY));
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError("");
    setText("");
    stickToBottom.current = true;
    const temp: ChatMessage = {
      id: tempId.current--,
      author_id: meId,
      kind: "text",
      body,
      poll_id: null,
      match_id: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, temp]);
    const { data, error } = await supabase
      .from("group_messages")
      .insert({ group_id: groupId, author_id: meId, body })
      .select("id, author_id, kind, body, poll_id, match_id, deleted_at, created_at")
      .single();
    if (error || !data) {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      setError(error?.message.includes("hızlı") ? "Çok hızlı mesaj gönderiyorsun, biraz bekle." : "Mesaj gönderilemedi.");
      return;
    }
    // Diğer üyelere bildirim (mesaj doğrudan veritabanına yazıldığı için sunucuya haber veririz; hata sohbeti etkilemez)
    void notifyChatMessage(groupId, data.id).catch(() => {});
    // Gerçek zamanlı kopya önce geldiyse geçiciyi at, gelmediyse yerine koy
    setMessages((prev) => {
      const withoutTemp = prev.filter((m) => m.id !== temp.id);
      return withoutTemp.some((m) => m.id === data.id) ? withoutTemp : [...withoutTemp, data as ChatMessage];
    });
  }

  async function remove(id: number) {
    setSelected(null);
    const { error } = await supabase.rpc("delete_message", { p_message_id: id });
    if (error) setError("Mesaj silinemedi.");
    else upsert({ ...messages.find((m) => m.id === id)!, deleted_at: new Date().toISOString(), body: "—" });
  }

  const roleTag = ROLE_TAG[kind];

  return (
    <main className="pb-24">
      <header className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 border-b border-line bg-pitch-950/95 px-4 py-3 backdrop-blur">
        <BackLink fallback={`/g/${groupId}`} className="-ml-2 rounded-lg p-2 text-muted hover:bg-pitch-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </BackLink>
        <TeamBadge name={groupName} color={groupColor} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{groupName}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-accent" : "bg-muted/50")} />
            {[...members.values()].filter((m) => !m.guest).length} üye · {live ? "canlı" : "bağlanıyor…"}
          </div>
        </div>
      </header>

      {hasMore && (
        <div className="py-2 text-center">
          <button onClick={loadOlder} disabled={loadingOlder} className="rounded-full bg-pitch-800 px-3 py-1 text-xs text-muted hover:text-white">
            {loadingOlder ? "Yükleniyor…" : "Daha eski mesajlar"}
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="py-16 text-center text-muted">
          <div className="text-4xl">💬</div>
          <p className="mt-2">Henüz mesaj yok. İlk mesajı sen yaz!</p>
        </div>
      )}

      <ol className="space-y-0.5">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const mine = m.author_id === meId;
          const author = m.author_id ? members.get(m.author_id) : null;
          // Aynı kişinin art arda (5 dk içinde) mesajlarını grupla
          const continued =
            !newDay && prev && prev.kind === "text" && m.kind === "text" && prev.author_id === m.author_id &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;

          return (
            <li key={m.id}>
              {newDay && (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-pitch-800 px-3 py-1 text-[11px] text-muted">{dayLabel(m.created_at)}</span>
                </div>
              )}
              {m.kind === "system" ? (
                <Link
                  href={m.poll_id ? `/g/${groupId}/cagri/${m.poll_id}` : m.match_id ? `/g/${groupId}/m/${m.match_id}` : `/g/${groupId}`}
                  className="mx-auto my-2 block max-w-[90%] rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-center text-sm transition hover:border-accent"
                >
                  {m.body}
                  <span className="ml-2 text-[10px] text-muted">{time(m.created_at)} ›</span>
                </Link>
              ) : (
                <div className={cx("flex items-end gap-2", mine ? "justify-end" : "justify-start", !continued && "mt-2")}>
                  {!mine && (
                    <Avatar
                      name={author?.name ?? "?"}
                      photoUrl={author?.photoUrl}
                      className={cx("h-7 w-7 bg-pitch-700 text-[10px]", continued && "invisible")}
                    />
                  )}
                  <div className={cx("max-w-[78%]", mine && "items-end")}>
                    {!mine && !continued && (
                      <div className="mb-0.5 ml-1 text-[11px] text-muted">
                        {author?.name ?? "Eski üye"}
                        {author && roleTag[author.role] && <span className="ml-1 text-amber-300">· {roleTag[author.role]}</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(selected === m.id ? null : m.id)}
                      className={cx(
                        "block w-full whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-[15px] leading-snug",
                        m.deleted_at
                          ? "border border-line italic text-muted"
                          : mine
                            ? "bg-accent text-pitch-950"
                            : "bg-pitch-800",
                        mine ? "rounded-br-md" : "rounded-bl-md",
                        m.pending && "opacity-60",
                        m.failed && "ring-1 ring-red-400",
                      )}
                    >
                      {m.deleted_at ? "Bu mesaj silindi" : <Linkify text={m.body} />}
                      <span className={cx("ml-2 inline-block align-bottom text-[10px]", mine && !m.deleted_at ? "text-pitch-900/70" : "text-muted")}>
                        {m.failed ? "gönderilemedi" : m.pending ? "…" : time(m.created_at)}
                      </span>
                    </button>
                    {selected === m.id && !m.deleted_at && m.id > 0 && (mine || canModerate) && (
                      <div className={cx("mt-1 flex", mine ? "justify-end" : "justify-start")}>
                        <button onClick={() => remove(m.id)} className="rounded-lg bg-red-950 px-2 py-1 text-xs text-red-300">
                          Mesajı sil
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div ref={bottomRef} />

      <form
        onSubmit={send}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {error && <p className="mx-auto max-w-lg px-4 pt-2 text-xs text-red-300">{error}</p>}
        <div className="mx-auto flex max-w-lg items-end gap-2 px-4 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Mesaj yaz…"
            aria-label="Mesaj"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-pitch-900 px-4 py-2.5 text-[15px] outline-none placeholder:text-muted/60 focus:border-accent"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Gönder"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-pitch-950 disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          </button>
        </div>
        {text.length > MAX - 100 && <p className="mx-auto max-w-lg px-4 pb-1 text-right text-[10px] text-muted">{text.length}/{MAX}</p>}
      </form>
    </main>
  );
}
