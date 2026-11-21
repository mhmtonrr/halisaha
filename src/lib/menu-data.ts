import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getMemberships, type Role } from "@/lib/teams-data";
import { getSkillQueue } from "@/lib/skill-queue";

export interface MenuGroup {
  id: string;
  name: string;
  kind: "community" | "team";
  color: string | null;
  role: Role;
}

export interface MenuData {
  name: string;
  overall: number;
  city: string | null;
  groups: MenuGroup[];
  /** Değerlendirmeni bekleyen oyuncu sayısı (20+ için 20) */
  skillCount: number;
}

/** ☰ çekmecesinin verisi; giriş yapmamış veya karşılamayı bitirmemiş kullanıcıda null (menü görünmez) */
export async function loadMenuData(): Promise<MenuData | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from("profiles").select("display_name, city, onboarded_at").eq("id", user.id).maybeSingle();
    if (!profile?.onboarded_at) return null;
    const [memberships, queue] = await Promise.all([getMemberships(supabase, user.id), getSkillQueue(supabase, 20)]);
    const best = memberships.reduce((m, x) => Math.max(m, x.overall), 0);
    return {
      name: profile.display_name,
      overall: best || 65,
      city: profile.city,
      groups: memberships
        .map((m) => ({ id: m.group.id, name: m.group.name, kind: m.group.kind, color: m.group.color, role: m.role }))
        .sort((a, b) => Number(b.kind === "team") - Number(a.kind === "team") || a.name.localeCompare(b.name, "tr")),
      skillCount: queue.length,
    };
  } catch {
    // Menü açılamazsa sayfa yine de çalışmalı
    return null;
  }
}
