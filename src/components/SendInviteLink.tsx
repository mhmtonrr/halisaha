import { Icon } from "@/components/Icon";
import Link from "next/link";
import { inviteToMatch } from "@/lib/call-actions";

const STYLE =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary/40 bg-surface-container px-4 text-sm font-bold transition hover:border-primary";

/** "Maça çağır": çağrı kartını sohbetten bir oyuncuya gönderme sayfasına götürür; alıcı üye olmasa da çağrıyı görüp yanıt verir */
export function SendInviteLink({ tur, refId, className = "" }: { tur: "poll" | "match"; refId: string; className?: string }) {
  return (
    <Link href={`/davet/gonder?tur=${tur}&ref=${refId}`} className={`${STYLE} ${className}`}>
      <Icon name="person_add" className="text-[18px]" />
      Maça çağır
    </Link>
  );
}

/** Maç ekranında "Maça çağır": açık adam aramaya (yoksa 1 kişilik açılır) davet gönderme sayfasına gider */
export function InviteToMatchButton({ groupId, matchId, className = "" }: { groupId: string; matchId: string; className?: string }) {
  return (
    <form action={inviteToMatch} className={className}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      <button className={STYLE}>
        <Icon name="person_add" className="text-[18px]" />
        Maça çağır
      </button>
    </form>
  );
}
