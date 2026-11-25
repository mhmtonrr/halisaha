import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, Input, LinkButton } from "@/components/ui";
import { openMatchByCode } from "@/lib/match-manage-actions";

/** Maça katıl: maç davet kodu (veya bağlantısı) girişi ve Keşfet'teki adam arayan maçlar (ana sayfa boşken ve /mac-katil) */
export function JoinMatchCard({ code }: { code?: string }) {
  return (
    <Card className="space-y-4 border-primary/35 bg-gradient-to-br from-primary/10 via-surface-container to-surface-container p-5 text-center">
      <div className="space-y-1">
        <Icon name="sports_soccer" fill className="text-[44px] text-primary" />
        <div className="font-display text-2xl font-bold">Maça katıl</div>
        <p className="text-sm text-on-surface-variant">Sana gönderilen maç davet kodunu ya da bağlantısını yaz.</p>
      </div>
      <form action={openMatchByCode} className="space-y-2">
        <Input name="code" defaultValue={code} required maxLength={200} placeholder="Davet kodu" aria-label="Maç davet kodu" autoComplete="off" autoCapitalize="characters" className="text-center" />
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
