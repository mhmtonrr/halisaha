import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds } from "@/lib/recipients";
import { ROLE_LABEL, type GroupKind, type Role } from "@/lib/teams-data";

/**
 * Yeni üye katıldı: kaptan/kurucu ve yetkililere (kullanıcı kararı: tüm üyelere değil).
 * `skip`: zaten haber alanlar (ör. daveti gönderen "davet kabul edildi" aldı).
 */
export function announceJoin(groupId: string, userId: string, skip: string[] = []) {
  later(async () => {
    const admin = createAdminClient();
    const [{ data: g }, { data: me }, ids] = await Promise.all([
      admin.from("groups").select("name, kind").eq("id", groupId).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      groupMemberIds(admin, groupId, { adminsOnly: true }),
    ]);
    if (!g) return;
    await notify(
      ids.filter((id) => !skip.includes(id)),
      "match",
      text.memberJoined(g.name as string, (me?.display_name as string | undefined) ?? "Bir oyuncu", groupId, g.kind as GroupKind),
      { excludeUserId: userId },
    );
  });
}

/** Rolü değişen kişiye (rolü veren hariç) */
export function announceRole(playerId: string, actorId: string) {
  later(async () => {
    const admin = createAdminClient();
    const { data: gp } = await admin.from("group_players").select("user_id, role, group_id, groups(name, kind)").eq("id", playerId).maybeSingle();
    const g = (Array.isArray(gp?.groups) ? gp.groups[0] : gp?.groups) as { name: string; kind: GroupKind } | null | undefined;
    if (!gp?.user_id || !g) return;
    await notify([gp.user_id as string], "match", text.roleChanged(g.name, gp.group_id as string, ROLE_LABEL[g.kind][gp.role as Role]), {
      excludeUserId: actorId,
    });
  });
}
