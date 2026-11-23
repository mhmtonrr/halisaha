// Birleşik çağrı verisi (0035): çağrı + yanıtlayanlar, gruptaki açık çağrılar, organizatörün bekleyen kararları.
import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/data";
import type { CallShape, Responder } from "@/lib/call-rules";

export interface Call extends CallShape {
  id: string;
  group_id: string;
  created_by: string;
  venue: string | null;
  note: string | null;
  positions: string[];
  match_id: string | null;
}

export interface CallMatch {
  id: string;
  group_id: string;
  kind: "internal" | "external";
  status: string;
  played_at: string;
  opponent_name: string | null;
  group_name: string;
}

const CALL_COLS = "id, group_id, created_by, purpose, status, play_on, starts_at, venue, team_size, capacity, decide_by, note, positions, match_id";

export async function loadCall(supabase: SupabaseClient, pollId: string, groupId: string) {
  const { data: call } = await supabase.from("match_polls").select(CALL_COLS).eq("id", pollId).eq("group_id", groupId).maybeSingle();
  if (!call) return null;
  const [{ data: responders }, { data: canManage }, match] = await Promise.all([
    supabase.rpc("poll_responders", { p_poll: pollId }),
    supabase.rpc("can_manage_poll", { p_poll_id: pollId }),
    call.match_id ? loadCallMatch(supabase, call.match_id as string) : Promise.resolve(null),
  ]);
  return { call: call as Call, responders: (responders ?? []) as Responder[], canManage: !!canManage, match };
}

async function loadCallMatch(supabase: SupabaseClient, matchId: string): Promise<CallMatch | null> {
  const { data } = await supabase
    .from("matches")
    .select("id, group_id, kind, status, played_at, opponent_name, groups!matches_group_id_fkey(name)")
    .eq("id", matchId)
    .maybeSingle();
  if (!data) return null;
  const g = one(data.groups as { name: string } | { name: string }[] | null);
  return { ...(data as Omit<CallMatch, "group_name">), group_name: g?.name ?? "" };
}

/** Grupta görünen çağrılar: açık toplama/adam arama ve kesinleşmiş ama maçı hâlâ planlı olanlar (yedek için) */
export async function groupCalls(supabase: SupabaseClient, groupId: string): Promise<Call[]> {
  const { data } = await supabase
    .from("match_polls")
    .select(CALL_COLS)
    .eq("group_id", groupId)
    .in("status", ["open", "filled"])
    .order("play_on")
    .limit(20);
  return (data ?? []) as Call[];
}

/** Belirli bir maça bağlı açık adam aramalar (maç ekranı için; yayınlandığı grup dahil) */
export async function fillCallsOfMatch(supabase: SupabaseClient, matchId: string) {
  const { data } = await supabase
    .from("match_polls")
    .select(`${CALL_COLS}, groups(name)`)
    .eq("match_id", matchId)
    .eq("purpose", "fill")
    .in("status", ["open", "filled"]);
  return (data ?? []).map((c) => ({ ...(c as unknown as Call), group_name: one(c.groups as { name: string } | { name: string }[] | null)?.name ?? "" }));
}

/** Maçı kuran toplama çağrısı (varsa): maç ekranında "yedekler" bağlantısı için */
export async function gatherCallOfMatch(supabase: SupabaseClient, matchId: string) {
  const { data } = await supabase
    .from("match_polls")
    .select("id, group_id")
    .eq("match_id", matchId)
    .eq("purpose", "gather")
    .maybeSingle();
  return data as { id: string; group_id: string } | null;
}

/** Organizatörün açık toplama çağrıları (ana sayfada "kadroyu kesinleştir" uyarısı) */
export async function myOpenGatherCalls(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("match_polls")
    .select(`${CALL_COLS}, groups(name)`)
    .eq("created_by", userId)
    .eq("purpose", "gather")
    .eq("status", "open")
    .order("play_on")
    .limit(10);
  return (data ?? []).map((c) => ({ ...(c as unknown as Call), group_name: one(c.groups as { name: string } | { name: string }[] | null)?.name ?? "" }));
}

export interface ManagedTeam {
  id: string;
  name: string;
  temporary: boolean;
  archived: boolean;
}

/**
 * Kesinleştirmede seçilebilecek takımlar: maç açabildiğim açık takımlar + kaptanı olduğum dağıtılmış geçici takımlar
 * (seçilince yeniden açılır; yeni takım kurmak yerine eskisi kullanılsın diye). Geçiciler önce.
 */
export async function myManagedTeams(supabase: SupabaseClient, userId: string): Promise<ManagedTeam[]> {
  type G = { id: string; name: string; kind: string; is_temporary: boolean; archived_at: string | null };
  const { data } = await supabase
    .from("group_players")
    .select("role, groups(id, name, kind, is_temporary, archived_at)")
    .eq("user_id", userId)
    .eq("is_loan", false)
    .is("left_at", null)
    .in("role", ["captain", "admin", "organizer"]);
  return (data ?? [])
    .flatMap((r) => {
      const g = one(r.groups as G | G[] | null);
      if (!g || g.kind !== "team") return [];
      if (g.archived_at && !(g.is_temporary && r.role === "captain")) return [];
      return [{ id: g.id, name: g.name, temporary: g.is_temporary, archived: !!g.archived_at }];
    })
    .sort((a, b) => Number(b.temporary) - Number(a.temporary) || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "tr"));
}

/** Adam aramayı açabileceğim topluluklar (organizatör/yetkili/kurucu olduğum) */
export async function myManagedCommunities(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("group_players")
    .select("groups(id, name, kind)")
    .eq("user_id", userId)
    .eq("is_loan", false)
    .is("left_at", null)
    .in("role", ["captain", "admin", "organizer"]);
  return (data ?? [])
    .map((r) => one(r.groups as { id: string; name: string; kind: string } | { id: string; name: string; kind: string }[] | null))
    .filter((g): g is { id: string; name: string; kind: string } => !!g && g.kind === "community")
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}
