"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useChatUnread, useUnreadCount } from "./NotificationBadge";
import { TeamBadge } from "./TeamBadge";
import { Avatar } from "./Avatar";
import { loadMenu } from "@/lib/actions";
import type { MenuData } from "@/lib/menu-data";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const MenuContext = createContext<{ available: boolean; open: () => void }>({ available: false, open: () => {} });

const HIDDEN = ["/login", "/auth", "/hosgeldin", "/privacy", "/sifre-yenile"];

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** Başlıktaki sağ üst düğmeler: bildirim çanı ve ☰. Menü yoksa (giriş yapılmamış) hiçbir şey çizmez. */
export function MenuControls({ className }: { className?: string }) {
  const { available, open } = useContext(MenuContext);
  const unread = useUnreadCount();
  const chatUnread = useChatUnread();
  if (!available) return null;
  return (
    <div className={cx("flex shrink-0 items-center gap-2", className)}>
      <Link href="/sohbet" aria-label="Sohbetler" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent">
        <Icon>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        </Icon>
        {chatUnread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-black text-pitch-950">
            {chatUnread > 9 ? "9+" : chatUnread}
          </span>
        )}
      </Link>
      <Link href="/bildirimler" aria-label="Bildirimler" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent">
        <Icon>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </Icon>
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-pitch-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={open}
        aria-label="Menüyü aç"
        aria-haspopup="dialog"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent"
      >
        <Icon>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </Icon>
      </button>
    </div>
  );
}

function NavLink({ href, label, badge, icon }: { href: string; label: string; badge?: number; icon: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-12 items-center gap-3 rounded-xl px-3 hover:bg-pitch-800">
      <span className="text-muted">
        <Icon>{icon}</Icon>
      </span>
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-black text-pitch-950">{badge >= 20 ? "20+" : badge}</span>
      )}
    </Link>
  );
}

