"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Geri oku tarayıcının GERÇEK geçmişini kullanır (history.go(-n)); asla ileriye yeni kayıt eklemez.
// Böylece telefonun geri hareketi, tarayıcının geri tuşu ve uygulamadaki ok hep aynı yere gider.
//  * sessionStorage'daki yığın tarayıcı geçmişinin aynasıdır. Her geçmiş girdisinin yığındaki sırası
//    `history.state.__hsIdx` olarak girdinin kendisine damgalanır: geri/ileri, yenileme, bfcache dönüşü, tam sayfa
//    geçişi fark etmez, bulunduğumuz sıra hep girdiden okunur (tahmin yok, kayma yok).
//  * Damgasız girdi = yeni gezinti: önceki sıradan sonrası kesilir, kayıt eklenir. replaceState her zaman aynı girdiyi
//    değiştirdiği için damgayı korur (Next yenileme/server action'da state'i baştan yazar; router.replace de böylece
//    kendiliğinden "aynı sıraya yaz" olur). Adres öncekiyle aynıysa (tarayıcı bunu replace yapar) üstüne yazılır.
//  * Ok, şu anki sayfayla aynı yoldaki kayıtları (sekme/filtre değişimleri) ve form sayfalarını (grup kur, yeni maç…)
//    atlayarak ilk "gerçek" önceki sayfaya kaç adım olduğunu hesaplar ve o kadar geri gider.
//  * Uygulama içinde önceki sayfa yoksa (doğrudan linkle açıldıysa) `fallback` adresine gider.
const KEY = "hs-nav2";
const IDX = "__hsIdx";
const TRANSIENT_PATHS = [
  /^\/(grup-kur|takim-kur|katil|sifre-yenile|hosgeldin|login|auth)(\/|$)/,
  /^\/join\//,
  /^\/g\/[^/]+\/(matches\/new|cagri\/yeni|teklif)$/,
];

export type Nav = { stack: string[]; idx: number };

const pathOf = (entry: string) => entry.split(/[?#]/)[0];
const isTransient = (entry: string) => TRANSIENT_PATHS.some((re) => re.test(pathOf(entry)));

function read(): Nav {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.stack) && typeof v.idx === "number" && v.idx < v.stack.length) return v;
  } catch {
    /* bozuk kayıt: sıfırdan başla */
  }
  return { stack: [], idx: -1 };
}

function write(nav: Nav) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(nav));
  } catch {
    /* depolama kapalıysa geri oku sabit adrese düşer */
  }
}

/** Bu geçmiş girdisine damgalanmış sıra (yoksa undefined) */
function stampedIdx(): number | undefined {
  const v = (window.history.state as Record<string, unknown> | null)?.[IDX];
  return typeof v === "number" ? v : undefined;
}

/** Next'in kendi durumu (__NA) korunarak sıra damgalanır; Next bu replaceState'i yok sayar */
function stamp(i: number) {
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), [IDX]: i }, "", window.location.href);
  } catch {
    /* yok say */
  }
}

/** replaceState aynı girdiyi değiştirir: yeni state'te damga yoksa eskisini taşı (bir kez kurulur) */
let patched = false;
function keepStampOnReplace() {
  if (patched) return;
  patched = true;
  const h = window.history;
  const original = h.replaceState;
  h.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    const cur = stampedIdx();
    if (cur !== undefined && (data == null || (typeof data === "object" && !(IDX in data)))) {
      data = { ...((data as object | null) ?? {}), [IDX]: cur };
    }
    return original.call(h, data, unused, url);
  };
}

/** Geri okun kaç adım geri gideceği: şu anki yoldaki ve form sayfalarındaki kayıtları atlar; hedef yoksa 0 */
export function backSteps(nav: Nav, pathname: string): number {
  for (let i = nav.idx - 1; i >= 0; i--) {
    const e = nav.stack[i];
    if (pathOf(e) === pathname || isTransient(e)) continue;
    return nav.idx - i;
  }
  return 0;
}

/**
 * Bir gezintide aynayı günceller (saf fonksiyon, test edilebilir).
 * `stamped`: girdinin damgası (geri/ileri/yenileme/replace), `prev`: bir önceki girdinin sırası.
 */
export function applyNav(nav: Nav, entry: string, opts: { stamped?: number; prev: number }): Nav {
  if (opts.stamped !== undefined && opts.stamped < nav.stack.length) {
    const stack = nav.stack.slice();
    stack[opts.stamped] = entry;
    return { stack, idx: opts.stamped };
  }
  const prev = Math.min(opts.prev, nav.stack.length - 1);
  const stack = nav.stack.slice(0, prev + 1);
  if (prev >= 0 && stack[prev] === entry) {
    stack[prev] = entry;
    return { stack, idx: prev };
  }
  stack.push(entry);
  return { stack, idx: stack.length - 1 };
}

/** Bu belgede bulunduğumuz sıra (-1: belge yeni açıldı, sessionStorage'daki son sıra geçerli) */
let current = -1;

/** Kök yerleşimde bir kez (Suspense içinde): her yol/sorgu değişiminde aynayı günceller */
export function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = search.toString();

  useEffect(() => {
    keepStampOnReplace();
    // bfcache'ten dönüşte efekt çalışmaz: sırayı girdinin damgasından düzelt
    const onShow = (e: PageTransitionEvent) => {
      const s = stampedIdx();
      if (!e.persisted || s === undefined) return;
      current = s;
      const nav = read();
      if (s < nav.stack.length) write({ stack: nav.stack, idx: s });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(() => {
    keepStampOnReplace();
    const nav = read();
    const entry = (key ? `${pathname}?${key}` : pathname) + window.location.hash;
    const next = applyNav(nav, entry, { stamped: stampedIdx(), prev: current >= 0 ? current : nav.idx });
    if (stampedIdx() !== next.idx) stamp(next.idx);
    current = next.idx;
    write(next);
  }, [pathname, key]);

  return null;
}

/** Geldiği sayfaya döner (gerçek tarayıcı geçmişiyle); uygulama içi geçmiş yoksa `fallback`'e gider */
export function BackLink({ fallback, children, className }: { fallback: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Link
      href={fallback}
      aria-label="Geri"
      className={className ?? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent"}
      onClick={(e) => {
        const nav = read();
        const s = stampedIdx();
        const steps = backSteps(s !== undefined && s < nav.stack.length ? { stack: nav.stack, idx: s } : nav, pathname);
        e.preventDefault();
        if (steps > 0) window.history.go(-steps);
        else router.push(fallback);
      }}
    >
      {children}
    </Link>
  );
}
