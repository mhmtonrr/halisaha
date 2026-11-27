"use server";

import { logoFromForm, logoPath, logoUrl } from "@/lib/crest";
import { revalidatePath, revalidateTag } from "next/cache";
import { FEATURED_TAG, loadFeatured, type Featured } from "@/lib/featured-data";
import { validateCardName } from "@/lib/card-name";
import { cardPhotoPath, cardPhotoUrl } from "@/lib/card-photo";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeMatch, recomputePlayers } from "@/lib/finalize";
import { later, notify, sendTestPush } from "@/lib/notify";
import { skillSet } from "@/lib/skills";
import { extractInviteCode, kindMatches, parseKind } from "@/lib/invite";
import { recomputeSkillsForVoter } from "@/lib/skills-data";
import { text, type Content, type NotificationType } from "@/lib/notify-rules";
import { loadMenuData } from "@/lib/menu-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupMemberIds, groupName, linkedMatches, matchAccountIds } from "@/lib/recipients";
import { notifySpotOpened } from "@/lib/match-notify";
import { announceJoin, announceRole } from "@/lib/membership-notify";
import { balanceTeams, pickVariant, type TeamCandidate } from "@/lib/teams";
import { formatDate, getGroupPlayers, parseLocalDateTime, POSITIONS, type Position } from "@/lib/data";
import { canonicalDistrict, isProvince } from "@/lib/regions";
import { getFormation, inferSize, isValidSize, validAssignment, type Role } from "@/lib/formations";

const VOTING_HOURS = 24;

/** Ana sayfa öne çıkanları: bölge değişince sayfayı yenilemeden o bölgenin listeleri (il boş: Türkiye) */
export async function fetchFeatured(city: string, district: string): Promise<Featured> {
  await requireUser();
  const il = isProvince(city) ? city : null;
  return loadFeatured(il, il ? (canonicalDistrict(il, district) ?? null) : null);
}
const asPosition = (v: string): Position | null => (POSITIONS.includes(v as Position) ? (v as Position) : null);

function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

/** RPC'lerin Türkçe hata metinlerini kullanıcıya gösterir; beklenmeyen hatada genel metin */
function rpcMessage(error: { message?: string; code?: string }, fallback: string) {
  // P0001: raise exception ile bizim yazdığımız mesaj
  return error.code === "P0001" && error.message ? error.message : fallback;
}

/** Formdan kişi sayısı (5-11); geçersizse null */
const sizeOf = (fd: FormData, key = "size") => {
  const n = Number(fd.get(key));
  return isValidSize(n) ? n : null;
};

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const int = (fd: FormData, key: string) => {
  const n = Number(fd.get(key));
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

/** Kartta görünen adı kaydeder (doğrulanmış değer); group_players kopyasını veritabanı tetikleyicisi eşitler */
async function saveCardName(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, value: string | null, back: string) {
  const { error } = await supabase.from("profiles").update({ card_name: value }).eq("id", userId);
  if (error) fail(back, "Kartta görünen ad kaydedilemedi");
}

/**
 * Kart fotoğrafı tarayıcıdan depoya (`avatars/<id>/card`) yüklendikten sonra adresi profile yazar.
 * Adres sunucuda kurulur (istemciden adres alınmaz); veritabanı kısıtı da sadece kendi klasörünü kabul eder.
 */
export async function saveCardPhoto(version: number): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser({ allowIncomplete: true });
  if (!Number.isFinite(version) || version <= 0) return { error: "Geçersiz istek" };
  const url = cardPhotoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, user.id, version);
  const { error } = await supabase.from("profiles").update({ photo_url: url }).eq("id", user.id);
  if (error) return { error: "Fotoğraf kaydedilemedi" };
  revalidatePath("/", "layout");
  return {};
}

/** Kart fotoğrafını siler (depodaki dosya + profil adresi) */
export async function deleteCardPhoto(): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser({ allowIncomplete: true });
  const { error } = await supabase.from("profiles").update({ photo_url: null }).eq("id", user.id);
  if (error) return { error: "Fotoğraf silinemedi" };
  await supabase.storage.from("avatars").remove([cardPhotoPath(user.id)]);
  revalidatePath("/", "layout");
  return {};
}

/** İstatistik ve maç geçmişini kimin görebileceği: "teammates" (ortak grup/takım) veya "public" (herkes) */
export async function updateStatsVisibility(fd: FormData) {
  const { supabase, user } = await requireUser();
  const value = str(fd, "visibility");
  if (value !== "teammates" && value !== "public") fail("/profil?sekme=ayarlar", "Geçersiz seçim");
  const { error } = await supabase.from("profiles").update({ stats_visibility: value }).eq("id", user.id);
  if (error) fail("/profil?sekme=ayarlar", "Ayar kaydedilemedi");
  revalidatePath("/profil");
  redirect("/profil?sekme=ayarlar&saved=1");
}

/** Oyuncu aramasında ve ana sayfadaki öne çıkanlarda görünme */
export async function updateDiscoverable(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ discoverable: str(fd, "discoverable") === "1" }).eq("id", user.id);
  if (error) fail("/profil/ayarlar/gorunurluk", "Ayar kaydedilemedi");
  revalidateTag(FEATURED_TAG); // gizlenen kişi öne çıkanlarda hemen kalksın
  revalidatePath("/profil");
  redirect("/profil/ayarlar/gorunurluk?saved=1");
}

// ---------------------------------------------------------------------------
// Ayarlar alt ekranları (Kişisel bilgiler, Futbolcu profili, müsaitlik, dondurma)
// ---------------------------------------------------------------------------

/** update_my_profile her çağrıda tüm alanları ister; alt ekranlar sadece kendi alanlarını değiştirir, gerisi mevcut değerden gelir */
async function currentProfileArgs(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, back: string) {
  const { data: p } = await supabase
    .from("profiles")
    .select("display_name, city, district, birth_year, preferred_position, secondary_positions, preferred_foot, shirt_number, bio")
    .eq("id", userId)
    .single();
  if (!p) fail(back, "Profil bulunamadı");
  return {
    p_display_name: p.display_name as string,
    p_position: (p.preferred_position ?? null) as string | null,
    p_secondary: (p.secondary_positions ?? []) as string[],
    p_foot: (p.preferred_foot ?? null) as string | null,
    p_shirt: (p.shirt_number ?? null) as number | null,
    p_bio: ((p.bio ?? "") as string).slice(0, 160),
    p_city: (p.city ?? "") as string,
    p_district: (p.district ?? "") as string,
    p_birth_year: (p.birth_year ?? null) as number | null,
  };
}

const PERSONAL = "/profil/ayarlar/kisisel";
const FOOTBALLER = "/profil/ayarlar/futbolcu";

/** Boş = girilmedi (geçerli); doluysa 1940 ile "en az 8 yaş" arasında gerçek bir tarih olmalı */
function validBirthDate(birth: string) {
  if (!birth) return true;
  const d = new Date(`${birth}T00:00:00Z`);
  const y = d.getUTCFullYear();
  return /^\d{4}-\d{2}-\d{2}$/.test(birth) && !Number.isNaN(d.getTime()) && y >= 1940 && y <= new Date().getFullYear() - 8;
}

/** Kişisel bilgiler: ad soyad, kartta görünen ad, il/ilçe, doğum tarihi (özel) */
export async function updatePersonal(fd: FormData) {
  const { supabase, user } = await requireUser();
  const card = validateCardName(str(fd, "cardName"));
  if (!card.ok) fail(PERSONAL, card.error);
  const name = str(fd, "name");
  if (name.length < 2) fail(PERSONAL, "Ad soyad en az 2 karakter olmalı");
  const city = str(fd, "city");
  if (!isProvince(city)) fail(PERSONAL, "İlini seç");
  const birth = str(fd, "birthDate");
  if (!validBirthDate(birth)) fail(PERSONAL, "Geçerli bir doğum tarihi gir");
  const base = await currentProfileArgs(supabase, user.id, PERSONAL);
  const { error } = await supabase.rpc("update_my_profile", {
    ...base,
    p_display_name: name,
    p_city: city,
    p_district: canonicalDistrict(city, str(fd, "district")) ?? "",
  });
  if (error) fail(PERSONAL, error.message);
  await saveCardName(supabase, user.id, card.ok ? card.value : null, PERSONAL);
  // Doğum tarihi ayrı özel tabloda (sadece kendisi okur); boşsa silinir
  const { error: birthErr } = await supabase.from("profile_private").upsert({ user_id: user.id, birth_date: birth || null }, { onConflict: "user_id" });
  if (birthErr) fail(PERSONAL, "Doğum tarihi kaydedilemedi");
  revalidatePath("/", "layout");
  redirect(`${PERSONAL}?saved=1`);
}

