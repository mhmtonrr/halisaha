"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Uygulama içi gezinti geçmişi (sekme başına, sessionStorage). Geri oku sabit bir üst sayfa yerine
// kullanıcının geldiği bir önceki sayfaya götürür.
//  * Kayıtlar yol + sorgu (?sekme=…) olarak tutulur, geri dönünce aynı sekme/filtre açılır. Geçici sorgular (?error= …) tutulmaz.
//  * Karşılaştırma yola göre yapılır (aynı sayfada sorgu değişimi yeni kayıt açmaz, mevcut kaydı günceller).
//  * Form/oluşturma sayfaları (grup kur, yeni maç…) geri hedefi olmaz: formu gönderip yönlendirilince geri ok formu değil önceki sayfayı açar.
//  * Geri okuyla dönüşte yığın hedefe kadar kesilir (aksi halde geçmiş şişer ve ileri-geri döngüsü oluşur).
const KEY = "hs-nav";
const BACK_KEY = "hs-nav-back";
const MAX = 40;
const TRANSIENT_PARAMS = ["error", "davet", "voted", "ok", "hata"];
const TRANSIENT_PATHS = [
  /^\/(grup-kur|takim-kur|katil|sifre-yenile|hosgeldin|login|auth)(\/|$)/,
  /^\/join\//,
  /^\/g\/[^/]+\/(matches\/new|cagri\/yeni|teklif)$/,
];

const pathOf = (entry: string) => entry.split("?")[0];
const isTransient = (entry: string) => TRANSIENT_PATHS.some((re) => re.test(pathOf(entry)));

function entryOf(pathname: string, search: URLSearchParams | string) {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  for (const k of TRANSIENT_PARAMS) params.delete(k);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

function read(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    /* depolama kapalıysa geri oku sabit adrese düşer */
  }
}

/** Geri okun gideceği kayıt: şu anki sayfadan ve form sayfalarından önceki ilk kayıt */
function backTarget(stack: string[], pathname: string): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = pathOf(stack[i]);
    if (p === pathname || isTransient(stack[i])) continue;
    return stack[i];
  }
  return undefined;
}

/** Kök yerleşimde bir kez (Suspense içinde): her yol/sorgu değişiminde geçmişi günceller */
export function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = search.toString();
  useEffect(() => {
    const entry = entryOf(pathname, key);
    const stack = read();
    let backTo: string | null = null;
    try {
      backTo = sessionStorage.getItem(BACK_KEY);
      sessionStorage.removeItem(BACK_KEY);
    } catch {
      /* yok say */
    }
    const last = stack[stack.length - 1];
    if (last !== undefined && pathOf(last) === pathname) {
      stack[stack.length - 1] = entry; // aynı sayfa: sorgu değişimi/yenileme
    } else if (backTo === pathname) {
      // Geri okuyla döndük: hedefe kadar kes
      let idx = -1;
      for (let i = stack.length - 2; i >= 0; i--) if (pathOf(stack[i]) === pathname) { idx = i; break; }
      if (idx >= 0) { stack.length = idx + 1; stack[idx] = entry; } else stack.push(entry);
    } else if (stack.length >= 2 && pathOf(stack[stack.length - 2]) === pathname) {
      stack.pop(); // tarayıcı/hareket ile geri gidildi
      stack[stack.length - 1] = entry;
    } else {
      stack.push(entry);
    }
    write(stack);
  }, [pathname, key]);
  return null;
}

/** Geldiği sayfaya döner; geçmiş yoksa (doğrudan linkle açıldıysa) `fallback`'e gider */
export function BackLink({ fallback, children, className }: { fallback: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Link
      href={fallback}
      aria-label="Geri"
      className={className ?? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent"}
      onClick={(e) => {
        const target = backTarget(read(), pathname);
        if (target) {
          e.preventDefault();
          try {
            sessionStorage.setItem(BACK_KEY, pathOf(target));
          } catch {
            /* yok say */
          }
          router.push(target);
        }
      }}
    >
      {children}
    </Link>
  );
}
