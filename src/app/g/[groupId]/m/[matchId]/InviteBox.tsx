"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { ShareLink } from "@/components/ShareLink";
import { regenerateMatchCode } from "@/lib/match-manage-actions";

/** Maç davet bağlantısı: paylaş, bağlantı kutusu (sağında kopyala), davet kodu ve açıklama */
export function InviteBox({ groupId, matchId, code }: { groupId: string; matchId: string; code: string }) {
  const path = `/davet/m/${code}`;
  // Sunucuda alan adı bilinmez; tarayıcıda tam adrese tamamlanır
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}${path}`), [path]);

  async function copy() {
    const full = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Linki kopyala:", full);
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm font-semibold">Davet bağlantısı</div>
        <form action={regenerateMatchCode} className="flex">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="matchId" value={matchId} />
          <button className="flex min-h-9 min-w-9 items-center justify-center text-muted" aria-label="Bağlantıyı yenile" title="Bağlantıyı yenile (eskisi geçersiz olur)">
            <Icon name="refresh" className="text-[20px]" />
          </button>
        </form>
        <ShareLink path={path} title="Maça gel" label="Paylaş" className="min-h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-bold text-pitch-950" />
      </div>
      <div className="flex items-center rounded-xl border border-line bg-pitch-950 pl-3">
        <span className="min-w-0 flex-1 select-all truncate text-sm text-on-surface-variant">{url}</span>
        <button type="button" onClick={copy} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted" aria-label="Bağlantıyı kopyala">
          <Icon name={copied ? "check" : "content_copy"} className={copied ? "text-[20px] text-primary" : "text-[20px]"} />
        </button>
      </div>
      <p className="text-sm">
        Davet kodu: <b className="tracking-wider">{code}</b>
      </p>
      <p className="text-xs text-muted">Bağlantıyı açan kişi kadroyu görür ve başvurur; sen onaylarsın.</p>
    </div>
  );
}
