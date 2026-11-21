// Bildirim kuralları ve metinleri. Saf fonksiyonlar (veritabanı/ağ yok) — notify-rules.test.ts ile test edilir.

export type NotificationType = "vote" | "poll" | "match" | "offer" | "listing" | "chat";
export type PrefKey = "votes" | "matches" | "offers" | "chat";
export type Prefs = Record<PrefKey, boolean>;

/** Hangi bildirim türü hangi kullanıcı tercihine bağlı */
export const PREF_OF: Record<NotificationType, PrefKey> = {
  vote: "votes",
  poll: "matches",
  match: "matches",
  offer: "offers",
  listing: "offers",
  chat: "chat",
};

export const PREF_LABEL: Record<PrefKey, { title: string; hint: string }> = {
  votes: { title: "Oylama", hint: "Maç bitip oylama açılınca ve oylama kapanmadan hatırlatma" },
  matches: { title: "Maç çağrısı ve maç", hint: "Yeni çağrı, maç kuruldu, çağrı iptal oldu" },
  offers: { title: "Teklif ve oyuncu ilanı", hint: "Maç teklifleri, ilana başvuru ve başvuru sonucu" },
  chat: { title: "Sohbet", hint: "Yeni mesajlar (bir grupta 10 dakikada en fazla 1 bildirim)" },
};

/** Satır yoksa tüm kategoriler açık */
export const DEFAULT_PREFS: Prefs = { votes: true, matches: true, offers: true, chat: true };

export function allowed(type: NotificationType, prefs?: Partial<Prefs> | null): boolean {
  return (prefs?.[PREF_OF[type]] ?? DEFAULT_PREFS[PREF_OF[type]]) !== false;
}

/** Sohbet bildirimleri aynı kullanıcı + grup için bu süre içinde tek kalır */
export const CHAT_MERGE_MINUTES = 10;

/**
 * Bildirimi kimlere yazacağımızı belirler: alıcılar tekrarsız, olayı yapan hariç, kategori tercihi açık olanlar;
 * sohbette son CHAT_MERGE_MINUTES içinde aynı etiketle bildirim almış olanlar atlanır (birleştirme).
 */
