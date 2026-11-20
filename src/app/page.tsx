import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { createGroup, joinGroup } from "@/lib/actions";
import { Button, Card, ErrorNote, Header, Input, SectionTitle } from "@/components/ui";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: memberships } = await supabase
    .from("group_players")
    .select("role, groups(id, name, group_players(count))")
    .eq("user_id", user.id);

  type G = { id: string; name: string; group_players: { count: number }[] };
  const groups = (memberships ?? [])
    .map((m) => ({ role: m.role, group: (Array.isArray(m.groups) ? m.groups[0] : m.groups) as G | null }))
    .filter((m): m is { role: string; group: G } => !!m.group);

  return (
    <main>
      <Header
        title="Gruplarım"
        right={
          <div className="flex items-center">
            <Link href="/profil" className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-pitch-800">
              Profilim
            </Link>
            <form action="/auth/signout" method="post">
              <button className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-pitch-800">Çıkış</button>
            </form>
          </div>
        }
      />
      <ErrorNote message={error} />

      {groups.length === 0 ? (
        <Card className="text-center text-muted">
          Henüz bir grubun yok. Aşağıdan yeni bir grup kur ya da arkadaşının gönderdiği davet kodunu gir.
        </Card>
      ) : (
        <ul className="space-y-2">
          {groups.map(({ group, role }) => (
            <li key={group.id}>
              <Link href={`/g/${group.id}`}>
                <Card className="flex items-center justify-between transition hover:border-accent/50">
                  <div>
                    <div className="font-semibold">{group.name}</div>
                    <div className="text-xs text-muted">
                      {group.group_players[0]?.count ?? 0} oyuncu{role === "admin" ? " · Yönetici" : ""}
                    </div>
                  </div>
                  <span className="text-muted">›</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Yeni grup kur</SectionTitle>
      <Card>
        <form action={createGroup} className="flex gap-2">
          <Input name="name" placeholder="Örn. Salı Akşamı Ekibi" required minLength={2} maxLength={60} />
          <Button>Kur</Button>
        </form>
      </Card>

      <SectionTitle>Gruba katıl</SectionTitle>
      <Card>
        <form action={joinGroup} className="flex gap-2">
          <Input name="code" placeholder="Davet kodu veya linki" required />
          <Button variant="secondary">Katıl</Button>
        </form>
      </Card>
    </main>
  );
}
