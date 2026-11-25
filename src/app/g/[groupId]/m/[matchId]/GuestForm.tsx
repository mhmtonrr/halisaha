"use client";

import { useActionState } from "react";
import { addGuestToMatch, type GuestState } from "@/lib/actions";
import { Button, Input } from "@/components/ui";
import { POSITIONS, POSITION_NAME } from "@/lib/data";

/**
 * Maça misafir oyuncu ekleme: yönlendirme yok, sayfa kaldığı yerde kalır; kadro yerinde güncellenir.
 * Başarıda form temizlenir (anahtar değişir), hatada yazılan isim korunur.
 */
export function GuestForm({ groupId, matchId }: { groupId: string; matchId: string }) {
  const [state, action, pending] = useActionState<GuestState, FormData>(addGuestToMatch, {});
  return (
    <form action={action} key={state.at ?? 0} className="space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      <p className="text-xs text-muted">Uygulamayı kullanmayan oyuncu doğrudan kadroya yazılır. Maç sonunda oylanır ama oy veremez.</p>
      <Input name="name" placeholder="İsim" required minLength={2} maxLength={60} defaultValue={state.error ? state.name : ""} />
      <div className="flex gap-2">
        <select
          name="position"
          defaultValue=""
          className="min-h-11 rounded-xl border border-line bg-pitch-950 px-2 text-sm"
          aria-label="Mevki"
        >
          <option value="">Mevki —</option>
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {POSITION_NAME[pos]}
            </option>
          ))}
        </select>
        <Button variant="secondary" className="flex-1" disabled={pending}>
          {pending ? "Ekleniyor…" : "Misafiri ekle"}
        </Button>
      </div>
      {state.error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{state.added} kadroya eklendi</p>}
    </form>
  );
}
