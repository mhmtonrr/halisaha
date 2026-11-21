import { describe, expect, it } from "vitest";
import { cardDisplayName, fitCardName, hasProfanity, validateCardName } from "./card-name";

describe("fitCardName", () => {
  it("sığan adı olduğu gibi bırakır", () => expect(fitCardName("Berk Beycan")).toBe("Berk Beycan"));
  it("uzun soyadı baş harfe indirir", () => expect(fitCardName("Mehmet Onur Duman")).toBe("Mehmet Onur D."));
  it("yine uzunsa ilk ad + soyad baş harfi", () => expect(fitCardName("Abdurrahman Kemalettin Yıldırım")).toBe("Abdurrahman Y."));
  it("tek uzun kelimeyi keser", () => expect(fitCardName("Abdurrahmanhüseyinoğlu")).toBe("Abdurrahmanhüs…"));
  it("çok kelimede ilk ad + soyad baş harfi (Ö)", () => expect(fitCardName("Ahmet Mehmet İlhan Özdemir")).toBe("Ahmet Ö."));
  it("fazla boşlukları sadeleştirir", () => expect(fitCardName("  Ali   Can ")).toBe("Ali Can"));
});

describe("validateCardName", () => {
  const ok = (s: string) => validateCardName(s);
  it("boş girdi null döner", () => {
    expect(ok("")).toEqual({ ok: true, value: null });
    expect(ok("   ")).toEqual({ ok: true, value: null });
    expect(validateCardName(null)).toEqual({ ok: true, value: null });
  });
  it("kenar boşluklarını siler, ardışık boşlukları tekler", () => expect(ok("  Ali   Can ")).toEqual({ ok: true, value: "Ali Can" }));
  it("Türkçe harf ve noktalı kısaltma kabul", () => {
    expect(ok("Şükrü Ö.")).toEqual({ ok: true, value: "Şükrü Ö." });
    expect(ok("M.")).toEqual({ ok: true, value: "M." });
  });
  it("uzunluk 2-20", () => {
    expect(ok("A").ok).toBe(false);
    expect(ok("Abdurrahman Kemalet").ok).toBe(true);
    expect(ok("Abdurrahman Kemalettin").ok).toBe(false);
  });
  it("rakam, kısa çizgi ve semboller yasak", () => {
    for (const s of ["Ali1", "Ali-Can", "Ali_Can", "Ali@", "Ali ⚽", "Алексей"]) expect(ok(s).ok, s).toBe(false);
  });
  it("nokta kuralları", () => {
    for (const s of [".Ali", "Ali..", "Ali .", "M..O"]) expect(ok(s).ok, s).toBe(false);
    expect(ok("M.O.").ok).toBe(true);
  });
  it("küfürlü adı reddeder", () => {
    for (const s of ["Orospu", "Siktir", "S i k", "s.i.k", "SİKTİR", "Oroospuu", "Ami Nakoy"]) expect(ok(s).ok, s).toBe(false);
  });
  it("normal adları yanlışlıkla reddetmez", () => {
    for (const s of ["Samina", "Sinan Bokeoğlu", "Mustafa Kemal", "Akın Çiçek", "Gökhan Güç", "Ece Pişkin", "Osman Gotur"]) expect(ok(s).ok, s).toBe(true);
  });
});

describe("hasProfanity", () => {
  it("harf-rakam değişimini yakalar", () => {
    expect(hasProfanity("s1kt1r")).toBe(true);
    expect(hasProfanity("0r0spu")).toBe(true);
  });
  it("temiz metinde false", () => expect(hasProfanity("Berk Beycan")).toBe(false));
});

describe("cardDisplayName", () => {
  it("kart adı varsa onu, yoksa gerçek adı kullanır", () => {
    expect(cardDisplayName("Mehmet Onur Duman", "Memo")).toBe("Memo");
    expect(cardDisplayName("Mehmet Onur Duman", null)).toBe("Mehmet Onur D.");
    expect(cardDisplayName("Mehmet Onur Duman", "  ")).toBe("Mehmet Onur D.");
  });
});