/** Futbolcu profili: mevkiler, ayak, forma no, boy, kilo, hakkımda */
export async function updateFootballer(fd: FormData) {
  const { supabase, user } = await requireUser();
  const position = asPosition(str(fd, "position"));
  if (!position) fail(FOOTBALLER, "Ana mevkini seç");
  const secondary = fd.getAll("secondary").map(String).filter((p) => asPosition(p) && p !== position);
  const foot = ["L", "R", "B"].includes(str(fd, "foot")) ? str(fd, "foot") : null;
  const num = (key: string, lo: number, hi: number) => {
    const raw = str(fd, key);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < lo || n > hi) fail(FOOTBALLER, `${key === "shirt" ? "Forma no 1-99" : key === "height" ? "Boy 120-230 cm" : "Kilo 30-200 kg"} aralığında olmalı`);
    return n;
  };
  const shirt = num("shirt", 1, 99);
  const height = num("height", 120, 230);
  const weight = num("weight", 30, 200);
  const base = await currentProfileArgs(supabase, user.id, FOOTBALLER);
  const { error } = await supabase.rpc("update_my_profile", {
    ...base,
    p_position: position,
    p_secondary: secondary,
    p_foot: foot,
    p_shirt: shirt,
    p_bio: str(fd, "bio").slice(0, 160),
  });
  if (error) fail(FOOTBALLER, error.message);
  const { error: bodyErr } = await supabase.from("profiles").update({ height_cm: height, weight_kg: weight }).eq("id", user.id);
  if (bodyErr) fail(FOOTBALLER, "Boy/kilo kaydedilemedi");
  revalidatePath("/", "layout");
  redirect(`${FOOTBALLER}?saved=1`);
}

/** Haftalık müsait günler (0=Pzt … 6=Paz) */
export async function saveAvailability(days: number[]): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const { error } = await supabase.from("profiles").update({ available_days: clean }).eq("id", user.id);
  if (error) return { error: "Kaydedilemedi" };
  revalidatePath("/profil");
  return {};
}

/** "İstatistiklerimi paylaş": açık = herkes görür, kapalı = takım arkadaşları ve bekleyen başvuruyu yanıtlayacak kişi */
export async function setStatsShare(on: boolean): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ stats_visibility: on ? "public" : "teammates" }).eq("id", user.id);
  if (error) return { error: "Kaydedilemedi" };
  revalidatePath("/profil");
  return {};
}

/** Hesabı geçici dondurma: aramada/öne çıkanlarda görünmez, bildirim almaz; istediğin an yeniden açılır */
export async function setAccountFrozen(fd: FormData) {
  const { supabase, user } = await requireUser();
  const freeze = str(fd, "freeze") === "1";
  const { error } = await supabase.from("profiles").update({ frozen_at: freeze ? new Date().toISOString() : null }).eq("id", user.id);
  if (error) fail("/profil?sekme=ayarlar", "İşlem yapılamadı");
  revalidateTag(FEATURED_TAG);
  revalidatePath("/", "layout");
  redirect(`/profil?sekme=ayarlar&saved=1`);
}

// ---------------------------------------------------------------------------
// Engelleme (oyuncu veya herkese açık takım; sadece engelleyen görür)
// ---------------------------------------------------------------------------

const BLOCKS = "/profil/ayarlar/engellenenler";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function blockUser(fd: FormData) {
  const { supabase, user } = await requireUser();
  const id = str(fd, "userId");
  if (!UUID_RE.test(id) || id === user.id) fail(BLOCKS, "Geçersiz istek");
  const { error } = await supabase.from("user_blocks").insert({ blocked_user_id: id });
  // 23505: zaten engelli
  if (error && error.code !== "23505") fail(BLOCKS, "Engellenemedi");
  revalidatePath("/kesfet");
  redirect(BLOCKS);
}

export async function blockTeam(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "groupId");
  if (!UUID_RE.test(id)) fail(BLOCKS, "Geçersiz istek");
  const { error } = await supabase.from("user_blocks").insert({ blocked_group_id: id });
  if (error && error.code !== "23505") fail(BLOCKS, "Engellenemedi");
  revalidatePath("/kesfet");
  redirect(BLOCKS);
}

export async function unblock(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  if (!UUID_RE.test(id)) fail(BLOCKS, "Geçersiz istek");
  const { error } = await supabase.from("user_blocks").delete().eq("id", id);
  if (error) fail(BLOCKS, "Engel kaldırılamadı");
  revalidatePath("/kesfet");
  redirect(BLOCKS);
}

/** Geri bildirim: günde en fazla 5 mesaj */
export async function sendFeedback(fd: FormData) {
  const { supabase, user } = await requireUser();
  const back = "/geri-bildirim";
  const message = str(fd, "message");
  const category = ["genel", "hata", "oneri"].includes(str(fd, "category")) ? str(fd, "category") : "genel";
  if (message.length < 5) fail(back, "Mesaj en az 5 karakter olmalı");
  if (message.length > 1000) fail(back, "Mesaj en fazla 1000 karakter olabilir");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 5) fail(back, "Bugün çok fazla geri bildirim gönderdin; yarın tekrar dene");
  const { error } = await supabase.from("feedback").insert({ category, message });
  if (error) fail(back, "Gönderilemedi, tekrar dene");
  redirect(`${back}?saved=1`);
}

