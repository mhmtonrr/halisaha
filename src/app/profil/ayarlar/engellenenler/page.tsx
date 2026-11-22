import { requireUser } from "@/lib/supabase/server";
import { unblock } from "@/lib/actions";
import { SubScreen } from "@/components/settings/SubScreen";
import { Icon } from "@/components/Icon";

export default async function BlockedPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireUser();
  const { data: blocks } = await supabase.from("user_blocks").select("id, blocked_user_id, blocked_group_id, created_at").order("created_at", { ascending: false });
  const userIds = (blocks ?? []).map((b) => b.blocked_user_id).filter((x): x is string => !!x);
  const groupIds = (blocks ?? []).map((b) => b.blocked_group_id).filter((x): x is string => !!x);
  const [{ data: users }, { data: groups }] = await Promise.all([
    userIds.length ? supabase.from("profiles").select("id, display_name").in("id", userIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    groupIds.length ? supabase.from("groups").select("id, name").in("id", groupIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const userName = new Map((users ?? []).map((u) => [u.id, u.display_name]));
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));

  return (
    <SubScreen title="Engellenen Oyuncular & Takımlar" error={error}>
      {(blocks ?? []).length === 0 ? (
        <p className="rounded-xl bg-surface-container p-4 text-center text-sm text-on-surface-variant">
          Kimseyi engellemedin. Bir oyuncunun profilinden veya bir takımın istatistik sayfasından engelleyebilirsin.
        </p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl bg-surface-container shadow-sm">
          {(blocks ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 p-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-high text-outline">
                  <Icon name={b.blocked_user_id ? "person" : "shield"} className="text-[22px]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-on-surface">{b.blocked_user_id ? (userName.get(b.blocked_user_id) ?? "Oyuncu") : (groupName.get(b.blocked_group_id!) ?? "Takım")}</div>
                  <div className="t-body-sm text-on-surface-variant">{b.blocked_user_id ? "Oyuncu" : "Takım"}</div>
                </div>
              </div>
              <form action={unblock}>
                <input type="hidden" name="id" value={b.id} />
                <button className="t-label-sm rounded-full bg-surface-high px-3 py-1.5 font-bold text-on-surface hover:bg-surface-bright">Engeli kaldır</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <p className="t-body-sm px-1 text-on-surface-variant">Engellediğin oyuncular Keşfet oyuncu aramasında, engellediğin takımlar takım listesinde ve ilanlarda görünmez. Engellenen kişi bunu görmez.</p>
    </SubScreen>
  );
}