/** Çekmecede takımlar ve gruplar ayrı başlıklar: liste (açılır kısayollarla) + katıl/kur bağlantıları */
function GroupSection({
  title,
  items,
  openId,
  onToggle,
  empty,
  joinHref,
  joinLabel,
  createHref,
  createLabel,
}: {
  title: string;
  items: MenuData["groups"];
  openId: string | null;
  onToggle: (id: string) => void;
  empty: string;
  joinHref: string;
  joinLabel: string;
  createHref: string;
  createLabel: string;
}) {
  return (
    <>
      <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {items.length === 0 && <p className="px-3 pb-1 text-sm text-muted">{empty}</p>}
      {items.map((g) => {
        const isOpen = openId === g.id;
        const links = [
          { href: `/g/${g.id}`, label: "Ana sayfa" },
          { href: `/g/${g.id}/kadro`, label: "Kadro" },
          { href: `/g/${g.id}/sohbet`, label: "Sohbet" },
          ...(g.kind === "team"
            ? [
                { href: `/g/${g.id}/teklifler`, label: "Maç teklifleri" },
                { href: `/g/${g.id}/istatistik`, label: "Takım istatistikleri" },
              ]
            : []),
          { href: `/g/${g.id}/players?bolum=oyuncular`, label: g.kind === "team" ? "Oyuncular" : "Üyeler" },
        ];
        return (
          <div key={g.id} className="rounded-xl">
            <button
              type="button"
              onClick={() => onToggle(g.id)}
              aria-expanded={isOpen}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-pitch-800"
            >
              <TeamBadge id={g.id} name={g.name} color={g.color} logo={g.logo} size="sm" />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className={cx("text-muted transition", isOpen && "rotate-90")}>›</span>
            </button>
            {isOpen && (
              <div className="mb-1 ml-6 border-l border-line pl-2">
                {links.map((l) => (
                  <Link key={l.href} href={l.href} className="flex min-h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-pitch-800 hover:text-white">
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-2 px-3 pb-1 pt-1">
        <Link href={joinHref} className="flex min-h-10 flex-1 items-center justify-center rounded-xl border border-line text-sm hover:bg-pitch-800">
          {joinLabel}
        </Link>
        <Link href={createHref} className="flex min-h-10 flex-1 items-center justify-center rounded-xl border border-line text-sm hover:bg-pitch-800">
          + {createLabel}
        </Link>
      </div>
    </>
  );
}

function Drawer({ data, onClose }: { data: MenuData | null; onClose: () => void }) {
  const unread = useUnreadCount();
  const chatUnread = useChatUnread();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const teams = data?.groups.filter((g) => g.kind === "team") ?? [];
  const communities = data?.groups.filter((g) => g.kind !== "team") ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menü">
      <button type="button" aria-label="Menüyü kapat" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <aside className="absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col border-l border-line bg-pitch-950 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold uppercase tracking-wider text-muted">Menü</span>
          <button type="button" onClick={onClose} aria-label="Kapat" className="flex h-10 w-10 items-center justify-center rounded-full bg-pitch-900 text-on-surface shadow-sm transition active:scale-95 hover:text-accent">
            <Icon>
              <path d="M6 6l12 12M18 6 6 18" />
            </Icon>
          </button>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <Link href="/profil" className="mb-2 flex items-center gap-3 rounded-2xl border border-line bg-pitch-900/80 p-3 hover:border-accent/50">
            {data ? (
              <Avatar name={data.name} photoUrl={data.photoUrl} className="h-12 w-12 bg-gradient-to-br from-gold-1 to-gold-2 text-sm font-black text-[#3b2a05]" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-1 to-gold-2 text-sm font-black text-[#3b2a05]">…</span>
            )}
            <span className="min-w-0 flex-1">
              {data ? (
                <>
                  <span className="block truncate font-bold">{data.name}</span>
                  <span className="block text-xs text-muted">
                    Rating {data.overall}
                    {data.city ? ` · ${data.city}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <span className="block h-4 w-32 animate-pulse rounded bg-pitch-700" />
                  <span className="mt-1.5 block h-3 w-24 animate-pulse rounded bg-pitch-800" />
                </>
              )}
            </span>
            <span className="text-muted">›</span>
          </Link>

          <NavLink href="/" label="Ana sayfa" icon={<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />} />
          <NavLink
            href="/kesfet"
            label="Keşfet"
            icon={
              <>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </>
            }
          />
          <NavLink
            href="/sosyal"
            label="Sosyal"
            badge={data?.friendRequests}
            icon={
              <>
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
                <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
                <path d="M18 14.3c2 .7 3.5 2.5 3.5 5.7" />
              </>
            }
          />
          <NavLink
            href="/sohbet"
            label="Sohbetler"
            badge={chatUnread}
            icon={<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />}
          />
          <NavLink
            href="/bildirimler"
            label="Bildirimler"
            badge={unread}
            icon={
              <>
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </>
            }
          />
          <NavLink
            href="/yetenek"
            label="Yetenek değerlendirmesi"
            badge={data?.skillCount}
            icon={
              <>
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="12" cy="12" r="0.5" />
              </>
            }
          />
          <NavLink
            href="/profil?sekme=istatistik"
            label="İstatistiklerim"
            icon={
              <>
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </>
            }
          />
          <NavLink
            href="/profil?sekme=ayarlar"
            label="Ayarlar"
            icon={
              <>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </>
            }
          />

          <GroupSection
            title="Takımlarım"
            items={teams}
            openId={openGroup}
            onToggle={(id) => setOpenGroup(openGroup === id ? null : id)}
            empty="Henüz bir takımın yok."
            joinHref="/katil?tur=takim"
            joinLabel="Takıma katıl"
            createHref="/takim-kur"
            createLabel="Takım kur"
          />
          <GroupSection
            title="Gruplarım"
            items={communities}
            openId={openGroup}
            onToggle={(id) => setOpenGroup(openGroup === id ? null : id)}
            empty="Henüz bir grubun yok."
            joinHref="/katil?tur=grup"
            joinLabel="Gruba katıl"
            createHref="/grup-kur"
            createLabel="Grup kur"
          />
        </div>

        <div className="space-y-1 border-t border-line px-3 py-3">
          <Link href="/privacy" className="flex min-h-10 items-center rounded-xl px-3 text-sm text-muted hover:bg-pitch-800 hover:text-white">
            Gizlilik politikası
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-red-900 px-3 text-red-300 hover:bg-red-950">
              <Icon>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </Icon>
              Çıkış yap
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}

/**
 * Menü bağlamı ve çekmece; layout'ta tüm sayfaları sarar. Veri sunucu action'ıyla (loadMenu) sayfa yüklenince boşta
 * ısıtılır ve çekmece her açılışta arkada tazelenir; böylece layout her sayfada 4-5 sorgu beklemez.
 */
export function AppMenuShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MenuData | null>(null);
  const available = !HIDDEN.some((h) => path.startsWith(h));

  // Sayfa değişince çekmece kapanır (render sırasında durum ayarı: effect'te setState'ten kaçınır)
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    if (open) setOpen(false);
  }

  const refresh = useCallback(() => {
    loadMenu().then(
      (d) => d && setData(d),
      () => {
        // menü verisi alınamazsa iskelet kalır; sayfa çalışmaya devam eder
      },
    );
  }, []);

  // Giriş sayfalarında çekme; diğerlerinde ilk boşta bir kez ısıt
  useEffect(() => {
    if (!available || data) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const t = idle ? idle(refresh) : window.setTimeout(refresh, 800);
    return () => {
      if (!idle) window.clearTimeout(t);
    };
    // data değişince tekrar çalışmasın: sadece erişilebilirlik değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const openMenu = () => {
    setOpen(true);
    refresh();
  };

  return (
    <MenuContext.Provider value={{ available, open: openMenu }}>
      {children}
      {available && open && <Drawer data={data} onClose={() => setOpen(false)} />}
    </MenuContext.Provider>
  );
}