/** İlk girişteki karşılama sihirbazı; başarılıysa yönlendirir, hata sihirbazda gösterilir */
export async function completeOnboarding(fd: FormData): Promise<{ error: string }> {
  const { supabase, user } = await requireUser({ allowIncomplete: true });
  const rawNext = str(fd, "next");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/hosgeldin") ? rawNext : "/";

  const name = str(fd, "name");
  if (name.length < 2) return { error: "Ad soyad en az 2 karakter olmalı" };
  const card = validateCardName(str(fd, "cardName"));
  if (!card.ok) return { error: card.error };
  const birth = str(fd, "birthDate");
  if (!validBirthDate(birth)) return { error: "Geçerli bir doğum tarihi gir" };
  const city = str(fd, "city");
  if (!isProvince(city)) return { error: "İlini seç" };
  const position = asPosition(str(fd, "position"));
  if (!position) return { error: "Ana mevkini seç" };
  const secondary = fd.getAll("secondary").map(String).filter((p) => asPosition(p) && p !== position);
  const foot = ["L", "R", "B"].includes(str(fd, "foot")) ? str(fd, "foot") : null;
  const num = (key: string, lo: number, hi: number) => {
    const n = Number(str(fd, key));
    return str(fd, key) && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };

  // Karşılama en son tamamlanır: önceki bir kayıt hata verirse kullanıcı sihirbazda kalıp tekrar dener
  const { error: bodyErr } = await supabase
    .from("profiles")
    .update({ card_name: card.value, height_cm: num("height", 120, 230), weight_kg: num("weight", 30, 200) })
    .eq("id", user.id);
  if (bodyErr) return { error: "Bilgiler kaydedilemedi, tekrar dene" };
  if (birth) {
    const { error } = await supabase.from("profile_private").upsert({ user_id: user.id, birth_date: birth }, { onConflict: "user_id" });
    if (error) return { error: "Doğum tarihi kaydedilemedi" };
  }
  const { error } = await supabase.rpc("update_my_profile", {
    p_display_name: name,
    p_position: position,
    p_secondary: secondary,
    p_foot: foot,
    p_shirt: num("shirt", 1, 99),
    p_bio: str(fd, "bio").slice(0, 160),
    p_city: city,
    // Sadece seçilen ile ait bir ilçe kabul edilir
    p_district: canonicalDistrict(city, str(fd, "district")) ?? "",
    p_birth_year: birth ? Number(birth.slice(0, 4)) : null,
    p_complete_onboarding: true,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect(next);
}

// ---------------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------------

export async function createGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const back = "/grup-kur";
  const fields = teamFields(fd);
  if (fields.name.length < 2) fail(back, "Grup adı en az 2 karakter olmalı");
  const { data, error } = await supabase
    .from("groups")
    .insert({ ...fields, kind: "community", created_by: user.id })
    .select("id")
    .single();
  if (error) fail(back, "Grup oluşturulamadı");
  redirect(`/g/${data.id}`);
}

function teamFields(fd: FormData) {
  const city = str(fd, "city");
  const color = str(fd, "color");
  const logo = logoFromForm(fd.get("logo"));
  return {
    ...(logo === undefined ? {} : { logo }),
    name: str(fd, "name").slice(0, 60),
    city: isProvince(city) ? city : null,
    district: canonicalDistrict(city, str(fd, "district")),
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    description: str(fd, "description").slice(0, 200) || null,
  };
}

export async function createTeam(fd: FormData) {
  const { supabase, user } = await requireUser();
  const back = "/takim-kur";
  const fields = teamFields(fd);
  if (fields.name.length < 2) fail(back, "Takım adı en az 2 karakter olmalı");
  if (!fields.city) fail(back, "Takımın ilini seç");
  const { data, error } = await supabase
    .from("groups")
    .insert({ ...fields, kind: "team", created_by: user.id })
    .select("id")
    .single();
  if (error) fail(back, "Takım oluşturulamadı");
  redirect(`/g/${data.id}`);
}

export async function updateTeam(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players?bolum=bilgiler`;
  // Takım ve grup bilgileri aynı formla düzenlenir; grupta il isteğe bağlı
  const { data: g } = await supabase.from("groups").select("kind").eq("id", groupId).maybeSingle();
  const isTeam = g?.kind === "team";
  const word = isTeam ? "Takım" : "Grup";
  const fields = teamFields(fd);
  if (fields.name.length < 2) fail(back, `${word} adı en az 2 karakter olmalı`);
  if (isTeam && !fields.city) fail(back, "Takımın ilini seç");
  const { data, error } = await supabase.from("groups").update(fields).eq("id", groupId).select("id");
  if (error || !data?.length) fail(back, `${word} bilgilerini sadece ${isTeam ? "kaptan" : "kurucu"} ve yetkililer değiştirebilir`);
  // Arma veya otomatik seçildiyse eski yüklenmiş görsel depoda kalmasın
  if (fields.logo !== undefined) await supabase.storage.from("logos").remove([logoPath(groupId)]);
  // Keşfet / katılma isteği anahtarları (0044); işaretsiz kutu formda gelmez
  if (fd.get("discovery")) {
    const { error: dErr } = await supabase.rpc("set_group_discovery", {
      p_group: groupId,
      p_discoverable: fd.get("discoverable") === "on",
      p_requests_open: fd.get("requestsOpen") === "on",
    });
    if (dErr) fail(back, rpcMessage(dErr, "Keşfet ayarı kaydedilemedi"));
  }
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`${back}&saved=1`);
}

/** Depoya yüklenen logoyu takıma/gruba bağlar (adres sunucuda kurulur; yetki RLS'de) */
export async function saveLogo(groupId: string, version: number): Promise<{ error?: string }> {
  const { supabase } = await requireUser();
  if (!Number.isFinite(version) || version <= 0) return { error: "Geçersiz istek" };
  const url = logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, groupId, version);
  const { data, error } = await supabase.from("groups").update({ logo: url }).eq("id", groupId).select("id");
  if (error || !data?.length) return { error: "Logo kaydedilemedi" };
  revalidateTag(FEATURED_TAG);
  revalidatePath("/", "layout");
  return {};
}

/** Yüklenen logoyu siler (adres + depodaki dosya); otomatik armaya dönülür */
export async function deleteLogo(groupId: string): Promise<{ error?: string }> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("groups").update({ logo: null }).eq("id", groupId).select("id");
  if (error || !data?.length) return { error: "Logo silinemedi" };
  await supabase.storage.from("logos").remove([logoPath(groupId)]);
  revalidateTag(FEATURED_TAG);
  revalidatePath("/", "layout");
  return {};
}

export async function setMemberRole(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const playerId = str(fd, "playerId");
  const back = `/g/${groupId}/players?bolum=oyuncular`;
  const { error } = await supabase.rpc("set_member_role", {
    p_player_id: playerId,
    p_role: str(fd, "role"),
  });
  if (error) fail(back, error.message);
  announceRole(playerId, user.id);
  revalidatePath(`/g/${groupId}`, "layout");
}

export async function regenerateInvite(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { error } = await supabase.rpc("regenerate_invite", { p_group_id: groupId });
  if (error) fail(`/g/${groupId}`, error.message);
  revalidatePath(`/g/${groupId}`);
}

/**
 * Davet koduyla takıma/gruba katıl. Kod, kullanıcının seçtiği türle (takım/grup) uyuşmalı; tam link
 * yapıştırılırsa içindeki kod alınır. Zaten üyeyse doğrudan grubuna gider.
 */
export async function joinGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const code = extractInviteCode(str(fd, "code"));
  const kind = parseKind(str(fd, "tur"));
  const back = `/katil${kind ? `?tur=${kind}` : ""}`;
  if (!code) fail(back, "Davet kodunu yaz");
  const { data: pv } = await supabase.rpc("invite_preview", { p_code: code });
  const info = (Array.isArray(pv) ? pv[0] : pv) as { group_id: string; kind: "team" | "community"; already_member: boolean } | undefined;
  if (!info) fail(back, "Davet kodu geçersiz ya da yenilenmiş. Kaptandan/kurucudan güncel kodu iste.");
  if (!kindMatches(kind, info.kind)) {
    // Yanlış bölümden girildi: doğru bölüme, kod dolu ve önizlemeyle yönlendir
    const right = info.kind === "team" ? "takim" : "grup";
    fail(`/katil?tur=${right}&kod=${encodeURIComponent(code)}`, info.kind === "team" ? "Bu kod bir takıma ait; aşağıdan takıma katılabilirsin." : "Bu kod bir gruba ait; aşağıdan gruba katılabilirsin.");
  }
  if (info.already_member) redirect(`/g/${info.group_id}`);
  const { data, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error || !data) fail(back, rpcMessage(error ?? {}, "Katılınamadı"));
  announceJoin(data as string, user.id);
  revalidatePath("/", "layout");
  redirect(`/g/${data}`);
}

export interface GuestState {
  ok?: boolean;
  error?: string;
  /** Başarıda eklenen kişinin adı (bildirim için); her gönderimde değişir, form bunu anahtar olarak kullanır */
  added?: string;
  /** Hata durumunda yazılan isim geri doldurulsun */
  name?: string;
  at?: number;
}

/**
 * Maç ekranından misafir oyuncu ekler: hesabı olmayan biri maça geldiyse isim + mevki yazılır, oyuncu
 * hem gruba (misafir olarak) hem bu maçın kadrosuna girer. Oylanır ama oy veremez. Sadece planlanmış maçta;
 * yetkiyi RLS yapar (kaptan/yetkili/maçı kuran).
 * Sayfa zıplamasın diye yönlendirmez: durum döndürür, sayfa yerinde yenilenir (revalidatePath).
 */
export async function addGuestToMatch(_prev: GuestState, fd: FormData): Promise<GuestState> {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const name = str(fd, "name");
  const position = asPosition(str(fd, "position"));
  const error = (message: string): GuestState => ({ error: message, name, at: Date.now() });
  if (name.length < 2) return error("Misafirin ismi en az 2 karakter olmalı");

  // Misafiri gruba ve maçın kadrosuna tek işlemde yazar; maçı kuran organizatör de ekleyebilir (yetki veritabanında)
  const { error: rpcError } = await supabase.rpc("add_match_guest", { p_match: matchId, p_name: name, p_position: position });
  if (rpcError) return error(rpcMessage(rpcError, "Misafir eklenemedi"));
  revalidatePath(`/g/${groupId}/m/${matchId}`);
  return { ok: true, added: name.slice(0, 60), at: Date.now() };
}

export async function claimGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players?bolum=oyuncular`;
  const { error } = await supabase.rpc("claim_guest", {
    p_guest_id: str(fd, "guestId"),
    p_member_id: str(fd, "memberId"),
  });
  if (error) fail(back, error.message);
  // Misafirin geçmişi artık hesap sahibine ait: genel rating'i tüm maçlarla yeniden hesapla
  await recomputePlayers([str(fd, "guestId")]);
  revalidatePath(`/g/${groupId}/players`);
}

export async function setPosition(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const playerId = str(fd, "playerId");
  const position = asPosition(str(fd, "position"));
  const { error } = await supabase.rpc("set_player_position", {
    p_player_id: playerId,
    p_position: position,
  });
  if (error) fail(`/g/${groupId}/players?bolum=oyuncular`, error.message);
  revalidatePath(`/g/${groupId}`, "layout");
}

/** Yetkili oyuncuyu çıkarır: hesaplı üye ayrılmış sayılır (geçmişi kalır), misafir silinir */
export async function removePlayer(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players?bolum=oyuncular`;
  const { error } = await supabase.rpc("remove_member", { p_player_id: str(fd, "playerId") });
  if (error) fail(back, rpcMessage(error, "Oyuncu çıkarılamadı"));
  revalidatePath(`/g/${groupId}`, "layout");
}

// ---------------------------------------------------------------------------
// Maçtan çekilme (kaptan onaylı)
// ---------------------------------------------------------------------------

/** Kadrodaki oyuncu maçtan çekilmek ister; kaptan/yetkili onaylar. Yetkililer kendi adına doğrudan çıkar. */
export async function requestWithdrawal(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const reason = str(fd, "reason").slice(0, 200);
  if (reason.length < 3) fail(back, "Mazeretini yaz (en az 3 karakter)");
  const { data, error } = await supabase.rpc("request_withdrawal", { p_match: matchId, p_reason: reason });
  if (error) fail(back, rpcMessage(error, "İstek gönderilemedi"));
  const result = data as "pending" | "approved";
  later(async () => {
    const admin = createAdminClient();
    const [{ data: profile }, { data: match }, ids] = await Promise.all([
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      admin.from("matches").select("played_at, created_by").eq("id", matchId).maybeSingle(),
      groupMemberIds(admin, groupId, { adminsOnly: true }),
    ]);
    // Kararı maçı kuran (organizatör) da verir; ona da haber gitsin
    if (match?.created_by && !ids.includes(match.created_by)) ids.push(match.created_by);
    const who = profile?.display_name ?? "Bir oyuncu";
    const when = match ? formatDate(match.played_at) : "";
    const late = match ? new Date(match.played_at).getTime() - Date.now() < 3 * 3600_000 : false;
    if (result === "pending") await notify(ids, "match", text.withdrawalRequested(groupId, matchId, who, when, late, reason), { excludeUserId: user.id });
    else {
      await notify(ids, "match", text.withdrawalLeft(groupId, matchId, who, when), { excludeUserId: user.id });
      await notifySpotOpened(admin, matchId, who);
    }
  });
  revalidatePath(back);
  redirect(`${back}?cekilme=${result}`);
}

export async function cancelWithdrawal(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase.rpc("cancel_withdrawal", { p_id: str(fd, "withdrawalId") });
  if (error) fail(back, rpcMessage(error, "İstek geri çekilemedi"));
  revalidatePath(back);
  redirect(`${back}?cekilme=cancelled`);
}

/** Kaptan/yetkili çekilme isteğini onaylar veya reddeder; oyuncuya haber gider */
export async function decideWithdrawal(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const withdrawalId = str(fd, "withdrawalId");
  const approve = str(fd, "approve") === "1";
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase.rpc("decide_withdrawal", { p_id: withdrawalId, p_approve: approve });
  if (error) fail(back, rpcMessage(error, "Karar kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const { data: w } = await admin.from("match_withdrawals").select("player_id, matches(played_at)").eq("id", withdrawalId).maybeSingle();
    if (!w) return;
    const { data: gp } = await admin.from("group_players").select("user_id").eq("id", w.player_id).maybeSingle();
    const m = Array.isArray(w.matches) ? w.matches[0] : w.matches;
    if (gp?.user_id) await notify([gp.user_id], "match", text.withdrawalDecided(groupId, matchId, approve, m ? formatDate((m as { played_at: string }).played_at) : ""));
    if (approve) {
      const { data: who } = gp?.user_id ? await admin.from("profiles").select("display_name").eq("id", gp.user_id).maybeSingle() : { data: null };
      await notifySpotOpened(admin, matchId, who?.display_name ?? "Bir oyuncu");
    }
  });
  revalidatePath(back);
  redirect(`${back}?cekilme=${approve ? "approved-by-admin" : "denied-by-admin"}`);
}

/**
 * Kendi isteğiyle gruptan/takımdan ayrıl. Geçmiş (maçlar, oylar, rating) korunur; gelecekteki maçlardan ve açık
 * çağrılardan çıkarılır. Kaptan önce devretmeli; oylaması süren maçı olan bekler (kurallar veritabanında).
 */
export async function leaveGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players?bolum=ayril`;
  const [{ data: profile }, { data: group }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
  ]);
  const { error } = await supabase.rpc("leave_group", { p_group: groupId });
  if (error) fail(back, rpcMessage(error, "Ayrılınamadı"));
  later(async () => {
    const admin = createAdminClient();
    const ids = await groupMemberIds(admin, groupId, { adminsOnly: true });
    await notify(ids, "match", text.memberLeft(group?.name ?? "Grup", profile?.display_name ?? "Bir oyuncu", groupId), { excludeUserId: user.id });
  });
  revalidatePath("/", "layout");
  redirect("/?left=1");
}

