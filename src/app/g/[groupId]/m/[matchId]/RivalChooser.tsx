"use client";

import { useState } from "react";
import { RivalPicker, type RivalSearch, type RivalTeam } from "@/components/RivalPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { sendChallenge, setOpponent } from "@/lib/match-manage-actions";

/** Maç ekranında rakip seçimi (Maç ayarla ile aynı seçici): uygulamadaki takıma teklif veya rakip adını kaydetme */
export function RivalChooser({ groupId, matchId, opponentName, homeCity }: { groupId: string; matchId: string; opponentName: string | null; homeCity: string }) {
  const [source, setSource] = useState<"app" | "name">(opponentName ? "name" : "app");
  const [team, setTeam] = useState<RivalTeam | null>(null);
  const [name, setName] = useState(opponentName ?? "");
  const [search, setSearch] = useState<RivalSearch>({ q: "", city: homeCity, district: "" });
  const typed = name.trim();

  return (
    <div className="space-y-3">
      <RivalPicker
        groupId={groupId}
        source={source}
        onSource={setSource}
        team={team}
        onTeam={setTeam}
        name={name}
        onName={setName}
        search={search}
        onSearch={setSearch}
        teamHint="Teklif gönderince onayına düşer"
      />
      {(source === "name" || team) && (
        <form action={source === "name" ? setOpponent : sendChallenge}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="matchId" value={matchId} />
          {source === "name" ? <input type="hidden" name="opponent" value={typed} /> : <input type="hidden" name="toGroupId" value={team?.id ?? ""} />}
          <SubmitButton variant="secondary" className="w-full" disabled={source === "name" && typed.length < 2} pendingLabel="…">
            {source === "name" ? "Kaydet" : "Teklif gönder"}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
