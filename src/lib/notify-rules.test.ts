import { describe, expect, it } from "vitest";
import {
  CHAT_MERGE_MINUTES,
  DEFAULT_PREFS,
  PREF_OF,
  allowed,
  explainPushFailure,
  explainSubscribeError,
  planRecipients,
  sendToAll,
  text,
  truncate,
  type NotificationType,
  type Subscription,
} from "@/lib/notify-rules";

describe("tercihler", () => {
  it("her tür bir tercih kategorisine bağlı", () => {
    const types: NotificationType[] = ["vote", "poll", "match", "offer", "listing", "chat"];
    for (const t of types) expect(Object.keys(DEFAULT_PREFS)).toContain(PREF_OF[t]);
    expect(PREF_OF.poll).toBe(PREF_OF.match);
    expect(PREF_OF.offer).toBe(PREF_OF.listing);
  });
  it("tercih satırı yoksa hepsi açık", () => {
    expect(allowed("vote", null)).toBe(true);
    expect(allowed("chat", undefined)).toBe(true);
    expect(allowed("offer", {})).toBe(true);
  });
  it("kapatılan kategori engellenir, diğerleri etkilenmez", () => {
    expect(allowed("chat", { chat: false })).toBe(false);
    expect(allowed("vote", { chat: false })).toBe(true);
    expect(allowed("poll", { matches: false })).toBe(false);
    expect(allowed("match", { matches: false })).toBe(false);
    expect(allowed("listing", { offers: false })).toBe(false);
  });
});

describe("alıcı planı", () => {
  const base = { type: "vote" as const, prefsByUser: new Map(), now: Date.parse("2026-01-01T12:00:00Z") };
  it("tekrarsız, olayı yapan hariç", () => {
    expect(planRecipients({ ...base, userIds: ["a", "b", "a", "c"], excludeUserId: "b" })).toEqual(["a", "c"]);
  });
  it("boş id'leri atar", () => {
    expect(planRecipients({ ...base, userIds: ["", "a"] })).toEqual(["a"]);
  });
  it("kategorisini kapatanlara yazmaz", () => {
    const prefs = new Map([["b", { votes: false }]]);
    expect(planRecipients({ ...base, userIds: ["a", "b"], prefsByUser: prefs })).toEqual(["a"]);
  });
  it("sohbet: son 10 dakikada bildirim almış olan atlanır (birleştirme)", () => {
    const recent = new Map([
      ["a", "2026-01-01T11:55:00Z"], // 5 dk önce → atla
      ["b", "2026-01-01T11:40:00Z"], // 20 dk önce → yaz
    ]);
    const r = planRecipients({ ...base, type: "chat", userIds: ["a", "b", "c"], recentByUser: recent });
    expect(r).toEqual(["b", "c"]);
    expect(CHAT_MERGE_MINUTES).toBe(10);
  });
  it("sohbet dışı türlerde birleştirme yok", () => {
    const recent = new Map([["a", "2026-01-01T11:59:00Z"]]);
    expect(planRecipients({ ...base, type: "vote", userIds: ["a"], recentByUser: recent })).toEqual(["a"]);
  });
  it("tam 10 dakika dolunca tekrar bildirim gider", () => {
    const recent = new Map([["a", "2026-01-01T11:50:00Z"]]);
    expect(planRecipients({ ...base, type: "chat", userIds: ["a"], recentByUser: recent })).toEqual(["a"]);
  });
});

