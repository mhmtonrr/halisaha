"use client";

import { useState } from "react";

/** Profil bağlantısını paylaşır (telefonda paylaşım menüsü, olmazsa panoya kopyalar) */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // paylaşım iptal edildi
    }
  }
  return (
    <button
      type="button"
      onClick={share}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface-high font-display font-bold hover:bg-surface-highest"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      {copied ? "Bağlantı kopyalandı ✓" : "Profili paylaş"}
    </button>
  );
}
