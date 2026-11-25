import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { shareMatchCard } from "@/lib/actions";
import { one } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";
import { Avatar } from "@/components/Avatar";
import { Card, ErrorNote, Header } from "@/components/ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Person {
  id: string;
  display_name: string;
  photo_url: string | null;
  city: string | null;
}

/** Kartın başlığı + grubu; kaynak yoksa/uygun değilse null */
async function loadSource(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], ref: string) {
  const { data } = await supabase.from("matches").select("group_id, status, played_at, time_tbd, venue, groups!matches_group_id_fkey(name)").eq("id", ref).maybeSingle();
  const g = one(data?.groups as { name: string } | { name: string }[] | null);
  return data && g
    ? {
        groupId: data.group_id as string,
        open: data.status === "planned" || data.status === "gathering",
        title: `Maç · ${g.name}`,
        when: matchWhen(data.played_at as string, !!data.time_tbd),
        venue: data.venue as string | null,
      }
    : null;
}

/** "Maça çağır": maç kartını sohbetten gönderme (kişiye özel davet, 0043): arkadaşlar + oyuncu arama */
export default async function SendCardPage({ searchParams }: { searchParams: Promise<{ tur?: string; ref?: string; q?: string; ok?: string; error?: string }> }) {
  const { tur, ref, q = "", ok, error } = await searchParams;
  if (tur !== "match" || !ref || !UUID.test(ref)) notFound();
  const { supabase, user } = await requireUser();

  const source = await loadSource(supabase, ref);
  if (!source) notFound();
  // share_match_card ile aynı kural: maçı yöneten (davet onaysız) veya kadrodaki oyuncu (davet onaya düşer)
  const [{ data: canManage }, { data: inRoster }] = await Promise.all([
    supabase.rpc("can_manage_match", { p_match_id: ref }),
    supabase.rpc("is_match_participant", { p_match_id: ref }),
  ]);
  if (!canManage && !inRoster) redirect("/");

  const needle = q.trim().replace(/[%_,()]/g, " ");
  const [{ data: rows }, { data: found }, { data: invited }] = await Promise.all([
    supabase.from("friendships").select("user_a, user_b").eq("status", "accepted").limit(300),
    // Aramada sadece profilini aramaya açanlar (Keşfet oyuncu aramasıyla aynı kural); arkadaşlar her zaman listede
    needle.length >= 2
      ? supabase
          .from("profiles")
          .select("id, display_name, photo_url, city")
          .eq("discoverable", true)
          .is("frozen_at", null)
          .ilike("display_name", `%${needle}%`)
          .neq("id", user.id)
          .limit(15)
      : Promise.resolve({ data: [] as Person[] }),
    // Zaten çağrılmış/kadroda/başvurmuş olanlar (RLS: yöneten hepsini, kadrodaki oyuncu kadroyu görür)
    supabase.from("match_entries").select("user_id").eq("match_id", ref).in("status", ["invited", "in", "reserve", "pending"]),
  ]);
  const invitedSet = new Set((invited ?? []).map((r) => r.user_id as string));
  const friendIds = (rows ?? []).map((r) => (r.user_a === user.id ? r.user_b : r.user_a));
  const { data: friendProfiles } = friendIds.length
    ? await supabase.from("profiles").select("id, display_name, photo_url, city").in("id", friendIds)
    : { data: [] as Person[] };
  const friends = ((friendProfiles ?? []) as Person[]).sort((a, b) => a.display_name.localeCompare(b.display_name, "tr"));
  const friendSet = new Set(friendIds);
  const results = ((found ?? []) as Person[]).filter((p) => !friendSet.has(p.id));

  const row = (p: Person) => (
    <Card key={p.id} className="flex items-center gap-3">
      <Avatar name={p.display_name} photoUrl={p.photo_url} className="h-10 w-10 shrink-0 bg-pitch-700 text-sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{p.display_name}</div>
        {p.city && <div className="truncate text-xs text-muted">{p.city}</div>}
      </div>
      {ok === p.id || invitedSet.has(p.id) ? (
        <span className="shrink-0 rounded-lg bg-accent/15 px-3 py-1.5 text-sm font-bold text-accent">✓ {ok === p.id ? "Gönderildi" : "Çağrıldı"}</span>
      ) : (
        <form action={shareMatchCard} className="shrink-0">
          <input type="hidden" name="tur" value={tur} />
          <input type="hidden" name="ref" value={ref} />
          <input type="hidden" name="userId" value={p.id} />
          <input type="hidden" name="q" value={q} />
          <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-pitch-950">Gönder</button>
        </form>
      )}
    </Card>
  );

  return (
    <main>
      <Header
        title="Maça çağır"
        back={`/g/${source.groupId}/m/${ref}`}
      />
      <ErrorNote message={error} />
      <Card className="mb-4 space-y-0.5">
        <div className="text-xs text-muted">Gönderilecek kart</div>
        <div className="font-bold">{source.title}</div>
        <div className="text-sm text-muted">
          {source.when}
          {source.venue ? ` · ${source.venue}` : ""}
        </div>
        {!source.open && <p className="pt-1 text-xs text-amber-300">Bu kayıt artık açık değil; gönderilemez.</p>}
        {source.open && (
          <p className="pt-1 text-xs text-muted">
            Kart sohbetten gider. Çağırdığın kişi üye olmasa da maçı ve kadroyu görür, &quot;Geliyorum&quot; der; bu maç için ödünç oyuncu olur.
            {!canManage && " Senin çağırdığın kişi maçı ayarlayanın onayına düşer."}
          </p>
        )}
      </Card>

      <form method="get" className="mb-4 flex gap-2">
        <input type="hidden" name="tur" value={tur} />
        <input type="hidden" name="ref" value={ref} />
        <input name="q" defaultValue={q} placeholder="Oyuncu adı ara…" aria-label="Oyuncu ara" className="min-h-11 flex-1 rounded-xl border border-line bg-pitch-900 px-4 outline-none placeholder:text-muted/60 focus:border-accent" />
        <button className="rounded-xl bg-pitch-800 px-4 font-bold">Ara</button>
      </form>

      {needle.length >= 2 && (
        <section className="mb-5 space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Arama sonucu</h2>
          {results.length === 0 ? <p className="px-1 text-sm text-muted">Eşleşen oyuncu yok (arkadaşların aşağıda).</p> : results.map(row)}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Arkadaşlarım ({friends.length})</h2>
        {friends.length === 0 ? <p className="px-1 text-sm text-muted">Henüz arkadaşın yok; yukarıdan oyuncu arayabilirsin.</p> : friends.map(row)}
      </section>
    </main>
  );
}
