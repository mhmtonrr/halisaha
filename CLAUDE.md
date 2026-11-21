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
src/lib/formations.ts    Sabit dizilişler (5-11 kişilik, slot koordinatları), otomatik yerleştirme (saf, testli)
src/lib/team-stats.ts    Takım karnesi, form, seri, rakip bazlı geçmiş, oyuncu liderleri (saf, testli)
src/lib/challenges-data.ts  Maç teklifleri sorguları (gelen/giden, bekleyen sayısı)
src/lib/data.ts          Ortak sorgular, mevki/ayak sabitleri, tarih yardımcıları (TR saati)
src/lib/regions.ts       81 il + src/data/districts.json (973 ilçe, iki kaynakla doğrulandı)
src/lib/actions.ts       Tüm Server Action'lar (yetkiyi RLS yapar; burada sadece çağrı + yönlendirme)
src/lib/finalize.ts      Oylama kapanışı, hesap bazlı genel rating hesabı ve yazımı (service role)
src/components/LiveRefresh.tsx  Canlı güncelleme: Realtime dinler, router.refresh() yapar (filtre yardımcısı src/lib/live.ts)
src/components/SubmitButton.tsx  Form gönderilirken anında "…" durumu (useFormStatus)
src/components/NavHistory.tsx  Uygulama içi gezinti geçmişi; Header geri oku geldiği sayfaya döner
src/lib/authErrors.ts    Supabase Auth hatalarının Türkçesi
src/lib/supabase/        server.ts (requireUser + karşılama yönlendirmesi), client.ts, admin.ts
src/middleware.ts        Oturum yenileme, girişsiz yönlendirme, x-pathname başlığı
src/app/                 Sayfalar (aşağıda)
supabase/migrations/     0001..0013 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
scripts/recompute-all.ts Tüm ratingleri baştan hesaplar (vite-node ile, aşağıda)
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/join/[code]` · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,matches/new,cagri/yeni,cagri/[pollId],m/[matchId],p/[playerId]}`
· takımlara özel: `/g/[id]/teklif` (bu takıma maç teklif et) · `/g/[id]/teklifler` (gelen/giden/kabul edilen) · `/g/[id]/istatistik` (herkese açık)

## Alan modeli ve kurallar

**Grup (`groups.kind='community'`)**: topluluk. Sadece üyelere görünür. Bölge isteğe bağlı.
**Takım (`kind='team'`)**: rekabet. Herkese açık (ad, bölge, kadro, ratingler, maç sonuçları); il zorunlu.
İkisi aynı altyapıyı paylaşır (group_players, matches, oylama, rating, çağrı, sohbet) ama **iş kuralları ayrıdır (kullanıcı kararı)**:

| | Grup (topluluk) | Takım (rekabet) |
|---|---|---|
| Maç türü | sadece **kendi aramızda** (internal, dengeli A/B) | sadece **rakibe karşı** (external; teklifle ortak maç veya uygulamada olmayan rakip) |
| Zorunluluk | `enforce_match_kind` tetikleyicisi (0013, sadece yeni kayıtlar; eski maçlar kalır) + `createMatch` türü gruptan alır | aynı |
| Rating etkisi | yarım (`CONFIG.CASUAL_IMPORTANCE = 0.5`) | rakip maçı tam; iç/antrenman maçı (eski veri) yarım |
| Görünürlük | özel | herkese açık; teklif, istatistik, diziliş, çapraz oylama sadece takımda |

**Kararlaştırılan ama henüz yapılmayanlar** (tasarım tartışması sürüyor): (1) grupta üyeler yalnızca **çağrı** açar, çağrı doluluk/süre
şartını sağlarsa otomatik maça dönüşür; yetkililer hem maç kurar hem çağrı açar (takımda çağrıyı sadece yetkili açar); (2) takım,
eksik oyuncusu için **gruplardan davetle oyuncu çekebilir** (ödünç/konuk hesaplı oyuncu; takım kadrosuna girmez, maç kadrosuna girer).

