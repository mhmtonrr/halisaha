import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

/** İstek başına tek istemci (cache): aynı istekte layout, sayfa ve yardımcılar aynı örneği paylaşır */
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component içinden çağrıldıysa yoksay; middleware oturumu yeniler.
          }
        },
      },
    },
  );
});

export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Giriş yapmış kullanıcı. JWT **yerelde** doğrulanır (asimetrik imza anahtarı, JWKS önbellekli): `getUser()` gibi
 * her çağrıda Supabase Auth'a ağ gidiş-dönüşü yapmaz. Süresi dolmuşsa oturum yenilenir. İstek başına bir kez hesaplanır.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
});

/** Karşılamayı bitirmiş mi (istek başına bir sorgu) */
const isOnboarded = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", userId).maybeSingle();
  return !!profile?.onboarded_at;
});

/**
 * Giriş yapmış kullanıcıyı döndürür, yoksa giriş sayfasına yönlendirir.
 * Karşılama ekranını (isim, il, mevki) doldurmamış kullanıcıyı oraya gönderir;
 * karşılama ekranının kendisi { allowIncomplete: true } ile çağırır.
 */
export async function requireUser(opts: { allowIncomplete?: boolean } = {}) {
  // İstemci ve kullanıcı birbirinden bağımsız: aynı anda hazırlanır
  const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
  if (!user) redirect("/login");

  if (!opts.allowIncomplete && !(await isOnboarded(user.id))) {
    const here = (await headers()).get("x-pathname") ?? "/";
    redirect(`/hosgeldin?next=${encodeURIComponent(here)}`);
  }
  return { supabase, user };
}
