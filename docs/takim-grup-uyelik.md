# Grup/takım, roller, üyelik, davet, ilan/ödünç

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

**Grup (`groups.kind='community'`)**: topluluk. Sadece üyelere görünür. Bölge isteğe bağlı.
**Takım (`kind='team'`)**: rekabet. Herkese açık (ad, bölge, kadro, ratingler, maç sonuçları); il zorunlu.
İkisi aynı altyapıyı paylaşır (group_players, matches, oylama, rating, çağrı, sohbet) ama **iş kuralları ayrıdır (kullanıcı kararı)**:

| | Grup (topluluk) | Takım (rekabet) |
|---|---|---|
| Maç türü | sadece **kendi aramızda** (internal, dengeli A/B) | sadece **rakibe karşı** (external; teklifle ortak maç veya uygulamada olmayan rakip) |
| Zorunluluk | `enforce_match_kind` tetikleyicisi (0013, sadece yeni kayıtlar; eski maçlar kalır) + `createMatch` türü gruptan alır | aynı |
| Rating etkisi | yarım (`CONFIG.CASUAL_IMPORTANCE = 0.5`) | rakip maçı tam; iç/antrenman maçı (eski veri) yarım |
| Görünürlük | özel | herkese açık; teklif, istatistik, diziliş, çapraz oylama sadece takımda |

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
**Katılma (migration 0023, kullanıcı isteği)**: link (`/join/KOD`) yanında **elle yazılan kod**: yeni kodlar 10 karakter, karışan O/0/I/1/L yok (`new_invite_code()`, sütun varsayılanı), ekranda `XXXXX-XXXXX`;
eski 12 karakterli kodlar geçerli. `join_group` büyük/küçük harf, boşluk ve tireyi yok sayar (`norm_invite`). Grup/takım sayfasında kod büyük gösterilir + "Kopyala" + link "Paylaş" + yetkiliye "Yeni kod oluştur"
(`regenerate_invite`, eski kod/link ölür). **`/katil?tur=takim|grup`**: kod yazılır (tam link de olur) → `invite_preview` RPC'siyle önizleme (ad, tür, bölge, oyuncu sayısı, zaten üye mi) → "Takıma/Gruba katıl" (`joinGroup`).
Seçilen tür kodla uyuşmazsa doğru bölüme yönlendirilir. Giriş noktaları: ana sayfada Takımlarım/Gruplarım başlıklarında "Takıma/Gruba katıl", menüde ayrı Takımlarım ve Gruplarım bölümleri (her birinde katıl/kur), Keşfet.
Bilinen: kod tahmini için oran sınırı yok (31^10 ≈ 8e14 olasılık; oturum açmak gerekir).

**Gruptan/takımdan ayrılma (migration 0021)**: kayıt **silinmez**; `group_players.left_at` dolar (maç kadroları, oylar, sonuçlar ve kişinin genel rating'i `group_players`'a bağlı, silmek geçmişi götürürdü).
`my_player_id`/`is_group_member`/`is_group_admin`/`is_group_captain`/`unread_counts` `left_at is null` ister; TS tarafında `getGroupPlayers` (varsayılan) ve `getMemberships`, `recipients`, `teams-data`, `profile-data`
ayrılmışları saymaz; **geçmiş gösteren** yerler (maç ekranı, oyuncu sayfası) `getGroupSummaries(..., { includeLeft: true })` kullanır, `isSquadMember` `left_at`'i dışlar. `leave_group` RPC (kullanıcı kararları):
**kaptan/kurucu önce devreder** (yoksa hata), **oylaması süren (`voting`/`played`) maçı olan oylama bitince ayrılır**; ayrılırken `deactivate_member` gelecekteki planlanmış maç kadrolarından ve açık çağrı yanıtlarından çıkarır,
kaptan/yetkililere "üye ayrıldı" bildirimi gider (`text.memberLeft`, tür `match`). Aynı davet koduyla `join_group` satırı yeniden açar (rol `member`). **Yetkili çıkarma** artık `remove_member` RPC'si: hesaplı üye aynı şekilde
ayrılmış sayılır, misafir silinir; `group_players` DELETE politikası sadece misafir kayıtları içindir. Tek başına kalan kaptan `delete_group` ile grubu/takımı siler (adını yazarak onaylar; maçlar da gider, kişinin
rating'i `recomputePlayers` ile yeniden hesaplanır); doğrudan `groups` silme politikası kaldırıldı. UI: `/g/[id]/players` sayfasının altında "Gruptan/Takımdan ayrıl". Bilinen küçük boşluk: ayrılan takım üyesi aynı takımın ilanına
`apply_listing` ile ödünç başvuramaz ("bu takımın oyuncususun" kontrolü `left_at`'i saymıyor). Test: `db-checks/leave-group.mjs`, `e2e/leave.mjs`.
