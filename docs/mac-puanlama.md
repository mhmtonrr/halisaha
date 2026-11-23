# Maç, puanlama, çağrı, teklif

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

**Birleşik çağrı (0035, kullanıcı kararları)**: eski üye çağrısı (otomatik maç, %70), yetkili elle onayı ve oyuncu ilanı tek yapıda: `match_polls`.
Açma/kesinleştirme sadece `can_create_match` (kurucu/yetkili/organizatör; arşivli takımda false); yönetim `can_manage_poll` (açan veya kurucu/yetkili; üye önerisinden açılan çağrıda öneren, 0037). Hızlı (geçici) takım arayüzden kaldırıldı: `docs/takim-grup-uyelik.md`. Kurucu/yetkili dışındakiler
aynı grupta en fazla 3 açık çağrı. Tabloya doğrudan yazma yok, hepsi RPC. `group_id` = çağrının yayınlandığı yer (kim görür/yanıtlar); maçın sahibi `matches.group_id`.
- **Toplama** (`purpose='gather'`, `create_gather_poll`): zorunlu tek şey gün (`play_on`, bugün..+30); saat (`starts_at`, o günde), saha, kişi sayısı
  (`team_size` → kontenjan: grupta ×2, takımda ×1; uygulama `p_capacity` gönderir), karar zamanı (`decide_by`, sadece hatırlatma), not isteğe bağlı; `update_gather_poll` ile netleşir (yanıt verenlere bildirim).
  Yanıt `respond_poll(poll, yes|maybe|no, mevki, not)`, hesaba bağlı (`poll_responses.user_id`). Organizatör `finalize_poll` ile **toplu kesinleştirir**:
  saat zorunlu, seçilenler "geliyorum"/"belki" demiş olmalı. **Kullanıcı kararı (2026-11-23): grup çağrısı sadece kendi aramızda, takım çağrısı sadece rakibe karşı**
  (RPC toplulukta başka takımla rakibe karşıyı hâlâ kabul eder, arayüz sunmaz; grupta "Takım kur" yönlendirmesi; arayüz adı "Maç ayarla" / "Maç çağrısı"). **Kendi aramızda** (≥4, taraflar `balanceTeams` ile uygulamada) veya
  **rakibe karşı** (takımın kendi çağrısında, rakip adıyla, ≥2; takım üyesi olmayan `ensure_match_player` ile ödünç). Seçilen `selected`, seçilmeyen
  "geliyorum" `reserve`; kesinleşmiş çağrıya geç gelen "geliyorum" da yedek. Uygulamadaki takımla ortak maç (çapraz oylama) yine teklifle.
- **Adam ara** (`purpose='fill'`, `create_fill_poll`): planlı maçın eksiği (1-10, mevkiler, not); maçın kendi grubunda veya organizatörün maç açabildiği
  bir toplulukta; maç başına yer başına 1 açık. Başvuranı organizatör **tek tek** `accept_responder`/`reject_responder` ile alır; sayı dolunca `filled`.
- **Yedek ve yer açılması (kullanıcı kararı: organizatör kontrolünde)**: kadrodan çıkan seçilmişin yanıtı `withdrawn` olur, dolu adam arama yeniden açılır
  (tetikleyici); çekilme onaylanınca yedek varsa organizatöre "yer açıldı" bildirimi (`notifySpotOpened`); yedeği `accept_responder` ile organizatör alır.
- Maç planlıdan çıkınca açık adam arama kapanır; günü geçen açık çağrılar sayfa açılışında `close_stale_polls` ile kapanır (cron yok). Karar zamanı geçen
  toplama çağrısı organizatöre ana sayfada ve çağrı sayfasında "Kadroyu kesinleştir" uyarısı olarak görünür (push yok). Organizatör yanıtlayanları
  `poll_responders` ile rating ve güvenilirlikle görür (diğer üyeler güvenilirlik görmez).
- Kod: `call-actions.ts` (eylemler + bildirimler), `calls-data.ts`, `call-rules.ts` (saf, testli), sayfa `/g/[id]/cagri/{yeni,[pollId]}` (`?kesinlestir=1`, `?duzenle=1`),
  maç ekranında `FillSection`. Test: `db-checks/calls.mjs`, `call-rules.test.ts`.

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

**Maçtan çekilme (migration 0022, kullanıcı kararı: "her zaman onay")**: çağrı aşamasında "geliyorum"dan "gelemem"e geçmek serbest (eskisi gibi); **maç kurulup kadroya girdikten sonra** oyuncu maç ekranında
"Maçtan çekilmek istiyorum" der (isteğe bağlı sebep ≤200), `request_withdrawal` RPC'si `match_withdrawals` satırı açar (`pending`); kaptan/yetkili `decide_withdrawal` ile onaylar (oyuncu `match_players`'tan çıkar) veya reddeder
(oyuncu kadroda kalır, yeniden isteyebilir); oyuncu `cancel_withdrawal` ile geri çekebilir. **Onaylı çekilme `match_no_shows`'a yazılmaz** (güvenilirliği bozmaz); reddedilen yine gelmezse kaptan sonuç girerken "gelmedi" işaretler.
Maça 3 saatten az kala istek `late` ("Son dakika") olur. Kaptan/yetkili kendi adına **doğrudan çıkar** (kayıt `approved`). Sadece `planned` maçta ve maç saatinden önce; maç planlanmış olmaktan çıkarsa veya oyuncu başka yolla
kadrodan çıkarsa (kaptan çıkardı, "gelmedi", ayrıldı) bekleyen istek `closed` olur (tetikleyiciler). Bağlı maçta onayı oyuncunun kendi takımının kaptanı/yetkilisi verir. Bildirimler (tür `match`): istek → kaptan/yetkililer ve maçı kuran,
karar → oyuncu, yetkili çıkışı → diğer yetkililer. UI: `m/[matchId]/WithdrawalSection.tsx` ("Çekilme istekleri" yetkilide, "Maça katılımım" oyuncuda). RLS: istek sahibi ve yetkililer görür; yazma sadece RPC.
Onaydan sonra çağrının yedeği organizatöre bildirilir, organizatör çağrı sayfasından "Kadroya al" der (otomatik girmez). Test: `db-checks/withdrawals.mjs`, `e2e/withdrawal.mjs`.
