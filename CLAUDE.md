# Halısaha — proje rehberi

Türkiye geneli halısaha topluluk ve rekabet platformu. Oyuncular maç sonrası birbirini puanlar,
FIFA tarzı kartlar oluşur; gruplar (topluluk) ve takımlar (rekabet) ayrı oluşumlardır.

**Kullanıcı Türkçe konuşuyor; yanıtlar, arayüz metinleri, commit mesajları ve kod yorumları Türkçe.**
Büyük tasarım kararlarını kodlamadan önce kullanıcıyla netleştir; küçük kararlarda makul varsayılanı seç ve söyle.

## Çalışma kuralları (token tasarrufu — her oturumda geçerli, kullanıcı tekrar anlatmak zorunda değil)

1. **Her görevin ilk yanıtının başında tek satır öneri ver**: `Öneri: model <haiku|sonnet|opus>, efor <low|medium|high>; parçalama: <gerekmez|şu parçalara böl>; /clear: <şimdi gerekmez|bitince>`.
   Ölçüt: tek dosya/metin/stil/küçük hata → haiku veya sonnet + low; birkaç dosya, UI+veri → sonnet + medium; migration/RLS, puanlama, çok dosyalı özellik → sonnet/opus + high (önce plan).
   Kullanıcı `/model` ve `/effort` ile ayarlar; mevcut ayar uygunsa "değiştirmene gerek yok" de.
   **Öneri satırından sonra DUR**: kullanıcı ayarı yapıp "devam" diyene kadar hiçbir araç çağırma, işe başlama (ayar zaten uygunsa "değiştirmene gerek yok" dedikten sonra da onay bekle).
2. **Parçalama**: iş 5+ dosyaya, veya migration + UI + test birlikte dokunuyorsa kullanıcıya parçaları öner (örn. 1 veri/DB, 2 UI, 3 test), her parça sonunda commit+push; hepsini tek seferde yapma.
3. **/clear uyarısı**: konu değişince, bir parça commit+push edilince, veya bağlam şiştiğinde (çok dosya okundu / uzun build-test çıktısı gördün) "şimdi /clear at" diye açıkça söyle. Gereksiz yere clear önerme.
4. **Kapsam**: sadece istenen değişikliği yap; istenmemiş refactor/özellik/doküman ekleme. Ek iş gerekiyorsa önce söyle.
5. **Keşif**: dosya belirtilmişse sadece onu oku (gerekirse ilgili satır aralığını); belirtilmemişse tek `Grep`/`Glob` ile bul. Tüm dizini gezme, `Agent` başlatma. Büyük dosyaları baştan sona okuma. İlgili `docs/` dosyası dışındakini okuma.
6. **Doğrulama (kullanıcı özellikle istemedikçe)**: küçük değişiklikte sadece `npx tsc --noEmit` + etkilenen tek test dosyası. `npm run build`, tüm e2e, `npm run db:check` sadece migration/RLS/akış değiştiyse ve ilgili tek senaryoyu çalıştır. Çıktıyı her zaman kısalt (`| tail -15`, `grep`). Aynı komutu "emin olmak için" tekrarlama.
7. **Commit/push** yalnızca iş bitince ve tek seferde; düzeltme için ek commit yerine mümkünse bitirmeden düzelt.
8. **Yanıtlar kısa**: ne yapıldı + tek paragraf; kod/dosya listesini tekrar etme. Seçenek yığma, öneri ver.
9. Bu kurallar değişecekse (kullanıcı isterse) burayı güncelle; yeni oturumda tekrar sorma.

## Canlı ortam

| | |
|---|---|
| Uygulama | https://halisaha-tawny.vercel.app (Vercel, `main`'e her push otomatik yayınlanır) |
| Repo | https://github.com/mhmtonrr/halisaha (public; gizli anahtar asla commit edilmez) |
| Supabase | proje ref `hbdhbquczlvjnsmrgqxj`, bölge eu-central-1 (Frankfurt) |
| Gerçek veri | Canlı veritabanında gerçek kullanıcılar ve bir grup var. Test verisi bırakma. |

Vercel ortam değişkenleri: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (+ isteğe bağlı `NEXT_PUBLIC_CONTACT_EMAIL`). Kullanıcı Vercel panelinden girdi.

## Yeni oturumda kurulum (Claude Code bulut ortamı)

