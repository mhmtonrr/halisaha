import { requireUser } from "@/lib/supabase/server";
import { JoinMatchCard } from "@/components/JoinMatchCard";
import { ErrorNote, Header } from "@/components/ui";

/** Maça katıl: davet koduyla maçı bul veya Keşfet'teki adam arayan maçlara git */
export default async function JoinMatchPage({ searchParams }: { searchParams: Promise<{ kod?: string; error?: string }> }) {
  const { kod, error } = await searchParams;
  await requireUser();
  return (
    <main>
      <Header title="Maça katıl" back="/" />
      <ErrorNote message={error} />
      <JoinMatchCard code={kod} />
    </main>
  );
}