/**
 * Silinen grubun yüklenmiş logosunu depodan kaldırır. Yetkiyi silme RPC'si doğruladıktan SONRA çağrılır:
 * grup gidince kimse yetkili sayılmadığından yönetici istemcisi gerekir.
 */
function removeDeletedGroupLogo(groupId: string) {
  later(async () => {
    await createAdminClient().storage.from("logos").remove([logoPath(groupId)]);
  });
}

/** Takımı dağıt (kaptan): oynanmış maç varsa arşivlenir (geçmiş ve puanlar kalır), yoksa silinir */
export async function disbandTeam(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { data, error } = await supabase.rpc("disband_team", { p_group: groupId });
  if (error) fail(`/g/${groupId}/players?bolum=dagit`, rpcMessage(error, "Takım dağıtılamadı"));
  if (data === "deleted") removeDeletedGroupLogo(groupId);
  revalidatePath("/", "layout");
  redirect(data === "deleted" ? "/" : `/g/${groupId}`);
}

/** Dağıtılmış takımı yeniden aç veya geçici takımı kalıcı yap (kaptan) */
export async function teamLifecycle(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const op = str(fd, "op") === "permanent" ? "make_team_permanent" : "reopen_team";
  const { error } = await supabase.rpc(op, { p_group: groupId });
  if (error) fail(`/g/${groupId}`, rpcMessage(error, "İşlem yapılamadı"));
  revalidatePath("/", "layout");
  redirect(`/g/${groupId}`);
}

/** Grubu kendi için sessize al / sesi aç: toplu duyurular (yeni çağrı, sohbet…) gelmez; sana özel bildirimler gelir */
export async function setGroupMuted(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { error } = await supabase.rpc("set_group_muted", { p_group: groupId, p_muted: str(fd, "muted") === "1" });
  if (error) fail(`/g/${groupId}`, rpcMessage(error, "Ayar kaydedilemedi"));
  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}`);
}

/** Tek başına kalan kaptan grubu/takımı siler (adını yazarak onaylar); kişinin genel rating'i yeniden hesaplanır */
export async function deleteGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players?bolum=ayril`;
  const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle();
  if (!group) fail(back, "Grup bulunamadı");
  if (str(fd, "confirm").toLocaleLowerCase("tr") !== group.name.toLocaleLowerCase("tr")) {
    fail(back, "Silmek için grubun adını aynen yazmalısın");
  }
  const { error } = await supabase.rpc("delete_group", { p_group: groupId });
  if (error) fail(back, rpcMessage(error, "Grup silinemedi"));
  removeDeletedGroupLogo(groupId);
  // Silinen grubun maçları kişinin istatistiğinden de gitti: kalan satırlardan genel rating'i yeniden hesapla
  later(async () => {
    const admin = createAdminClient();
    const { data: rows } = await admin.from("group_players").select("id").eq("user_id", user.id);
    if (rows?.length) await recomputePlayers(rows.map((r) => r.id));
  });
  revalidatePath("/", "layout");
  redirect("/?deleted=1");
}

