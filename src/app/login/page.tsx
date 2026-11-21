import Link from "next/link";
import { LoginForm } from "./LoginForm";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Zaten giriş yapmışsa giriş ekranını gösterme
  const user = await getAuthUser();
  if (user) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <main className="flex min-h-dvh flex-col justify-center py-10">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pitch-800 text-4xl">⚽</div>
        <h1 className="text-3xl font-black tracking-tight">Halısaha</h1>
        <p className="mt-2 text-muted">Maçtan sonra puanla, kartını büyüt, takımları adil kur.</p>
      </div>
      <LoginForm next={next?.startsWith("/") ? next : "/"} initialError={error} />
      <p className="mt-6 text-center text-xs text-muted">
        Devam ederek{" "}
        <Link href="/privacy" className="underline">
          gizlilik politikasını
        </Link>{" "}
        kabul etmiş olursun.
      </p>
    </main>
  );
}
