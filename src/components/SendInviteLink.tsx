import Link from "next/link";

/** Kaptan/yetkili veya maçı/çağrıyı açan için: maç/çağrı kartını sohbetten bir oyuncuya/arkadaşa gönderme sayfasına götürür */
export function SendInviteLink({ tur, refId, className = "" }: { tur: "poll" | "match"; refId: string; className?: string }) {
  return (
    <Link
      href={`/davet/gonder?tur=${tur}&ref=${refId}`}
      className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-pitch-900 px-4 text-sm font-bold transition hover:border-accent ${className}`}
    >
      💬 Sohbetten davet et
    </Link>
  );
}