- Ortam: `halisaha` (izinli hostlar: `hbdhbquczlvjnsmrgqxj.supabase.co`, `halisaha-tawny.vercel.app`;
  `api.supabase.com` için Supabase erişim anahtarı ortamda kayıtlı, proxy ekler — değeri hiç görmezsin).
- Node'un `fetch`'i proxy'yi kendiliğinden kullanmaz: Supabase'e giden her Node komutunda `NODE_USE_ENV_PROXY=1`.
- `.env.local` gitignore'da; yeni konteynerde yoktur. Anahtarları **ekrana basmadan** oluştur:

```bash
npm install
curl -s "https://api.supabase.com/v1/projects/hbdhbquczlvjnsmrgqxj/api-keys?reveal=true" | python3 -c "
import json,sys; k={x['name']:x['api_key'] for x in json.load(sys.stdin) if x.get('name') in ('anon','service_role')}
open('.env.local','w').write('NEXT_PUBLIC_SUPABASE_URL=https://hbdhbquczlvjnsmrgqxj.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n'%(k['anon'],k['service_role']))"
sed 's/=.*/=<set>/' .env.local
```

Erişim reddedilirse (403/401) kullanıcıdan Supabase erişim anahtarını `request_credential` ile
(`api.supabase.com`) iste; chat'e yapıştırtma.

## Teknoloji

Next.js 15 (App Router, Server Actions) · React 19 · Supabase (Postgres, Auth, RLS, Realtime) ·
Tailwind v4 · Vitest · Playwright (konteynerde hazır) · PGlite (gömülü Postgres, RLS kontrolleri için).
Supabase tipleri üretilmedi; sorgular elle tiplenir. 1-1 ilişkiler bazen dizi döner → `one()` (src/lib/data.ts).

## Dizin yapısı

