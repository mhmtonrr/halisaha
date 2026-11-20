import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error || !data) redirect(`/?error=${encodeURIComponent("Davet linki geçersiz")}`);
  redirect(`/g/${data}`);
}
