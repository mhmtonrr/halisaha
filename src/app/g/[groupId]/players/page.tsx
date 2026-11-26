import { Icon } from "@/components/Icon";
import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { claimGuest, deleteGroup, disbandTeam, inviteToGroup, leaveGroup, openDm, removePlayer, setMemberRole, setPosition, updateTeam } from "@/lib/actions";
import { getGroupSummaries, isGuestLike, isSquadMember, type Position } from "@/lib/data";
import { ROLE_LABEL, type GroupKind, type Role } from "@/lib/teams-data";
import { Badge, Button, cx, ErrorNote, Header, LinkButton } from "@/components/ui";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { TeamFields } from "@/components/TeamFields";

const POSITION_OPTIONS: { value: Position | ""; label: string }[] = [
  { value: "", label: "Mevki yok" },
  { value: "GK", label: "Kaleci" },
  { value: "DEF", label: "Defans" },
  { value: "MID", label: "Orta saha" },
  { value: "FWD", label: "Forvet" },
];

/** Satır içi işlem düğmesi */
const ACTION = "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-xs font-semibold transition";
const SELECT = "min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-pitch-950 px-2 text-sm";

/** Sayfanın açılır kapanır ana başlığı; işlemden dönülen bölüm (`?bolum=`) açık gelir */
function Section({ open, icon, title, count, danger, children }: { open: boolean; icon: string; title: string; count?: number; danger?: boolean; children: React.ReactNode }) {
  return (
    <AutoOpenDetails
      openInitially={open}
      className="group/section mb-3 overflow-hidden rounded-xl border border-line bg-surface-container shadow-sm"
      summaryClassName="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 transition hover:bg-surface-high [&::-webkit-details-marker]:hidden"
      summary={
        <>
          <Icon name={icon} className={cx("text-[22px]", danger ? "text-red-300" : "text-primary")} />
          <h2 className={cx("min-w-0 flex-1 truncate font-display text-sm font-bold uppercase tracking-wider", danger && "text-red-300")}>{title}</h2>
          {count !== undefined && <Badge>{count}</Badge>}
          <Icon name="expand_more" className="text-[22px] text-on-surface-variant transition group-open/section:rotate-180" />
        </>
      }
    >
      <div className="border-t border-line">{children}</div>
    </AutoOpenDetails>
  );
}

