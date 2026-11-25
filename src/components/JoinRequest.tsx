import { cancelJoinRequest, requestJoin } from "@/lib/join-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Icon } from "@/components/Icon";
import { Input } from "@/components/ui";

/**
 * Katılma isteği düğmesi (0044): bekleyen istek varsa "Geri al", yoksa isteğe bağlı mesajla "İstek gönder".
 * Keşfet "Gruplar" sekmesi ve üye olmayanın takım sayfası kullanır. `back`: eylemden sonra dönülecek uygulama içi yol.
 */
export function JoinRequest({ groupId, back, pending, isTeam }: { groupId: string; back: string; pending: boolean; isTeam: boolean }) {
  if (pending) {
    return (
      <form action={cancelJoinRequest} className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="back" value={back} />
        <Icon name="hourglass_top" className="text-[18px] text-amber-300" />
        <span className="min-w-0 flex-1 text-sm font-semibold">İsteğin onay bekliyor</span>
        <SubmitButton variant="ghost" className="min-h-8 px-2 text-xs" pendingLabel="…">
          Geri al
        </SubmitButton>
      </form>
    );
  }
  return (
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-bold text-pitch-950 group-open:hidden">
        <Icon name="person_add" className="text-[18px]" />
        Katılma isteği gönder
      </summary>
      <form action={requestJoin} className="space-y-2">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="back" value={back} />
        <Input name="message" maxLength={200} placeholder={`Kısa not (isteğe bağlı): mevki, ne zaman boşsun…`} aria-label="İstek notu" />
        <SubmitButton className="min-h-10 w-full text-sm" pendingLabel="Gönderiliyor…">
          {isTeam ? "Takıma katılma isteği gönder" : "Gruba katılma isteği gönder"}
        </SubmitButton>
      </form>
    </details>
  );
}
