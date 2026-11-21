import { describe, expect, it } from "vitest";
import {
  CHAT_MERGE_MINUTES,
  DEFAULT_PREFS,
  PREF_OF,
  allowed,
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
    text.pollConverted("Grup", "g", "m", "Cum 21:00"),
    text.pollCancelled("Grup", "g", "p"),
    text.matchCreated("Takım", "g", "m", "Cum 21:00", "Rakip"),
    text.challengeReceived("Kartallar", "g", "Cum 21:00"),
    text.challengeAnswered("Aslanlar", "g", true),
    text.challengeAnswered("Aslanlar", "g", false),
    text.listingApplied("Ali", "Takım", "g", "m"),
    text.applicationDecided("Takım", true, "g", "m"),
    text.applicationDecided("Takım", false, "g", "m"),
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
  it("reddedilen başvuruda maça değil ana sayfaya gider", () => {
    expect(text.applicationDecided("T", false, "g", "m").url).toBe("/");
    expect(text.applicationDecided("T", true, "g", "m").url).toBe("/g/g/m/m");
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
    expect(r).toEqual({ sent: 1, dead: ["https://push/b", "https://push/c"], failed: 1 });
  });
  it("abonelik yoksa boş sonuç", async () => {
    expect(await sendToAll([], "{}", async () => {})).toEqual({ sent: 0, dead: [], failed: 0 });
  });
  it("ağ hatası (statusCode yok) ölü sayılmaz", async () => {
    const r = await sendToAll(subs.slice(0, 1), "{}", async () => {
      throw new Error("ECONNRESET");
    });
    expect(r).toEqual({ sent: 0, dead: [], failed: 1 });
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
