// E2E temizliği: test kullanıcılarını ve kurdukları her şeyi canlı veritabanından siler.
// Neden: senaryolar arayüzden kurulan grupları izlemiyordu; grup/maç/çağrı `created_by` (silme kuralı yok) kullanıcıyı
// tuttuğu için deleteUser sessizce başarısız oluyor, canlıda test verisi birikiyordu (bkz. docs/inceleme-2026-11-23.md).
// Kullanım (finally içinde): await removeTestUsers(admin, users.map((u) => u.id));

/** Sadece bu kullanıcıların üye olduğu (başka hesaplı üyesi olmayan) grupları siler, sonra kullanıcıları. Hata olursa yüksek sesle yazar. */
export async function removeTestUsers(admin, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const mine = new Set(ids);
  const [{ data: owned }, { data: memberOf }] = await Promise.all([
    admin.from("groups").select("id").in("created_by", ids),
    admin.from("group_players").select("group_id").in("user_id", ids),
  ]);
  const candidates = [...new Set([...(owned ?? []).map((g) => g.id), ...(memberOf ?? []).map((r) => r.group_id)])];
  const groups = [];
  for (const g of candidates) {
    const { data: members } = await admin.from("group_players").select("user_id").eq("group_id", g).not("user_id", "is", null);
    if ((members ?? []).every((m) => mine.has(m.user_id))) groups.push(g);
  }
  const errors = [];
  if (groups.length) {
    // Davet kartı varken grup silinemiyor (dm_messages_shape_check; bkz. inceleme raporu) → önce davet mesajları
    const { data: invites } = await admin.from("group_invites").select("id").in("group_id", groups);
    if (invites?.length) await admin.from("dm_messages").delete().in("invite_id", invites.map((i) => i.id));
    const { error } = await admin.from("groups").delete().in("id", groups);
    if (error) errors.push(`grup: ${error.message}`);
  }
  await admin.from("match_challenges").delete().or(`created_by.in.(${ids}),responded_by.in.(${ids})`);
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(`kullanıcı ${id.slice(0, 8)}: ${error.message}`);
  }
  if (errors.length) console.log("  ⚠ TEMİZLİK EKSİK (canlıda test verisi kaldı):", errors.join(" | "));
}
