"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Okunmamış bildirim sayısı rozeti: sayfa değişince ve yeni bildirim gelince (Realtime) güncellenir */
export function NotificationBadge() {
  const path = usePathname();
  const [count, setCount] = useState(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { count: n } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      setCount(n ?? 0);
    };
    loadRef.current = load;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`notif-badge:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${data.session.user.id}` }, () => void load())
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    loadRef.current();
  }, [path]);

  if (count === 0) return null;
  return (
    <span className="absolute right-[calc(50%-18px)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-pitch-950">
      {count > 9 ? "9+" : count}
    </span>
  );
}
