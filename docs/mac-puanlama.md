# Maç, puanlama, çağrı, teklif

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

**Otomatik çağrı (migration 0014; 0034'ten beri üye açamaz, sadece `can_create_match`: kurucu/yetkili/organizatör; arayüzde artık açılmıyor, birleşik çağrıyla (2. parça) kalkacak)**: eskiden grupta üyeler **çağrı** açardı (`create_member_poll` RPC: `match_polls.auto_match`,
`team_size`; kontenjan = 2 × kişi sayısı). Sınırlar DB'de: maç en az 3 saat sonra, en fazla 14 gün içinde; son yanıt süresi (boşsa maçtan
3 saat önce) maçtan en az 1 saat önce ve gelecekte; yetkili olmayan üye aynı anda 1 açık çağrı; açan otomatik "geliyorum". Takımda üye
çağrı açamaz. Maça dönüşüm (`polls.ts`, `poll-rules.ts`): **kontenjan dolunca hemen** (`respondPoll` sonrası `settlePoll`); **son yanıt süresi
bitince** "geliyorum" ≥ %70 (`MIN_FILL_RATIO`; 14 için 10) ise eksik kadroyla, değilse çağrı iptal olur ve sohbete yazılır. Sayfa açılışında
tetiklenir (`settleExpiredPolls`, cron yok; çağrı sayfası açıkken 30 sn'de bir tazelenir). Kadro: yanıt sırasına göre ilk N kişi, fazlası yedek
(biri vazgeçerse sıradaki girer); takımlar `balanceTeams` ile dengeli bölünür (profilinde mevkisi kaleci olan kaleci). Dönüşüm atomik talep eder
(`status open → converted`), hata olursa maç silinir ve çağrı yeniden açılır. Çağrıyı açan veya yetkili `close_poll` ile iptal eder. Yetkililerin
çağrısı eskisi gibi elle onaylıdır (`approve_*` RPC'leri, "Maçı oluştur"); yetkili hem maç kurar hem çağrı açar.

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

**Maçtan çekilme (migration 0022, kullanıcı kararı: "her zaman onay")**: çağrı aşamasında "geliyorum"dan "gelemem"e geçmek serbest (eskisi gibi); **maç kurulup kadroya girdikten sonra** oyuncu maç ekranında
"Maçtan çekilmek istiyorum" der (isteğe bağlı sebep ≤200), `request_withdrawal` RPC'si `match_withdrawals` satırı açar (`pending`); kaptan/yetkili `decide_withdrawal` ile onaylar (oyuncu `match_players`'tan çıkar) veya reddeder
(oyuncu kadroda kalır, yeniden isteyebilir); oyuncu `cancel_withdrawal` ile geri çekebilir. **Onaylı çekilme `match_no_shows`'a yazılmaz** (güvenilirliği bozmaz); reddedilen yine gelmezse kaptan sonuç girerken "gelmedi" işaretler.
Maça 3 saatten az kala istek `late` ("Son dakika") olur. Kaptan/yetkili kendi adına **doğrudan çıkar** (kayıt `approved`). Sadece `planned` maçta ve maç saatinden önce; maç planlanmış olmaktan çıkarsa veya oyuncu başka yolla
kadrodan çıkarsa (kaptan çıkardı, "gelmedi", ayrıldı) bekleyen istek `closed` olur (tetikleyiciler). Bağlı maçta onayı oyuncunun kendi takımının kaptanı/yetkilisi verir. Bildirimler (tür `match`): istek → kaptan/yetkililer,
karar → oyuncu, yetkili çıkışı → diğer yetkililer. UI: `m/[matchId]/WithdrawalSection.tsx` ("Çekilme istekleri" yetkilide, "Maça katılımım" oyuncuda). RLS: istek sahibi ve yetkililer görür; yazma sadece RPC.
Yapılmadı: onaydan sonra çağrının yedek listesinden otomatik öneri (kaptan "Kadroya oyuncu ekle / çıkar" listesinden elle ekler). Test: `db-checks/withdrawals.mjs`, `e2e/withdrawal.mjs`.