// ---------------------------------------------------------------------------
// Maçlar
// ---------------------------------------------------------------------------

function toCandidates(
  rows: { id: string; position: Position | null }[],
  ratings: Map<string, { overall: number; name: string }>,
): TeamCandidate[] {
  return rows.map(({ id, position }) => ({
    id,
    name: ratings.get(id)?.name,
    overall: ratings.get(id)?.overall ?? 65,
    isGoalkeeper: position === "GK",
    position,
  }));
}

async function ratingsFor(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  groupId: string,
) {
  const players = await getGroupPlayers(supabase, groupId);
  return new Map(
    players.map((p) => [p.id, { overall: p.overall, name: p.display_name, position: p.position }]),
  );
}

/** Oylanabilecek oyuncular: maçın kadrosu; bağlı maçta rakip kadro da */
async function loadVoteTargets(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
) {
  const { data: m } = await supabase.from("matches").select("challenge_id").eq("id", matchId).single();
  let ids = [matchId];
  if (m?.challenge_id) {
    const { data: linked } = await supabase.from("matches").select("id").eq("challenge_id", m.challenge_id);
    ids = (linked ?? []).map((x) => x.id);
  }
  const { data } = await supabase.from("match_players").select("player_id").in("match_id", ids);
  return data ?? [];
}

async function loadRoster(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
) {
  const { data } = await supabase
    .from("match_players")
    .select("player_id, team, is_goalkeeper, position")
    .eq("match_id", matchId);
  return data ?? [];
}

async function writeTeams(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
  teamA: string[],
  teamB: string[],
) {
  const results = await Promise.all([
    supabase.from("match_players").update({ team: "A" }).eq("match_id", matchId).in("player_id", teamA),
    supabase.from("match_players").update({ team: "B" }).eq("match_id", matchId).in("player_id", teamB),
  ]);
  return results.find((r) => r.error)?.error ?? null;
}

/** Takımları yeniden dengeler: en iyiye yakın bölünmelerden rastgele biri. */
export async function reshuffleTeams(fd: FormData) {
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  if (!(await splitTeams(groupId, matchId))) fail(back, "Takımlar güncellenemedi");
  revalidatePath(back);
}

/**
 * Kendi aramızdaki maçın kadrosunu iki dengeli tarafa böler (maç kesinleşince ve "karıştır"da).
 * Yetki RLS'de (maçı yöneten); başarılıysa true.
 */
export async function splitTeams(groupId: string, matchId: string): Promise<boolean> {
  const { supabase } = await requireUser();
  const roster = await loadRoster(supabase, matchId);
  if (roster.length < 2) return true;
  const ratings = await ratingsFor(supabase, groupId);
  const splits = balanceTeams(
    toCandidates(
      roster.map((r) => ({ id: r.player_id, position: r.position as Position | null })),
      ratings,
    ),
  );
  const pick = pickVariant(splits, 1.5);
  const error = await writeTeams(
    supabase,
    matchId,
    pick.teamA.map((p) => p.id),
    pick.teamB.map((p) => p.id),
  );
  return !error;
}

export async function movePlayer(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const team = str(fd, "team") === "A" ? "B" : "A";
  const { error } = await supabase
    .from("match_players")
    .update({ team })
    .eq("match_id", matchId)
    .eq("player_id", str(fd, "playerId"));
  if (error) fail(back, "Oyuncu taşınamadı");
  revalidatePath(back);
}

/**
 * Skor ve istatistikler girilir, oylama 24 saatliğine açılır.
 * Takımlar arası (bağlı) maçta skoru iki takım da girer: ikisi birbirinin aynası olunca
 * iki maçın da oylaması açılır; o zamana kadar maç "skor onayı bekliyor" durumunda kalır.
 */
