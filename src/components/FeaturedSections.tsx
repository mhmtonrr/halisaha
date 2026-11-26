import { Suspense } from "react";
import { FeaturedPanel, type Viewer } from "@/components/home/FeaturedPanel";
import { loadFeatured } from "@/lib/featured-data";

function Skeleton() {
  return (
    <div aria-hidden className="mt-8 space-y-3">
      <div className="h-4 w-48 animate-pulse rounded bg-surface-high" />
      <div className="h-40 animate-pulse rounded-xl bg-surface-high" />
    </div>
  );
}

async function FeaturedAsync(v: Viewer) {
  // Hata ana sayfayı bozmasın: öne çıkanlar süs, asıl içerik değil
  const f = await loadFeatured(v.city, v.district).catch((e) => {
    console.error("[öne çıkanlar]", e);
    return null;
  });
  return f ? <FeaturedPanel initial={f} {...v} /> : null;
}

/** Ana sayfa "öne çıkanlar": ana içeriği bekletmesin diye akışla gelir; bölge değişimi FeaturedPanel'de */
export function FeaturedSections(props: Viewer) {
  return (
    <Suspense fallback={<Skeleton />}>
      <FeaturedAsync {...props} />
    </Suspense>
  );
}
