# Kart/yetenek, profil, keşfet, menü, hız, karşılama, bölge

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

**Kart tasarımı (kullanıcı şablonu)**: tam kart `FullCard` (PlayerCard.tsx): zemin `public/cards/{gold,silver,bronze}.webp` (640x925, şeffaf kenar; kullanıcının ürettiği boş şablonlar, üzerinde metin/logo yok), üstüne canlı metin yüzde konumlarla: sol üst rating/mevki/takım rozeti, sağda fotoğraf (`photoUrl`; yoksa silüet), ad kuşağı, 6 yetenek, alt koyu şeritte plaka | ilçe. Her öğe kendi yazı boyutunu taşır (`em` birikmesi olmasın). Seviye: **≤64 bronz, 65-74 gümüş, ≥75 altın** (`tierOf`); maçsız oyuncu gri (gümüş zemin + grayscale). Saha (`compact`) kartı eski sade düzende. Middleware `/cards/` yolunu atlar. **Sıradaki iş = Parça 2 (kullanıcı kararları, onaylandı)**: oyuncu kart fotoğrafı. Bkz. aşağıdaki "Parça 2 planı".

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


## Parça 2 planı: kart fotoğrafı (kullanıcı onaylı kararlar)

**Uygulama durumu**: 1) veri/DB yapıldı (0026): `avatars` deposu (herkese açık, 512 KB, webp/png; yol `<user_id>/<dosya>`, sadece sahibi yazar/siler), `profiles.photo_url` (check `photo_url_ok`: sadece kendi klasöründeki depo adresi, isteğe bağlı `?v=<sayı>` önbellek kırıcı), `group_players.photo_url` kopya (tetikleyici hep profilden doldurur, elle değişmez). db-check: `card-photo.mjs` (PGlite'ta `storage` şeması taklit edilir). 2) arayüz yapıldı: `CardPhotoUploader` (Ayarlar'da "Kart fotoğrafı" + hoş geldin'de isteğe bağlı). Tarayıcıda: 1280px'e indir → şeffaf PNG/WebP ise model atlanır, değilse `@imgly/background-removal` (`isnet_fp16` ~80 MB; `isnet_quint8` beyaz duvarda yüzü yarı saydam bırakıyordu; dynamic import, model `staticimgly.com`'dan) → `hardenAlpha` maskeyi sertleştirir (≤96 şeffaf, ≥176 opak) → şeffaf kenar kırpılır, en çok 480x600, WebP (Safari yazamazsa PNG), ≤500 KB'a sığana dek kalite/boyut düşer. Model başarısızsa `centerCrop` düz kırpma + uyarı. Yükleme istemciden tek dosyaya `avatars/<id>/card` (upsert); adres sunucuda kurulur (`saveCardPhoto(version)` → `?v=`), istemciden adres alınmaz; `deleteCardPhoto` dosya + adresi siler. Saf yardımcılar `src/lib/card-photo.ts` (testli). e2e `card-photo.mjs` (konteynerde staticimgly.com engelli → düz kırpma yolu sınanır; gerçek model telefonda denenmeli). 3) kartlara bağlandı: `getGroupPlayers.photo_url` (group_players kopyası) → kadro, grup oyuncu sayfası, maç sahası; `profiles.photo_url` → profil/oyuncu (`PersonProfile.photoUrl`), arama/öne çıkanlar (`PlayerCandidate.photoUrl`). Saha (compact) kartında fotoğraf baş harf dairesinin yerine geçer. Gri kart filtresi artık sadece zemin katmanında (fotoğraf renkli kalır). Profil fotoğrafı olarak da kullanılır: `components/Avatar.tsx` (fotoğraf yoksa baş harf) → ana sayfa başlığı, ☰ menü, grup sayfası üye şeridi, sohbet, oylama formu. Henüz baş harfli: yetenek değerlendirme formu (`skill_queue` RPC'si foto döndürmüyor; migration gerekir).

- Oyuncu fotoğraf yükler; kartta `photoUrl` olarak görünür (`FullCard` hazır, yoksa silüet). Yükleme **hoş geldin ekranında isteğe bağlı** ve sonradan **Profil → Ayarlar**'da.
- **Arka plan kaldırma tarayıcıda** (`@imgly/background-removal`, ücretsiz, fotoğraf sunucuya ham gitmez; model ~40 MB, sadece yükleme ekranı açılınca `dynamic import`, model dosyaları üçüncü taraf CDN'den iner, repoya konmaz). Yedek: işlem başarısız/cihaz yetersizse düz kırpma. Kullanıcı **şeffaf PNG** yüklerse işlem atlanır.
- Akış: seç → arka plan kaldır → kart üzerinde **canlı önizleme** → "Kaydet" / "Başka fotoğraf". Sonuç şeffaf **WebP (~100-200 KB, kırpılmış/küçültülmüş)** olarak Supabase Storage'a (yeni migration: avatar deposu, oyuncu sadece kendi dosyasını yazar/siler, herkes okur; sunucuda tür ve boyut doğrulanır). Oyuncu kendi fotoğrafını silebilir.
- Telif/KVKK: fotoğraf sadece kendi kartında; üçüncü taraf servise gitmez. Seçilen alternatifler: ücretli API (remove.bg) ve sunucuda işleme **reddedildi**.
- Takım rozeti tasarımı ayrı, sonraki geliştirme (kart şimdilik takım baş harflerini gösterir).
- Önerilen model/efor: opus + high (depolama güvenliği + model entegrasyonu); `/clear` sonrası "Parça 2'ye geç" yeter, bu bölümü oku.

## Kartta görünen ad (yapıldı: 0025; kullanıcı onaylı kararlar)

**Uygulama**: `profiles.card_name` + `group_players.card_name` (kopya; ekleme tetikleyicisi doldurur, profil değişince `sync_card_name` eşitler); check `card_name_ok()`. Kartlara `cardName` prop'u (`cardDisplayName`), `getGroupPlayers`/profil/arama/öne çıkanlar/saha bağlı. Form alanı `cardName` (Ayarlar + hoş geldin), action `saveCardName`. Arama (`q`) hâlâ gerçek ada bakar.

- Karttaki ad şu an `fitCardName(gerçek ad)` (src/lib/card-name.ts: sığmazsa "Mehmet Onur D." gibi kısaltır). Yeni: `profiles.card_name` (isteğe bağlı). Boşsa gerçek ad kullanılır; doluysa o kısaltma kuralından geçerek kartta görünür. Kartın kullanıldığı her yerde (Profil, oyuncu sayfası, kadro, saha, öne çıkanlar, arama) bu alan kullanılır.
- Düzenleme: Profil → Ayarlar'da "Kartta görünen ad" alanı (ve hoş geldin ekranında isteğe bağlı).
- **Doğrulama (kesin kurallar)**: 2-20 karakter; **sadece harf (Türkçe harfler dahil), boşluk ve nokta**; kısa çizgi, rakam ve diğer her sembol yasak. Boşluk serbest (2-3 kelimeli adlar); baş/son boşluk silinir, ardışık boşluklar tek boşluğa iner. Nokta sadece bir harfin hemen arkasından gelir ("M.", "Mehmet O."), ardışık iki nokta ve noktayla başlama yasak. **Küfür/hakaret kontrolü zorunlu**: Türkçe kelime listesi + normalizasyon (büyük/küçük, Türkçe harf eşlemesi, tekrar eden harf, boşluk/nokta ile bölme ve s1k/ş0t gibi harf-rakam değişimleri yakalanır). Hem sunucuda (`actions.ts`, saf doğrulama fonksiyonu + birim testleri) hem veritabanında (check kısıtı: karakter kümesi ve uzunluk) uygulanır; küfür listesi sadece TS tarafında.
- Parçalama: 1) saf doğrulama + test (`card-name.ts` genişlet), 2) migration + db-check + action + Ayarlar/hoş geldin arayüzü + kartlara bağlama.
- Önerilen model/efor: sonnet + medium. `/clear` sonrası "Parça 2'ye geç, kart adı" yeter.

## Profil tasarımı giydirme (Stitch "Obsidian Pitch": Profil/İstatistik/Maçlar/Ayarlar ekranları)

Kullanıcı kararları: rozetler eldeki verilerden hesaplanan kurallarla (hat-trick, yenilmezlik serisi, MVP, maç sayısı; "Pas Ustası" yok); telefon doğrulama yok, sadece e-posta doğrulaması; dil satırı "Türkçe" sabit; tema seçici durur, ikinci tema ("Klasik Gece") "yakında".
- **Parça 1 (yapıldı)**: Genel (hızlı sayı kartları, son maç formu, Profili paylaş, oyuncu bilgisi ızgarası), İstatistik (radar grafik `profile/RadarChart.tsx`, güvenilirlik kartları), Maçlar (`profile/MatchesList.tsx` filtre çipleri + sonuç renkli kartlar), Ayarlar (üst kart, çıkış düğmesi).
- **Parça 2a (yapıldı, migration yok)**: rozetler (`src/lib/badges.ts`, saf + testli; maç kayıtlarından hesaplanır, saklanmaz; İstatistik sekmesinde), yaklaşan/planlanmış maç (`loadUpcomingMatches`, sadece kendi profilinde), kart çevirme (`profile/FlipCard.tsx`; arka yüz özet istatistik, boy/kilo 2b'de eklenecek).
- **Parça 2b (sırada, migration)**: boy/kilo, doğum tarihi, haftalık müsaitlik günleri, "istatistiklerimi paylaş" anahtarı, Ayarlar'da düzenleme.
- **Parça 2c (migration)**: engellenen oyuncu/takımlar, hesabı geçici dondurma (kural kararı gerekir).
- **Parça 3**: Yardım/SSS, Geri bildirim, KVKK sayfaları, tema/dil satırları, Ayarlar'ın tasarımdaki gruplu liste düzeni.
