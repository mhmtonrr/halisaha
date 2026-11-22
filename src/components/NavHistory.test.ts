import { describe, expect, it } from "vitest";
import { applyNav, backSteps, type Nav } from "./NavHistory";

const start: Nav = { stack: [], idx: -1 };
/** Yeni gezintiler (damgasız girdiler) */
const go = (nav: Nav, ...entries: string[]) => entries.reduce((n, e) => applyNav(n, e, { prev: n.idx }), nav);
/** Geri/ileri: girdinin damgası okunur */
const pop = (nav: Nav, i: number) => applyNav(nav, nav.stack[i], { stamped: i, prev: nav.idx });

describe("geri oku (tarayıcı geçmişi aynası)", () => {
  it("ana sayfa → profil: geri 1 adım ana sayfaya", () => {
    expect(backSteps(go(start, "/", "/profil"), "/profil")).toBe(1);
  });

  it("profilde sekme değiştirince sekmeler atlanır, ana sayfaya döner", () => {
    const nav = go(start, "/", "/profil", "/profil?sekme=istatistik", "/profil?sekme=ayarlar");
    expect(backSteps(nav, "/profil")).toBe(3);
  });

  it("form sayfası atlanır: grup → yeni maç → maç", () => {
    expect(backSteps(go(start, "/g/1", "/g/1/matches/new", "/g/1/m/5"), "/g/1/m/5")).toBe(2);
  });

  it("geri gidince sıra kayar, ileri korunur; yeni gezinti ileriyi keser", () => {
    let nav = pop(go(start, "/", "/profil", "/sosyal"), 1);
    expect(nav.idx).toBe(1);
    nav = pop(nav, 2);
    expect(nav.idx).toBe(2);
    nav = go(pop(nav, 1), "/kesfet");
    expect(nav.stack).toEqual(["/", "/profil", "/kesfet"]);
  });

  it("aynı adrese tekrar gitmek kayıt eklemez (tarayıcı replace yapar)", () => {
    expect(go(start, "/oyuncu/9", "/", "/").stack).toEqual(["/oyuncu/9", "/"]);
  });

  it("bfcache/tam sayfa dönüşünden sonra yeni gezinti doğru yerden keser", () => {
    // [/, /grup-kur, /g/1] → go(-2) ile / (damga 0) → /sohbet
    let nav = pop(go(start, "/", "/grup-kur", "/g/1"), 0);
    nav = go(nav, "/sohbet");
    expect(nav.stack).toEqual(["/", "/sohbet"]);
  });

  it("doğrudan açılan sayfada geçmiş yok → 0 (fallback)", () => {
    expect(backSteps(go(start, "/oyuncu/9"), "/oyuncu/9")).toBe(0);
  });

  it("replace (damga korunur) aynı sıraya yazar", () => {
    const nav = applyNav(go(start, "/profil", "/login"), "/", { stamped: 1, prev: 1 });
    expect(nav.stack).toEqual(["/profil", "/"]);
  });
});