export async function submitResult(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  if (fd.get("scoreA") === "" || fd.get("scoreB") === "") fail(back, "Skoru girin");

  const [roster, { data: cur }, { data: allowed }] = await Promise.all([
    loadRoster(supabase, matchId),
    supabase.from("matches").select("challenge_id, status").eq("id", matchId).single(),
    supabase.rpc("can_manage_match", { p_match_id: matchId }),
  ]);
  if (!cur) fail(back, "Maç bulunamadı");
  if (!allowed) fail(back, "Sonucu sadece maçı oluşturan veya yetkililer girer");
  const linked = !!cur.challenge_id;

  // Geri alınamayan işlemlerden ÖNCE her şey doğrulanır. Gelmeyenler (kadrodan çıkar, güvenilirlik kaydı yazılır)
  // en son, maç durumu güncellenmeden hemen önce işaretlenir.
  const rosterIds = new Set(roster.map((r) => r.player_id));
  const noShows = [...new Set(fd.getAll("noshow").map(String).filter((id) => rosterIds.has(id)))];
  if (noShows.length && cur.status !== "planned") fail(back, "Gelmeyenler sadece planlanmış maçta işaretlenir");
  const present = roster.filter((r) => !noShows.includes(r.player_id));
  if (present.length < 2) {
    fail(back, noShows.length ? "Gelmeyenler çıkarılınca kadroda en az 2 oyuncu kalmalı" : "Sonuç girmek için kadroda en az 2 oyuncu olmalı");
  }
  if (cur.status !== "planned" && !(linked && cur.status === "played")) fail(back, "Bu maçın sonucu zaten girildi");

  // Gelmeyenlerin istatistiği yazılmaz (kadrodan çıkacaklar)
  const updates = await Promise.all(
    present.map((r) =>
      supabase
        .from("match_players")
        .update({
          goals: int(fd, `goals_${r.player_id}`),
          assists: int(fd, `assists_${r.player_id}`),
          saves: int(fd, `saves_${r.player_id}`),
        })
        .eq("match_id", matchId)
        .eq("player_id", r.player_id),
    ),
  );
  if (updates.some((u) => u.error)) fail(back, "İstatistikler kaydedilemedi");

  if (noShows.length) {
    const { error: nsError } = await supabase.rpc("mark_no_shows", { p_match: matchId, p_players: noShows });
    if (nsError) fail(back, rpcMessage(nsError, "Gelmeyenler işaretlenemedi"));
  }

  const deadline = new Date(Date.now() + VOTING_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .update({
      score_a: int(fd, "scoreA"),
      score_b: int(fd, "scoreB"),
      status: linked ? "played" : "voting",
      ...(linked ? {} : { voting_deadline: deadline }),
    })
    .eq("id", matchId)
    .in("status", linked ? ["planned", "played"] : ["planned"])
    .select("id");
  if (error || !data?.length) fail(back, "Maç güncellenemedi (yetkiniz olmayabilir)");

  if (linked) {
    const { data: state, error: settleError } = await supabase.rpc("settle_linked_match", { p_match_id: matchId });
    if (settleError) fail(back, "Skor eşleştirilemedi");
    if (state === "settled") announceVoting(matchId, user.id);
    else announceScore(matchId, state === "mismatch", int(fd, "scoreA"), int(fd, "scoreB"), user.id);
    revalidatePath(back);
    redirect(`${back}?skor=${state}`);
  }
  announceVoting(matchId, user.id);
  revalidatePath(back);
}

/**
 * Bağlı maçta skor eşleşmedi: rakip henüz girmediyse rakibin yetkililerine "sen de gir", girdiyse ve farklıysa
 * iki tarafın yetkililerine "uyuşmuyor". Yetkili = kaptan/yönetici + maçı kuran (can_manage_match ile aynı).
 */
function announceScore(matchId: string, mismatch: boolean, ownA: number, ownB: number, actorId: string) {
  later(async () => {
    const admin = createAdminClient();
    const { data: cur } = await admin.from("matches").select("challenge_id").eq("id", matchId).maybeSingle();
    if (!cur?.challenge_id) return;
    const { data: ms } = await admin.from("matches").select("id, group_id, created_by").eq("challenge_id", cur.challenge_id);
    const me = ms?.find((m) => m.id === matchId);
    const other = ms?.find((m) => m.id !== matchId);
    if (!me || !other) return;
    const managers = async (m: { group_id: string; created_by: string | null }) => [
      ...(await groupMemberIds(admin, m.group_id, { adminsOnly: true })),
      ...(m.created_by ? [m.created_by] : []),
    ];
    const [myName, otherName] = await Promise.all([groupName(admin, me.group_id), groupName(admin, other.group_id)]);
    if (mismatch) {
      await notify(await managers(me), "match", text.scoreMismatch(otherName, me.group_id, me.id), { excludeUserId: actorId });
      await notify(await managers(other), "match", text.scoreMismatch(myName, other.group_id, other.id), { excludeUserId: actorId });
    } else {
      // Rakibin açısından: kendi skoru = bizim girdiğimiz B
      await notify(await managers(other), "match", text.opponentScored(myName, other.group_id, other.id, ownB, ownA), { excludeUserId: actorId });
    }
  });
}

/** Oylama açıldı: maçın (bağlı maçta iki takımın) hesap sahiplerine "oy ver" */
function announceVoting(matchId: string, actorId: string) {
  later(async () => {
    const admin = createAdminClient();
    const matches = await linkedMatches(admin, matchId);
    for (const m of matches) {
      const ids = await matchAccountIds(admin, [m.id]);
      await notify(ids, "vote", text.voteOpened(m.group_id, m.id, m.kind === "external" ? m.opponent_name : null), { excludeUserId: actorId });
    }
  });
}

export async function submitVotes(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;

  const { data: me } = await supabase.rpc("my_player_id", { p_group_id: groupId });
  if (!me) fail(back, "Bu grupta oyuncu değilsiniz");

  // Takımlar arası maçta rakip takımın oyuncuları da oylanır (oy kendi maçıma yazılır)
  const roster = await loadVoteTargets(supabase, matchId);
  const votes = roster
    .filter((r) => r.player_id !== me)
    .map((r) => ({
      match_id: matchId,
      voter_id: me,
      target_id: r.player_id,
      score: int(fd, `score_${r.player_id}`),
    }));
  // Herkesi puanlamak zorunlu; boş puan varsayılan sayılmaz
  if (votes.some((v) => !(v.score >= 1 && v.score <= 10))) fail(back, "Göndermek için tüm oyuncuları puanlamalısın");
  const { error } = await supabase
    .from("votes")
    .upsert(votes, { onConflict: "match_id,voter_id,target_id" });
  if (error) fail(back, "Oylar kaydedilemedi. Oylama kapanmış olabilir.");

  const mvp = str(fd, "mvp");
  if (mvp && mvp !== me) {
    const { error: mvpError } = await supabase
      .from("mvp_votes")
      .upsert(
        { match_id: matchId, voter_id: me, target_id: mvp },
        { onConflict: "match_id,voter_id" },
      );
    if (mvpError) fail(back, "MVP oyu kaydedilemedi");
  }

  // Oy veren için "oy ver" / "kapanmak üzere" bildirimleri artık geçersiz: kutusundan kaldır
  await createAdminClient().from("notifications").delete().eq("user_id", user.id).in("tag", [`vote:${matchId}`, `vote-reminder:${matchId}`]);

  // Herkes oy verdiyse sonuçları hemen açıkla
  const { data: progress } = await supabase.rpc("voting_progress", { p_match_id: matchId });
  const p = Array.isArray(progress) ? progress[0] : progress;
  if (p && p.eligible > 0 && p.voters >= p.eligible) await finalizeMatch(matchId);

  revalidatePath(back);
  redirect(`${back}?voted=1`);
}

export async function closeVoting(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { data: allowed } = await supabase.rpc("can_manage_match", { p_match_id: matchId });
  if (!allowed) fail(back, "Oylamayı sadece maçı oluşturan veya yönetici kapatabilir");
  const { data: cur } = await supabase.from("matches").select("challenge_id").eq("id", matchId).single();
  if (cur?.challenge_id) {
    fail(back, "Takımlar arası maçın oylaması süre dolunca veya herkes oy verince kapanır; rakip takım da oy veriyor");
  }
  await finalizeMatch(matchId);
  revalidatePath(`/g/${groupId}`, "layout");
}

type Notice = { ids: string[]; type: NotificationType; content: Content };

/**
 * Teklif iptali bildirimleri. Alıcılar iptalden ÖNCE toplanır, işlem başarılı olunca `sendNotices` ile gönderilir.
 * Bekleyen teklif → karşı takımın yetkililerine "geri çekildi"; kabul edilmiş teklif → iki maçın kadro, yedek,
 * davetli, başvuran ve yetkililerine "iptal edildi".
 */
async function prepareCancelNotices(challengeId: string): Promise<Notice[]> {
  try {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("status, from_group_id, to_group_id").eq("id", challengeId).maybeSingle();
    if (!c) return [];
    if (c.status === "pending") {
      const ids = await groupMemberIds(admin, c.to_group_id as string, { adminsOnly: true });
      return [{ ids, type: "offer", content: text.challengeWithdrawn(await groupName(admin, c.from_group_id as string), c.to_group_id as string) }];
    }
    const { data: ms } = await admin.from("matches").select("id, group_id, played_at, opponent_name").eq("challenge_id", challengeId);
    return await Promise.all(
      (ms ?? []).map(async (m) => {
        const [roster, entries, admins, name] = await Promise.all([
          matchAccountIds(admin, [m.id as string]),
          admin.from("match_entries").select("user_id").eq("match_id", m.id).in("status", ["in", "reserve", "invited", "pending"]).not("user_id", "is", null),
          groupMemberIds(admin, m.group_id as string, { adminsOnly: true }),
          groupName(admin, m.group_id as string),
        ]);
        return {
          ids: [...new Set([...roster, ...(entries.data ?? []).map((e) => e.user_id as string), ...admins])],
          type: "match" as const,
          content: text.matchCancelled(name, m.group_id as string, m.id as string, formatDate(m.played_at as string), m.opponent_name as string | null),
        };
      }),
    );
  } catch (e) {
    console.error("[bildirim]", e instanceof Error ? e.message : e);
    return [];
  }
}

function sendNotices(notices: Notice[], actorId: string) {
  if (!notices.length) return;
  later(async () => {
    for (const n of notices) await notify(n.ids, n.type, n.content, { excludeUserId: actorId });
  });
}

// ---------------------------------------------------------------------------
// Takımlar arası maç teklifi
// ---------------------------------------------------------------------------

/** Kendi takımımızdan (fromGroupId) karşı takıma (toGroupId) teklif gönderir */
export async function createChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const from = str(fd, "fromGroupId");
  const to = str(fd, "toGroupId");
  const back = `/g/${to}/teklif`;
  if (!from) fail(back, "Hangi takımınızla teklif göndereceğinizi seçin");
  const when = str(fd, "playedAt");
  if (!when) fail(back, "Maç zamanını seçin");
  const size = sizeOf(fd);
  if (!size) fail(`${back}?from=${from}`, "Kaç kişilik oynanacağını seçin (5-11)");

  const { error } = await supabase.rpc("create_challenge", {
    p_size: size,
    p_from: from,
    p_to: to,
    p_at: parseLocalDateTime(when),
    p_venue: str(fd, "venue").slice(0, 80),
    p_fee: str(fd, "fee").slice(0, 120),
    p_message: str(fd, "message").slice(0, 300),
  });
  if (error) fail(`${back}?from=${from}`, rpcMessage(error, "Teklif gönderilemedi"));
  // Karşı takımın kaptan/yetkililerine "teklif geldi"
  later(async () => {
    const admin = createAdminClient();
    const [ids, fromName] = await Promise.all([groupMemberIds(admin, to, { adminsOnly: true }), groupName(admin, from)]);
    await notify(ids, "offer", text.challengeReceived(fromName, to, formatDate(parseLocalDateTime(when))), { excludeUserId: user.id });
  });
  revalidatePath(`/g/${from}/teklifler`);
  redirect(`/g/${from}/teklifler?sent=1`);
}

