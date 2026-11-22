# Halısaha — proje rehberi

Türkiye geneli halısaha topluluk ve rekabet platformu. Oyuncular maç sonrası birbirini puanlar,
FIFA tarzı kartlar oluşur; gruplar (topluluk) ve takımlar (rekabet) ayrı oluşumlardır.

**Kullanıcı Türkçe konuşuyor; yanıtlar, arayüz metinleri, commit mesajları ve kod yorumları Türkçe.**
Büyük tasarım kararlarını kodlamadan önce kullanıcıyla netleştir; küçük kararlarda makul varsayılanı seç ve söyle.

## Çalışma kuralları (token tasarrufu — her oturumda geçerli, kullanıcı tekrar anlatmak zorunda değil)

1. **Model/efor önerisi sadece ayar işe uymuyorsa**: o zaman tek satır yaz (`Öneri: model <haiku|sonnet|opus>, efor <low|medium|high> — sebep`) ve kullanıcı ayarlayana kadar bekle. Ayar uygunsa öneri yazma, direkt başla.
   Ölçüt: tek dosya/metin/stil/küçük hata → haiku veya sonnet + low; birkaç dosya, UI+veri → sonnet + medium; migration/RLS, puanlama, çok dosyalı özellik → sonnet/opus + high.
   **Büyük işlerde** (migration/RLS, puanlama, çok dosyalı özellik) önce kısa plan yaz (etki listesi dahil, bkz. kural 2), onay al, sonra kodla.
2. **Etki analizi — tutarsızlık bırakma**: bir şeyi değiştirmeden önce nerelere dokunduğunu bul: değişen fonksiyon/bileşen/tip/sütun/metin/rota için `Grep` ile tüm kullanımları, ilgili sorgular, RLS/RPC, testler, `docs/` ve arayüzdeki aynı kavramın diğer yerleri (ör. bir etiketi değiştirince her sayfadaki aynı etiket).
   Hepsini aynı işte tutarlı güncelle. Kapsam dışına taşan etki varsa (başka özellik, veri göçü) yapmadan önce söyle. Bitince yanıtta tek satır: "Etkilenen: …".
3. **Parçalama**: iş 5+ dosyaya, veya migration + UI + test birlikte dokunuyorsa kullanıcıya parçaları öner (örn. 1 veri/DB, 2 UI, 3 test), her parça sonunda commit+push; hepsini tek seferde yapma.
4. **/clear uyarısı**: konu değişince, bir parça commit+push edilince, veya bağlam şiştiğinde (çok dosya okundu / uzun build-test çıktısı gördün) "şimdi /clear at" diye açıkça söyle. Gereksiz yere clear önerme.
5. **Kapsam**: sadece istenen değişikliği yap (etkilediği yerler dahil, bkz. kural 2); istenmemiş refactor/özellik/doküman ekleme. Ek iş gerekiyorsa önce söyle.
6. **Keşif**: ilgili dosyaları hedefli oku (`Grep`/`Glob` ile bul, büyük dosyada sadece ilgili satır aralığı); doğru yazmak için gereken tip/fonksiyon/çağıran dosyaya bakmaktan kaçınma. Tüm dizini gezme, `Agent` başlatma, ilgisiz `docs/` dosyası okuma.
7. **Doğrulama (kullanıcı özellikle istemedikçe)**: küçük değişiklikte sadece `npx tsc --noEmit` + etkilenen tek test dosyası. `npm run build`, tüm e2e, `npm run db:check` sadece migration/RLS/akış değiştiyse ve ilgili tek senaryoyu çalıştır. Çıktıyı her zaman kısalt (`| tail -15`, `grep`). Aynı komutu "emin olmak için" tekrarlama.
8. **Commit/push** yalnızca iş bitince ve tek seferde; düzeltme için ek commit yerine mümkünse bitirmeden düzelt.
9. **Yanıtlar kısa**: ne yapıldı + tek paragraf; kod/dosya listesini tekrar etme. Seçenek yığma, öneri ver.
10. Bu kurallar değişecekse (kullanıcı isterse) burayı güncelle; yeni oturumda tekrar sorma.

## Canlı ortam

| | |
|---|---|
| Uygulama | https://halisaha-tawny.vercel.app (Vercel, `main`'e her push otomatik yayınlanır) |
| Repo | https://github.com/mhmtonrr/halisaha (public; gizli anahtar asla commit edilmez) |
| Supabase | proje ref `hbdhbquczlvjnsmrgqxj`, bölge eu-central-1 (Frankfurt) |
| Gerçek veri | Canlı veritabanında gerçek kullanıcılar ve bir grup var. Test verisi bırakma. |

Vercel ortam değişkenleri: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (+ isteğe bağlı `NEXT_PUBLIC_CONTACT_EMAIL`). Kullanıcı Vercel panelinden girdi.

