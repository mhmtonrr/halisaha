import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "Halısaha Performans",
  description: "Maç sonrası puanlama, FIFA tarzı rating ve dengeli takım kurma",
  appleWebApp: { capable: true, title: "Halısaha", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#04130b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="antialiased">
        <div className="mx-auto w-full max-w-lg px-4 pb-28">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