**Roller (`group_players.role`)**: `captain` (takımda "Kaptan", grupta "Kurucu"), `admin` ("Yetkili"), `member`.
- Maç ve maç çağrısını sadece captain/admin kurar (RLS). Rolleri sadece captain değiştirir (`set_member_role` RPC;
  doğrudan UPDATE politikası bilerek yok). Kaptanlık devrinde eski kaptan admin olur.
- Oyuncu çıkarma: captain çıkarılamaz; admin'leri sadece captain çıkarır.
- `is_group_admin()` captain'ı da kapsar.

**Misafir**: `group_players.user_id IS NULL`. Oylanır, oy veremez, sohbete yazamaz. `claim_guest` ile hesaba aktarılır.
**Sadece maç ekranından eklenir** (`addGuestToMatch`: misafiri gruba + o maçın kadrosuna yazar; planlanmış maçta, kaptan/yetkili).
"Oyuncular" sayfasında ekleme formu yoktur; orada misafirin mevkisi ve geçmiş aktarımı kalır. Sonraki maçlarda
misafir kadro listesinde (yedek seçiminde) tekrar seçilebilir.
**Asıl kadro = hesabı olan üyeler** (davet linki/kodla katılanlar). Misafirler takım/grup sayfasında, kadro sayfasında ve Oyuncular
sayfasında ayrı bölümde/sekmede durur (`RosterTabs`, `?sekme=misafir`; istatistikleri orada görünür); oyuncu sayısına, takım
puanına (`teamRating`), Keşfet sıralamasına, takım liderlerine ve istatistik sayfasına girmez. Maç kadrosunda ve oylamada normal oyuncudur.

**Davet kodu gizli**: `groups.invite_code` sütununa SELECT yetkisi yok (takımlar herkese açık olduğu için).
Kod `group_invite_code()` RPC ile alınır (takımda captain/admin, grupta her üye). **`groups`'tan seçerken
sütunları açıkça yaz, `select *` ve `invite_code` kullanma** — yetki hatası verir.

**Maç**: `kind` internal (kendi aramızda, A/B takımı) / external (rakibe karşı; tüm kadro A, score_a=biz).
Durum: planned → voting (skor girilince, 24 saat) → closed. Takımlar arası maçta planned → played (skor onayı) → voting. Maça özel mevki `match_players.position`.

**Puanlama** (src/lib/rating.ts): oy veren bazlı normalizasyon (z), 5+ oyda uç değer kırpma, ikili/klik tespiti,
ağırlık = katılım (oy verebilecek hesap sahiplerinin yarısı → tam) × örneklem (4+ oy → tam), tek oyla 0;
galibiyet ±0.15; maçın önemi çarpanı (`MatchInput.importance`: takım rakip maçı 1, grup/iç maç 0.5; ağırlığı çarpar, eşikleri değiştirmez); yakın maçlar ağır basar; yeni oyuncu ortalamaya (65) çekilir; 40-99 FIFA ölçeği.
Oylama süre dolunca **sayfa açıldığında** kapanır (`finalizeExpired`), herkes oy verince anında kapanır.
Formül değişirse `recomputeGroup(groupId)` ile grubun tüm sonuçları yeniden yazılabilir (oylara dokunmaz).