```
src/lib/rating.ts        Puanlama motoru (saf, testli) — en kritik dosya
src/lib/teams.ts         Dengeli takım kurma (saf, testli)
src/lib/attributes.ts    Kart özellikleri FRM/İST/GOL|KRT/AST/GAL/MVP (saf, testli)
src/lib/teams-data.ts    Takım rating'i (en iyi 7), rol etiketleri, takım/üyelik sorguları
src/lib/formations.ts    Sabit dizilişler (5-11 kişilik, slot koordinatları), otomatik yerleştirme (saf, testli)
src/lib/poll-rules.ts    Üye çağrısı kuralları: dolunca kur / süre bitince %70 / yedek sırası (saf, testli)
src/lib/polls.ts         Çağrıyı değerlendirip maça dönüştürür veya iptal eder (service role, atomik talep)
src/lib/listings-data.ts Oyuncu ilanı sorguları (açık ilanlar, başvuranlar, başvurularım)
src/lib/reliability.ts   Güvenilirlik: oynadığı / (oynadığı + gelmediği) (saf, testli)
src/lib/notify-rules.ts  Bildirim kuralları: kategori/tercih, alıcı planı, sohbet birleştirme, metinler, push sonucu (saf, testli)
src/lib/notify.ts        notify(): kutuya yaz + web push gönder (service role; asla fırlatmaz); later(): yanıttan sonra çalıştır
src/lib/recipients.ts    Alıcı bulma: grup üyeleri/yetkilileri, maç kadrosu, bağlı maçlar
src/lib/reminders.ts     Oylama hatırlatması (cron): kapanmasına <24 saat kalan maçlarda oy vermeyenlere, kişi başı 1
src/lib/push-client.ts   Tarayıcı tarafı abonelik yardımcıları; components/PushControls.tsx (izin kartı + profil ayarı)
public/sw.js             Service worker: push'u gösterir, tıklayınca aynı site içi adresi açar (önbellek yok)
src/lib/skills.ts        Yetenek itibarı: 12 kategori (saha HIZ/ŞUT/PAS/DRİ/DEF/FİZ, kaleci REF/ATL/HAV/YER/DAĞ/İLT), 1-10 puanlardan 40-99 değer (saf, testli)
src/lib/skills-data.ts   Değerlendirmelerden kişinin yeteneklerini hesaplayıp player_skills'e yazar (service role; recomputeSkills / recomputeSkillsForVoter)
src/lib/skill-queue.ts   Değerlendirmeni bekleyen oyuncular (skill_queue RPC)
src/lib/profile-stats.ts Kişinin TÜM grup/takım maçlarından istatistik özeti: toplamlar, form, seri, rakip/iç, grup bazında, mevki (saf, testli)
src/lib/profile-data.ts  Kişi bazlı veri (service role): loadPerson, loadPersonMatches, canViewStats, loadProfileForViewer
src/lib/invite.ts        Davet kodu: linkten/yazıdan kodu çıkarma, XXXXX-XXXXX biçimi, tür eşleşmesi (saf, testli)
src/lib/fetch-in.ts      Büyük `in (...)` sorgularını parçalayıp sayfalayan yardımcı
src/components/profile/ProfileView.tsx  Sekmeli profil (Genel/İstatistik/Maçlar/Ayarlar); /profil ve /oyuncu/[id] aynı bileşeni kullanır
src/lib/team-stats.ts    Takım karnesi, form, seri, rakip bazlı geçmiş, oyuncu liderleri (saf, testli)
src/lib/player-search.ts  Oyuncu arama süzgeçleri/sıralama/URL ayrıştırma (saf, testli); veri: src/lib/players-data.ts (service role, sadece `discoverable` kişiler)
src/lib/featured-data.ts  Ana sayfa "öne çıkanlar" (bölge başına 5 dk `unstable_cache`, etiket `featured`); src/components/FeaturedSections.tsx (Suspense ile akar)
src/lib/challenges-data.ts  Maç teklifleri sorguları (gelen/giden, bekleyen sayısı)
src/lib/data.ts          Ortak sorgular, mevki/ayak sabitleri, tarih yardımcıları (TR saati)
src/lib/regions.ts       81 il + src/data/districts.json (973 ilçe, iki kaynakla doğrulandı)
src/lib/actions.ts       Tüm Server Action'lar (yetkiyi RLS yapar; burada sadece çağrı + yönlendirme)
src/lib/finalize.ts      Oylama kapanışı, hesap bazlı genel rating hesabı ve yazımı (service role)
src/components/LiveRefresh.tsx  Canlı güncelleme: Realtime dinler, router.refresh() yapar (filtre yardımcısı src/lib/live.ts)
src/components/SubmitButton.tsx  Form gönderilirken anında "…" durumu (useFormStatus)
src/components/NavHistory.tsx  Uygulama içi gezinti geçmişi; Header geri oku geldiği sayfaya döner
src/components/AppMenu.tsx  ☰ çekmecesi (AppMenuShell layout'ta) ve başlık düğmeleri (MenuControls: bildirim çanı + ☰); veri src/lib/menu-data.ts
src/lib/authErrors.ts    Supabase Auth hatalarının Türkçesi
src/lib/supabase/        server.ts (requireUser + karşılama yönlendirmesi), client.ts, admin.ts
src/middleware.ts        Oturum yenileme, girişsiz yönlendirme, x-pathname başlığı
src/app/                 Sayfalar (aşağıda)
supabase/migrations/     0001..0030 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
scripts/perf/ttfb.mjs   Sayfa yanıt süresi ölçümü (geçici kullanıcıyla canlı site, TTFB)
scripts/recompute-all.ts Tüm ratingleri baştan hesaplar (vite-node ile, aşağıda)
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/profil/ayarlar/{kisisel,futbolcu,iletisim,guvenlik,gorunurluk,engellenenler}` · `/sohbet` (genel sohbet: takım/grup/kişi; `/sohbet/[threadId]` birebir) · `/yardim` · `/geri-bildirim` · `/yetenek` (yetenek değerlendirmesi) · `/oyuncu/[userId]` (başkasının profili) · `/katil` (davet koduyla takıma/gruba katıl; `?tur=takim|grup`) · `/join/[code]` · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,matches/new,cagri/yeni,cagri/[pollId],m/[matchId],p/[playerId]}`
· takımlara özel: `/g/[id]/teklif` (bu takıma maç teklif et) · `/g/[id]/teklifler` (gelen/giden/kabul edilen) · `/g/[id]/istatistik` (herkese açık)

## Alan modeli ve kurallar (ayrıntı docs/ altında — sadece ilgili konuda oku)

| Konu | Dosya |
|---|---|
| Maç türleri, puanlama, genel rating, çapraz oylama, diziliş, teklif, çağrı, çekilme | `docs/mac-puanlama.md` |
| Grup/takım farkı, roller, misafir, asıl kadro, davet kodu, ayrılma, oyuncu ilanı/ödünç | `docs/takim-grup-uyelik.md` |
| Bildirim/push, canlı güncelleme (Realtime), sohbet | `docs/bildirim-canli-sohbet.md` |
| Oyuncu kartı/yetenek, profil/istatistik, Keşfet/öne çıkanlar, menü, hız, karşılama, bölge | `docs/profil-kart-kesfet-menu.md` |
| Gerçek hosting'e geçince / sonra yapılacaklar (e-posta onayı, SMTP, hatırlatıcı, SMS, dil, tema, maç süresi…) | `docs/yayin-sonrasi.md` |

Kısa özet: **Grup** (`kind='community'`) özel topluluk, sadece kendi aramızda maç, rating etkisi yarım. **Takım** (`kind='team'`) herkese açık, sadece rakibe karşı maç, tam etki.
Roller: captain/admin/member. Misafir = `user_id IS NULL`. Davet kodu sütunu okunamaz (RPC). Rating hesap bazında genel (`user_id`), tüm `group_players` satırlarına yazılır.
Yetki hep RLS/RPC'de; `groups` seçerken sütunları açıkça yaz (`invite_code` yok). Yeni konu/tuzak çıkarsa ilgili docs dosyasına ekle, buraya sadece tek satırlık işaret koy.

## Veritabanı değişikliği iş akışı

1. Yeni dosya: `supabase/migrations/00NN_aciklama.sql` (sadece ekleme tercih et; mevcut veriyi koru).
2. `scripts/db-checks/` altına yetki kontrolü ekle (`setupDb()` Supabase'e benzer ortam kurar), `npm run db:check`.
3. **Yayındaki eski kodla uyumu düşün.** Eski sürümü bozan değişiklik (ör. sütun yetkisi kaldırma, rol değişimi)
   canlıya kodla birlikte, push'tan hemen önce uygulanır.
4. Canlıya uygula (tek istek tek transaction):
```bash
python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/00NN_x.sql').read()}))" > /tmp/m.json
curl -s -X POST https://api.supabase.com/v1/projects/hbdhbquczlvjnsmrgqxj/database/query -H 'Content-Type: application/json' --data @/tmp/m.json
```
5. Supabase Auth ayarı gibi **güvenliği gevşeten** değişiklikleri kendin yapma; kullanıcıya panelden nasıl
   yapacağını anlat.

## Test

```bash
npm test               # Vitest: puanlama, takım dengeleme, özellikler, bölgeler, hata metinleri
npm run db:check       # PGlite'ta tüm migration'lar + RLS/RPC kontrolleri
npx tsc --noEmit && npm run lint && npm run build
```

Uçtan uca (canlı Supabase'e karşı; test kullanıcıları/grupları oluşturur ve **sonunda siler**):
```bash
(NODE_USE_ENV_PROXY=1 npx next start -p 3000 > /tmp/server.log 2>&1 &)
NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 node scripts/e2e/chat.mjs /tmp/shots
```
**Bilinen bozuk/kırılgan senaryolar (benim değişikliklerimle ilgisiz)**: `teams-polls` ("grup üyesi maç/çağrı açamıyor" ve "Doğrudan maç" eski varsayımlar, üye çağrısından/0013'ten önce yazıldı), `auth-onboarding` (ilçe artık `input[name=district]` değil seçim listesi),
`member-poll` (akşam saatlerinde formun varsayılan 21:00 maçı "en az 3 saat sonra" kuralına takılır → günün saatine bağlı). Menü/davet testlerinde çekmece içeriği `waitFor` ile beklenir.
Senaryolar: `profile-links`, `invite`, `withdrawal`, `leave`, `menu`, `profile`, `skills`, `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`, `member-poll`, `listings`, `notifications`.
Ekran görüntülerine bak (390px genişlik, telefon) — görsel sorunlar çoğu zaman sadece orada yakalanıyor.
Port doluysa: `fuser -k 3000/tcp`. Arayüzden kayıt (signUp) test etme: onay maili gönderir, limit saatte 2.

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

`main`'e doğrudan commit + push (kullanıcının akışı bu). Commit mesajları Türkçe, ne ve neden.
