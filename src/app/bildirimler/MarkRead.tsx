"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/lib/actions";

/** Sayfa açıkken okunmamışlar kısa süre sonra okundu işaretlenir (önce vurgulu görünür) */
export function MarkRead({ unread }: { unread: number }) {
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => void markNotificationsRead(), 1500);
    return () => clearTimeout(t);
  }, [unread]);
  return null;
}
