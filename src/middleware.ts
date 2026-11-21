import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/cron: Vercel Cron oturumsuz çağırır, kendi gizli anahtarıyla korunur
const PUBLIC_PATHS = ["/login", "/auth", "/privacy", "/api/cron"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Sunucu bileşenleri gidilmek istenen adresi bilsin (ör. karşılama sonrası geri dönmek için)
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", path + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = next();
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // JWT yerelde doğrulanır (asimetrik anahtar); sadece süresi dolmuşsa oturum yenilenir. getUser() her istekte Auth sunucusuna giderdi.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? claimsData.claims : null;

  if (!user && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)",
  ],
};
