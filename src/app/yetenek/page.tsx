import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getSkillQueue } from "@/lib/skill-queue";
import { SKILL_CONFIG } from "@/lib/skills";
import { Card, ErrorNote, Header } from "@/components/ui";
import { SkillRateForm } from "./SkillRateForm";

export default async function SkillRatingPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const { supabase } = await requireUser();
  const queue = await getSkillQueue(supabase, 5);

  return (
    <main>
      <Header title="Yetenek değerlendirmesi" back="/" />
      <ErrorNote message={error} />
      {saved && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Değerlendirmen kaydedildi ✓</p>}

      <p className="mb-4 text-sm text-muted">
        Birlikte en az {SKILL_CONFIG.MIN_SHARED_MATCHES} maç oynadığın oyuncuları hız, şut, pas gibi yeteneklerde 1-10 puanla.
        Bilmediğin yeteneği boş bırak. Puanların anonim; oyuncunun kartındaki yetenekler herkesin puanından oluşur. Herkese yüksek
        puan vermek işe yaramaz: önemli olan oyuncuları birbirinden ayırman.
      </p>

      {queue.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Şu an değerlendirebileceğin kimse yok. Birlikte en az {SKILL_CONFIG.MIN_SHARED_MATCHES} maç oynadığın oyuncular (rakipler dahil)
          burada görünür; değerlendirdiklerin 30 gün sonra tekrar sorulur.
          <div className="mt-3">
            <Link href="/" className="text-accent underline">
              Ana sayfaya dön
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {queue.map((q) => (
            <SkillRateForm key={q.playerId} playerId={q.playerId} name={q.name} isGuest={q.isGuest} keeper={q.keeper} matches={q.matches} />
          ))}
          <p className="text-center text-xs text-muted">Her seferde en fazla 5 kişi sorulur; kaydettikçe sıradakiler gelir.</p>
        </div>
      )}
    </main>
  );
}
