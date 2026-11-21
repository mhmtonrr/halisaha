"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Açılır bölüm: `openInitially` ise sayfa ilk yüklendiğinde bir kez açılır, sonrasında açık/kapalı durumu kullanıcıya aittir.
 * (Sunucu bileşenindeki `open={koşul}` her canlı yenilemede yeniden uygulanır ve kullanıcının açtığı bölümü kapatabilir.)
 */
export function AutoOpenDetails({
  openInitially,
  summary,
  children,
  className,
}: {
  openInitially: boolean;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openInitially && ref.current) ref.current.open = true;
    // Sadece ilk yükleme: sonraki prop değişimleri bilerek yok sayılır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <details ref={ref} className={className}>
      <summary className="cursor-pointer py-2 text-sm text-muted">{summary}</summary>
      {children}
    </details>
  );
}
