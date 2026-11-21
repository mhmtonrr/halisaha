"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Watch {
  table: string;
  /** PostgREST biçiminde tek koşul: `group_id=eq.<id>` veya `group_id=in.(a,b)` */
  filter?: string;
}

/**
 * Sayfayı canlı tutar: verilen tablolardaki değişiklikleri Supabase Realtime ile dinler ve sunucu
 * bileşenlerini yeniden çeker (router.refresh) — sayfa kaldığı yerde kalır, form/sürükleme durumu korunur.
 * Realtime RLS'e uyar; kullanıcı sadece görebildiği satırların değişikliğinden haberdar olur.
 *
 * Yedekler: sekme tekrar görünür olunca, ağ geri gelince ve bağlantı yeniden kurulunca bir yenileme;
 * `pollMs` verilirse görünürken periyodik yenileme (ör. başkalarının oyu RLS'ten dolayı Realtime'a düşmeyen oylama sayacı).
 * Silme olayları filtreli aboneliklere ulaşmaz; bu yüzden silmeye bağlı durumlar (iptal) bir güncelleme olayıyla
 * (örneğin teklifin durumu) da izlenir.
 */
export function LiveRefresh({ watches, pollMs }: { watches: Watch[]; pollMs?: number }) {
  const router = useRouter();
  const key = JSON.stringify(watches);

  useEffect(() => {
    const supabase = createClient();
    const list: Watch[] = JSON.parse(key);
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let connectedBefore = false;

    // Art arda gelen değişiklikler (ör. toplu kadro ekleme) tek yenilemeye iner
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      let ch = supabase.channel(`live:${Math.random().toString(36).slice(2)}`);
      for (const w of list) {
        ch = ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: w.table, ...(w.filter ? { filter: w.filter } : {}) },
          refresh,
        );
      }
      channel = ch.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Yeniden bağlanınca kaçırılanları yakala (ilk bağlantıda sayfa zaten güncel)
        if (connectedBefore) refresh();
        connectedBefore = true;
      });
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    const poll = pollMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") router.refresh();
        }, pollMs)
      : undefined;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [key, pollMs, router]);

  return null;
}
