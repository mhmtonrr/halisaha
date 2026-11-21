import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { ChatRoom, type ChatMember, type ChatMessage } from "./ChatRoom";

const PAGE_SIZE = 50;

export default async function ChatPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase, user } = await requireUser();

  const [{ data: group }, { data: members }, { data: messages }] = await Promise.all([
    supabase.from("groups").select("id, name, color, kind").eq("id", groupId).maybeSingle(),
    supabase.from("group_players").select("id, display_name, role, user_id, is_loan").eq("group_id", groupId),
    supabase
      .from("group_messages")
      .select("id, author_id, kind, body, poll_id, match_id, deleted_at, created_at")
      .eq("group_id", groupId)
      .order("id", { ascending: false })
      .limit(PAGE_SIZE),
  ]);
  if (!group) notFound();
  // Ödünç oyuncu takım sohbetine giremez
  const me = (members ?? []).find((m) => m.user_id === user.id && !m.is_loan);
  // Sohbet sadece üyelere
  if (!me) redirect(`/g/${groupId}`);

  await supabase.rpc("mark_chat_read", { p_group_id: groupId });

  return (
    <ChatRoom
      groupId={groupId}
      groupName={group.name}
      groupColor={group.color}
      kind={group.kind as "team" | "community"}
      meId={me.id}
      canModerate={me.role === "captain" || me.role === "admin"}
      members={(members ?? []).map((m): ChatMember => ({ id: m.id, name: m.display_name, role: m.role, guest: !m.user_id }))}
      initial={((messages ?? []) as ChatMessage[]).reverse()}
      hasMore={(messages?.length ?? 0) === PAGE_SIZE}
    />
  );
}
