"use client";
import { Icon } from "@/components/Icon";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelGroupInvite, notifyDm, respondDmRequest, respondGroupInvite } from "@/lib/actions";
import { answerMatchInvite } from "@/lib/match-actions";
import { withdrawMatchInvite } from "@/lib/match-manage-actions";
import { Avatar } from "@/components/Avatar";
import { BackLink } from "@/components/NavHistory";
import { cx } from "@/components/ui";
import { MatchCardView, type LiveMatch, type MatchCard } from "./MatchCardView";

export interface DmMessage {
  id: number;
  author_id: string;
  kind: "text" | "invite" | "match";
  body: string;
  invite_id: string | null;
  card?: MatchCard | null;
  match_id?: string | null;
  /** Maç daveti iptal edildi (0056) */
  revoked_at?: string | null;
  deleted_at: string | null;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
}

export interface InviteInfo {
  id: string;
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  status: "pending" | "accepted" | "declined" | "cancelled";
  inviter_id: string;
}

const MAX = 1000;
const TZ = "Europe/Istanbul";
const COLS = "id, author_id, kind, body, invite_id, card, match_id, revoked_at, deleted_at, created_at";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string) {
  const d = dayKey(iso);
  if (d === dayKey(new Date().toISOString())) return "Bugün";
  if (d === dayKey(new Date(Date.now() - 86400000).toISOString())) return "Dün";
  return new Date(iso).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", weekday: "long" });
}

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

const INVITE_STATUS: Record<InviteInfo["status"], string> = {
  pending: "Yanıt bekliyor",
  accepted: "Kabul edildi",
  declined: "Reddedildi",
  cancelled: "Geri çekildi",
};

