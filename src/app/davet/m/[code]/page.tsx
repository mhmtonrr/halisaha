import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { applyMatch, cancelApplication } from "@/lib/match-manage-actions";
import { feeText, matchWhen, opponentLabel } from "@/lib/match-rules";
import { POSITION_NAME, POSITIONS, type Position } from "@/lib/data";
import { Icon } from "@/components/Icon";
import { TeamBadge } from "@/components/TeamBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { Card, ErrorNote, Header, Input, LinkButton, SectionTitle, cx } from "@/components/ui";

interface ByCode {
  match_id: string;
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  group_color: string | null;
  group_logo: string | null;
  city: string | null;
  district: string | null;
  status: string;
  kind: "internal" | "external";
  played_at: string;
  time_tbd: boolean;
  venue: string | null;
  team_size: number | null;
  capacity: number | null;
  roster_count: number;
  reserve_count: number;
  opponent_name: string | null;
  fee_per_person: number | null;
  pending_rival: string | null;
  note: string | null;
  my_status: string | null;
  is_member: boolean;
  roster: { name: string; position: Position | null; guest: boolean; overall: number | null; photo_url: string | null }[];
}

/**
 * Maç davet bağlantısı (yeniden tasarım 4b): açan kişi başvurmadan maçı ve kadroyu görür (match_by_code),
 * "Başvur" der; maçı ayarlayan onaylar. Davetli/üye/kadrodaki ise maç ekranına yönlenir.
 */
export default async function MatchInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { code } = await params;
  const { error, ok } = await searchParams;
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("match_by_code", { p_code: code });
  const m = data as ByCode | null;
  const back = `/davet/m/${encodeURIComponent(code)}`;

  if (!m) {
    return (
      <main>
        <Header title="Maç daveti" back="/" />
        <Card className="space-y-2 text-center">
          <Icon name="link_off" className="text-[32px] text-muted" />
          <p className="font-semibold">Bu bağlantı geçersiz</p>
          <p className="text-sm text-muted">Bağlantı yenilenmiş ya da maç silinmiş olabilir. Seni çağıran kişiden yeni bağlantı iste.</p>
        </Card>
      </main>
    );
  }

  const open = m.status === "gathering" || m.status === "planned";
  const capacity = m.capacity ?? m.roster_count;
  const missing = Math.max(0, capacity - m.roster_count);
  const matchUrl = `/g/${m.group_id}/m/${m.match_id}`;
  const inside = m.is_member || ["in", "reserve", "invited"].includes(m.my_status ?? "");

  return (
    <main>
      <Header title="Maç daveti" back="/" />
      <ErrorNote message={error} />
      <Card className="mb-4 space-y-3">
        <div className="flex items-center gap-3">
          <TeamBadge id={m.group_id} name={m.group_name} color={m.group_color} logo={m.group_logo} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-bold">{m.group_name}</div>
            <div className="text-xs text-muted">
              {m.group_kind === "team" ? "Takım" : "Grup"}
              {m.city ? ` · ${m.district ? `${m.district}, ` : ""}${m.city}` : ""}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Zaman</dt>
          <dd>{matchWhen(m.played_at, m.time_tbd)}</dd>
          <dt className="text-muted">Saha</dt>
          <dd>{m.venue ?? "Belirtilmedi"}</dd>
          <dt className="text-muted">Maç</dt>
          <dd>
            {m.team_size ? `${m.team_size}v${m.team_size} · ` : ""}
            {m.kind === "external" ? (opponentLabel(m.opponent_name, m.pending_rival) ?? "rakip belli değil") : "kendi aramızda"}
          </dd>
          {m.fee_per_person && (
            <>
              <dt className="text-muted">Ücret</dt>
              <dd>{feeText(m.fee_per_person)}</dd>
            </>
          )}
        </dl>
        {m.note && <p className="rounded-lg bg-pitch-900 px-3 py-2 text-sm text-on-surface-variant">{m.note}</p>}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-display text-xl font-bold tabular-nums">
              {m.roster_count}/{capacity}
            </span>
            <span className={cx("text-sm font-semibold", missing ? "text-amber-300" : "text-primary")}>
              {missing ? `${missing} kişi aranıyor` : "Kadro tamam"}
              {m.reserve_count > 0 && <span className="font-normal text-muted"> · {m.reserve_count} yedek</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-pitch-800">
            <div className={cx("h-full rounded-full", missing ? "bg-amber-400" : "bg-primary")} style={{ width: `${Math.min(100, Math.round((m.roster_count / Math.max(1, capacity)) * 100))}%` }} />
          </div>
        </div>
      </Card>

      {!open ? (
        <Card className="mb-4 text-center text-sm text-muted">Bu maç artık açık değil.</Card>
      ) : inside ? (
        <LinkButton href={matchUrl} className="mb-4 w-full">
          Maça git
        </LinkButton>
      ) : m.my_status === "pending" ? (
        <Card className="mb-4 space-y-2 text-center">
          <p className="font-semibold text-amber-300">{ok ? "Başvurun gönderildi." : "Başvurun onay bekliyor."}</p>
          <p className="text-sm text-muted">Maçı ayarlayan onaylayınca bildirim gelecek. Kadro doluysa yedeğe yazılırsın.</p>
          <form action={cancelApplication}>
            <input type="hidden" name="groupId" value={m.group_id} />
            <input type="hidden" name="matchId" value={m.match_id} />
            <input type="hidden" name="back" value={back} />
            <button className="text-xs text-muted underline">Başvurumu geri çek</button>
          </form>
        </Card>
      ) : m.my_status === "rejected" ? (
        <Card className="mb-4 text-center text-sm text-muted">Bu maça başvurun kabul edilmedi.</Card>
      ) : (
        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Maça katılmak ister misin?</div>
          <p className="text-sm text-muted">
            Başvurunu maçı ayarlayan kişi onaylar. {missing ? "" : "Kadro dolu; onaylanırsan yedeğe yazılırsın. "}
            Başvurun beklerken istatistiklerin ve maç geçmişin karar verecek kişiye görünür.
          </p>
          <form action={applyMatch} className="space-y-2">
            <input type="hidden" name="groupId" value={m.group_id} />
            <input type="hidden" name="matchId" value={m.match_id} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="back" value={back} />
            <div className="flex gap-2">
              <select name="position" aria-label="Mevki" defaultValue="" className="min-h-11 rounded-xl border border-line bg-pitch-950 px-2 text-sm">
                <option value="">Mevki</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POSITION_NAME[p]}
                  </option>
                ))}
              </select>
              <Input name="note" maxLength={200} placeholder="Not (isteğe bağlı)" aria-label="Başvuru notu" className="flex-1" />
            </div>
            <SubmitButton className="w-full" pendingLabel="Gönderiliyor…">
              Başvur
            </SubmitButton>
          </form>
        </Card>
      )}

      <SectionTitle>Kadro · {m.roster.length}</SectionTitle>
      {m.roster.length === 0 ? (
        <p className="px-1 text-sm text-muted">Henüz kimse yok.</p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {m.roster.map((r, i) => (
              <li key={i} className="flex min-h-12 items-center gap-3 px-4 py-2">
                <OvrBadge overall={r.overall ?? 65} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.guest && <span className="text-xs text-muted">misafir</span>}
                <PositionChip position={r.position} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {inside && (
        <p className="mt-4 text-center text-sm">
          <Link href={matchUrl} className="text-accent underline">
            Maça git
          </Link>
        </p>
      )}
    </main>
  );
}
