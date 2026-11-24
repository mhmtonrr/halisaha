import Link from "next/link";
import type { ReactNode } from "react";
import type { Position } from "@/lib/data";
import type { Responder } from "@/lib/call-rules";
import type { PollGuest } from "@/lib/calls-data";
import { reliability } from "@/lib/reliability";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";

const TONE = { good: "text-accent", ok: "text-amber-300", bad: "text-red-300", new: "text-muted" } as const;

/** Üye olmayan yanıtlayanın kökeni (0041): çağrı kartıyla çağrılan veya herkese açık aramadan gelen */
export type ResponderOrigin = "invited" | "outside";
const ORIGIN = {
  invited: { label: "davetli", title: "Grubun üyesi değil; çağrı kartıyla çağrıldı. Seçilirse bu maça ödünç oyuncu olarak yazılır." },
  outside: { label: "dışarıdan", title: "Grubun üyesi değil; herkese açık aramadan başvurdu. Alınırsa bu maça ödünç oyuncu olarak yazılır." },
} as const;

/** Yanıtlayan satırı: organizatöre güvenilirlik ve üye olmayanın kökeni de görünür (played/no_shows sadece ona gelir) */
export function ResponderRow({ r, origin, children }: { r: Responder; origin?: ResponderOrigin; children?: ReactNode }) {
  const rel = r.played != null && r.no_shows != null ? reliability(r.played, r.no_shows) : null;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <OvrBadge overall={r.overall} className="h-8 w-8 text-xs" />
        <div className="min-w-0 flex-1">
          {/* İsim tek başına tam genişlikte; mevki, köken ve güvenilirlik altta (dar ekranda isim kısalmasın) */}
          <Link href={`/oyuncu/${r.user_id}`} className="block truncate hover:underline">
            {r.display_name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            <PositionChip position={(r.chosen_position ?? r.preferred_position) as Position | null} />
            {origin && (
              <span title={ORIGIN[origin].title} className="shrink-0 rounded-full border border-primary/50 px-1.5 text-[10px] font-semibold text-primary">
                {ORIGIN[origin].label}
              </span>
            )}
            {rel && <span className={TONE[rel.tone]}>{rel.label}</span>}
          </div>
        </div>
        {children}
      </div>
      {r.note && <p className="mt-1.5 rounded-lg bg-pitch-950 px-2 py-1 text-xs text-muted">“{r.note}”</p>}
    </li>
  );
}

/** Organizatörün eklediği dışarıdan misafir satırı (hesabı yok; profil bağlantısı ve puanı yok) */
export function GuestRow({ g, children }: { g: PollGuest; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-xs text-muted">M</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate">{g.name}</span>
        <PositionChip position={g.position as Position | null} />
        <span className="text-xs text-muted">misafir</span>
      </div>
      {children}
    </li>
  );
}
