import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { announceJoin } from "@/lib/membership-notify";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase, user } = await requireUser();
  // Zaten üyeyse (link tekrar açıldı) yetkililere "katıldı" gitmesin
  const { data: pv } = await supabase.rpc("invite_preview", { p_code: code });
  const already = !!(Array.isArray(pv) ? pv[0] : pv)?.already_member;
  const { data, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error || !data) redirect(`/?error=${encodeURIComponent("Davet linki geçersiz")}`);
  if (!already) announceJoin(data as string, user.id);
  redirect(`/g/${data}`);
}
