"use client";

import { useActionState, useRef } from "react";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, Input, LinkButton } from "@/components/ui";
import { openMatchByCode, type JoinMatchState } from "@/lib/match-manage-actions";

/** Maça katıl: maç davet kodu (veya bağlantısı) girişi ve Keşfet'teki adam arayan maçlar (ana sayfa boşken kart olarak, doluyken açılır pencerede) */
export function JoinMatchCard() {
  const [state, action] = useActionState<JoinMatchState, FormData>(openMatchByCode, {});
  return (
    <Card className="space-y-4 border-primary/35 bg-gradient-to-br from-primary/10 via-surface-container to-surface-container p-5 text-center">
      <div className="space-y-1">
        <Icon name="sports_soccer" fill className="text-[44px] text-primary" />
        <div className="font-display text-2xl font-bold">Maça katıl</div>
        <p className="text-sm text-on-surface-variant">Sana gönderilen maç davet kodunu ya da bağlantısını yaz.</p>
      </div>
      <form action={action} key={state.at ?? 0} className="space-y-2">
        <Input name="code" defaultValue={state.code} required maxLength={200} placeholder="Davet kodu" aria-label="Maç davet kodu" autoComplete="off" autoCapitalize="characters" className="text-center" />
        {state.error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-error">{state.error}</p>}
        <SubmitButton className="w-full" pendingLabel="Aranıyor…">
          Maçı bul
        </SubmitButton>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        veya
        <span className="h-px flex-1 bg-line" />
      </div>
      <LinkButton href="/kesfet?sekme=mac" variant="secondary" className="w-full">
        Adam arayan maçlara bak
      </LinkButton>
    </Card>
  );
}

/** "Yaklaşan maçlar" başlığındaki "Maça katıl" düğmesi: kartı açılır pencerede gösterir */
export function JoinMatchPopup() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="flex min-h-8 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-primary/40 px-2.5 text-[11px] font-bold text-primary">
        <Icon name="add" className="!text-[14px]" />
        Maça katıl
      </button>
      {/* Dışına (karartmaya) dokununca da kapanır */}
      <dialog
        ref={ref}
        aria-label="Maça katıl"
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-pitch-950 p-0 text-on-surface backdrop:bg-black/70"
      >
        <div className="relative">
          <button type="button" onClick={() => ref.current?.close()} aria-label="Kapat" className="absolute right-2 top-2 flex min-h-10 min-w-10 items-center justify-center text-muted">
            <Icon name="close" className="text-[22px]" />
          </button>
          <JoinMatchCard />
        </div>
      </dialog>
    </>
  );
}
