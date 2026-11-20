"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

export function InviteLink({ code, groupName }: { code: string; groupName: string }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/join/${code}`;

  async function share() {
    const text = `${groupName} grubuna katıl: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: groupName, text, url });
        return;
      } catch {
        // kullanıcı vazgeçti; kopyalamaya düş
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-pitch-950 px-3 py-2 text-xs text-muted">{url}</code>
      <Button variant="secondary" onClick={share} type="button">
        {copied ? "Kopyalandı ✓" : "Paylaş"}
      </Button>
    </div>
  );
}
