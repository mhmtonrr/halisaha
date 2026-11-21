"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { formatInviteCode } from "@/lib/invite";

/** Davet: elle yazılabilen kod ve paylaşılabilen link yan yana */
export function InviteLink({ code, groupName, isTeam }: { code: string; groupName: string; isTeam: boolean }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/join/${code}`;
  const pretty = formatInviteCode(code);

  async function copy(what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(what === "code" ? pretty : url);
    } catch {
      window.prompt("Kopyala:", what === "code" ? pretty : url);
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  async function share() {
    const text = `${groupName} ${isTeam ? "takımına" : "grubuna"} katıl: ${url}\nYa da uygulamada "${isTeam ? "Takıma" : "Gruba"} katıl" > davet kodu: ${pretty}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: groupName, text });
        return;
      } catch {
        // kullanıcı vazgeçti; kopyalamaya düş
      }
    }
    await copy("link");
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Davet kodu</div>
        <div className="flex items-center gap-2">
          <code
            data-testid="invite-code"
            className="min-w-0 flex-1 truncate rounded-lg bg-pitch-950 px-3 py-2 text-center text-xl font-black tracking-widest"
          >
            {pretty}
          </code>
          <Button variant="secondary" type="button" onClick={() => copy("code")}>
            {copied === "code" ? "Kopyalandı ✓" : "Kopyala"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Oyuncular ana sayfadaki &quot;{isTeam ? "Takıma" : "Gruba"} katıl&quot; bölümüne bu kodu yazarak girer.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-pitch-950 px-3 py-2 text-xs text-muted">{url}</code>
        <Button variant="secondary" onClick={share} type="button">
          {copied === "link" ? "Kopyalandı ✓" : "Paylaş"}
        </Button>
      </div>
    </div>
  );
}
