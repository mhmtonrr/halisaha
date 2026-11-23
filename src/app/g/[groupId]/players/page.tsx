import { LiveRefresh } from "@/components/LiveRefresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { claimGuest, deleteGroup, disbandTeam, inviteToGroup, leaveGroup, openDm, removePlayer, setMemberRole, setPosition, updateTeam } from "@/lib/actions";
import { getGroupSummaries, isGuestLike, isSquadMember, type Position } from "@/lib/data";
import { ROLE_LABEL, type GroupKind, type Role } from "@/lib/teams-data";
import { Badge, Button, Card, ErrorNote, Header, SectionTitle } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { TeamFields } from "@/components/TeamFields";

const POSITION_OPTIONS: { value: Position | ""; label: string }[] = [
  { value: "", label: "Mevki yok" },
  { value: "GK", label: "Kaleci" },
  { value: "DEF", label: "Defans" },
  { value: "MID", label: "Orta saha" },
  { value: "FWD", label: "Forvet" },
];

function PositionSelect({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className="min-h-11 rounded-xl border border-line bg-pitch-950 px-2 text-sm">
      {POSITION_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RoleButton({ groupId, playerId, role, children, danger }: { groupId: string; playerId: string; role: Role; children: React.ReactNode; danger?: boolean }) {
  return (
    <form action={setMemberRole}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="role" value={role} />
      <button
        className={
          "rounded-lg px-2 py-1 text-xs " +
          (danger ? "text-amber-300 hover:bg-amber-400/10" : "text-accent hover:bg-accent/10")
        }
      >
        {children}
      </button>
    </form>
  );
}

const ROLE_ORDER: Record<Role, number> = { captain: 0, admin: 1, organizer: 2, member: 3 };

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; davet?: string }>;
}) {
  const { groupId } = await params;
  const { error, saved, davet } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, kind, city, district, color, description, archived_at")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();
  const kind = group.kind as GroupKind;
  const isTeam = kind === "team";
  const labels = ROLE_LABEL[kind];

  const players = await getGroupSummaries(supabase, groupId);
  const me = players.find((p) => p.user_id === user.id && !p.is_loan);
  const myRole = me?.role as Role | undefined;
  const isCaptain = myRole === "captain";
  const canManage = isCaptain || myRole === "admin";
  const guests = players.filter(isGuestLike);
  // Misafir geçmişi sadece henüz maçı olmayan üyelere aktarılabilir
  const claimable = players.filter((p) => isSquadMember(p) && p.totals.played === 0);
  const squadCount = players.filter(isSquadMember).length;
  const sorted = players.filter(isSquadMember).sort(
    (a, b) => ROLE_ORDER[a.role as Role] - ROLE_ORDER[b.role as Role] || a.display_name.localeCompare(b.display_name, "tr"),
  );

  /** Bu oyuncuyu ben çıkarabilir miyim? (veritabanı kuralıyla aynı) */
  const canRemove = (p: (typeof players)[number]) =>
    canManage && p.id !== me?.id && p.role !== "captain" && (p.role === "member" || p.role === "organizer" || isCaptain) && (!!p.user_id || p.totals.played === 0);

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "group_players", filter: `group_id=eq.${groupId}` },
        ]}
      />
      <Header title={canManage ? (isTeam ? "Takımı yönet" : "Grubu yönet") : isTeam ? "Oyuncular" : "Üyeler"} back={`/g/${groupId}`} />
      <ErrorNote message={error} />
      {saved && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Kaydedildi ✓</p>}
      {davet && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Takım daveti gönderildi ✓ Kabul edince asıl kadroya geçer.</p>}

      <Card className="mb-4 text-sm text-muted">
        <b className="text-white">{labels.captain}</b> rolleri yönetir ve {isTeam ? "kaptanlığı" : "kuruculuğu"} devredebilir.{" "}
        <b className="text-white">{labels.admin}</b>ler maç kurar, tüm maçları ve üyeleri yönetir (mevki, çıkarma).{" "}
        <b className="text-white">{labels.organizer}</b>ler maç ve maç çağrısı açar, sadece kendi kurduğu maçı yönetir (kadro, misafir, sonuç); üyelere dokunamaz.{" "}
        <b className="text-white">{labels.member}</b>ler oynar ve oy verir.
      </Card>

      <Card className="p-0">
        <ul className="divide-y divide-line">
          {sorted.map((p) => {
            const role = p.role as Role;
            return (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <OvrBadge overall={p.overall} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <Link href={`/g/${groupId}/p/${p.id}`} className="truncate hover:underline">
                        {p.display_name}
                      </Link>{" "}
                      <PositionChip position={p.position} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {role !== "member" && <Badge tone={role === "captain" ? "warn" : "accent"}>{labels[role]}</Badge>}
                      <span className="text-xs text-muted">{p.totals.played} maç</span>
                    </div>
                  </div>
                  {p.user_id && p.id !== me?.id && (
                    <form action={openDm}>
                      <input type="hidden" name="userId" value={p.user_id} />
                      <button aria-label={`${p.display_name} ile mesajlaş`} className="rounded-lg bg-pitch-800 px-2.5 py-1.5 text-sm hover:text-accent">
                        💬
                      </button>
                    </form>
                  )}
                  {canRemove(p) && (
                    <form action={removePlayer}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="playerId" value={p.id} />
                      <button className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-red-950 hover:text-red-300">Çıkar</button>
                    </form>
                  )}
                </div>
                {isCaptain && p.user_id && p.id !== me?.id && (
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    {role !== "organizer" && role !== "captain" && (
                      <RoleButton groupId={groupId} playerId={p.id} role="organizer">
                        {labels.organizer} yap
                      </RoleButton>
                    )}
                    {role !== "admin" && role !== "captain" && (
                      <RoleButton groupId={groupId} playerId={p.id} role="admin">
                        {labels.admin} yap
                      </RoleButton>
                    )}
                    {(role === "admin" || role === "organizer") && (
                      <RoleButton groupId={groupId} playerId={p.id} role="member" danger>
                        Yetkiyi al
                      </RoleButton>
                    )}
                    {role !== "captain" && (
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-xs text-muted hover:bg-pitch-800">
                          {isTeam ? "Kaptanlığı devret" : "Kuruculuğu devret"}…
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-60 rounded-xl border border-line bg-pitch-900 p-3 text-xs shadow-xl">
                          <p className="mb-2 text-muted">
                            {p.display_name} {labels.captain.toLocaleLowerCase("tr")} olacak, sen {labels.admin.toLocaleLowerCase("tr")} olacaksın. Geri alamazsın.
                          </p>
                          <RoleButton groupId={groupId} playerId={p.id} role="captain" danger>
                            Evet, devret
                          </RoleButton>
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {guests.length > 0 && (
        <>
          <SectionTitle>Misafirler · {guests.length}</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {guests.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <OvrBadge overall={p.overall} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <Link href={`/g/${groupId}/p/${p.id}`} className="truncate hover:underline">
                        {p.display_name}
                      </Link>{" "}
                      <PositionChip position={p.position} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <Badge>{p.is_loan ? "Ödünç" : "Misafir"}</Badge>
                      <span className="text-xs text-muted">
                        {p.totals.played} maç · {p.totals.goals} gol · {p.totals.assists} asist
                      </span>
                    </div>
                  </div>
                  {canManage && isTeam && p.is_loan && p.user_id && (
                    // Ödünç oynamış oyuncuyu takıma davet et (kabul edince asıl kadroya geçer)
                    <form action={inviteToGroup}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="userId" value={p.user_id} />
                      <input type="hidden" name="back" value={`/g/${groupId}/players`} />
                      <button className="rounded-lg border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10">Takıma davet et</button>
                    </form>
                  )}
                  {canRemove(p) && (
                    <form action={removePlayer}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="playerId" value={p.id} />
                      <button className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-red-950 hover:text-red-300">Çıkar</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-center text-xs text-muted">
            Misafirler asıl kadroya, takım puanına ve sıralamalara girmez; maça gelince kadroya eklenirler.
          </p>
        </>
      )}

      {canManage && (
        <>
          <SectionTitle>{isTeam ? "Takım bilgileri" : "Grup bilgileri"}</SectionTitle>
          <form action={updateTeam} className="space-y-3">
            <input type="hidden" name="groupId" value={groupId} />
            <Card className="space-y-4">
              <TeamFields values={group} kind={kind} />
            </Card>
            <Button variant="secondary" className="w-full">
              Kaydet
            </Button>
          </form>
        </>
      )}

      {canManage && (
        <>
          {guests.length > 0 && (
            <>
              <SectionTitle>Misafirlerin mevkisi</SectionTitle>
              <Card className="space-y-2">
                {guests.map((g) => (
                  <form key={g.id} action={setPosition} className="flex items-center gap-2">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="playerId" value={g.id} />
                    <span className="min-w-0 flex-1 truncate text-sm">{g.display_name}</span>
                    <PositionSelect name="position" defaultValue={g.position} />
                    <Button variant="secondary">Kaydet</Button>
                  </form>
                ))}
              </Card>
            </>
          )}

          {guests.length > 0 && claimable.length > 0 && (
            <>
              <SectionTitle>Misafir geçmişini aktar</SectionTitle>
              <Card>
                <p className="mb-3 text-sm text-muted">
                  Misafir sonradan katıldıysa, misafir kaydındaki maçlarını ve puanlarını onun hesabına aktar.
                </p>
                <form action={claimGuest} className="space-y-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <select name="guestId" className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-2 text-sm">
                    {guests.map((g) => (
                      <option key={g.id} value={g.id}>
                        Misafir: {g.display_name}
                      </option>
                    ))}
                  </select>
                  <select name="memberId" className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-2 text-sm">
                    {claimable.map((m) => (
                      <option key={m.id} value={m.id}>
                        Hesap: {m.display_name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" className="w-full">
                    Aktar
                  </Button>
                </form>
              </Card>
            </>
          )}
        </>
      )}

      {isTeam && isCaptain && !group.archived_at && (
        <>
          <SectionTitle>Takımı dağıt</SectionTitle>
          <Card>
            <details>
              <summary className="cursor-pointer text-sm text-red-300">Takımı dağıt…</summary>
              <form action={disbandTeam} className="mt-3 space-y-3">
                <input type="hidden" name="groupId" value={groupId} />
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                  <li>Oynanmış maçı varsa takım arşivlenir: maç geçmişi ve puanlar kalır, yeni maç/teklif/katılım kapanır. İstersen sonra yeniden açarsın.</li>
                  <li>Hiç maçı yoksa takım tamamen silinir.</li>
                  <li>Planlı veya oylaması süren maç varsa önce o bitmeli ya da iptal edilmeli.</li>
                </ul>
                <Button variant="danger" className="w-full">
                  Takımı dağıt
                </Button>
              </form>
            </details>
          </Card>
        </>
      )}

      {me && (
        <>
          <SectionTitle>{isTeam ? "Takımdan ayrıl" : "Gruptan ayrıl"}</SectionTitle>
          {isCaptain ? (
            squadCount > 1 ? (
              <Card className="text-sm text-muted">
                {isTeam ? "Kaptan" : "Kurucu"} olarak ayrılmadan önce {isTeam ? "kaptanlığı" : "kuruculuğu"} listeden birine devretmelisin (üyenin altındaki
                “{isTeam ? "Kaptanlığı devret" : "Kuruculuğu devret"}…” düğmesi). Devrettikten sonra bu bölümden ayrılabilirsin.
              </Card>
            ) : (
              <Card className="space-y-3">
                <p className="text-sm text-muted">
                  {isTeam ? "Takımda" : "Grupta"} tek üye sensin, devredecek kimse yok. İstersen {isTeam ? "takımı" : "grubu"} tamamen silebilirsin: tüm maçlar, oylar ve sohbet
                  geri dönüşsüz silinir; genel rating&apos;in diğer maçlarından yeniden hesaplanır.
                </p>
                <details>
                  <summary className="cursor-pointer text-sm text-red-300">{isTeam ? "Takımı sil" : "Grubu sil"}…</summary>
                  <form action={deleteGroup} className="mt-3 space-y-2">
                    <input type="hidden" name="groupId" value={groupId} />
                    <label className="block text-xs text-muted">
                      Onaylamak için adını aynen yaz: <b className="text-white">{group.name}</b>
                      <input
                        name="confirm"
                        autoComplete="off"
                        className="mt-1 min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm text-white outline-none focus:border-red-400"
                      />
                    </label>
                    <Button variant="danger" className="w-full">
                      Kalıcı olarak sil
                    </Button>
                  </form>
                </details>
              </Card>
            )
          ) : (
            <Card>
              <details>
                <summary className="cursor-pointer text-sm text-red-300">{isTeam ? "Takımdan ayrıl" : "Gruptan ayrıl"}…</summary>
                <form action={leaveGroup} className="mt-3 space-y-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                    <li>Geçmiş maçların, oyların ve rating&apos;in korunur; istatistiklerin yerinde kalır.</li>
                    <li>Gelecekteki maç kadrolarından ve açık çağrılardan çıkarılırsın.</li>
                    <li>{isTeam ? "Takım sohbeti ve teklifler" : "Grup sohbeti ve maçlar"} sana kapanır; davet koduyla istediğin zaman geri dönebilirsin.</li>
                    <li>Oylaması süren bir maçın varsa oylama bitince ayrılabilirsin.</li>
                  </ul>
                  <Button variant="danger" className="w-full">
                    Evet, {isTeam ? "takımdan" : "gruptan"} ayrıl
                  </Button>
                </form>
              </details>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