**Genel rating (migration 0010)**: hesap sahibi oyuncunun rating'i tüm grup/takım/maçlardan **tek** hesaplanır ve kişinin
her `group_players` satırına aynen yazılır (`player_ratings` yapısı değişmedi, UI sorguları aynı). Kimlik anahtarı = `user_id`,
misafirde `group_players.id` (misafirin rating'i kendi grubunda kalır). Bir kişinin rating'i sadece oynadığı maçlara
bağlı olduğundan `recomputeRatings(admin, {playerIds})` o kişilerin tüm maçlarını yükler. Yeni gruba katılana DB tetikleyicisi
mevcut rating'i kopyalar (`copy_rating_on_join`); misafir hesaba aktarılınca `recomputePlayers`. Kart özellikleri
(gol/asist/FRM…) hâlâ grup geçmişinden gelir; sadece rating genel.
Formül değişince veya geçişte hepsini yeniden yazmak için (yedek alıp farkı listeler):
`NODE_USE_ENV_PROXY=1 npx vite-node --config scripts/recompute.vite.config.mjs scripts/recompute-all.ts`

**Çapraz oylama**: takımlar arası (bağlı) iki maç **tek oylama havuzudur**: sahadaki herkes kendi dışındaki herkese oy verir
(`can_vote` bağlı maçın kadrosunu da kabul eder; oy oy verenin kendi maçına yazılır, `voting_progress` iki maçı sayar).
Motor (`MatchInput.rivalShare`, `CONFIG.RIVAL_SHARE = 0.6`): bir oyuncunun maç puanının %60'ı rakip takımın, %40'ı kendi
takımının oylarından gelir (taraf boşsa diğeri tam sayılır); tek MVP seçilir. İki maç birlikte kapanır (`finalizeMatch`
çifti birlikte talep eder, sonuçlar `match_results`'a her oyuncunun kendi maç satırına yazılır). Bağlı maçta elle "oylamayı
kapat" yoktur (süre dolunca veya herkes oy verince). Aynı kişi bağlı maçın iki kadrosunda olamaz (`guard_linked_roster`).

**Kişi sayısı ve diziliş (migration 0011)**: `matches.team_size` (5-11, her takım, kaleci dahil; eski maçlarda boş →
kadrodan tahmin `inferSize`). Teklifte seçilir (`create_challenge(..., p_size default 7)`), kabulde iki maça yazılır;
normal maç kurarken de seçilir. Diziliş: `matches.formation_a/b` (ör. `2-3-1`) + `match_players.slot` (0 = kaleci,
sonra savunmadan hücuma soldan sağa; boşsa yedek; takım başına benzersiz). `formations.ts` her sayı için hazır dizilişleri
üretir. Kaptan/yetkili/maçı kuran maç ekranında "Diziliş (sürükle-bırak)" editörünü (`LineupEditor`, Pointer Events: sürükle
ya da seç+dokun; dolu yere bırakınca takas) kullanır, `setLineup` action'ı kaydeder ve sahadaki oyuncunun maç mevkisini
slot rolüne çeker. Dizilişler **hep açık**: herkes (rakip ve ziyaretçi dahil) maç ekranında iki sahayı görür. Rakibe karşı
maçta sadece A tarafı vardır; kendi aramızda maçta A ve B ayrı dizilir. Oyuncu takım değiştirince slotu düşer (tetikleyici).
Sahadaki oyuncu, profildeki gerçek oyuncu kartıdır (`PitchCard`: kalkan, seviye rengi, rating/mevki/baş harfler/isim ve 6 özellik
FRM·İST·GOL|KRT·AST·GAL·MVP). Kart `em` ile çizilir; yazı boyutu sahanın genişliğinden (`cqw`, `Pitch` kapsayıcısı + `--cw`)
türetilir ve `cardWidthPct` ile hat başına oyuncu sayısına göre ölçeklenir. Özellikler `getGroupSummaries` ile gelir (kendi ve rakip kadro).
Tuzak: editördeki token'ın `click`'i yukarı çıkarsa slot/yedek alanının "seçiliyi buraya koy" işleyicisi seçimi siler
(`stopPropagation` bu yüzden var).

**Takımlar arası maç teklifi** (match_challenges, migration 0009): kaptan/yetkili kendi takımından başka bir takıma
`create_challenge` RPC ile teklif yollar (tarih, saha, ücret serbest metin, mesaj; aynı takıma en fazla 3 bekleyen).
Karşı takımın kaptan/yetkilisi `respond_challenge` ile kabul/ret eder; kabulde **iki takımda da** birer `external` maç
açılır (`matches.challenge_id` ortak, `opponent_group_id` rakip takım) ve kadroları her takım kendi maçında seçer.
Teklifi sadece iki takımın üyeleri görür; yazma sadece RPC (`cancel_challenge`: gönderen bekleyeni geri çeker, kabul
edilmiş planlı maçı iki taraf da iptal eder — iki maç birlikte silinir). Bağlı maçta "Maçı iptal et" = `cancel_challenge`.
**Skor eşleşmesi**: bağlı maçta skoru iki takım ayrı girer; `submitResult` maçı `played` (skor onayı bekliyor) yapar ve
`settle_linked_match` RPC'si çağrılır: skorlar birbirinin aynası değilse `mismatch` (oylama açılmaz, taraflar düzeltir),
rakip girmediyse `waiting`, eşleşirse `settled` ve iki maç da `voting` (24 saat) olur. Maç ekranı ortak karşılaşma ekranıdır:
iki takım kartı, rakip kadro/ratingler (takımlar herkese açık olduğu için RLS değişmedi), kapanınca rakibin oyuncu puanları.
Takım istatistikleri `finished` (voting+closed) rakip maçlarından hesaplanır (`team-stats.ts`).

**Maç çağrısı** (match_polls/poll_responses): yetkili açar; üyeler `respond_poll` RPC ile yanıtlar; onay
sadece `set_poll_approval` / `approve_first_responders` RPC ile. Kontenjan sırası `responded_at`.
"Maçı oluştur" → `/matches/new?cagri=ID` onaylananlarla dolu gelir; maç oluşunca çağrı `converted`.

**Canlı güncelleme (migration 0012)**: sayfa elle yenilenmeden diğer kullanıcıların işlemleri yansır. `<LiveRefresh watches=[…]>`
Supabase Realtime `postgres_changes`'i dinler (RLS'e uyar; `realtime.setAuth`) ve `router.refresh()` yapar (250 ms debounce; sayfa
kaydırması, form ve sürükleme durumu korunur). Yayındaki tablolar: group_messages, matches, match_players, match_results,
match_challenges, match_polls, poll_responses, group_players. Yeni bir tabloyu canlı yapmak için migration'da publication'a ekle.
Filtre tek koşuldur (`col=eq.x` veya `inList()`); **DELETE olayları filtreli aboneliklere ulaşmaz** → silmeye bağlı durumlar
bir güncelleme olayıyla izlenir (teklif iptalinde maçlar silinir, `match_challenges.status` güncellenir; maç ekranı bunu dinler).
Başkalarının oyları RLS'ten dolayı Realtime'a düşmez; oylamada sayaç için `pollMs` (15 sn) kullanılır. Sekme görünür olunca/
ağ gelince/yeniden bağlanınca da yenilenir. Tuzak: `inList` gibi yardımcılar `"use client"` dosyasında olamaz (sunucu bileşeni çağıramaz) → `src/lib/live.ts`.
Sohbet kendi aboneliğini kullanır (LiveRefresh koyma). Sayfa zıplamasın diye yerinde güncellenecek formlar `redirect` etmez:
eylem durum döndürür (`useActionState`, bkz. `GuestForm`); `revalidatePath` sayfayı yerinde tazeler.

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
Senaryolar: `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`.
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

- **E-posta onayı kapatıldı** (kullanıcı yaptı): şifreyle kayıt artık mail limitine takılmaz. Risk: başkasının
  e-postasıyla kayıt olunabilir; Resend/SMTP kurulunca "Confirm email" tekrar açılmalı.
- **Resend/SMTP**: alan adı gerekiyor (vercel.app doğrulanamaz). Kullanıcı şimdilik erteledi.
- Google OAuth uygulaması yayınlandı (Publish app yapıldı); artık sadece test kullanıcıları değil herkes girebilir.

## Yol haritası (kullanıcıyla konuşulan)

1. ~~Puanlama, takım dengeleme, oylama~~ · ~~profil/mevki/rakip maç~~ · ~~takımlar, roller, çağrı~~ · ~~sohbet~~
2. ~~Takımlar arası maç teklifi + ortak maç ekranı + takım istatistikleri~~ (yapıldı; sonraki adım: karşı teklif/tarih değiştirme, takım sıralamasında W/D/L)
3. **Bildirimler** (çağrı, maç, oylama, sohbet; web push — iOS'ta ana ekrana ekleme gerekir)
4. Halısaha tesis rehberi, işletme hesapları, rezervasyon/turnuva (gelir modeli)
5. Rozetler, yetenek oylaması (hız/şut/pas…), sohbette fotoğraf
6. Türkiye geneli açılış öncesi: KVKK aydınlatma metni, 18 yaş altı kuralı, e-posta onayı tekrar açık

## Git

`main`'e doğrudan commit + push (kullanıcının akışı bu). Commit mesajları Türkçe, ne ve neden.
