import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-grotesk", display: "swap" });
import { BottomNav } from "@/components/BottomNav";
import { NavTracker } from "@/components/NavHistory";
import { AppMenuShell } from "@/components/AppMenu";

export const metadata: Metadata = {
  title: "Halısaha Performans",
  description: "Maç sonrası puanlama, FIFA tarzı rating ve dengeli takım kurma",
  appleWebApp: { capable: true, title: "Halısaha", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#051424",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${jakarta.variable} ${grotesk.variable}`}>
      <head>
        {/* Tasarımdaki ikon seti (Material Symbols Outlined) */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0..1,0&display=block" />
      </head>
      <body className="antialiased">
        <AppMenuShell>
          <div className="mx-auto w-full max-w-lg px-4 pb-28">{children}</div>
          <NavTracker />
          <BottomNav />
        </AppMenuShell>
      </body>
    </html>
  );
}