export function DmRoom({
  threadId,
  meId,
  other,
  status,
  requestedByMe,
  initial,
  hasMore: initialHasMore,
  invites,
  refStatus,
  live: liveCards = {},
}: {
  threadId: string;
  meId: string;
  other: { id: string; name: string; photoUrl: string | null };
  status: "pending" | "accepted" | "declined";
  requestedByMe: boolean;
  initial: DmMessage[];
  hasMore: boolean;
  invites: InviteInfo[];
  refStatus: Record<string, string>;
  /** Maç kartlarının canlı özeti (maç id → sayaç/durum) */
  live?: Record<string, LiveMatch>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [messages, setMessages] = useState<DmMessage[]>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const tempId = useRef(-1);
  const inviteOf = useMemo(() => new Map(invites.map((i) => [i.id, i])), [invites]);

  // İstek bekleyen konuşmada gönderen, kabul edilene kadar tek mesaj atabilir
  const waiting = status === "pending" && requestedByMe;
  const alreadyAsked = waiting && messages.some((m) => m.author_id === meId && m.kind === "text" && !m.failed);

  const upsert = useCallback((msg: DmMessage) => {
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

  // Bağlantı koptuğunda kaçan iptaller sayfa yenilenince işlensin
  useEffect(() => {
    const revoked = new Map(initial.filter((m) => m.revoked_at).map((m) => [m.id, m.revoked_at]));
    if (!revoked.size) return;
    setMessages((prev) => prev.map((m) => (!m.revoked_at && revoked.has(m.id) ? { ...m, revoked_at: revoked.get(m.id) } : m)));
  }, [initial]);

  const markRead = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRead = useCallback(() => {
    if (markRead.current) clearTimeout(markRead.current);
    markRead.current = setTimeout(() => {
      if (document.visibilityState === "visible") supabase.rpc("mark_dm_read", { p_thread_id: threadId });
    }, 800);
  }, [supabase, threadId]);

  const lastId = useRef(0);
  useEffect(() => {
    lastId.current = messages.reduce((a, m) => (m.id > a ? m.id : a), 0);
  }, [messages]);
  const catchUp = useCallback(async () => {
    const { data } = await supabase.from("dm_messages").select(COLS).eq("thread_id", threadId).gt("id", lastId.current).order("id").limit(100);
    for (const m of (data ?? []) as DmMessage[]) upsert(m);
    if (data?.length) {
      scheduleRead();
      // Yeni davet kartı geldiyse durumunu sunucudan al
      if ((data as DmMessage[]).some((m) => m.kind === "invite" || m.kind === "match")) router.refresh();
    }
  }, [supabase, threadId, upsert, scheduleRead, router]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`dm:${threadId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `thread_id=eq.${threadId}` }, (payload) => {
          const msg = payload.new as DmMessage;
          upsert(msg);
          if (msg.author_id !== meId) scheduleRead();
          if (msg.kind === "invite" || msg.kind === "match") router.refresh();
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_messages", filter: `thread_id=eq.${threadId}` }, (payload) =>
          upsert(payload.new as DmMessage),
        )
        .subscribe((s) => {
          setLive(s === "SUBSCRIBED");
          if (s === "SUBSCRIBED") catchUp();
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
  }, [supabase, threadId, meId, upsert, scheduleRead, catchUp, router]);

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
    const { data } = await supabase.from("dm_messages").select(COLS).eq("thread_id", threadId).lt("id", oldest.id).order("id", { ascending: false }).limit(50);
    setLoadingOlder(false);
    if (!data) return;
    setHasMore(data.length === 50);
    stickToBottom.current = false;
    setMessages((prev) => [...(data as DmMessage[]).reverse(), ...prev]);
    requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight - before + window.scrollY));
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || alreadyAsked) return;
    setError("");
    setText("");
    stickToBottom.current = true;
    const temp: DmMessage = { id: tempId.current--, author_id: meId, kind: "text", body, invite_id: null, deleted_at: null, created_at: new Date().toISOString(), pending: true };
    setMessages((prev) => [...prev, temp]);
    const { data, error } = await supabase.rpc("send_dm", { p_thread_id: threadId, p_body: body });
    if (error || data == null) {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      setError(error?.message && !/^(new row|permission|JWT)/.test(error.message) ? error.message : "Mesaj gönderilemedi.");
      return;
    }
    const id = data as number;
    void notifyDm(threadId, id).catch(() => {});
    setMessages((prev) => {
      const withoutTemp = prev.filter((m) => m.id !== temp.id);
      return withoutTemp.some((m) => m.id === id) ? withoutTemp : [...withoutTemp, { ...temp, id, pending: false }];
    });
    router.refresh(); // istek durumu (tek mesaj hakkı) sunucudan tazelensin
  }

  async function remove(id: number) {
    setSelected(null);
    const { error } = await supabase.rpc("delete_dm_message", { p_message_id: id });
    if (error) setError("Mesaj silinemedi.");
    else upsert({ ...messages.find((m) => m.id === id)!, deleted_at: new Date().toISOString(), body: "—" });
  }

  async function answerInvite(inv: InviteInfo, accept: boolean) {
    setBusy(true);
    const r = await respondGroupInvite(inv.id, accept);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "İşlem yapılamadı");
    if (accept && r.groupId) router.push(`/g/${r.groupId}`);
    else router.refresh();
  }

  async function withdrawInvite(inv: InviteInfo) {
    setBusy(true);
    const r = await cancelGroupInvite(inv.id);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "İşlem yapılamadı");
    router.refresh();
  }

  async function matchAction(run: () => Promise<{ error?: string }>) {
    setBusy(true);
    setError("");
    const r = await run();
    setBusy(false);
    if (r.error) return setError(r.error);
    router.refresh();
    void catchUpRevoked();
  }

  /** Geri çekmeden sonra kartın iptal işareti (canlı bağlantı yoksa da) */
  async function catchUpRevoked() {
    const { data } = await supabase.from("dm_messages").select(COLS).eq("thread_id", threadId).not("revoked_at", "is", null).order("id", { ascending: false }).limit(20);
    for (const m of (data ?? []) as DmMessage[]) if (messages.some((x) => x.id === m.id)) upsert(m);
  }

  async function respond(accept: boolean) {
    setBusy(true);
    const r = await respondDmRequest(threadId, accept);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "İşlem yapılamadı");
    if (accept) router.refresh();
    else router.push("/sohbet");
  }

  const incomingRequest = status === "pending" && !requestedByMe;

  return (
    <main className="pb-24">
      <header className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 border-b border-line bg-pitch-950/95 px-4 py-3 backdrop-blur">
        <BackLink fallback="/sohbet" className="-ml-2 rounded-lg p-2 text-muted hover:bg-pitch-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </BackLink>
        <Link href={`/oyuncu/${other.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={other.name} photoUrl={other.photoUrl} className="h-9 w-9 bg-pitch-700 text-xs" />
          <div className="min-w-0">
            <div className="truncate font-bold">{other.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-accent" : "bg-muted/50")} />
              {live ? "canlı" : "bağlanıyor…"} · profili aç
            </div>
          </div>
        </Link>
      </header>

      {incomingRequest && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3 text-sm">
          <p>
            <b>{other.name}</b> sana mesaj isteği gönderdi. Kabul edersen karşılıklı yazışabilirsiniz; reddedersen sana tekrar yazamaz.
          </p>
          <div className="mt-2 flex gap-2">
            <button disabled={busy} onClick={() => respond(true)} className="rounded-lg bg-accent px-3 py-1.5 font-bold text-pitch-950 disabled:opacity-50">
              Kabul et
            </button>
            <button disabled={busy} onClick={() => respond(false)} className="rounded-lg bg-pitch-800 px-3 py-1.5 disabled:opacity-50">
              Reddet
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Cevap yazman da isteği kabul sayılır.</p>
        </div>
      )}

      {hasMore && (
        <div className="py-2 text-center">
          <button onClick={loadOlder} disabled={loadingOlder} className="rounded-full bg-pitch-800 px-3 py-1 text-xs text-muted hover:text-white">
            {loadingOlder ? "Yükleniyor…" : "Daha eski mesajlar"}
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="py-16 text-center text-muted">
          <Icon name="forum" className="text-[40px] text-primary" />
          <p className="mt-2">{other.name} ile ilk mesajı sen yaz!</p>
        </div>
      )}

      <ol className="space-y-0.5">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const mine = m.author_id === meId;
          const continued = !newDay && prev && prev.kind === "text" && m.kind === "text" && prev.author_id === m.author_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;
          const invite = m.invite_id ? inviteOf.get(m.invite_id) : undefined;
          return (
            <li key={m.id}>
              {newDay && (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-pitch-800 px-3 py-1 text-[11px] text-muted">{dayLabel(m.created_at)}</span>
                </div>
              )}
              {m.kind === "match" && m.card ? (
                <MatchCardView
                  card={m.card}
                  refId={m.match_id ?? null}
                  status={m.match_id ? refStatus[`match:${m.match_id}`] : undefined}
                  live={m.match_id ? liveCards[m.match_id] : undefined}
                  mine={mine}
                  time={time(m.created_at)}
                  revoked={!!m.revoked_at}
                  busy={busy}
                  onAnswer={(accept) => matchAction(() => answerMatchInvite(m.match_id!, accept))}
                  onWithdraw={() => matchAction(() => withdrawMatchInvite(m.match_id!, other.id))}
                />
              ) : m.kind === "invite" ? (
                <div className={cx("my-2 flex", mine ? "justify-end" : "justify-start")}>
                  <div className="max-w-[85%] rounded-2xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm">
                    <div className="font-bold">{invite ? `${invite.group_kind === "team" ? "Takım" : "Grup"} daveti` : "Davet"}</div>
                    <div className="mt-0.5">{invite ? invite.group_name : m.body}</div>
                    <div className="mt-1 text-[11px] text-muted">
                      {invite ? INVITE_STATUS[invite.status] : "Artık geçerli değil"} · {time(m.created_at)}
                    </div>
                    {invite?.status === "pending" && !mine && (
                      <div className="mt-2 flex gap-2">
                        <button disabled={busy} onClick={() => answerInvite(invite, true)} className="rounded-lg bg-accent px-3 py-1.5 font-bold text-pitch-950 disabled:opacity-50">
                          Katıl
                        </button>
                        <button disabled={busy} onClick={() => answerInvite(invite, false)} className="rounded-lg bg-pitch-800 px-3 py-1.5 disabled:opacity-50">
                          Reddet
                        </button>
                      </div>
                    )}
                    {invite?.status === "pending" && mine && (
                      <button disabled={busy} onClick={() => withdrawInvite(invite)} className="mt-2 rounded-lg bg-pitch-800 px-3 py-1.5 text-xs disabled:opacity-50">
                        Daveti geri çek
                      </button>
                    )}
                    {invite?.status === "accepted" && !mine && (
                      <Link href={`/g/${invite.group_id}`} className="mt-2 inline-block text-xs text-accent">
                        {invite.group_kind === "team" ? "Takıma git ›" : "Gruba git ›"}
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <div className={cx("flex items-end gap-2", mine ? "justify-end" : "justify-start", !continued && "mt-2")}>
                  <div className="max-w-[78%]">
                    <button
                      type="button"
                      onClick={() => setSelected(selected === m.id ? null : m.id)}
                      className={cx(
                        "block w-full whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-[15px] leading-snug",
                        m.deleted_at ? "border border-line italic text-muted" : mine ? "bg-accent text-pitch-950" : "bg-pitch-800",
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
                    {selected === m.id && !m.deleted_at && m.id > 0 && mine && (
                      <div className="mt-1 flex justify-end">
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

      <form onSubmit={send} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {error && <p className="mx-auto max-w-lg px-4 pt-2 text-xs text-red-300">{error}</p>}
        {alreadyAsked && (
          <p className="mx-auto max-w-lg px-4 pt-2 text-xs text-muted">İsteğin gönderildi. {other.name} kabul edene kadar yeni mesaj yazamazsın.</p>
        )}
        <div className="mx-auto flex max-w-lg items-end gap-2 px-4 py-2">
          <textarea
            value={text}
            disabled={alreadyAsked}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={alreadyAsked ? "Kabul bekleniyor…" : waiting ? "İlk mesajını yaz (istek olarak gider)…" : "Mesaj yaz…"}
            aria-label="Mesaj"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-pitch-900 px-4 py-2.5 text-[15px] outline-none placeholder:text-muted/60 focus:border-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || alreadyAsked}
            aria-label="Gönder"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-pitch-950 disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          </button>
        </div>
      </form>
    </main>
  );
}