export async function respondChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/teklifler`;
  const accept = str(fd, "answer") === "accept";
  const { data: matchId, error } = await supabase.rpc("respond_challenge", {
    p_challenge_id: str(fd, "challengeId"),
    p_accept: accept,
  });
  if (error) fail(back, rpcMessage(error, "Teklif yanıtlanamadı"));
  // Teklifi gönderen takımın kaptan/yetkililerine yanıt
  later(async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("from_group_id, to_group_id").eq("id", str(fd, "challengeId")).maybeSingle();
    if (!c) return;
    const [ids, toName] = await Promise.all([groupMemberIds(admin, c.from_group_id, { adminsOnly: true }), groupName(admin, c.to_group_id)]);
    await notify(ids, "offer", text.challengeAnswered(toName, c.from_group_id, accept), { excludeUserId: user.id });
  });
  revalidatePath(back);
  // Kabulde doğrudan oluşan maça git: kadroyu belirlemek için
  if (accept && matchId) redirect(`/g/${groupId}/m/${matchId}?kabul=1`);
  redirect(back);
}

export async function cancelChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const challengeId = str(fd, "challengeId");
  const back = `/g/${groupId}/teklifler`;
  const notices = await prepareCancelNotices(challengeId);
  const { error } = await supabase.rpc("cancel_challenge", { p_challenge_id: challengeId });
  if (error) fail(back, rpcMessage(error, "Teklif iptal edilemedi"));
  sendNotices(notices, user.id);
  revalidatePath(`/g/${groupId}`, "layout");
  revalidatePath("/");
  redirect(back);
}

// ---------------------------------------------------------------------------
// Diziliş (sürükle-bırak editörü)
// ---------------------------------------------------------------------------

/**
 * Bir takımın dizilişini kaydeder: formasyon + oyuncu → slot atamaları. Sahaya dizilen oyuncunun maçtaki
 * mevkisi slotun rolü olur. Sadece planlanmış maçta; yetkiyi RLS yapar (kaptan/yetkili/maçı kuran).
 */
export async function setLineup(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const team = str(fd, "team") === "B" ? "B" : "A";
  const back = `/g/${groupId}/m/${matchId}`;

  const { data: match } = await supabase
    .from("matches")
    .select("status, kind, team_size, challenge_id")
    .eq("id", matchId)
    .single();
  if (!match) fail(back, "Maç bulunamadı");
  if (match.status !== "planned") fail(back, "Diziliş sadece planlanmış maçta değiştirilir");
  // Rakibe karşı maçta sadece A (bizim takım) vardır
  if (match.kind === "external" && team === "B") fail(back, "Geçersiz takım");

  const roster = (await loadRoster(supabase, matchId)).filter((r) => r.team === team);
  const size = match.team_size ?? inferSize(roster.length);
  const formation = getFormation(size, str(fd, "formation"));
  if (!formation) fail(back, "Geçersiz diziliş");

  let raw: unknown;
  try {
    raw = JSON.parse(str(fd, "lineup") || "{}");
  } catch {
    fail(back, "Diziliş okunamadı");
  }
  const rosterIds = new Set(roster.map((r) => r.player_id));
  const assign: Record<string, number | null> = {};
  for (const [id, slot] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!rosterIds.has(id)) continue; // kadroda olmayan oyuncu sayılmaz
    assign[id] = typeof slot === "number" ? slot : null;
  }
  if (!validAssignment(assign, formation)) fail(back, "Diziliş geçersiz (iki oyuncu aynı yerde olamaz)");

  // Benzersiz slot kuralı yüzünden önce takımın tüm slotları boşaltılır
  const cleared = await supabase.from("match_players").update({ slot: null }).eq("match_id", matchId).eq("team", team);
  if (cleared.error) fail(back, "Diziliş kaydedilemedi (yetkiniz olmayabilir)");

  const results = await Promise.all(
    Object.entries(assign)
      .filter(([, slot]) => slot !== null)
      .map(([id, slot]) => {
        const role = formation.slots[slot as number].role as Role;
        return supabase
          .from("match_players")
          .update({ slot, position: role, is_goalkeeper: role === "GK" })
          .eq("match_id", matchId)
          .eq("player_id", id);
      }),
  );
  if (results.some((r) => r.error)) fail(back, "Diziliş kaydedilemedi");

  const { error } = await supabase
    .from("matches")
    .update({
      [team === "A" ? "formation_a" : "formation_b"]: formation.id,
      ...(match.team_size ? {} : { team_size: size }),
    })
    .eq("id", matchId);
  if (error) fail(back, "Diziliş kaydedilemedi");
  revalidatePath(back);
  redirect(`${back}?dizilis=1`);
}

// ---------------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------------

/**
 * Sohbet mesajı atılınca göndericinin tarayıcısı çağırır (mesaj doğrudan veritabanına yazıldığı için sunucu bilmez).
 * Mesajın gerçekten çağıranın, yeni ve metin olduğu doğrulanır; grup üyelerine (gönderen hariç) bildirim gider.
 * Aynı gruptan 10 dakikada en fazla 1 bildirim alınır (birleştirme notify içinde).
 */
export async function notifyChatMessage(groupId: string, messageId: number) {
  const { supabase, user } = await requireUser();
  const { data: msg } = await supabase
    .from("group_messages")
    .select("id, kind, body, created_at, group_players(user_id, display_name)")
    .eq("id", messageId)
    .eq("group_id", groupId)
    .maybeSingle();
  const author = Array.isArray(msg?.group_players) ? msg?.group_players[0] : msg?.group_players;
  if (!msg || msg.kind !== "text" || !author || (author as { user_id: string | null }).user_id !== user.id) return;
  if (Date.now() - new Date(msg.created_at).getTime() > 60_000) return; // eski mesaj için bildirim yok
  const authorName = (author as { display_name: string }).display_name;
  later(async () => {
    const admin = createAdminClient();
    const [ids, name] = await Promise.all([groupMemberIds(admin, groupId, { broadcast: true }), groupName(admin, groupId)]);
    await notify(ids, "chat", text.chat(name, groupId, authorName, msg.body), { excludeUserId: user.id });
  });
}

/** Bir kişiyle birebir sohbeti açar (yoksa istek olarak oluşturur) ve konuşmaya yönlendirir */
export async function openDm(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "userId");
  if (!UUID_RE.test(id)) fail("/sohbet", "Geçersiz istek");
  const { data, error } = await supabase.rpc("start_dm", { p_user_id: id });
  if (error || !data) fail(`/oyuncu/${id}`, rpcMessage(error ?? {}, "Konuşma açılamadı"));
  redirect(`/sohbet/${data}`);
}

/** Birebir mesaj gönderildikten sonra karşı tarafa bildirim (RPC mesajı yazdı; burada sadece bildirim) */
export async function notifyDm(threadId: string, messageId: number) {
  const { supabase, user } = await requireUser();
  if (!UUID_RE.test(threadId)) return;
  const { data: msg } = await supabase
    .from("dm_messages")
    .select("id, author_id, kind, body, created_at, thread_id, dm_threads(user_a, user_b, status, requested_by)")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .maybeSingle();
  const thread = Array.isArray(msg?.dm_threads) ? msg?.dm_threads[0] : msg?.dm_threads;
  if (!msg || msg.kind !== "text" || msg.author_id !== user.id || !thread) return;
  if (Date.now() - new Date(msg.created_at).getTime() > 60_000) return;
  const t = thread as { user_a: string; user_b: string; status: string; requested_by: string };
  const other = t.user_a === user.id ? t.user_b : t.user_a;
  later(async () => {
    const admin = createAdminClient();
    const { data: me } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    await notify([other], "dm", text.dm(me?.display_name ?? "Bir oyuncu", threadId, msg.body, t.status === "pending"), { excludeUserId: user.id });
  });
}

/** Oyuncuyu takıma/gruba davet et (sadece kaptan/yetkili; yetkiyi RPC denetler). Davet kartı konuşmaya düşer, davet edilene bildirim gider. */
export async function inviteToGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const userId = str(fd, "userId");
  // Takım sayfasından (ödünç oyuncuya) gelindiyse oraya döner
  const from = str(fd, "back");
  const back = from.startsWith("/g/") ? from : `/oyuncu/${userId}`;
  if (!UUID_RE.test(groupId) || !UUID_RE.test(userId)) fail("/", "Geçersiz istek");
  const { data: inviteId, error } = await supabase.rpc("invite_to_group", { p_group_id: groupId, p_user_id: userId });
  if (error || !inviteId) fail(back, rpcMessage(error ?? {}, "Davet gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: inv }, { data: me }, { data: thread }] = await Promise.all([
      admin.from("group_invites").select("group_name, group_kind").eq("id", inviteId as string).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      admin.from("dm_threads").select("id").eq("user_a", user.id < userId ? user.id : userId).eq("user_b", user.id < userId ? userId : user.id).maybeSingle(),
    ]);
    if (!inv || !thread) return;
    await notify([userId], "invite", text.groupInvite(me?.display_name ?? "Bir oyuncu", inv.group_name, inv.group_kind as "team" | "community", thread.id, inviteId as string), { excludeUserId: user.id });
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}davet=1`);
}