describe("metinler", () => {
  const all = [
    text.voteOpened("g", "m", "Rakip FK"),
    text.voteReminder("g", "m", 3.4),
    text.pollOpened("Grup", "g", "p", "Cum 21:00", "Saha"),
    text.fillOpened("Grup", "g", "p", 2, "Cum 21:00", ["DEF"]),
    text.pollUpdated("Grup", "g", "p", "Cum 21:00", "Saha"),
    text.pollSelected("Grup", "g", "m", "Cum 21:00"),
    text.pollReserve("Grup", "g", "p", "Cum 21:00", 2),
    text.pollRejected("Grup", "g", "p"),
    text.pollApplied("Ali", "g", "p"),
    text.spotOpened("Ali", "g", "p", 3),
    text.proposalReceived("Ali", "Grup", "g", "Cuma"),
    text.proposalDecided("Grup", "g", true, "p"),
    text.proposalDecided("Grup", "g", false, null),
    text.matchCreated("Takım", "g", "m", "Cum 21:00", "Rakip"),
    text.matchCancelled("Takım", "g", "m", "Cum 21:00", "Rakip"),
    text.removedFromMatch("Grup", "g", "m", "Cum 21:00"),
    text.opponentScored("Kartallar", "g", "m", 3, 2),
    text.scoreMismatch("Kartallar", "g", "m"),
    text.challengeWithdrawn("Kartallar", "g"),
    text.challengeReceived("Kartallar", "g", "Cum 21:00"),
    text.challengeAnswered("Aslanlar", "g", true),
    text.challengeAnswered("Aslanlar", "g", false),
    text.chat("Grup", "g", "Ali", "Merhaba\n\n  nasılsınız   hepiniz"),
  ];
  it("başlık ≤120, gövde ≤300, url uygulama içi yol (// ve dış adres yok)", () => {
    for (const c of all) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.title.length).toBeLessThanOrEqual(120);
      expect(c.body.length).toBeLessThanOrEqual(300);
      expect(c.url).toMatch(/^\/[^/\\]|^\/$/);
    }
  });
  it("sohbet: tek satır, uzun mesaj kısaltılır, etiket grup bazlı (birleştirme)", () => {
    const c = text.chat("Grup", "g1", "Ali", "x".repeat(500));
    expect(c.body.length).toBeLessThanOrEqual(100);
    expect(c.body.endsWith("…")).toBe(true);
    expect(c.tag).toBe("chat:g1");
    expect(text.chat("G", "g", "Ali", "a\n\nb  c").body).toBe("Ali: a b c");
  });
  it("etiketler olaya özgü (aynı maçın bildirimi cihazda tek kalır)", () => {
    expect(text.voteOpened("g", "m1").tag).toBe("vote:m1");
    expect(text.voteReminder("g", "m1", 2).tag).toBe("vote-reminder:m1");
    expect(text.voteOpened("g", "m1").tag).not.toBe(text.voteReminder("g", "m1", 2).tag);
  });
  it("kadroya seçilen maça, yedek ve reddedilen çağrıya gider", () => {
    expect(text.pollSelected("G", "g", "m", "Cum").url).toBe("/g/g/m/m");
    expect(text.pollReserve("G", "g", "p", "Cum", 1).url).toBe("/g/g/cagri/p");
    expect(text.pollRejected("G", "g", "p").url).toBe("/g/g/cagri/p");
  });
  it("hatırlatma en az 1 saat gösterir", () => {
    expect(text.voteReminder("g", "m", 0.2).body).toContain("1 saat");
  });
  it("truncate", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
  });
});

