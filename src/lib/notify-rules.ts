// Bildirim kuralları ve metinleri. Saf fonksiyonlar (veritabanı/ağ yok) — notify-rules.test.ts ile test edilir.

// "listing": eski oyuncu ilanı bildirimleri (kutudaki eski kayıtlar için); yeni bildirim üretilmez
export type NotificationType = "vote" | "poll" | "match" | "offer" | "listing" | "chat" | "dm" | "invite" | "friend";
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
  dm: "chat",
  invite: "chat",
  friend: "chat",
};

export const PREF_LABEL: Record<PrefKey, { title: string; hint: string }> = {
  votes: { title: "Oylama", hint: "Maç bitip oylama açılınca, oylama kapanmadan hatırlatma ve sonuçlar açıklanınca" },
  matches: { title: "Maç", hint: "Maç ayarlandı/kesinleşti/ertelendi/iptal, davet, kadroya alınma/yedek/çıkarılma, ilan ve başvurular, rakibin skoru, yer açılması (yönetene), üye katıldı/ayrıldı (yetkililere), rolün değişti" },
  offers: { title: "Maç teklifi", hint: "Takımlar arası maç teklifleri, yanıtları ve geri çekilmesi" },
  chat: { title: "Sohbet", hint: "Grup/takım ve birebir mesajlar, takıma/gruba davetler (bir sohbette 10 dakikada en fazla 1 bildirim)" },
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
    if (input.type === "chat" || input.type === "dm") {
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
  memberJoined: (groupName: string, who: string, groupId: string, kind: "team" | "community"): Content => ({
    title: kind === "team" ? "👋 Takıma yeni oyuncu" : "👋 Gruba yeni üye",
    body: truncate(`${who}, “${oneLine(groupName)}” ${kind === "team" ? "takımına" : "grubuna"} katıldı`, 300),
    url: `/g/${groupId}/players`,
    tag: `member-joined:${groupId}`,
  }),
  joinDecided: (groupName: string, groupId: string, kind: "team" | "community", accepted: boolean): Content => ({
    title: accepted ? "✅ Katılma isteğin kabul edildi" : "Katılma isteğin reddedildi",
    body: truncate(
      accepted
        ? `Artık “${oneLine(groupName)}” ${kind === "team" ? "takımının oyuncususun" : "grubunun üyesisin"}`
        : `“${oneLine(groupName)}” isteğini kabul etmedi`,
      300,
    ),
    url: accepted ? `/g/${groupId}` : "/kesfet?sekme=grup",
    tag: `join-decided:${groupId}`,
  }),
  roleChanged: (groupName: string, groupId: string, roleLabel: string): Content => ({
    title: "🎖️ Rolün değişti",
    body: truncate(`${oneLine(groupName)}: artık ${roleLabel}`, 300),
    url: `/g/${groupId}`,
    tag: `role:${groupId}`,
  }),
  voteOpened: (groupId: string, matchId: string, opponent?: string | null): Content => ({
    title: "🗳️ Oylama açıldı",
    body: join(opponent ? `vs ${opponent}` : "Maç bitti", "arkadaşlarını puanla, oyunu bekliyorlar"),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `vote:${matchId}`,
  }),
  /** Oylama kapandı: kadroya */
  resultsOut: (groupId: string, matchId: string, mvp: string | null): Content => ({
    title: "🏆 Sonuçlar açıklandı",
    body: truncate(join(mvp ? `Maçın adamı: ${mvp}` : null, "puanını ve kartını gör"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `results:${matchId}`,
  }),
  voteReminder: (groupId: string, matchId: string, hoursLeft: number): Content => ({
    title: "⏰ Oylama kapanmak üzere",
    body: `Oy vermek için yaklaşık ${Math.max(1, Math.round(hoursLeft))} saat kaldı.`,
    url: `/g/${groupId}/m/${matchId}`,
    tag: `vote-reminder:${matchId}`,
  }),
  /** Kesinleştirme sonucu: kadroda veya yedekte (sıra no ile) */
  selectedForMatch: (groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "⚽ Kadrodasın",
    body: truncate(join(groupName, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Kurucu/yetkili/organizatörlere: üye maç önerdi */
  proposalReceived: (who: string, groupName: string, groupId: string, when: string): Content => ({
    title: "💡 Maç önerisi",
    body: truncate(join(`${who} maç öneriyor`, groupName, when), 300),
    url: `/g/${groupId}/istekler?sekme=oneri`,
    tag: `proposal:${groupId}`,
  }),
  /** Önerene: onaylandı (çağrı açıldı, sen yönetiyorsun) veya reddedildi */
  proposalDecided: (groupName: string, groupId: string, accepted: boolean, matchId: string | null): Content => ({
    title: accepted ? "✅ Maç önerin onaylandı" : "Maç önerin onaylanmadı",
    body: truncate(accepted ? `${groupName}: maç ayarlandı, kadroda yerin hazır; toplanınca sen kesinleştirirsin` : groupName, 300),
    url: accepted && matchId ? `/g/${groupId}/m/${matchId}` : `/g/${groupId}`,
    tag: `proposal-decision:${groupId}`,
  }),
  /** Organizatöre: kadroda yer açıldı, yedek var */
  spotOpened: (who: string, groupId: string, matchId: string, reserves: number): Content => ({
    title: "🔄 Kadroda yer açıldı",
    body: truncate(`${who} kadrodan çıktı. ${reserves} yedek var; maç ekranından kadroya alabilirsin.`, 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `spot:${matchId}`,
  }),
  matchCreated: (groupName: string, groupId: string, matchId: string, when: string, opponent?: string | null): Content => ({
    title: "⚽ Maç kuruldu",
    body: truncate(join(groupName, opponent ? `vs ${opponent}` : null, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Kadroya: maç silindi/iptal edildi (bağlı maçta iki takımın kadrosuna) */
  matchCancelled: (groupName: string, groupId: string, matchId: string, when: string, opponent?: string | null): Content => ({
    title: "❌ Maç iptal edildi",
    body: truncate(join(groupName, opponent ? `vs ${opponent}` : null, when), 300),
    url: `/g/${groupId}`,
    tag: `match-cancel:${matchId}`,
  }),
  /** Takıma/gruba duyurulan yeni maç (toplanıyor): geliyorum/gelemem */
  matchGathering: (groupName: string, groupId: string, matchId: string, when: string, roster: number, capacity: number): Content => ({
    title: "📣 Maç ayarlanıyor",
    body: truncate(join(groupName, when, `kadro ${roster}/${capacity}`, "geliyor musun?"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Yöneten kişi seni kadroya yazdı (kesin gelen / yedekten / başvurun kabul) */
  addedToRoster: (who: string, groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "⚽ Kadrodasın",
    body: truncate(join(`${who} seni kadroya yazdı`, groupName, when, "gelemezsen maç ekranından çık"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Toplanan maçın kadrosu doldu: yönetenlere */
  rosterFull: (groupName: string, groupId: string, matchId: string, count: number): Content => ({
    title: "✅ Kadro tamam",
    body: truncate(join(groupName, `${count} kişi`, "saati seçip maçı kesinleştir"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `roster-full:${matchId}`,
  }),
  /** Maç kesinleşti: kadroya */
  matchConfirmed: (groupName: string, groupId: string, matchId: string, when: string, opponent?: string | null): Content => ({
    title: "✅ Maç kesinleşti",
    body: truncate(join(groupName, opponent ? `vs ${opponent}` : null, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Maçın tarihi değişti: kadro ve yedeklere */
  matchRescheduled: (groupName: string, groupId: string, matchId: string, when: string, freeWithdraw: boolean): Content => ({
    title: "🗓️ Maç saati değişti",
    body: truncate(join(groupName, `yeni zaman: ${when}`, freeWithdraw ? "gelemeyecek olan 24 saat içinde onaysız çıkabilir" : null), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Maça başvuru geldi: yönetenlere */
  applicationReceived: (who: string, groupName: string, groupId: string, matchId: string, via: string): Content => ({
    title: "🙋 Maça başvuru",
    body: truncate(join(`${who} maça katılmak istiyor`, groupName, via), 300),
    url: `/g/${groupId}/m/${matchId}#basvurular`,
    tag: `application:${matchId}`,
  }),
  /** Başvurunun sonucu: başvurana */
  applicationDecided: (groupName: string, groupId: string, matchId: string, result: "in" | "reserve" | "rejected", when: string): Content => ({
    title: result === "rejected" ? "Başvurun kabul edilmedi" : result === "in" ? "✅ Başvurun kabul edildi" : "Başvurun kabul edildi · yedektesin",
    body: truncate(join(groupName, when, result === "reserve" ? "kadro dolu; yer açılırsa kadroya alınırsın" : null), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `application-result:${matchId}`,
  }),
  /** Gruba onay bekleyen ilan: o grubun kaptan/yetkililerine */
  listingNeedsApproval: (who: string, fromName: string, targetGroupId: string, when: string): Content => ({
    title: "📋 Onay bekleyen ilan",
    body: truncate(join(`${who}, ${fromName} maçı için grubunda adam arıyor`, when, "yayınlamak için onayla"), 300),
    url: `/g/${targetGroupId}/istekler?sekme=ilan`,
    tag: `listing-approval:${targetGroupId}`,
  }),
  /** Grupta ilan yayında: o grubun üyelerine */
  listingOpened: (fromName: string, targetName: string, groupId: string, matchId: string, needed: number, when: string): Content => ({
    title: `🔎 ${needed} oyuncu aranıyor`,
    body: truncate(join(fromName, when, `${targetName} grubunda paylaşıldı`), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `listing:${matchId}`,
  }),
  /** Teklifte karşı teklif / bağlı maçta tarih önerisi: sırası gelen takımın yetkililerine */
  counterOffer: (team: string, groupId: string, when: string, reschedule: boolean): Content => ({
    title: reschedule ? "🗓️ Rakip tarih değişikliği önerdi" : "↩️ Karşı teklif geldi",
    body: truncate(join(team, `önerilen: ${when}`, "kabul et veya reddet"), 300),
    url: `/g/${groupId}/teklifler`,
    tag: `counter:${groupId}`,
  }),
  /** Maça 3 saat kala yedekten otomatik kadroya alınana */
  autoPromoted: (groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "✅ Kadroya alındın",
    body: truncate(join(groupName, when, "yedekteydin, yer açıldı"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `promoted:${matchId}`,
  }),
  /** Maç günü sabahı kadroya */
  matchToday: (groupName: string, groupId: string, matchId: string, when: string, opponent?: string | null): Content => ({
    title: "⚽ Bugün maç var",
    body: truncate(join(groupName, opponent ? `vs ${opponent}` : null, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `today:${matchId}`,
  }),
  /** Maç günü sabahı hâlâ toplanan maçı yönetenlere */
  gatheringWarning: (groupName: string, groupId: string, matchId: string, roster: number, capacity: number): Content => ({
    title: "⚠️ Maç bugün ama kadro eksik",
    body: truncate(join(groupName, `kadro ${roster}/${capacity}`, "kesinleştir, ertele veya iptal et; saat geçerse maç iptal olur"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `gather-warn:${matchId}`,
  }),
  /** Skor girilmemiş kesin maçı yönetenlere (maçtan 2 saat sonra ve ertesi gün) */
  scoreReminder: (groupName: string, groupId: string, matchId: string, second: boolean): Content => ({
    title: "📝 Maçın skorunu gir",
    body: truncate(join(groupName, second ? "skor yarın girilmezse maç sonuçsuz kapanır" : "skoru girince oylama açılır"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `score-reminder:${second ? 2 : 1}:${matchId}`,
  }),
  /** Kadro tamamlanmadan saati geçen toplanan maç iptal oldu */
  gatheringExpired: (groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "❌ Maç iptal oldu",
    body: truncate(join(groupName, when, "kadro tamamlanmadan maç zamanı geçti"), 300),
    url: `/g/${groupId}`,
    tag: `match-cancel:${matchId}`,
  }),
  /** Elle kadrodan çıkarılan oyuncuya */
  removedFromMatch: (groupName: string, groupId: string, matchId: string, when: string): Content => ({
    title: "Maç kadrosundan çıkarıldın",
    body: truncate(join(groupName, when), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `match:${matchId}`,
  }),
  /** Bağlı maçta rakip skoru girdi; skor alıcı takımın açısından (kendi-rakip) */
  opponentScored: (opponent: string, groupId: string, matchId: string, own: number, theirs: number): Content => ({
    title: "📝 Rakip takım skoru girdi",
    body: truncate(join(`${opponent} karşısında ${own}-${theirs}`, "sen de skoru gir; aynıysa oylama açılır"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `score:${matchId}`,
  }),
  scoreMismatch: (opponent: string, groupId: string, matchId: string): Content => ({
    title: "⚠️ Skorlar uyuşmuyor",
    body: truncate(join(`vs ${opponent}`, "iki takımın girdiği skor farklı; rakiple konuşup skoru düzeltin"), 300),
    url: `/g/${groupId}/m/${matchId}`,
    tag: `score:${matchId}`,
  }),
  /** Bekleyen teklif gönderen takımca geri çekildi */
  challengeWithdrawn: (fromTeam: string, toGroupId: string): Content => ({
    title: "Maç teklifi geri çekildi",
    body: truncate(fromTeam, 300),
    url: `/g/${toGroupId}/teklifler`,
    tag: `offer:${toGroupId}`,
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
  chat: (groupName: string, groupId: string, author: string, message: string): Content => ({
    title: truncate(groupName, 120),
    body: truncate(`${author}: ${oneLine(message)}`, 100),
    url: `/g/${groupId}/sohbet`,
    tag: `chat:${groupId}`,
  }),
  /** Birebir mesaj: konuşma başına birleşir (etiket dm:<konuşma>) */
  dm: (author: string, threadId: string, message: string, isRequest: boolean): Content => ({
    title: truncate(isRequest ? `${author} sana mesaj isteği gönderdi` : author, 120),
    body: truncate(oneLine(message), 100),
    url: `/sohbet/${threadId}`,
    tag: `dm:${threadId}`,
  }),
  friendRequest: (who: string): Content => ({
    title: "👋 Arkadaşlık isteği",
    body: truncate(`${who} seni arkadaş olarak eklemek istiyor`, 300),
    url: "/sosyal",
    tag: `friend-request:${who}`,
  }),
  friendAccepted: (who: string, userId: string): Content => ({
    title: "🤝 Arkadaşlık kabul edildi",
    body: truncate(`${who} ile artık arkadaşsınız`, 300),
    url: `/oyuncu/${userId}`,
    tag: `friend-accepted:${userId}`,
  }),
  inviteReply: (who: string, groupName: string, kind: "team" | "community", accepted: boolean, groupId: string): Content => ({
    title: accepted ? "✅ Davet kabul edildi" : "❌ Davet reddedildi",
    body: truncate(
      accepted
        ? `${who}, “${oneLine(groupName)}” ${kind === "team" ? "takımına" : "grubuna"} katıldı`
        : `${who}, “${oneLine(groupName)}” davetini reddetti`,
      300,
    ),
    url: accepted ? `/g/${groupId}` : "/sosyal",
    tag: `invite-reply:${groupId}:${who}`,
  }),
  /** Sohbette paylaşılan maç/çağrı/ilan kartı */
  matchCard: (inviter: string, groupName: string, label: string, whenText: string, threadId: string, refId: string): Content => ({
    title: "⚽ Maç daveti",
    body: truncate(`${inviter}: ${label} · ${oneLine(groupName)} · ${whenText}`, 300),
    url: `/sohbet/${threadId}`,
    tag: `match-card:${refId}`,
  }),
  groupInvite: (inviter: string, groupName: string, kind: "team" | "community", threadId: string, inviteId: string): Content => ({
    title: kind === "team" ? "🛡️ Takım daveti" : "👥 Grup daveti",
    body: truncate(`${inviter} seni “${oneLine(groupName)}” ${kind === "team" ? "takımına" : "grubuna"} davet etti`, 300),
    url: `/sohbet/${threadId}`,
    tag: `invite:${inviteId}`,
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

export interface PushFailure {
  /** Push servisinin HTTP kodu (yoksa ağ/zaman aşımı hatası) */
  statusCode?: number;
  message: string;
}

/** Her aboneliğe gönderir; hata hiçbir zaman fırlatılmaz. Dönen: gönderilen sayısı, silinecek (ölü) endpoint'ler ve hata ayrıntıları. */
export async function sendToAll(
  subs: Subscription[],
  payload: string,
  send: PushSender,
): Promise<{ sent: number; dead: string[]; failed: number; errors: PushFailure[] }> {
  const results = await Promise.allSettled(subs.map((s) => send(s, payload)));
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  const errors: PushFailure[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
      return;
    }
    const reason = r.reason as { statusCode?: number; message?: string; body?: string } | undefined;
    errors.push({ statusCode: reason?.statusCode, message: String(reason?.body || reason?.message || reason).slice(0, 200) });
    if (isDeadSubscription(reason?.statusCode)) dead.push(subs[i].endpoint);
    else failed++;
  });
  return { sent, dead, failed, errors };
}

/** Push servisinin hata kodunu kullanıcıya/yöneticiye anlaşılır Türkçe nedene çevirir */
export function explainPushFailure(f: PushFailure): string {
  const code = f.statusCode;
  if (code === 401 || code === 403) {
    return `Push servisi anahtarları reddetti (${code}). Vercel'deki VAPID_PRIVATE_KEY ile NEXT_PUBLIC_VAPID_PUBLIC_KEY aynı çiftten olmalı; değiştirdiysen yeniden dağıt ve bildirimleri bu cihazda kapatıp yeniden aç.`;
  }
  if (code === 404 || code === 410) return "Bu cihazın aboneliği artık geçersiz. Bildirimleri bu cihazda kapatıp yeniden aç.";
  if (code === 413) return "Bildirim içeriği çok büyük (413).";
  if (code === 429) return "Push servisi çok fazla istek nedeniyle sınırladı (429); biraz sonra tekrar dene.";
  if (code && code >= 500) return `Push servisi geçici olarak hata veriyor (${code}); biraz sonra tekrar dene.`;
  if (/timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|fetch failed/i.test(f.message)) return "Push servisine ulaşılamadı (ağ/zaman aşımı); biraz sonra tekrar dene.";
  return `Gönderilemedi${code ? ` (${code})` : ""}: ${f.message}`;
}

/** Tarayıcıda abone olurken alınan hatayı (DOMException adı + mesaj) anlaşılır nedene çevirir */
export function explainSubscribeError(name: string | undefined, message: string | undefined): string {
  const detail = [name, message].filter(Boolean).join(": ").slice(0, 160);
  if (name === "NotAllowedError") return `Tarayıcı bildirim iznini vermedi. Site ayarlarından bildirimlere izin ver. (${detail})`;
  if (name === "AbortError" || /push service/i.test(message ?? "")) {
    return `Tarayıcı push servisine bağlanamadı. Brave kullanıyorsan Ayarlar → Gizlilik → “Google push mesajlaşma hizmetlerini kullan”ı aç; VPN/reklam engelleyici de engelleyebilir. (${detail})`;
  }
  if (name === "InvalidAccessError" || name === "InvalidCharacterError") return `Bildirim anahtarı geçersiz görünüyor; yeniden dağıtımın bittiğinden emin ol. (${detail})`;
  if (name === "SecurityError") return `Güvenli bağlantı gerekli (https). (${detail})`;
  if (name === "NotSupportedError") return `Bu tarayıcı push bildirimini desteklemiyor. (${detail})`;
  return `Bildirimler açılamadı. (${detail || "bilinmeyen hata"})`;
}
