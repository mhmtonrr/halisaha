import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { applyListing, withdrawApplication } from "@/lib/actions";
import { formatDate, getGroupPlayers, isSquadMember, POSITIONS, POSITION_NAME, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { teamRating } from "@/lib/teams-data";
import { APPLICATION_STATUS, LISTING_STATUS, getListing, getMyApplication } from "@/lib/listings-data";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ShareLink } from "@/components/ShareLink";
import { SendInviteLink } from "@/components/SendInviteLink";
import { SubmitButton } from "@/components/SubmitButton";
import { PushPrompt } from "@/components/PushControls";
import { TeamBadge } from "@/components/TeamBadge";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { Badge, Card, ErrorNote, Header, Label, LinkButton } from "@/components/ui";

/** Herkese açık oyuncu ilanı: takım, maç bilgisi, aranan mevkiler ve başvuru */
export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { listingId } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();

  const listing = await getListing(supabase, listingId);
  if (!listing) notFound();

  const [myApp, { data: myRating }, { data: isAdmin }, { data: isMember }, players, { data: profile }] = await Promise.all([
    getMyApplication(supabase, listingId, user.id),
    supabase.rpc("my_rating"),
    supabase.rpc("is_group_admin", { p_group_id: listing.groupId }),
    supabase.rpc("is_group_member", { p_group_id: listing.groupId }),
    getGroupPlayers(supabase, listing.groupId),
    supabase.from("profiles").select("preferred_position").eq("id", user.id).single(),
  ]);

  const rating = (myRating as number | null) ?? 65;
  const squad = players.filter(isSquadMember);
  const status = LISTING_STATUS[listing.status];
  const matchOpen = listing.matchStatus === "planned" && new Date(listing.playedAt).getTime() > Date.now();
  const canApply = listing.status === "open" && matchOpen && !isMember && (!myApp || myApp.status === "withdrawn");
  const belowMin = listing.minOverall !== null && rating < listing.minOverall;
  const defaultPosition = (listing.positions.find((p) => p === profile?.preferred_position) ?? profile?.preferred_position ?? "") as Position | "";

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "player_listings", filter: `id=eq.${listingId}` },
          { table: "listing_applications", filter: `listing_id=eq.${listingId}` },
        ]}
      />
      <Header title="Oyuncu ilanı" back="/kesfet" right={<Badge tone={status.tone}>{status.label}</Badge>} />
      <ErrorNote message={error} />

      <Link href={`/g/${listing.groupId}`}>
        <Card className="mb-4 flex items-center gap-3 transition hover:border-accent/50">
          <TeamBadge name={listing.team.name} color={listing.team.color} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{listing.team.name}</div>
            <div className="truncate text-xs text-muted">{formatRegion(listing.team.city ?? "", listing.team.district)} · {squad.length} oyuncu</div>
          </div>
          <OvrBadge overall={teamRating(squad.map((p) => p.overall))} />
        </Card>
      </Link>

      <Card className="mb-4 space-y-3">
        <div className="text-2xl font-black">{listing.needed} oyuncu aranıyor</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Maç</dt>
          <dd>{formatDate(listing.playedAt)}</dd>
          <dt className="text-muted">Saha</dt>
          <dd>{listing.venue ?? "Belirtilmedi"}</dd>
          {listing.teamSize && (
            <>
              <dt className="text-muted">Kişi</dt>
              <dd>
                {listing.teamSize} kişilik ({listing.teamSize}v{listing.teamSize})
              </dd>
            </>
          )}
          {listing.minOverall && (
            <>
              <dt className="text-muted">Min. rating</dt>
              <dd>{listing.minOverall}</dd>
            </>
          )}
        </dl>
        {listing.positions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted">Aranan mevki:</span>
            {listing.positions.map((p) => (
              <PositionChip key={p} position={p} />
            ))}
          </div>
        )}
        {listing.note && <p className="rounded-lg bg-pitch-950 p-3 text-sm">“{listing.note}”</p>}
        <ShareLink path={`/ilan/${listing.id}`} title={`${listing.team.name}: oyuncu arıyoruz`} />
        {isAdmin && listing.status === "open" && matchOpen && <SendInviteLink tur="listing" refId={listing.id} />}
      </Card>

      {myApp?.status === "pending" && <PushPrompt reason="Başvurun yanıtlanınca haber verelim mi?" />}
      {isMember ? (
        <Card className="space-y-2 text-center text-sm text-muted">
          <p>Bu takımın oyuncususun.</p>
          {isAdmin && (
            <LinkButton href={`/g/${listing.groupId}/m/${listing.matchId}`} className="w-full">
              Başvuruları yönet ›
            </LinkButton>
          )}
        </Card>
      ) : myApp && myApp.status !== "withdrawn" ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Başvurun</span>
            <Badge tone={APPLICATION_STATUS[myApp.status].tone}>{APPLICATION_STATUS[myApp.status].label}</Badge>
          </div>
          {myApp.status === "accepted" && (
            <LinkButton href={`/g/${listing.groupId}/m/${listing.matchId}`} className="w-full">
              Maç ekranına git ›
            </LinkButton>
          )}
          {myApp.status === "pending" && (
            <>
              <p className="text-sm text-muted">Kaptan başvurunu inceliyor. Yanıt gelince bu sayfa ve ana sayfan kendiliğinden güncellenir.</p>
              <form action={withdrawApplication}>
                <input type="hidden" name="listingId" value={listingId} />
                <SubmitButton variant="secondary" className="w-full" pendingLabel="Geri çekiliyor…">
                  Başvuruyu geri çek
                </SubmitButton>
              </form>
            </>
          )}
          {myApp.status === "rejected" && <p className="text-sm text-muted">Bu ilan için başvurun kabul edilmedi.</p>}
        </Card>
      ) : !canApply ? (
        <Card className="text-center text-sm text-muted">
          {listing.status === "filled" ? "Bu ilandaki oyuncular tamamlandı." : "Bu ilan artık başvuruya kapalı."}
        </Card>
      ) : (
        <form action={applyListing} className="space-y-3">
          <input type="hidden" name="listingId" value={listingId} />
          <Card className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <OvrBadge overall={rating} />
              <span className="text-muted">Senin ratingin. Kaptan başvurunu bu rating, mevkin ve güvenilirliğinle görür.</span>
            </div>
            {belowMin && (
              <p className="rounded-lg bg-red-950/50 p-3 text-sm text-red-300">
                Bu ilan için en az {listing.minOverall} rating gerekiyor, seninki {rating}.
              </p>
            )}
            <label className="block">
              <Label>Hangi mevkide oynarsın?</Label>
              <select
                name="position"
                defaultValue={defaultPosition}
                className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm"
              >
                <option value="">Fark etmez</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POSITION_NAME[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Not</Label>
              <textarea
                name="note"
                maxLength={200}
                rows={2}
                placeholder="Örn. O gün müsaitim, kendi kramponum var."
                className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </label>
          </Card>
          <SubmitButton className="w-full" disabled={belowMin} pendingLabel="Başvuru gönderiliyor…">
            Başvur
          </SubmitButton>
          <p className="text-center text-xs text-muted">
            Kabul edilirsen sadece bu maçın kadrosuna ödünç oyuncu olarak girersin; takımın asıl kadrosuna girmezsin.
          </p>
        </form>
      )}
    </main>
  );
}