describe("push gönderimi sonucu", () => {
  const subs: Subscription[] = ["a", "b", "c", "d"].map((x) => ({ endpoint: `https://push/${x}`, p256dh: "p", auth: "a" }));
  it("başarılar sayılır; 404/410 ölü olarak işaretlenir; diğer hatalar sadece sayılır, fırlatılmaz", async () => {
    const send = async (s: Subscription) => {
      if (s.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("/c")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (s.endpoint.endsWith("/d")) throw Object.assign(new Error("server"), { statusCode: 500 });
    };
    const r = await sendToAll(subs, "{}", send);
    expect(r).toMatchObject({ sent: 1, dead: ["https://push/b", "https://push/c"], failed: 1 });
  });
  it("abonelik yoksa boş sonuç", async () => {
    expect(await sendToAll([], "{}", async () => {})).toMatchObject({ sent: 0, dead: [], failed: 0 });
  });
  it("ağ hatası (statusCode yok) ölü sayılmaz", async () => {
    const r = await sendToAll(subs.slice(0, 1), "{}", async () => {
      throw new Error("ECONNRESET");
    });
    expect(r).toMatchObject({ sent: 0, dead: [], failed: 1 });
  });
});

describe("üye ayrıldı metni", () => {
  it("gruba ve kişiye işaret eder, oyuncular sayfasına götürür", () => {
    const c = text.memberLeft("Cuma Halısaha", "Ali Veli", "g1");
    expect(c.title).toContain("ayrıldı");
    expect(c.body).toContain("Ali Veli");
    expect(c.body).toContain("Cuma Halısaha");
    expect(c.url).toBe("/g/g1/players");
  });
});

describe("maçtan çekilme metinleri", () => {
  it("istek: kim, ne zaman, sebep ve son dakika işareti; maç ekranına götürür", () => {
    const c = text.withdrawalRequested("g1", "m1", "Mert", "Cum 21:00", true, "Dizim\nağrıyor");
    expect(c.title).toContain("son dakika");
    expect(c.body).toContain("Mert");
    expect(c.body).toContain("Dizim ağrıyor");
    expect(c.body).toContain("onayını bekliyor");
    expect(c.url).toBe("/g/g1/m/m1");
    expect(text.withdrawalRequested("g1", "m1", "Mert", "Cum 21:00", false).title).not.toContain("son dakika");
  });
  it("karar: onay ve ret farklı metin taşır", () => {
    expect(text.withdrawalDecided("g1", "m1", true, "Cum 21:00").title).toContain("onaylandı");
    const denied = text.withdrawalDecided("g1", "m1", false, "Cum 21:00");
    expect(denied.title).toContain("reddedildi");
    expect(denied.body).toContain("kadroda kalıyorsun");
  });
});

describe("push hata açıklamaları", () => {
  it("sendToAll hata ayrıntısını toplar, ölü abonelikleri ayırır", async () => {
    const subs = [
      { endpoint: "https://a", p256dh: "p", auth: "a" },
      { endpoint: "https://b", p256dh: "p", auth: "a" },
      { endpoint: "https://c", p256dh: "p", auth: "a" },
    ];
    const r = await sendToAll(subs, "{}", async (s) => {
      if (s.endpoint === "https://b") throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint === "https://c") throw Object.assign(new Error("denied"), { statusCode: 403, body: "unauthorized vapid" });
    });
    expect(r.sent).toBe(1);
    expect(r.dead).toEqual(["https://b"]);
    expect(r.failed).toBe(1);
    expect(r.errors.map((e) => e.statusCode)).toEqual([410, 403]);
    expect(r.errors[1].message).toBe("unauthorized vapid");
  });
  it("401/403 anahtar uyuşmazlığı, 410 geçersiz abonelik, ağ hatası ayrı açıklanır", () => {
    expect(explainPushFailure({ statusCode: 403, message: "x" })).toContain("VAPID_PRIVATE_KEY");
    expect(explainPushFailure({ statusCode: 410, message: "x" })).toContain("geçersiz");
    expect(explainPushFailure({ statusCode: 503, message: "x" })).toContain("geçici");
    expect(explainPushFailure({ message: "Request timed out" })).toContain("ulaşılamadı");
    expect(explainPushFailure({ statusCode: 400, message: "bad" })).toContain("(400)");
  });
  it("tarayıcı abonelik hataları neden ve çözümle açıklanır", () => {
    expect(explainSubscribeError("AbortError", "Registration failed - push service error")).toContain("Brave");
    expect(explainSubscribeError("NotAllowedError", "denied")).toContain("izin");
    expect(explainSubscribeError("InvalidAccessError", "key")).toContain("anahtar");
    expect(explainSubscribeError(undefined, undefined)).toContain("bilinmeyen");
  });
});
