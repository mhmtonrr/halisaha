// Cloudflare Worker: bazı internet sağlayıcıları vercel.app adresine erişemediği için siteyi workers.dev üzerinden açar.
// Her istek Vercel'e aktarılır, uygulama Vercel'de çalışmaya devam eder.
// Otomatik yayınlanmaz: bu dosya değişirse içeriği Cloudflare panelinde (Workers & Pages > halisaha > Edit code) yeniden Deploy edilir.

const UPSTREAM = "https://halisaha-tawny.vercel.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Oturum çerezleri ve bildirimler için sadece https
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }

    const proxied = new Request(UPSTREAM + url.pathname + url.search, request);

    // Next.js, Server Action'larda Origin ile sunucu adresini karşılaştırır. Yalnızca kendi adresimizden gelen
    // Origin değiştirilir; başka sitelerden gelen istekler olduğu gibi gider ve reddedilmeye devam eder.
    if (proxied.headers.get("origin") === url.origin) proxied.headers.set("origin", UPSTREAM);

    // Yönlendirmeleri burada izlemeyiz: tarayıcıya iletilir (giriş çerezleri de böylece kaybolmaz)
    const upstream = await fetch(proxied, { redirect: "manual" });

    // Vercel adresine yapılan yönlendirmeler bu adrese çevrilir
    const location = upstream.headers.get("location");
    if (!location?.startsWith(UPSTREAM)) return upstream;
    const response = new Response(upstream.body, upstream);
    response.headers.set("location", url.origin + location.slice(UPSTREAM.length));
    return response;
  },
};