## Yerel geliştirme ortamı (Windows, terminalde Claude Code)

- Klasör: `C:\Users\PC1\Desktop\halisaha`. Windows + Git Bash/PowerShell, Node 24. **Python yok**; betikleri Node ile yaz.
- `.env.local` kullanıcının bilgisayarında hazır (gitignore'da). Değerleri **asla ekrana basma**; yalnızca dolu/boş kontrolü yap.
  Eksikse kullanıcı Supabase panelinden (Project Settings > API) kendisi doldurur; chat'e yapıştırtma.
- `npm run dev` → http://localhost:3000. Yerel uygulama **canlı veritabanına** bağlıdır: test verisi bırakma.
- Google girişi yerelde çalışsın diye Supabase Auth > URL Configuration > Redirect URLs'te `http://localhost:3000/**` olmalı.
- Bulut ortamındaki `NODE_USE_ENV_PROXY=1` yerelde gerekmez (betik yorumlarında geçiyorsa yok say).

## Teknoloji

Next.js 15 (App Router, Server Actions) · React 19 · Supabase (Postgres, Auth, RLS, Realtime) ·
Tailwind v4 · Vitest · Playwright (devDependency; yerelde bir kez `npx playwright install chromium`) · PGlite (gömülü Postgres, RLS kontrolleri için).
Supabase tipleri üretilmedi; sorgular elle tiplenir. 1-1 ilişkiler bazen dizi döner → `one()` (src/lib/data.ts).

## Dizin yapısı ve sayfalar

Dosya başına tek satırlık açıklamalar ve tüm sayfa rotaları: `docs/dizin-yapisi.md` (bir dosyayı/sayfayı bulmak için önce oraya bak; yeni dosya/sayfa ekleyince oraya tek satır ekle).
En kritik: `src/lib/rating.ts` (puanlama), `src/lib/actions.ts` (Server Action'lar), `src/lib/finalize.ts` (oylama kapanışı), `src/lib/user-cards.ts` (kart verisi).

## Alan modeli ve kurallar (ayrıntı docs/ altında — sadece ilgili konuda oku)

| Konu | Dosya |
|---|---|
| Maç türleri, puanlama, genel rating, çapraz oylama, diziliş, teklif, çağrı, çekilme | `docs/mac-puanlama.md` |
| Grup/takım farkı, roller, misafir, asıl kadro, davet kodu, ayrılma, oyuncu ilanı/ödünç | `docs/takim-grup-uyelik.md` |
| Bildirim/push, canlı güncelleme (Realtime), sohbet | `docs/bildirim-canli-sohbet.md` |
| Oyuncu kartı/yetenek, profil/istatistik, Keşfet/öne çıkanlar, menü, hız, karşılama, bölge | `docs/profil-kart-kesfet-menu.md` |
| Gerçek hosting'e geçince / sonra yapılacaklar (e-posta onayı, SMTP, hatırlatıcı, SMS, dil, tema, maç süresi…) | `docs/yayin-sonrasi.md` |
| Dosya/sayfa haritası | `docs/dizin-yapisi.md` |
| E2E çalıştırma, senaryolar, bozuk testler | `docs/test.md` |

Kısa özet: **Grup** (`kind='community'`) özel topluluk, sadece kendi aramızda maç, rating etkisi yarım. **Takım** (`kind='team'`) herkese açık, sadece rakibe karşı maç, tam etki.
Roller: captain/admin/organizer/member (maçı ilk üçü açar). Misafir = `user_id IS NULL`. Davet kodu sütunu okunamaz (RPC). Rating ve yetenekler hesap bazında genel: `user_ratings`/`user_skills` (tek satır, `user_id`); satır başına kopya YOK (misafir hariç).
Yetki hep RLS/RPC'de; `groups` seçerken sütunları açıkça yaz (`invite_code` yok). Yeni konu/tuzak çıkarsa ilgili docs dosyasına ekle, buraya sadece tek satırlık işaret koy.

## Veritabanı değişikliği iş akışı

1. Yeni dosya: `supabase/migrations/00NN_aciklama.sql` (sadece ekleme tercih et; mevcut veriyi koru).
2. `scripts/db-checks/` altına yetki kontrolü ekle (`setupDb()` Supabase'e benzer ortam kurar), `npm run db:check`.
3. **Yayındaki eski kodla uyumu düşün.** Eski sürümü bozan değişiklik (ör. sütun yetkisi kaldırma, rol değişimi)
   canlıya kodla birlikte, push'tan hemen önce uygulanır.
4. Canlıya uygula (tek istek tek transaction; `.env.local`'da `SUPABASE_ACCESS_TOKEN` gerekir):
```bash
node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/00NN_x.sql
```
5. Supabase Auth ayarı gibi **güvenliği gevşeten** değişiklikleri kendin yapma; kullanıcıya panelden nasıl
   yapacağını anlat.

## Test

```bash
npm test               # Vitest: puanlama, takım dengeleme, özellikler, bölgeler, hata metinleri
npm run db:check       # PGlite'ta tüm migration'lar + RLS/RPC kontrolleri
npx tsc --noEmit && npm run lint && npm run build
```

Uçtan uca (e2e) çalıştırma, senaryo listesi ve bilinen bozuk senaryolar: `docs/test.md`. E2E canlı veritabanına karşı çalışır, test verisini sonunda siler.

## Bilinen tuzaklar

- Sayfa dosyaları (`page.tsx`) Next'in tanıdığı alanlar dışında bir şey export edemez.
- Vitest `@/` alias'ı `vitest.config.ts`'de. Türkçe sıralama `localeCompare(x, "tr")` (ı<i, s<ş).
- `datetime-local` değerleri Türkiye saati: `parseLocalDateTime` (+03:00, yaz saati yok).
- Tailwind v4: seçili radio/checkbox stili için `has-checked:` kullan.
- Güvenlik tanımlayıcı (security definer) fonksiyonlarda `search_path = public`; pgcrypto orada görünmez
  (rastgele kod için `md5(random()...)`).
- Service role anahtarı sadece `src/lib/supabase/admin.ts` (server-only) içinde.

## Kullanıcıda bekleyen işler

Ertelenenlerin ve sıradaki işlerin tam listesi: `docs/yayin-sonrasi.md`.

- **E-posta onayı kapatıldı** (kullanıcı yaptı): şifreyle kayıt artık mail limitine takılmaz. Risk: başkasının
  e-postasıyla kayıt olunabilir; Resend/SMTP kurulunca "Confirm email" tekrar açılmalı.
- **Resend/SMTP**: alan adı gerekiyor (vercel.app doğrulanamaz). Kullanıcı şimdilik erteledi.
- **Web push**: Vercel ortam değişkenleri **eklendi** (kullanıcı yaptı); iPhone'da bildirim çalışıyor. **Android'de ekran kapalıyken gelmiyordu**: gönderim `urgency: "high"` yapıldı (6f009ba), kullanıcının telefonda yeniden denemesi bekleniyor;
  gelmezse cihaz tarafı (pil "Sınırsız", bildirim önemi "Yüksek") ve telefon modeli sorulmalı.
- **Hız**: kullanıcı konuyu "sonra döneriz" dedi. Ölçüm: ana sayfa 1512→539 ms, diğerleri 0,35-0,56 sn (kalanın çoğu ölçüm bağlantısı). Olası devam: ana sayfa her açılışta tüm grupların `finalizeExpired`/`settleExpiredPolls` kontrolünü yapıyor
  (çok grupta ilk aday); kök `loading.tsx` güvenli bir yolla (sadece `/g/[groupId]` gibi segment geçişlerinde) yeniden denenebilir; `scripts/perf/ttfb.mjs` ile önce/sonra ölç.
- Google OAuth uygulaması yayınlandı (Publish app yapıldı); artık sadece test kullanıcıları değil herkes girebilir.

## Yol haritası (kullanıcıyla konuşulan)

1. ~~Puanlama, takım dengeleme, oylama~~ · ~~profil/mevki/rakip maç~~ · ~~takımlar, roller, çağrı~~ · ~~sohbet~~
2. ~~Takımlar arası maç teklifi + ortak maç ekranı + takım istatistikleri~~ (yapıldı; sonraki adım: karşı teklif/tarih değiştirme, takım sıralamasında W/D/L)
3. ~~Bildirimler~~ (yapıldı: kutu + web push; kullanıcı Vercel'e VAPID anahtarlarını eklemeli, bkz. yukarı)
4. Halısaha tesis rehberi, işletme hesapları, rezervasyon/turnuva (gelir modeli)
5. **Sıradaki (sırayla): ~~a) kart adı alanı~~ (yapıldı: 0025), ~~b) kart fotoğrafı yükleme + arka plan kaldırma~~ (yapıldı: 0026, kartlara bağlandı; gerçek model telefonda denenmeli)**; sıradaki: takım rozeti tasarımı. Rozetler, ~~yetenek oylaması (hız/şut/pas…)~~ (yapıldı: 0019), sohbette fotoğraf
6. Türkiye geneli açılış öncesi: KVKK aydınlatma metni, 18 yaş altı kuralı, e-posta onayı tekrar açık

## Git

`main`'e doğrudan commit + push (kullanıcının akışı bu). Riskli işlerde (migration, akış/yetki değişikliği) ayrı dala push edip Vercel önizleme adresinde denemeyi öner, sonra `main`'e al. Commit mesajları Türkçe, ne ve neden.