/** Oyuncu satırı: dokununca o kişiyle ilgili işlemler açılır */
function PlayerRow({ player, meta, children }: { player: { overall: number; display_name: string; position: Position | null }; meta: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <details className="group/row">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-surface-high [&::-webkit-details-marker]:hidden">
          <OvrBadge overall={player.overall} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{player.display_name}</span>
              <PositionChip position={player.position} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted">{meta}</div>
          </div>
          <Icon name="expand_more" className="text-[20px] text-on-surface-variant transition group-open/row:rotate-180" />
        </summary>
        <div className="space-y-3 bg-surface-low px-4 py-3">{children}</div>
      </details>
    </li>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="t-label-caps border-b border-line bg-surface-high/50 px-4 py-2 uppercase text-on-surface-variant">{children}</h3>;
}

function FieldTitle({ children }: { children: React.ReactNode }) {
  return <p className="t-label-caps mb-1.5 uppercase text-on-surface-variant">{children}</p>;
}

function ProfileLink({ href }: { href: string }) {
  return (
    <LinkButton href={href} variant="secondary" className="min-h-10 gap-1.5 px-3.5 text-xs">
      <Icon name="person" className="text-[18px]" />
      Profil
    </LinkButton>
  );
}

function RoleButton({ groupId, playerId, role, children, danger }: { groupId: string; playerId: string; role: Role; children: React.ReactNode; danger?: boolean }) {
  return (
    <form action={setMemberRole}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="role" value={role} />
      <button className={cx(ACTION, danger ? "border-amber-400/40 text-amber-300 hover:bg-amber-400/10" : "border-accent/40 text-accent hover:bg-accent/10")}>{children}</button>
    </form>
  );
}

/** Yetkilinin üyeyi/misafiri çıkarma düğmesi */
function RemoveButton({ groupId, playerId, label }: { groupId: string; playerId: string; label: string }) {
  return (
    <form action={removePlayer} className="border-t border-line pt-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="playerId" value={playerId} />
      <button className={cx(ACTION, "border-red-900 text-red-300 hover:bg-red-950")}>
        <Icon name="person_remove" className="text-[18px]" />
        {label}
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
  searchParams: Promise<{ error?: string; saved?: string; davet?: string; bolum?: string }>;
}) {
  const { groupId } = await params;
  const { error, saved, davet, bolum } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, kind, city, district, color, logo, description, archived_at, discoverable, join_requests_open")
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

      <div className="mt-1 pb-4">
        <Section open={bolum === "oyuncular" || !!davet} icon="group" title={isTeam ? "Oyuncular" : "Üyeler"} count={squadCount}>
          <SubTitle>
            {isTeam ? "Kadro" : "Üyeler"} · {squadCount}
          </SubTitle>
          <ul className="divide-y divide-line">
            {sorted.map((p) => {
              const role = p.role as Role;
              const isMe = p.id === me?.id;
              const canSetRole = isCaptain && !!p.user_id && !isMe && role !== "captain";
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  meta={
                    <>
                      {role !== "member" && <Badge tone={role === "captain" ? "warn" : "accent"}>{labels[role]}</Badge>}
                      <span>
                        {p.totals.played} maç{isMe && " · Sen"}
                      </span>
                    </>
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <ProfileLink href={`/g/${groupId}/p/${p.id}`} />
                    {p.user_id && !isMe && (
                      <form action={openDm}>
                        <input type="hidden" name="userId" value={p.user_id} />
                        <button aria-label={`${p.display_name} ile mesajlaş`} className={cx(ACTION, "hover:text-accent")}>
                          <Icon name="chat" className="text-[18px]" />
                          Mesaj
                        </button>
                      </form>
                    )}
                  </div>
                  {canSetRole && (
                    <div>
                      <FieldTitle>Yetki</FieldTitle>
                      <div className="flex flex-wrap gap-2">
                        {role !== "admin" && (
                          <RoleButton groupId={groupId} playerId={p.id} role="admin">
                            {labels.admin} yap
                          </RoleButton>
                        )}
                        {role !== "organizer" && (
                          <RoleButton groupId={groupId} playerId={p.id} role="organizer">
                            {labels.organizer} yap
                          </RoleButton>
                        )}
                        {role !== "member" && (
                          <RoleButton groupId={groupId} playerId={p.id} role="member" danger>
                            Yetkiyi al
                          </RoleButton>
                        )}
                      </div>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-amber-300">{isTeam ? "Kaptanlığı devret" : "Kuruculuğu devret"}…</summary>
                        <div className="mt-2 space-y-2 text-xs">
                          <p className="text-muted">
                            {p.display_name} {labels.captain.toLocaleLowerCase("tr")} olacak, sen {labels.admin.toLocaleLowerCase("tr")} olacaksın. Geri alamazsın.
                          </p>
                          <RoleButton groupId={groupId} playerId={p.id} role="captain" danger>
                            Evet, devret
                          </RoleButton>
                        </div>
                      </details>
                    </div>
                  )}
                  {canRemove(p) && <RemoveButton groupId={groupId} playerId={p.id} label={isTeam ? "Takımdan çıkar" : "Gruptan çıkar"} />}
                </PlayerRow>
              );
            })}
          </ul>

          {guests.length > 0 && (
            <>
              <SubTitle>Misafirler · {guests.length}</SubTitle>
              <ul className="divide-y divide-line">
                {guests.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    meta={
                      <>
                        <Badge>{p.is_loan ? "Ödünç" : "Misafir"}</Badge>
                        <span>
                          {p.totals.played} maç · {p.totals.goals} gol · {p.totals.assists} asist
                        </span>
                      </>
                    }
                  >
                    <div className="flex flex-wrap gap-2">
                      <ProfileLink href={`/g/${groupId}/p/${p.id}`} />
                      {canManage && isTeam && p.is_loan && p.user_id && (
                        // Ödünç oynamış oyuncuyu takıma davet et (kabul edince asıl kadroya geçer)
                        <form action={inviteToGroup}>
                          <input type="hidden" name="groupId" value={groupId} />
                          <input type="hidden" name="userId" value={p.user_id} />
                          <input type="hidden" name="back" value={`/g/${groupId}/players?bolum=oyuncular`} />
                          <button className={cx(ACTION, "border-accent/40 text-accent hover:bg-accent/10")}>Takıma davet et</button>
                        </form>
                      )}
                    </div>
                    {canManage && (
                      <form action={setPosition}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="playerId" value={p.id} />
                        <FieldTitle>Mevki</FieldTitle>
                        <div className="flex gap-2">
                          <select name="position" aria-label="Mevki" defaultValue={p.position ?? ""} className={SELECT}>
                            {POSITION_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <Button variant="secondary">Kaydet</Button>
                        </div>
                      </form>
                    )}
                    {canManage && !p.user_id && claimable.length > 0 && (
                      <form action={claimGuest}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="guestId" value={p.id} />
                        <FieldTitle>Misafir geçmişini aktar</FieldTitle>
                        <div className="flex gap-2">
                          <select name="memberId" aria-label="Aktarılacak hesap" className={SELECT}>
                            {claimable.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.display_name}
                              </option>
                            ))}
                          </select>
                          <Button variant="secondary">Aktar</Button>
                        </div>
                        <p className="mt-1.5 text-xs text-muted">
                          Misafir sonradan katıldıysa maçları ve puanları seçtiğin hesaba geçer. Sadece henüz maçı olmayan üyeler listelenir.
                        </p>
                      </form>
                    )}
                    {canRemove(p) && <RemoveButton groupId={groupId} playerId={p.id} label="Misafiri çıkar" />}
                  </PlayerRow>
                ))}
              </ul>
              <p className="border-t border-line px-4 py-3 text-xs text-muted">
                Misafirler asıl kadroya, takım puanına ve sıralamalara girmez; maça gelince kadroya eklenirler.
              </p>
            </>
          )}

          <details className="border-t border-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-primary [&::-webkit-details-marker]:hidden">
              <Icon name="help" className="text-[18px]" />
              Roller ne yapabilir?
            </summary>
            <ul className="space-y-1.5 px-4 pb-4 text-xs text-muted">
              <li>
                <b className="text-white">{labels.captain}:</b> rolleri yönetir ve {isTeam ? "kaptanlığı" : "kuruculuğu"} devredebilir.
              </li>
              <li>
                <b className="text-white">{labels.admin}:</b> maç kurar, tüm maçları ve üyeleri yönetir (mevki, çıkarma).
              </li>
              <li>
                <b className="text-white">{labels.organizer}:</b> maç ve maç çağrısı açar, sadece kendi kurduğu maçı yönetir (kadro, misafir, sonuç); üyelere dokunamaz.
              </li>
              <li>
                <b className="text-white">{labels.member}:</b> oynar ve oy verir.
              </li>
            </ul>
          </details>
        </Section>

        {canManage && (
          <Section open={bolum === "bilgiler" || !!saved} icon="edit" title={isTeam ? "Takım bilgileri" : "Grup bilgileri"}>
            <form action={updateTeam} className="space-y-4 p-4">
              <input type="hidden" name="groupId" value={groupId} />
              <TeamFields values={group} kind={kind} />
              {/* Keşfet ve katılma isteği (0044); takımlar Keşfet'te zaten görünür */}
              <div className="space-y-3 border-t border-line pt-4">
                <input type="hidden" name="discovery" value="1" />
                {!isTeam && (
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" name="discoverable" defaultChecked={group.discoverable} className="mt-1 accent-accent" />
                    <span>
                      <span className="font-semibold">Keşfet&apos;te görünsün</span>
                      <span className="block text-xs text-on-surface-variant">Bölgendeki oyuncular grubu Keşfet&apos;te görür (üyeler ve sohbet görünmez).</span>
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name="requestsOpen" defaultChecked={group.join_requests_open ?? !isTeam} className="mt-1 accent-accent" />
                  <span>
                    <span className="font-semibold">Katılma isteği alınsın</span>
                    <span className="block text-xs text-on-surface-variant">
                      {isTeam ? "Oyuncular Keşfet'ten ve takım sayfasından istek gönderir" : "Keşfet'te görünüyorsa oyuncular istek gönderir"}; kabul ya da ret senin elinde. Davet bağlantısı yine çalışır.
                    </span>
                  </span>
                </label>
              </div>
              <Button className="w-full">Kaydet</Button>
            </form>
          </Section>
        )}

        {me && (
          <Section open={bolum === "ayril"} icon="logout" title={isTeam ? "Takımdan ayrıl" : "Gruptan ayrıl"} danger>
            {!isCaptain ? (
              <form action={leaveGroup} className="space-y-3 p-4">
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
            ) : squadCount > 1 ? (
              <p className="p-4 text-sm text-muted">
                {isTeam ? "Kaptan" : "Kurucu"} olarak ayrılmadan önce {isTeam ? "kaptanlığı" : "kuruculuğu"} listeden birine devretmelisin ({isTeam ? "Oyuncular" : "Üyeler"}{" "}
                başlığında kişiye dokun, “{isTeam ? "Kaptanlığı devret" : "Kuruculuğu devret"}…”). Devrettikten sonra bu bölümden ayrılabilirsin.
              </p>
            ) : (
              <div className="space-y-3 p-4">
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
              </div>
            )}
          </Section>
        )}

        {isTeam && isCaptain && !group.archived_at && (
          <Section open={bolum === "dagit"} icon="delete" title="Takımı dağıt" danger>
            <form action={disbandTeam} className="space-y-3 p-4">
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
          </Section>
        )}
      </div>
    </main>
  );
}
