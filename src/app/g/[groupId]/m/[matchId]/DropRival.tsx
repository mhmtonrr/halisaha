import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { dropRival } from "@/lib/match-manage-actions";

/** Kesinleşmemiş bağlı maçta rakibi bırakma (kaptan/yetkili); yanlışlıkla basılmasın diye açılır */
export function DropRival({ groupId, matchId, rivalName }: { groupId: string; matchId: string; rivalName: string }) {
  return (
    <details className="-mt-2 mb-4 rounded-2xl border border-line bg-surface-container">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
        <Icon name="swap_horiz" className="text-[20px]" />
        Rakibi bırak
      </summary>
      <form action={dropRival} className="space-y-2 px-4 pb-4">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="matchId" value={matchId} />
        <p className="text-xs text-muted">
          {rivalName} ile eşleşme biter. Maçın ve kadron kalır, başka rakibe teklif gönderebilirsin; rakibin maçı da rakipsiz devam eder.
        </p>
        <SubmitButton variant="secondary" className="w-full" pendingLabel="Bırakılıyor…">
          Evet, rakibi bırak
        </SubmitButton>
      </form>
    </details>
  );
}
