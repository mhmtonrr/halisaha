import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { completeOnboarding } from "@/lib/actions";
import { Button, Card, ErrorNote } from "@/components/ui";
import { ProfileFields, type ProfileValues } from "@/components/ProfileFields";

const PROFILE_COLUMNS =
  "display_name, city, district, birth_year, preferred_position, secondary_positions, preferred_foot, shirt_number, bio, onboarded_at";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const { supabase, user } = await requireUser({ allowIncomplete: true });

  const { data: profile } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single();
  if (profile?.onboarded_at) redirect(next);

  // E-postadan türetilmiş isimleri (ör. "e6180023") önermeyelim
  const emailPrefix = user.email?.split("@")[0];
  const name = profile?.display_name && profile.display_name !== emailPrefix ? profile.display_name : "";

  return (
    <main className="py-8">
      <div className="mb-6 text-center">
        <div className="text-4xl">👋</div>
        <h1 className="mt-3 text-2xl font-black">Hoş geldin!</h1>
        <p className="mt-1 text-muted">Kartını oluşturmak için seni biraz tanıyalım.</p>
      </div>
      <ErrorNote message={error} />
      <form action={completeOnboarding} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Card className="space-y-4">
          <ProfileFields values={{ ...(profile as ProfileValues), display_name: name }} full={false} />
        </Card>
        <Button className="w-full">Devam et</Button>
        <p className="text-center text-xs text-muted">
          İlin ve ilçen, yakınındaki maçları ve oyuncuları gösterebilmemiz için kullanılacak. Hepsini sonra profilinden
          değiştirebilirsin.
        </p>
      </form>
    </main>
  );
}