export function planRecipients(input: {
  type: NotificationType;
  userIds: Iterable<string>;
  excludeUserId?: string | null;
  prefsByUser: Map<string, Partial<Prefs>>;
  /** Kullanıcı → aynı etiketli en son bildirimin zamanı (ISO), sadece sohbet için */
  recentByUser?: Map<string, string>;
  now?: number;
}): string[] {
  const now = input.now ?? Date.now();
  const out: string[] = [];
  for (const id of new Set(input.userIds)) {
    if (!id || id === input.excludeUserId) continue;
    if (!allowed(input.type, input.prefsByUser.get(id))) continue;
    if (input.type === "chat") {
      const last = input.recentByUser?.get(id);
      if (last && now - new Date(last).getTime() < CHAT_MERGE_MINUTES * 60_000) continue;
    }
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metinler (başlık ≤ 120, gövde ≤ 300 karakter; url uygulama içi yol)
// ---------------------------------------------------------------------------

export interface Content {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

export const text = {
  withdrawalRequested: (groupId: string, matchId: string, who: string, when: string, late: boolean, reason?: string | null): Content => ({
    title: late ? "🙋 Maçtan çekilme isteği (son dakika)" : "🙋 Maçtan çekilme isteği",
    body: truncate(join(who, when, reason ? `“${oneLine(reason)}”` : null, "onayını bekliyor"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `withdrawal:${matchId}`,
  }),
  withdrawalLeft: (groupId: string, matchId: string, who: string, when: string): Content => ({
    title: "👋 Bir oyuncu maçtan çıktı",
    body: truncate(join(who, when, "kadrodan çıktı"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `withdrawal-left:${matchId}`,
  }),
  withdrawalDecided: (groupId: string, matchId: string, approved: boolean, when: string): Content => ({
    title: approved ? "✅ Çekilme isteğin onaylandı" : "❌ Çekilme isteğin reddedildi",
    body: approved ? join(when, "maç kadrosundan çıkarıldın") : join(when, "kadroda kalıyorsun; gelemeyeceksen kaptanla konuş"),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `withdrawal-decided:${matchId}`,
  }),
  memberLeft: (groupName: string, who: string, groupId: string): Content => ({
    title: "👋 Bir üye ayrıldı",
    body: truncate(join(groupName, `${who} gruptan ayrıldı`), 300),
    url: `/g/${groupId}/players`,
    tag: `member-left:${groupId}`,
  }),
  voteOpened: (groupId: string, matchId: string, opponent?: string | null): Content => ({
    title: "🗳️ Oylama açıldı",
    body: join(opponent ? `vs ${opponent}` : "Maç bitti", "arkadaşlarını puanla, oyunu bekliyorlar"),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `vote:${matchId}`,
  }),
  voteReminder: (groupId: string, matchId: string, hoursLeft: number): Content => ({
    title: "⏰ Oylama kapanmak üzere",
    body: `Oy vermek için yaklaşık ${Math.max(1, Math.round(hoursLeft))} saat kaldı.`,
    url: `/g/${groupId}/m/${matchId}`,
    tag: `vote-reminder:${matchId}`,
  }),
  pollOpened: (groupName: string, groupId: string, pollId: string, when: string, venue?: string | null): Content => ({
    title: "📣 Maç çağrısı",
    body: truncate(join(groupName, when, venue), 300),
    url: `/g/${groupId}/cagri/${pollId}`,
    tag: `poll:${pollId}`,
  }),
  pollConverted: (groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "⚽ Maç kuruldu",
    body: truncate(join(groupName, when, "kadrodasın"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  pollCancelled: (groupName: string, groupId: string, pollId: string): Content => ({
    title: "❌ Çağrı iptal oldu",
    body: truncate(`${groupName}: yeterli kişi toplanamadı.`, 300),
    url: `/g/${groupId}/cagri/${pollId}`,
    tag: `poll:${pollId}`,
  }),
  matchCreated: (groupName: string, groupId: string, matchId: string, when: string, opponent?: string | null): Content => ({
    title: "⚽ Maç kuruldu",
    body: truncate(join(groupName, opponent ? `vs ${opponent}` : null, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  challengeReceived: (fromTeam: string, toGroupId: string, when: string): Content => ({
    title: "🤝 Maç teklifi geldi",
    body: truncate(join(fromTeam, when), 300),
    url: `/g/${toGroupId}/teklifler`,
    tag: `offer:${toGroupId}`,
  }),
  challengeAnswered: (toTeam: string, fromGroupId: string, accepted: boolean): Content => ({
    title: accepted ? "✅ Teklifin kabul edildi" : "❌ Teklifin reddedildi",
    body: truncate(toTeam, 300),
    url: `/g/${fromGroupId}/teklifler`,
    tag: `offer:${fromGroupId}`,
  }),
  listingApplied: (applicant: string, teamName: string, groupId: string, matchId: string): Content => ({
    title: "🔎 Oyuncu ilanına başvuru",
    body: truncate(join(applicant, teamName), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `listing-apply:${matchId}`,
  }),
  applicationDecided: (teamName: string, accepted: boolean, groupId: string, matchId: string): Content => ({
    title: accepted ? "✅ Kadroya alındın" : "❌ Başvurun reddedildi",
    body: truncate(teamName, 300),
    url: accepted ? `/g/${groupId}/m/${matchId}` : "/",
    tag: `listing-decision:${matchId}`,
  }),
  chat: (groupName: string, groupId: string, author: string, message: string): Content => ({
    title: truncate(groupName, 120),
    body: truncate(`${author}: ${oneLine(message)}`, 100),
    url: `/g/${groupId}/sohbet`,
    tag: `chat:${groupId}`,
  }),
};

// ---------------------------------------------------------------------------
// Push gönderim sonucu: hangi abonelikler ölü (silinmeli)
// ---------------------------------------------------------------------------

/** Push servisinin "bu abonelik artık yok" dediği durumlar: 404 Not Found, 410 Gone */
export const isDeadSubscription = (statusCode: number | undefined) => statusCode === 404 || statusCode === 410;

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSender = (sub: Subscription, payload: string) => Promise<void>;

/** Her aboneliğe gönderir; hata hiçbir zaman fırlatılmaz. Dönen: gönderilen sayısı ve silinecek (ölü) endpoint'ler. */
export async function sendToAll(
  subs: Subscription[],
  payload: string,
  send: PushSender,
): Promise<{ sent: number; dead: string[]; failed: number }> {
  const results = await Promise.allSettled(subs.map((s) => send(s, payload)));
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
    } else if (isDeadSubscription((r.reason as { statusCode?: number } | undefined)?.statusCode)) {
      dead.push(subs[i].endpoint);
    } else {
      failed++;
    }
  });
  return { sent, dead, failed };
}
