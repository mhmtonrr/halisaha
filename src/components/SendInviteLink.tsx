import { Icon } from "@/components/Icon";
import Link from "next/link";

const STYLE =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary/40 bg-surface-container px-4 text-sm font-bold transition hover:border-primary";

/** "Maça çağır": maç/çağrı kartını sohbetten bir oyuncuya gönderme sayfasına götürür (maçta kişiye özel davet, 0043) */
export function SendInviteLink({ refId, className = "" }: { refId: string; className?: string }) {
  return (
    <Link href={`/davet/gonder?tur=match&ref=${refId}`} className={`${STYLE} ${className}`}>
      <Icon name="person_add" className="text-[18px]" />
      Maça çağır
    </Link>
  );
}
