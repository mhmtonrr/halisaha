# Kart/yetenek, profil, keşfet, menü, hız, karşılama, bölge

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

**Oyuncu kartı ve yetenek değerlendirmesi (migration 0018 + 0019)**: kart (`PlayerCard`/`CardFace`, saha için `compact`) FIFA kalkanıdır: rating, mevki,
**il plaka kodu + ilçe** (bayrak yerine; `plateOf`), takım rozeti (sadece profilde), 6 yetenek (Türkçe kısaltma). Maçı olmayan oyuncunun kartı gri ("new" seviye);
yetenekler değer gelene dek "–". Kartın yetenekleri **sadece değerlendirmeden** gelir; eski istatistik göstergeleri (FRM/İST/GOL/AST/GAL/MVP, `attributes.ts`) oyuncu
sayfasında "Performans göstergeleri"dir. **Model (kullanıcı kararı, "B")**: maç oylamasından ayrı `/yetenek` sayfası; birlikte **en az 2 maç** oynadığın (rakipler ve misafirler
dahil, maç `voting`/`closed`; bağlı iki maç tek havuz) ve son 30 günde puanlamadığın oyuncular `skill_queue` RPC'siyle listelenir (her seferde en fazla 5). Her oyuncu 6 yetenekte
1-10 kaydırıcıyla puanlanır, bilinmeyen boş bırakılır ("bilmiyorum"); kaleciye kaleci seti (REF ATL HAV YER DAĞ İLT), diğerlerine saha seti (HIZ ŞUT PAS DRİ DEF FİZ).
Yazma sadece `submit_skill_rating` RPC'si (kendine değil, ortak maç şartı, kategori seti doğrulanır, tekrar gönderince yerine geçer); `skill_ratings` anonim (RLS: sadece kendi puanların);
`shared_players` iç fonksiyondur (çağrılamaz). Giriş noktaları: ana sayfa ve oy verdikten sonra maç ekranındaki `SkillQueueBanner`.
Hesap (`skills.ts` motor + `skills-data.ts`, `submitSkillRating` sonrası `later`): **oy verene göre normalizasyon** (rating.ts gibi): oy verenin tüm puanlarından kategori başına
ortalama/sapma (az puan verdiyse tarafsız 6 / 1,5'a çekilir), z = (puan − ortalama)/sapma; karşılıklı ortalaması ≥ 8,5 olan iki kişi (klik) yarım ağırlık; değer =
`65 + 11·(Σwz / (Σw + 1))`, 40-99. **Görünme eşiği: en az 2 farklı oy veren** (`SKILL_CONFIG`; "2 maç" şartı değerlendirmeyi açar), yoksa "–". Oy verenin normalizasyonu değiştiğinden
bir gönderim, o oy verenin puanladığı herkesi yeniden hesaplatır (`recomputeSkillsForVoter`). Sonuç `player_skills`'e kişinin tüm `group_players` satırlarına yazılır
(rating gibi); misafirde kendi satırı. Kaleci kuralı her yerde aynı: `match_players.position`, yoksa `is_goalkeeper`, yoksa profil mevkisi.
Test: `skills.test.ts`, `db-checks/skill-ratings.mjs`, `e2e/skills.mjs`. (Geçmiş: 0018'de "maçta kim öne çıktı?" işaretleme modeli (A) yapılmıştı; kullanıcı B istediği için 0019 ile kaldırıldı.)

**Profil ve istatistik (migration 0020)**: `/profil` sekmelidir (`?sekme=genel|istatistik|maclar|ayarlar`), başkasının profili `/oyuncu/[userId]` (Ayarlar sekmesi yok; kendi
kimliğine giderse `/profil`'e yönlenir). Aynı `ProfileView`. **Genel**: kart, güvenilirlik, yetenek çubukları, oyuncu bilgisi, takımlar (başkasında sadece herkese açık takımlar). **İstatistik**:
toplamlar, G/B/M, form + son 10 puanlı maç grafiği, seri, ortalamalar, rakip/iç ayrımı, takım-grup bazında, mevki, güvenilirlik. **Maçlar**: son 50 maç. Veri **tüm grup ve takımlardan** (oylamada +
kapanmış maçlar; grup sayfasındaki istatistik hâlâ sadece kapanmış maçlardır) service role ile okunur (`profile-data.ts`), **görünürlük kontrolü çağıranın sorumluluğu** (`canViewStats`).
**Görünürlük (kullanıcı kararı)**: `profiles.stats_visibility` = `teammates` (varsayılan: ödünç olmayan ortak grup/takım) veya `public` (giriş yapmış herkes); ayar Ayarlar sekmesinde
(`updateStatsVisibility`). Kart (rating, yetenekler, bölge) her zaman herkese görünür; sadece istatistik ve maç geçmişi ayara bağlı. Başkasının maç geçmişinde özel topluluğun adı ve maç bağlantısı
sadece o grubun üyelerine görünür ("Özel grup"); takımlar herkese açık. "Gruplarımdaki kartlarım" kaldırıldı (rating ve yetenekler genel olduğundan kartlar aynı). Tuzak: başlıklar CSS ile BÜYÜK harf;
e2e'de metin karşılaştırması Türkçe küçük harfe göre yapılır. **Profile giden bağlantılar**: Oyuncular sayfası, maç kadrosu (planlanmış), grup/takım sayfası, kadro, istatistik liderleri → `/g/[id]/p/[playerId]` (oradan "Tüm gruplardaki istatistikleri gör" → `/oyuncu/[userId]`);
ilan başvuranları doğrudan `/oyuncu/[userId]` (rating/yetenek kartı açık, istatistik görünürlük ayarına bağlı). Tuzak: zaten `<Link>` olan satırın içine ikinci `<Link>` koyma (iç içe `<a>` → React #418 hydration hatası). Test: `profile-stats.test.ts`, `db-checks/stats-visibility.mjs`, `e2e/profile.mjs`.

**Oyuncu keşfi (migration 0024, kullanıcı kararları)**: `/kesfet` iki sekmeli (`?sekme=oyuncu`): Takımlar | Oyuncular. Oyuncu araması GET formudur (paylaşılabilir adres): il/ilçe, ad, mevki (+ "ikinci mevkisi de"), rating aralığı
(maçsız oyuncular dışlanır), deneyim (en az puanlı maç), ayak, yetenek+eşik, güvenilir (gelmedi yok veya %90+), takımsız (hiçbir takımın asıl üyesi değil), sıralama; sayfa başına 20, "Daha fazla" `?sayfa=`. Veri service role ile okunur
(rating özel gruplardaki satırlara bağlı) → **sadece `profiles.discoverable = true` olanlar** (varsayılan açık, Profil → Ayarlar → "Oyuncu aramasında görün" ile kapatılır, `updateDiscoverable`; kapatınca `revalidateTag("featured")`). Sonuçta özel grup adı
asla yok, sadece herkese açık takımlar. Aday listesi bölge/ad/mevki/ayak SQL'de, kalanı TS'de süzülür (tek sorguda en fazla 1000 profil; ölçek büyürse RPC'ye taşı). **Ana sayfa**: "Takımlarım/Gruplarım"dan sonra, kullanıcının iline göre ⭐ Öne çıkan oyuncular
(en az 3 puanlı maç), 🏆 Öne çıkan takımlar (puanlı), 🔥 Haftanın MVP'leri (son 7 gün, **sadece herkese açık takım maçları**: özel grup maçı sızmasın), 📈 Yükselen yıldızlar (son 30 gün rating artışı, en az 2 maç), 🔎 Oyuncu arayan takımlar;
bölgede <3 kayıt varsa Türkiye geneli gösterilir. Tuzak: `match_results→matches→groups` gömmesi iki FK yüzünden belirsiz (PGRST201) → `groups!matches_group_id_fkey`. Test: `player-search.test.ts`, `db-checks/discoverable.mjs`, `e2e/discover.mjs`.

**Menü**: her sayfada sağ üstte bildirim çanı + ☰ (`Header` içinde `MenuControls`; ana sayfada kendi satırı). ☰ sağdan açılan çekmecedir: profil özeti, Ana sayfa, Keşfet, Bildirimler,
Yetenek değerlendirmesi (bekleyen sayısı), İstatistiklerim, Ayarlar, **ayrı Takımlarım ve Gruplarım bölümleri** (her biri açılır: ana sayfa, kadro, sohbet, takımda teklifler/istatistik, oyuncular; her başlıkta Katıl/Kur), Gizlilik,
**Çıkış yap** (`POST /auth/signout`). **Alt çubuk kaldı** (kullanıcı kararı). Menü verisi layout'ta değil, `loadMenu` server action'ıyla boşta zamanda ve çekmece açılırken gelir (`AppMenuShell`; veri gelene dek iskelet); giriş sayfalarında menü yoktur (`HIDDEN`); çekmece sayfa değişince/Escape/karartma ile kapanır.

**Hız (kullanıcı raporu: "uygulama yavaş")**: ölçüm `node scripts/perf/ttfb.mjs [adres]` (geçici kullanıcıyla sayfa TTFB'si; ilk ölçüm 0,7-1,7 sn). Kök neden: Vercel fonksiyonları `iad1` (ABD) çalışıyordu, Supabase Frankfurt;
her sorgu/kimlik çağrısı okyanus aşıyordu. Yapılanlar: `vercel.json` `regions: ["fra1"]` (Supabase ile aynı bölge); **JWT yerelde doğrulanır** (`getClaims`, ES256 JWKS; middleware ve `getAuthUser`/`requireUser`) — `getUser()` her istekte
3 kez Auth'a gidiyordu; `createClient`/`getAuthUser`/onboarding sorgusu `React.cache` ile **istek başına tek**; ☰ menü verisi layout'ta değil, `loadMenu` server action'ıyla boşta/açılışta (layout sorgusuz);
`next.config.ts` `staleTimes.dynamic = 20` (ziyaret edilen sayfalar istemcide 20 sn önbellekte; sunucu eylemi `revalidatePath` ve `router.refresh` geçersiz kılar). **Tuzak: kök `loading.tsx` ekleme** — verili kullanıcıda
`?sekme=` gibi aynı sayfa arama-parametresi gezintisinin URL'sini asla tamamlatmadı (e2e `profile`); menü artık veri beklediği için testlerde çekmece içeriği `waitFor` ile beklenir.

**Karşılama**: `profiles.onboarded_at` boşsa `requireUser()` kullanıcıyı `/hosgeldin?next=...` sayfasına yollar
(middleware `x-pathname` başlığı ile). Karşılama sayfası `requireUser({ allowIncomplete: true })` kullanır.

**Bölge**: il `PROVINCES` listesinden, ilçe `canonicalDistrict(il, ilçe)` ile sunucuda doğrulanır.
Formlarda `RegionSelect` (il seçilince ilçeler) kullan.
