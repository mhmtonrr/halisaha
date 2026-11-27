import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { canonicalDistrict } from "@/lib/regions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { WelcomeWizard } from "./WelcomeWizard";

const PROFILE_COLUMNS =
  "display_name, card_name, photo_url, city, district, preferred_position, secondary_positions, preferred_foot, shirt_number, height_cm, weight_kg, bio, onboarded_at";

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const { supabase, user } = await requireUser({ allowIncomplete: true });

  const [{ data: profile }, { data: priv }] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single(),
    supabase.from("profile_private").select("birth_date").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profile?.onboarded_at) redirect(next);

  // E-postadan türetilmiş isimleri (ör. "e6180023") önermeyelim
  const emailPrefix = user.email?.split("@")[0];
  const name = profile?.display_name && profile.display_name !== emailPrefix ? profile.display_name : "";

  return (
    <WelcomeWizard
      userId={user.id}
      next={next}
      photoUrl={profile?.photo_url ?? null}
      rating={DEFAULT_OVERALL}
      maxBirth={`${new Date().getFullYear() - 8}-12-31`}
      values={{
        name,
        cardName: profile?.card_name ?? "",
        birthDate: (priv as { birth_date: string | null } | null)?.birth_date ?? "",
        city: profile?.city ?? "",
        district: canonicalDistrict(profile?.city, profile?.district) ?? "",
        position: profile?.preferred_position ?? null,
        secondary: profile?.secondary_positions ?? [],
        foot: profile?.preferred_foot ?? null,
        shirt: profile?.shirt_number ?? null,
        height: profile?.height_cm ?? null,
        weight: profile?.weight_kg ?? null,
        bio: profile?.bio ?? "",
      }}
    />
  );
}
