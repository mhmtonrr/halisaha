# Halısaha — proje rehberi

Türkiye geneli halısaha topluluk ve rekabet platformu. Oyuncular maç sonrası birbirini puanlar,
FIFA tarzı kartlar oluşur; gruplar (topluluk) ve takımlar (rekabet) ayrı oluşumlardır.

**Kullanıcı Türkçe konuşuyor; yanıtlar, arayüz metinleri, commit mesajları ve kod yorumları Türkçe.**
Büyük tasarım kararlarını kodlamadan önce kullanıcıyla netleştir; küçük kararlarda makul varsayılanı seç ve söyle.

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
src/lib/data.ts          Ortak sorgular, mevki/ayak sabitleri, tarih yardımcıları (TR saati)
src/lib/regions.ts       81 il + src/data/districts.json (973 ilçe, iki kaynakla doğrulandı)
src/lib/actions.ts       Tüm Server Action'lar (yetkiyi RLS yapar; burada sadece çağrı + yönlendirme)
src/lib/finalize.ts      Oylama kapanışı, grup ratinglerini yeniden hesaplama (service role)
src/lib/authErrors.ts    Supabase Auth hatalarının Türkçesi
src/lib/supabase/        server.ts (requireUser + karşılama yönlendirmesi), client.ts, admin.ts
src/middleware.ts        Oturum yenileme, girişsiz yönlendirme, x-pathname başlığı
src/app/                 Sayfalar (aşağıda)
supabase/migrations/     0001..0008 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/join/[code]` · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,matches/new,cagri/yeni,cagri/[pollId],m/[matchId],p/[playerId]}`

## Alan modeli ve kurallar

**Grup (`groups.kind='community'`)**: topluluk. Sadece üyelere görünür. Bölge isteğe bağlı.
**Takım (`kind='team'`)**: rekabet. Herkese açık (ad, bölge, kadro, ratingler, maç sonuçları); il zorunlu.
İkisi aynı altyapıyı paylaşır (group_players, matches, oylama, rating, çağrı, sohbet).

**Roller (`group_players.role`)**: `captain` (takımda "Kaptan", grupta "Kurucu"), `admin` ("Yetkili"), `member`.
- Maç ve maç çağrısını sadece captain/admin kurar (RLS). Rolleri sadece captain değiştirir (`set_member_role` RPC;
  doğrudan UPDATE politikası bilerek yok). Kaptanlık devrinde eski kaptan admin olur.
- Oyuncu çıkarma: captain çıkarılamaz; admin'leri sadece captain çıkarır.
- `is_group_admin()` captain'ı da kapsar.

**Misafir**: `group_players.user_id IS NULL`. Oylanır, oy veremez, sohbete yazamaz. `claim_guest` ile hesaba aktarılır.

**Davet kodu gizli**: `groups.invite_code` sütununa SELECT yetkisi yok (takımlar herkese açık olduğu için).
Kod `group_invite_code()` RPC ile alınır (takımda captain/admin, grupta her üye). **`groups`'tan seçerken
sütunları açıkça yaz, `select *` ve `invite_code` kullanma** — yetki hatası verir.

**Maç**: `kind` internal (kendi aramızda, A/B takımı) / external (rakibe karşı; tüm kadro A, score_a=biz).
Durum: planned → voting (skor girilince, 24 saat) → closed. Maça özel mevki `match_players.position`.

**Puanlama** (src/lib/rating.ts): oy veren bazlı normalizasyon (z), 5+ oyda uç değer kırpma, ikili/klik tespiti,
ağırlık = katılım (oy verebilecek hesap sahiplerinin yarısı → tam) × örneklem (4+ oy → tam), tek oyla 0;
galibiyet ±0.15; yakın maçlar ağır basar; yeni oyuncu ortalamaya (65) çekilir; 40-99 FIFA ölçeği.
Oylama süre dolunca **sayfa açıldığında** kapanır (`finalizeExpired`), herkes oy verince anında kapanır.
Formül değişirse `recomputeGroup(groupId)` ile grubun tüm sonuçları yeniden yazılabilir (oylara dokunmaz).

**Maç çağrısı** (match_polls/poll_responses): yetkili açar; üyeler `respond_poll` RPC ile yanıtlar; onay
sadece `set_poll_approval` / `approve_first_responders` RPC ile. Kontenjan sırası `responded_at`.
"Maçı oluştur" → `/matches/new?cagri=ID` onaylananlarla dolu gelir; maç oluşunca çağrı `converted`.

**Sohbet** (group_messages/chat_reads): Realtime postgres_changes, RLS'e uyar (sadece üyeler; takım sohbeti de
sadece oyunculara). İstemci abone olmadan önce `realtime.setAuth(token)` çağırır ve (yeniden) bağlanınca
kaçırılanları çeker — bunu kaldırma, yoksa mesajlar ara sıra düşmüyor. Etkinlik kartları DB tetikleyicileriyle
(çağrı açıldı, maç kuruldu, oylama açıldı); "sonuçlar açıklandı" kartı finalize başarılı olunca koddan yazılır.
Spam: dakikada 20 mesaj, 1000 karakter. Silme `delete_message` RPC (yazar veya yetkili; içerik silinir).

**Karşılama**: `profiles.onboarded_at` boşsa `requireUser()` kullanıcıyı `/hosgeldin?next=...` sayfasına yollar
(middleware `x-pathname` başlığı ile). Karşılama sayfası `requireUser({ allowIncomplete: true })` kullanır.

**Bölge**: il `PROVINCES` listesinden, ilçe `canonicalDistrict(il, ilçe)` ile sunucuda doğrulanır.
Formlarda `RegionSelect` (il seçilince ilçeler) kullan.

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
Senaryolar: `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`.
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

- **E-posta onayı açık + saatte 2 mail limiti**: şifreyle kayıt neredeyse imkânsız. Kullanıcıya önerildi:
  Supabase → Authentication → Sign In / Providers → Email → "Confirm email" kapat, min şifre 8.
  (Kapatınca başkasının e-postasıyla kayıt riski var; Resend kurulunca tekrar açılmalı.) Yapıldı mı, sor.
- **Resend/SMTP**: alan adı gerekiyor (vercel.app doğrulanamaz). Kullanıcı şimdilik erteledi.
- Google OAuth uygulaması "Testing"de kalmışsa sadece test kullanıcıları girebilir (Branding + Publish app).

## Yol haritası (kullanıcıyla konuşulan)

1. ~~Puanlama, takım dengeleme, oylama~~ · ~~profil/mevki/rakip maç~~ · ~~takımlar, roller, çağrı~~ · ~~sohbet~~
2. **Takımlar arası maç teklifi** (takım → takım; tarih, saha, ücret; kabul/ret; iki taraf da kendi oyuncularını puanlar)
3. **Bildirimler** (çağrı, maç, oylama, sohbet; web push — iOS'ta ana ekrana ekleme gerekir)
4. Halısaha tesis rehberi, işletme hesapları, rezervasyon/turnuva (gelir modeli)
5. Rozetler, yetenek oylaması (hız/şut/pas…), sohbette fotoğraf
6. Türkiye geneli açılış öncesi: KVKK aydınlatma metni, 18 yaş altı kuralı, e-posta onayı tekrar açık

## Git

`main`'e doğrudan commit + push (kullanıcının akışı bu). Commit mesajları Türkçe, ne ve neden.
