import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Ziyaret edilen sayfalar istemcide kısa süre önbellekte tutulur: geri/ileri ve tekrar ziyaret anında açılır.
    // Sunucu eylemleri (revalidatePath) ve canlı yenilemeler (router.refresh) önbelleği zaten geçersiz kılar.
    staleTimes: { dynamic: 20, static: 180 },
  },
};

export default nextConfig;
