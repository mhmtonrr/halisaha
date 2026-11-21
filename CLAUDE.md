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
supabase/migrations/     0001..0019 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
scripts/recompute-all.ts Tüm ratingleri baştan hesaplar (vite-node ile, aşağıda)
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/yetenek` (yetenek değerlendirmesi) · `/join/[code]` · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,matches/new,cagri/yeni,cagri/[pollId],m/[matchId],p/[playerId]}`
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

**Üye çağrısı (migration 0014, yapıldı)**: grupta üyeler maç kuramaz, **çağrı** açar (`create_member_poll` RPC: `match_polls.auto_match`,
`team_size`; kontenjan = 2 × kişi sayısı). Sınırlar DB'de: maç en az 3 saat sonra, en fazla 14 gün içinde; son yanıt süresi (boşsa maçtan
3 saat önce) maçtan en az 1 saat önce ve gelecekte; yetkili olmayan üye aynı anda 1 açık çağrı; açan otomatik "geliyorum". Takımda üye
çağrı açamaz. Maça dönüşüm (`polls.ts`, `poll-rules.ts`): **kontenjan dolunca hemen** (`respondPoll` sonrası `settlePoll`); **son yanıt süresi
bitince** "geliyorum" ≥ %70 (`MIN_FILL_RATIO`; 14 için 10) ise eksik kadroyla, değilse çağrı iptal olur ve sohbete yazılır. Sayfa açılışında
tetiklenir (`settleExpiredPolls`, cron yok; çağrı sayfası açıkken 30 sn'de bir tazelenir). Kadro: yanıt sırasına göre ilk N kişi, fazlası yedek
(biri vazgeçerse sıradaki girer); takımlar `balanceTeams` ile dengeli bölünür (profilinde mevkisi kaleci olan kaleci). Dönüşüm atomik talep eder
(`status open → converted`), hata olursa maç silinir ve çağrı yeniden açılır. Çağrıyı açan veya yetkili `close_poll` ile iptal eder. Yetkililerin
çağrısı eskisi gibi elle onaylıdır (`approve_*` RPC'leri, "Maçı oluştur"); yetkili hem maç kurar hem çağrı açar.

**Oyuncu arama ilanı ve ödünç oyuncu (migration 0015, yapıldı)**: takımın kaptanı/yetkilisi planlanmış rakip maçı için "oyuncu arıyoruz"
ilanı açar (`create_listing`: 1-10 oyuncu, aranan mevkiler, isteğe bağlı min. rating, not; maç başına 1, takım başına en fazla 5 açık ilan).
İlan **herkese açıktır** (giriş yapmış herkes görür): `/ilan/[id]`, Keşfet'te bölgeye göre "Oyuncu arayan takımlar", takım sayfası, maç ekranı
şeridi; `ShareLink` ile gruplarda paylaşılır. Hesabı olan herkes `apply_listing` ile başvurur (mevki + not; takımın oyuncusu, maçta/rakip kadroda
olan ve min. rating altı başvuramaz; en fazla 10 bekleyen başvuru). Kaptan/yetkili başvuranları `listing_applicants` RPC'siyle **rating,
mevki ve güvenilirlikle** görür (başvuranın rating'i kendi özel gruplarındaki satırlara bağlı olduğundan normal sorguyla okunamaz) ve
`decide_application` ile **tek tek** kabul/ret eder (ilk gelen otomatik girmez). Kabul edilen oyuncu takıma `group_players.is_loan = true`
olarak yazılır ve o maçın kadrosuna girer; takımın asıl kadrosunda değildir: `is_group_member` onu **saymaz** (takım sohbeti, teklifler,
çağrılar, yetkiler kapalı), `getMemberships`/Takımlarım/profil kartlarında yoktur, takım sayfasında "Misafirler" sekmesinde "ödünç" etiketiyle
görünür (maç ekranı ve kadro sayfası da `isSquadMember`/`isGuestLike` ayrımını kullanır). Oy verir/oylanır, genel ratingi geçerlidir.
Gereken sayı dolunca ilan `filled` olur. Ödünç oyuncu davet koduyla katılırsa kalıcı üye olur (`join_group` upsert). Oyuncu ilan
kabulünü/durumunu ana sayfada görür (canlı). **Güvenilirlik**: maç sonucu girerken kaptan "gelmedi" işaretler (`mark_no_shows`: kadrodan
çıkarır, hesabı olanı `match_no_shows`'a yazar; sadece planlanmış maçta, yani skor düzeltmesinde "gelmedi" kutusu görünmez). `listing_applicants`
oynadığı (oylama/kapanışa ulaşmış) maç ve gelmediği maç sayısını verir (kimlik doğrulamasız genel bir güvenilirlik sorgusu bilerek yok),
`reliability()` yüzdeyi ve etiketi üretir (3 kayıttan azında "Yeni"). `submitResult` sırası: önce her şeyi doğrula (yetki, skor, "gelmedi"
çıkınca kalan ≥2, durum), sonra istatistikleri yaz, "gelmedi"yi en son (maç durumu güncellenmeden hemen önce) işaretle; geri alınamayan işlem
doğrulanabilir bir hatadan önce yapılmaz.
**İlan yaşam döngüsü (0016)**: maç planlanmış olmaktan çıkınca (sonuç/oylama/iptal) açık ilan **kapanır** (tetikleyici); 5 açık ilan sınırı sadece
planlanmış ve gelecekteki maçları sayar; bekleyen 10 başvuru sınırı yeniden başvuruda da işler; kabul edilmiş ödünç oyuncu maç kadrosundan çıkarılırsa
(`match_players` silinmesi) başvurusu `withdrawn` olur ve dolu ilan yeniden açılır; mevkisiz başvuran da kabul edilir (kaleci sayılmaz).
Ödünç oyuncu `getMemberships`'te yok ama oynadığı maç oylamaya geçince ana sayfada "Oyunu bekliyorlar (ödünç)" kartı görür. Tuzak: `returns table` içinde `position` sütun adı olamaz (`chosen_position`).
Tuzak: canlı yenilenen sunucu bileşeninde `<details open={koşul}>` her yenilemede kullanıcının açtığını kapatır → `AutoOpenDetails`
(sadece ilk yüklemede açar).

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

**Bildirimler (migration 0017)**: her olay `notify()` ile önce **bildirim kutusuna** (`notifications`, `/bildirimler`, nav rozeti Realtime ile canlı)
yazılır, sonra (VAPID anahtarı ve abonelik varsa) **web push** gönderilir; push izni olmayan/iPhone'da ana ekrana eklememiş kullanıcı da kutuda görür.
Olaylar: oylama açıldı (`submitResult`/`settle_linked_match` sonrası, iki takım), oylama hatırlatması (günlük cron), çağrı açıldı/maça dönüştü/iptal,
maç kuruldu, teklif geldi/yanıtlandı, ilana başvuru/başvuru sonucu, sohbet mesajı. Olayı yapan kendi işlemi için bildirim almaz. Kategori tercihi
(`notification_prefs`: votes, matches, offers, chat; satır yoksa hepsi açık) kapalıysa ne kutuya ne push'a yazılır. **Sohbet**: bir kullanıcıya aynı
gruptan 10 dakikada en fazla 1 bildirim (etiket `chat:<grup>`; mesaj doğrudan DB'ye yazıldığından gönderenin tarayıcısı `notifyChatMessage` ile bildirir,
sunucu mesajın çağıranın ve <60 sn olduğunu doğrular). Gönderim yanıttan sonra (`later` = `after`) yapılır; hata asıl işlemi bozmaz. Ölü abonelik (404/410)
silinir. İzin kartı (`PushPrompt`) anlamlı anda çıkar: oy verince, çağrıya yanıt verince, ilana başvurunca; 14 gün "şimdi değil"; iPhone'da önce ana ekrana ekleme anlatılır.
**Ortam değişkenleri (Vercel; yoksa sadece uygulama içi kutu çalışır)**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (üretmek için
`npx web-push generate-vapid-keys`; özel anahtarı asla commit etme/yazdırma), isteğe bağlı `VAPID_SUBJECT` (varsayılan site adresi; kişisel e-posta koyma),
`CRON_SECRET` (hatırlatma cron'u için; yoksa `/api/cron/vote-reminders` kapalıdır, Vercel Cron `vercel.json` ile günde 1 kez 18:00 TR çağırır).
Test: `scripts/e2e/notifications.mjs` (sunucu `CRON_SECRET=e2e-secret` ile başlatılmalı) ve gerçek kütüphane/VAPID imzalı
`NODE_USE_ENV_PROXY=1 npx vite-node --config scripts/recompute.vite.config.mjs scripts/e2e/push-delivery.ts`. Gerçek cihaza teslim sadece elle denenebilir.
Tuzak: `web-push` adlandırılmış içe aktarımla kullanılır (varsayılan dışa aktarımı yok; derleme uyarısı verir ve üretimde çöker).

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
Senaryolar: `skills`, `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`, `member-poll`, `listings`, `notifications`.
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
- **Web push için Vercel ortam değişkenleri** (bildirimler kodu hazır, anahtarlar yoksa sadece uygulama içi kutu çalışır): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`), `CRON_SECRET` (rastgele uzun metin). Eklenince yeniden dağıtım gerekir. Sonra telefonda gerçek bildirim denemesi yapılmalı.
- Google OAuth uygulaması yayınlandı (Publish app yapıldı); artık sadece test kullanıcıları değil herkes girebilir.

## Yol haritası (kullanıcıyla konuşulan)

1. ~~Puanlama, takım dengeleme, oylama~~ · ~~profil/mevki/rakip maç~~ · ~~takımlar, roller, çağrı~~ · ~~sohbet~~
2. ~~Takımlar arası maç teklifi + ortak maç ekranı + takım istatistikleri~~ (yapıldı; sonraki adım: karşı teklif/tarih değiştirme, takım sıralamasında W/D/L)
3. ~~Bildirimler~~ (yapıldı: kutu + web push; kullanıcı Vercel'e VAPID anahtarlarını eklemeli, bkz. yukarı)
4. Halısaha tesis rehberi, işletme hesapları, rezervasyon/turnuva (gelir modeli)
5. Rozetler, ~~yetenek oylaması (hız/şut/pas…)~~ (yapıldı: 0019), sohbette fotoğraf
6. Türkiye geneli açılış öncesi: KVKK aydınlatma metni, 18 yaş altı kuralı, e-posta onayı tekrar açık

## Git

`main`'e doğrudan commit + push (kullanıcının akışı bu). Commit mesajları Türkçe, ne ve neden.
