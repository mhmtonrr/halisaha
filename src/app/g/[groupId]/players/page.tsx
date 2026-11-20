import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { addGuest, claimGuest, removePlayer, setPosition } from "@/lib/actions";
import { getGroupSummaries, type Position } from "@/lib/data";
import { Badge, Button, Card, ErrorNote, Header, Input, SectionTitle } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";

const POSITION_OPTIONS: { value: Position | ""; label: string }[] = [
  { value: "", label: "Mevki yok" },
  { value: "GK", label: "Kaleci" },
  { value: "DEF", label: "Defans" },
  { value: "MID", label: "Orta saha" },
  { value: "FWD", label: "Forvet" },
];

function PositionSelect({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className="min-h-11 rounded-xl border border-line bg-pitch-950 px-2 text-sm"
    >
      {POSITION_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { groupId } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: group } = await supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle();
  if (!group) notFound();

  const players = await getGroupSummaries(supabase, groupId);
  const me = players.find((p) => p.user_id === user.id);
  const isAdmin = me?.role === "admin";
  const guests = players.filter((p) => !p.user_id);
  // Misafir geçmişi sadece henüz maçı olmayan üyelere aktarılabilir
  const claimable = players.filter((p) => p.user_id && p.totals.played === 0);
  const sorted = [...players].sort((a, b) => a.display_name.localeCompare(b.display_name, "tr"));

  return (
    <main>
      <Header title="Oyuncular ve ayarlar" back={`/g/${groupId}`} />
      <ErrorNote message={error} />

      {me && (
        <Link href="/profil">
          <Card className="mb-4 flex items-center justify-between transition hover:border-accent/50">
            <span className="text-sm">Mevkini, ayağını ve forma numaranı profilinden düzenle</span>
            <span className="text-muted">›</span>
          </Card>
        </Link>
      )}

      <Card className="p-0">
        <ul className="divide-y divide-line">
          {sorted.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <OvrBadge overall={p.overall} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {p.display_name} <PositionChip position={p.position} />
                </div>
                <div className="flex gap-1 pt-0.5">
                  {p.role === "admin" && <Badge tone="accent">Yönetici</Badge>}
                  {!p.user_id && <Badge>Misafir</Badge>}
                  <span className="text-xs text-muted">{p.totals.played} maç</span>
                </div>
              </div>
              {isAdmin && p.id !== me?.id && p.totals.played === 0 && (
                <form action={removePlayer}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <button
                    className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-red-950 hover:text-red-300"
                    title="Gruptan çıkar"
                  >
                    Çıkar
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isAdmin && (
        <>
          <SectionTitle>Misafir oyuncu ekle</SectionTitle>
          <Card>
            <p className="mb-3 text-sm text-muted">
              Uygulamayı kullanmayan biri maça gelirse misafir olarak ekle. Oylanır ama oy veremez.
            </p>
            <form action={addGuest} className="space-y-2">
              <input type="hidden" name="groupId" value={groupId} />
              <Input name="name" placeholder="İsim" required minLength={2} />
              <div className="flex gap-2">
                <PositionSelect name="position" />
                <Button className="flex-1">Ekle</Button>
              </div>
            </form>
          </Card>

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
                  Misafir sonradan gruba katıldıysa, misafir kaydındaki maçlarını ve puanlarını onun hesabına aktar.
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
    </main>
  );
}
