import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export async function createClient() {
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
}

/**
 * Giriş yapmış kullanıcıyı döndürür, yoksa giriş sayfasına yönlendirir.
 * Karşılama ekranını (isim, il, mevki) doldurmamış kullanıcıyı oraya gönderir;
 * karşılama ekranının kendisi { allowIncomplete: true } ile çağırır.
 */
export async function requireUser(opts: { allowIncomplete?: boolean } = {}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!opts.allowIncomplete) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.onboarded_at) {
      const here = (await headers()).get("x-pathname") ?? "/";
      redirect(`/hosgeldin?next=${encodeURIComponent(here)}`);
    }
  }
  return { supabase, user };
}
