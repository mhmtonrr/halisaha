"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Uygulama içi gezinti geçmişi (sekme başına, sessionStorage). Geri oku sabit bir üst sayfa yerine
// kullanıcının geldiği bir önceki farklı sayfaya götürür. Form gönderimleri aynı sayfaya
// (?error=, ?voted=) yönlendirdiği için sadece yol (pathname) karşılaştırılır.
const KEY = "hs-nav";
const MAX = 40;

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

/** Kök yerleşimde bir kez: her yol değişiminde geçmişi günceller */
export function NavTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const stack = read();
    const last = stack[stack.length - 1];
    if (last === pathname) return; // aynı sayfa (sorgu değişimi, yenileme)
    if (stack[stack.length - 2] === pathname) stack.pop(); // kullanıcı geri gitti
    else stack.push(pathname);
    write(stack);
  }, [pathname]);
  return null;
}

/** Geldiği sayfaya döner; geçmiş yoksa (doğrudan linkle açıldıysa) `fallback`'e gider */
export function BackLink({ fallback, children }: { fallback: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Link
      href={fallback}
      aria-label="Geri"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent"
      onClick={(e) => {
        const stack = read();
        // Üstteki kayıt şu anki sayfa olmalı; bir öncekine dön
        const prev = stack[stack.length - 1] === pathname ? stack[stack.length - 2] : undefined;
        if (prev && prev !== pathname) {
          e.preventDefault();
          router.push(prev);
        }
      }}
    >
      {children}
    </Link>
  );
}
