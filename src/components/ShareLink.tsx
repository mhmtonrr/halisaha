"use client";

import { useState } from "react";

/** Sayfa linkini paylaşır (telefonda paylaşım menüsü, olmayan yerde panoya kopyalar) */
export function ShareLink({ path, title, className }: { path: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url });
        return;
      }
    } catch {
      // Kullanıcı paylaşımı kapattıysa sessizce panoya kopyalamaya düş
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Linki kopyala:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={className ?? "rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:bg-pitch-800 hover:text-white"}
    >
      {copied ? "Link kopyalandı ✓" : "🔗 Paylaş"}
    </button>
  );
}