/** Daveti kabul et (üye olur) / reddet; daveti gönderene bildirim gider */
export async function respondGroupInvite(inviteId: string, accept: boolean) {
  const { supabase, user } = await requireUser();
  if (!UUID_RE.test(inviteId)) return { ok: false, error: "Geçersiz istek" };
  const { data: inv } = await supabase.from("group_invites").select("inviter_id, group_name, group_kind").eq("id", inviteId).maybeSingle();
  const { data, error } = await supabase.rpc("respond_group_invite", { p_invite_id: inviteId, p_accept: accept });
  revalidatePath("/sohbet");
  revalidatePath("/");
  if (!error && inv && data) {
    later(async () => {
      const { data: me } = await createAdminClient().from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      await notify([inv.inviter_id], "invite", text.inviteReply(me?.display_name ?? "Bir oyuncu", inv.group_name, inv.group_kind as "team" | "community", accept, data as string), { excludeUserId: user.id });
    });
    // Daveti gönderen zaten "kabul edildi" aldı; diğer yetkililere "katıldı"
    if (accept) announceJoin(data as string, user.id, [inv.inviter_id as string]);
  }
  return { ok: !error, groupId: (data as string | null) ?? undefined, error: error ? rpcMessage(error, "İşlem yapılamadı") : undefined };
}

/** Gönderilmiş daveti geri çek */
export async function cancelGroupInvite(inviteId: string) {
  const { supabase } = await requireUser();
  if (!UUID_RE.test(inviteId)) return { ok: false, error: "Geçersiz istek" };
  const { error } = await supabase.rpc("cancel_group_invite", { p_invite_id: inviteId });
  return { ok: !error, error: error ? rpcMessage(error, "İşlem yapılamadı") : undefined };
}

/** Arkadaşlık işlemleri (form): op = add | accept | decline | remove. İşlemden sonra `back` sayfasına döner. */
export async function friendAction(fd: FormData) {
  const { supabase, user } = await requireUser();
  const op = str(fd, "op");
  const id = str(fd, "userId");
  const rawBack = str(fd, "back");
  const back = /^\/[^/\\]/.test(rawBack) ? rawBack : `/oyuncu/${id}`;
  if (!UUID_RE.test(id) || id === user.id) fail("/sosyal", "Geçersiz istek");

  let result: string | null = null;
  let error: { message?: string; code?: string } | null = null;
  if (op === "add") {
    const r = await supabase.rpc("send_friend_request", { p_user_id: id });
    error = r.error;
    result = (r.data as string | null) ?? null;
  } else if (op === "accept" || op === "decline") {
    error = (await supabase.rpc("respond_friend_request", { p_user_id: id, p_accept: op === "accept" })).error;
    if (!error && op === "accept") result = "accepted";
  } else if (op === "remove") {
    error = (await supabase.rpc("remove_friendship", { p_user_id: id })).error;
  } else {
    fail(back, "Geçersiz istek");
  }
  if (error) fail(back, rpcMessage(error, "İşlem yapılamadı"));

  // Bildirim: istek gitti → karşı tarafa; kabul edildi (veya karşılıklı istek) → isteği atana
  if ((op === "add" && result === "pending") || result === "accepted") {
    later(async () => {
      const { data: me } = await createAdminClient().from("profiles").select("display_name").eq("id", user.id).maybeSingle();
      const name = me?.display_name ?? "Bir oyuncu";
      await notify([id], "friend", result === "pending" ? text.friendRequest(name) : text.friendAccepted(name, user.id), { excludeUserId: user.id });
    });
  }
  revalidatePath("/sosyal");
  redirect(back);
}

/** Maça davet (yöneten): kişiye sohbetten maç kartı gider (share_match_card = davet); sayfadan ayrılmadan sonuç döner */
export async function inviteToMatch(groupId: string, matchId: string, userId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (![groupId, matchId, userId].every((v) => UUID_RE.test(v))) return { error: "Geçersiz istek" };
  const { data: messageId, error } = await supabase.rpc("share_match_card", { p_user_id: userId, p_type: "match", p_ref: matchId });
  if (error || messageId == null) return { error: rpcMessage(error ?? {}, "Davet gönderilemedi") };
  later(async () => {
    const admin = createAdminClient();
    const [{ data: msg }, { data: me }] = await Promise.all([
      admin.from("dm_messages").select("thread_id, card").eq("id", messageId as number).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    const card = msg?.card as { group_name?: string; starts_at?: string; time_tbd?: boolean } | null;
    if (!msg || !card?.group_name) return;
    const whenText = card.starts_at
      ? new Date(card.starts_at).toLocaleString("tr-TR", {
          timeZone: "Europe/Istanbul",
          day: "numeric",
          month: "short",
          ...(card.time_tbd ? { weekday: "long" } : { hour: "2-digit", minute: "2-digit" }),
        })
      : "";
    await notify([userId], "invite", text.matchCard(me?.display_name ?? "Bir oyuncu", card.group_name, "Maç", whenText, msg.thread_id as string, matchId), { excludeUserId: user.id });
  });
  revalidatePath(`/g/${groupId}/m/${matchId}`);
  return {};
}

/** Bekleyen mesaj isteğini kabul et / reddet */
export async function respondDmRequest(threadId: string, accept: boolean) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("respond_dm_request", { p_thread_id: threadId, p_accept: accept });
  revalidatePath("/sohbet");
  return { ok: !error, error: error ? rpcMessage(error, "İşlem yapılamadı") : undefined };
}

/** Bildirim kutusunu okundu işaretle (boşsa hepsi) */
export async function markNotificationsRead(ids?: string[]) {
  const { supabase } = await requireUser();
  await supabase.rpc("mark_notifications_read", { p_ids: ids?.length ? ids : null });
  revalidatePath("/bildirimler");
}

/** Cihazın push aboneliğini kaydet / kaldır (RPC: aynı cihaz başka kullanıcıya geçebilir) */
export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    p_user_agent: userAgent.slice(0, 300),
  });
  return { ok: !error, error: error ? rpcMessage(error, "Abonelik kaydedilemedi") : undefined };
}

/** ☰ çekmecesinin verisi: her sayfada değil, menü açılırken/ilk boşta çekilir (layout'u yavaşlatmasın) */
export async function loadMenu() {
  return loadMenuData();
}

/** Bu hesabın cihazlarına test bildirimi: abonelik, anahtarlar ve push servisi uçtan uca denenir */
export async function sendTestNotification() {
  const { user } = await requireUser();
  return sendTestPush(user.id);
}

export async function removePushSubscription(endpoint: string) {
  const { supabase } = await requireUser();
  await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint });
}

/** Bildirim kategorisi aç/kapat (satır yoksa oluşturur) */
export async function setNotificationPref(key: string, value: boolean) {
  const { supabase, user } = await requireUser();
  if (!["votes", "matches", "offers", "chat"].includes(key)) return;
  await supabase.from("notification_prefs").upsert({ user_id: user.id, [key]: value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  revalidatePath("/profil");
}

// ---------------------------------------------------------------------------
// Yetenek değerlendirmesi
// ---------------------------------------------------------------------------

/** Birlikte oynadığın bir oyuncuyu 6 yetenekte 1-10 puanla; boş bırakılan "bilmiyorum" demektir */
export async function submitSkillRating(fd: FormData) {
  const { supabase, user } = await requireUser();
  const playerId = str(fd, "playerId");
  const keeper = str(fd, "keeper") === "1";
  const scores: Record<string, number | null> = {};
  for (const { key } of skillSet(keeper)) {
    const raw = str(fd, `score_${key}`);
    scores[key] = raw === "" ? null : Number(raw);
  }
  const { error } = await supabase.rpc("submit_skill_rating", { p_target_player: playerId, p_scores: scores });
  if (error) fail("/yetenek", rpcMessage(error, "Değerlendirme kaydedilemedi"));
  // Oy verenin normalizasyonu değiştiği için tüm hedefleri yeniden hesaplanır; yanıttan sonra
  later(async () => {
    await recomputeSkillsForVoter(createAdminClient(), user.id);
  });
  revalidatePath("/yetenek");
  redirect("/yetenek?saved=1");
}
