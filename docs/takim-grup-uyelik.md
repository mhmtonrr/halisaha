# Grup/takım, roller, üyelik, davet, adam ara/ödünç

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

**Ödünç oyuncu (0015; 0035'ten beri ilan yerine çağrı)**: takım maçına topluluktan veya dışarıdan gelen oyuncu takıma `group_players.is_loan = true` olarak yazılır
(`ensure_match_player`: kesinleştirmede "rakibe karşı" seçilince veya "adam ara" başvurusu kabul edilince; ayrılmış eski üye de ödünç olarak yeniden açılır) ve o maçın
kadrosuna girer; takımın asıl kadrosunda değildir: `is_group_member` onu **saymaz** (takım sohbeti, teklifler, çağrılar, yetkiler kapalı), `getMemberships`/Takımlarım/
profil kartlarında yoktur, takım sayfasında "Misafirler" sekmesinde "ödünç" etiketiyle görünür (`isSquadMember`/`isGuestLike`). Oy verir/oylanır, genel ratingi geçerlidir.
**Özel grupta ödünç (0041, kullanıcı kararı)**: grup maçına dışarıdan gelen ödünç oyuncu sadece oynadığı maçı görür (maç, kadro, sonuç, o maçtaki oyuncuların kartları; `is_match_participant`, `is_co_player`) + grubun adı (`has_group_row`); grubun diğer maçları, oyuncu listesi, sohbeti kapalı.
Davet koduyla katılırsa kalıcı üye olur (`join_group` upsert). Eski herkese açık ilan (`player_listings`, `/ilan`, Keşfet "Oyuncu arayan takımlar") kalktı; yerine
adam arama "Herkese açık" seçilebilir (0041; Keşfet "Adam arayan" sekmesi). Kurallar: `docs/mac-puanlama.md` "Birleşik çağrı".
**Geçici (hızlı) takım ve dağıtma (0037, kullanıcı kararları)**: **Arayüzde artık kurulmuyor** (kullanıcı kararı 2026-11-23: grupta sadece kendi aramızda maç; mevcut geçici takımlar ve RPC duruyor, e2e RPC ile kurar). Eskiden kesinleştirmede "Rakibe karşı" + "+ Hızlı takım kur" (`finalize_poll` `p_new_team`) geçici takım
kurar (`groups.is_temporary`; il/ilçe çağrının topluluğundan, yoksa profilden; kişi başı en fazla 5 açık geçici). Geçici takım Keşfet'te, öne çıkanlarda, menüde ve
ana sayfadaki Takımlar sekmesinin listesinde görünmez; aynı sekmede kapalı "Geçici ve dağıtılmış takımlarım" bölümünde durur. **Son maçı kapanınca** ve planlı/oylamada maçı
kalmayınca kendiliğinden arşivlenir (`groups.archived_at`, tetikleyici); maçı iptal olup hiç maçı kalmayan geçici takım silinir (`deleteMatch` sonrası
`cleanup_temp_team`; tetikleyici değil, grup silinirken basamaklı silmeyle çakışmasın diye). Kesinleştirmede arşivdeki geçici takımı (kaptanıysan) seçmek onu
yeniden açar; listede geçiciler önce. Kaptan "Kalıcı yap" (`make_team_permanent`) ile normal takıma çevirir. **Takımı dağıt** (`disband_team`, kaptan, oyuncular
sayfası): planlı/oylamada maç varsa önce o bitmeli; oynanmış maç varsa arşiv (geçmiş ve puanlar kalır; açık çağrılar, bekleyen teklif ve davetler kapanır), yoksa
silme. **Arşivli takım** yeni maç, çağrı, teklif, davet ve katılım almaz (`guard_archived_group` tetikleyicileri; `can_create_match` da false); sayfasında
"Bu takım dağıtıldı" şeridi, kaptan "Yeniden aç" (`reopen_team`). `groups` sütun yetkisine `is_temporary`, `archived_at` eklendi.
**Takıma davet**: mevcut `invite_to_group` (kaptan/yetkili); takımın oyuncular sayfasında ödünç oyuncunun yanında "Takıma davet et" (kabul edince asıl kadroya geçer).
**Üye maç önerisi (0037)**: üye grup/takım sayfasında "💡 Maç öner" (`propose_match`: gün, isteğe bağlı saat/saha/not; grupta kişi başı 1 bekleyen; maç açabilen
öneremez, doğrudan çağrı açar). Öneriyi sadece öneren ve maç açabilenler görür (RLS), topluluğa/sohbete düşmez; maç açabilenlere bildirim. `decide_proposal`:
onayda öneren adına toplama çağrısı açılır (`match_polls.proposal_id`) ve öneren **rolü olmasa da** o çağrıyı yönetir (`can_manage_poll`), kurduğu maçı da
(`created_by`); gruba normal çağrı duyurusu gider. Öneren `cancel_proposal` ile geri çeker. UI: öneri formu `g/[groupId]/GroupExtras.tsx` (`Proposals`, `#oneriler`), karar `/g/[id]/istekler?sekme=oneri` (`ProposalDecisions`).
**Sessize alma (0037)**: üye grubu kendi için sessize alır (`group_players.muted`, `set_group_muted`; grup sayfasında "🔔 Sessize al"). Toplu duyurular
(`groupMemberIds(..., { broadcast: true })`: yeni çağrı, adam arama, sohbet, öneriden açılan çağrı) gitmez; kişiye özel olanlar (kadrodasın, yedek, oylama,
çekilme, öneri kararı) gider. Test: `db-checks/proposals-temp-teams.mjs`, `e2e/proposals-teams.mjs`.
**Güvenilirlik**: maç sonucu girerken kaptan "gelmedi" işaretler (`mark_no_shows`: kadrodan çıkarır, hesabı olanı `match_no_shows`'a yazar; sadece planlanmış maçta,
yani skor düzeltmesinde "gelmedi" kutusu görünmez). `poll_responders` organizatöre oynadığı (oylama/kapanışa ulaşmış) maç ve gelmediği maç sayısını verir (kimlik
doğrulamasız genel bir güvenilirlik sorgusu bilerek yok), `reliability()` yüzdeyi ve etiketi üretir (3 kayıttan azında "Yeni"). `submitResult` sırası: önce her şeyi
doğrula (yetki, skor, "gelmedi" çıkınca kalan ≥2, durum), sonra istatistikleri yaz, "gelmedi"yi en son işaretle; geri alınamayan işlem doğrulanabilir bir hatadan önce yapılmaz.
Ödünç oyuncu `getMemberships`'te yok ama oynadığı maç oylamaya geçince ana sayfada "Oyunu bekliyorlar (ödünç)" kartı görür. Tuzak: `returns table` içinde `position` sütun adı olamaz (`chosen_position`, `poll_responders`).
Tuzak: canlı yenilenen sunucu bileşeninde `<details open={koşul}>` her yenilemede kullanıcının açtığını kapatır → `AutoOpenDetails`
(sadece ilk yüklemede açar).

**Roller (`group_players.role`)**: `captain` (takımda "Kaptan", grupta "Kurucu"), `admin` ("Yetkili"), `organizer` ("Organizatör", 0034), `member`.
- Maç ve maç çağrısını sadece captain/admin/organizer açar (`can_create_match`, RLS; üye açamaz — spam önlemi, kullanıcı kararı).
- Herkes **kendi kurduğu maçı** yönetir (`can_manage_match`: kadro, misafir `add_match_guest`, sonuç, "gelmedi", çekilme kararı, kart paylaşımı);
  kendi çağrısını `can_manage_poll` ile (rolü alınınca çağrı yönetimi düşer, maç sahipliği kalır). Başkasının maçını sadece captain/admin yönetir.
- Organizatör üye yönetemez (çıkarma, mevki, rol, davet kodu yenileme, sohbet moderasyonu `is_group_admin`'de kalır); TS'de `canCreateMatch(role)`. Rolleri sadece captain değiştirir (`set_member_role` RPC;
  doğrudan UPDATE politikası bilerek yok). Kaptanlık devrinde eski kaptan admin olur.
- Oyuncu çıkarma: captain çıkarılamaz; admin'leri sadece captain çıkarır.
- `is_group_admin()` captain'ı da kapsar.

**Misafir**: `group_players.user_id IS NULL`. Oylanır, oy veremez, sohbete yazamaz. `claim_guest` ile hesaba aktarılır.
**İki yerden eklenir**: maç ekranından (`addGuestToMatch`: misafiri gruba + o maçın kadrosuna yazar; planlanmış maçta, kaptan/yetkili)
ve açık toplama çağrısından (0038, `add_poll_guest`: organizatör; kesinleştirmede kadroya girer, ayrıntı `mac-puanlama.md`).
"Oyuncular" sayfasında ekleme formu yoktur; orada misafirin mevkisi ve geçmiş aktarımı kalır. Sonraki maçlarda
misafir kadro listesinde (yedek seçiminde) tekrar seçilebilir.
**Asıl kadro = hesabı olan üyeler** (davet linki/kodla katılanlar). Misafirler takım/grup sayfasında, kadro sayfasında ve Oyuncular
sayfasında ayrı bölümde/sekmede durur (`RosterTabs`, `?sekme=misafir`; istatistikleri orada görünür); oyuncu sayısına, takım
puanına (`teamRating`), Keşfet sıralamasına, puan tablosuna ve istatistik sayfasına girmez. Maç kadrosunda ve oylamada normal oyuncudur.

**Davet kodu gizli**: `groups.invite_code` sütununa SELECT yetkisi yok (takımlar herkese açık olduğu için).
Kod `group_invite_code()` RPC ile alınır (takımda captain/admin, grupta her üye). **`groups`'tan seçerken
sütunları açıkça yaz, `select *` ve `invite_code` kullanma** — yetki hatası verir.
**Katılma (migration 0023, kullanıcı isteği)**: link (`/join/KOD`) yanında **elle yazılan kod**: yeni kodlar 10 karakter, karışan O/0/I/1/L yok (`new_invite_code()`, sütun varsayılanı), ekranda `XXXXX-XXXXX`;
eski 12 karakterli kodlar geçerli. `join_group` büyük/küçük harf, boşluk ve tireyi yok sayar (`norm_invite`). Grup/takım sayfasında kod büyük gösterilir + "Kopyala" + link "Paylaş" + yetkiliye "Yeni kod oluştur"
(`regenerate_invite`, eski kod/link ölür). **`/katil?tur=takim|grup`**: kod yazılır (tam link de olur) → `invite_preview` RPC'siyle önizleme (ad, tür, bölge, oyuncu sayısı, zaten üye mi) → "Takıma/Gruba katıl" (`joinGroup`).
Seçilen tür kodla uyuşmazsa doğru bölüme yönlendirilir. Giriş noktaları: ana sayfada "Takımlarım ve gruplarım" bölümünün Takımlar/Gruplar sekmelerinde "Takıma/Gruba katıl", menüde ayrı Takımlarım ve Gruplarım bölümleri (her birinde katıl/kur), Keşfet.
Bilinen: kod tahmini için oran sınırı yok (31^10 ≈ 8e14 olasılık; oturum açmak gerekir).

**Gruptan/takımdan ayrılma (migration 0021)**: kayıt **silinmez**; `group_players.left_at` dolar (maç kadroları, oylar, sonuçlar ve kişinin genel rating'i `group_players`'a bağlı, silmek geçmişi götürürdü).
`my_player_id`/`is_group_member`/`is_group_admin`/`is_group_captain`/`unread_counts` `left_at is null` ister; TS tarafında `getGroupPlayers` (varsayılan) ve `getMemberships`, `recipients`, `teams-data`, `profile-data`
ayrılmışları saymaz; **geçmiş gösteren** yerler (maç ekranı, oyuncu sayfası) `getGroupSummaries(..., { includeLeft: true })` kullanır, `isSquadMember` `left_at`'i dışlar. `leave_group` RPC (kullanıcı kararları):
**kaptan/kurucu önce devreder** (yoksa hata), **oylaması süren (`voting`/`played`) maçı olan oylama bitince ayrılır**; ayrılırken `deactivate_member` gelecekteki planlanmış maç kadrolarından ve açık çağrı yanıtlarından çıkarır,
kaptan/yetkililere "üye ayrıldı" bildirimi gider (`text.memberLeft`, tür `match`). Aynı davet koduyla `join_group` satırı yeniden açar (rol `member`). **Yetkili çıkarma** artık `remove_member` RPC'si: hesaplı üye aynı şekilde
ayrılmış sayılır, misafir silinir; `group_players` DELETE politikası sadece misafir kayıtları içindir. Tek başına kalan kaptan `delete_group` ile grubu/takımı siler (adını yazarak onaylar; maçlar da gider, kişinin
rating'i `recomputePlayers` ile yeniden hesaplanır); doğrudan `groups` silme politikası kaldırıldı. UI: `/g/[id]/players` sayfasının altında "Gruptan/Takımdan ayrıl". Test: `db-checks/leave-group.mjs`, `e2e/leave.mjs`.

**Katılma isteği ve Keşfet'te grup (0044, kullanıcı kararları 2026-11-25)**: `groups.discoverable` (topluluk Keşfet'te listelenir, varsayılan kapalı; takımlar zaten herkese açık), `groups.join_requests_open` (boş = varsayılan: toplulukta açık, takımda kapalı; toplulukta ayrıca discoverable gerekir; ayar `set_group_discovery`, kaptan/yetkili). `request_join` (tek bekleyen, red sonrası 7 gün, günde 10), `cancel_join_request`, `decide_join_request` (kaptan/yetkili; kabul `join_group` ile aynı satır). Kodla/bağlantıyla doğrudan giriş aynen. Liste `discover_groups(il, ilçe, tür)` (güvenli alanlar, üye sayısı, isteğimin durumu). Yetkililer için `pending_requests(grup)` (katılma, bu gruba gelen ilan onayları, maç önerileri, grubun maçlarına başvurular; her bölüm karar verebilene) ve ana sayfa için `my_pending_counts()`. Test: `db-checks/join-requests.mjs`.
**Arayüz (6a)**: `/g/[id]/istekler` sekmeli sayfa (Katılma · İlan onayı · Öneri · Başvuru; boş sekme gizli, başvurular maç ekranına gider), grup sayfasında yetkiliye "Bekleyen istekler · N", ana sayfa yapılacaklarda grup başına tek satır. Karar `join-actions.ts` (`decideJoinRequest`; isteyene `invite` türü bildirim, diğer yetkililere "yeni üye"). Ayar: Grubu yönet → Grup bilgileri formunda "Keşfet'te görünsün" (sadece topluluk) ve "Katılma isteği alınsın" (`updateTeam` içinde `set_group_discovery`). Gönderme (6b): Keşfet "Gruplar" sekmesi ve üye olmayanın takım sayfası (istek açıksa; kapalıysa "davet linki iste" yazısı), `JoinRequest` bileşeni (isteğe bağlı not, bekliyorsa "Geri al"); istek → kaptan/yetkililere `invite` bildirimi (`/istekler?sekme=katilma`). Topluluk sayfası üye olmayana kapalı, o yüzden Keşfet kartı bağlantısız. Test: `e2e/join-requests.mjs`.

## Takım/grup logosu (0054; kullanıcı kararları 2026-11-26)

- Takım ve grup için tek alan `groups.logo`: boş → otomatik arma (grup kimliğinden sabit; ortada baş harfler, ana renk takım rengi) · `crest:<şekil>.<sembol>.<desen>.<hex>` · `preset:<id>` (`public/logos/<id>.webp`, liste `PRESET_LOGOS`; görseller gelene kadar boş ve sekme gizli) · `logos` deposundaki yüklenen görsel (`<grup_id>/logo`, 512 KB, webp/png). Değer kuralı veritabanında `logo_ok`; yazma yetkisi kaptan/yetkili (`is_group_admin`).
- Gösterim hep `TeamBadge` (`id`, `name`, `color`, `logo`); grup seçen sorgular `logo` sütununu da ister; `invite_preview`, `discover_groups` (`logo`), `match_overview`, `match_by_code` (`group_logo`) döndürür. Maç sahasındaki takım renkleri değişmedi.
- Parçalar: 1) temel (yapıldı) · 2) seçim ekranı (yapıldı: `LogoPicker`, `TeamFields` içinde → takım kur + takım/grup bilgileri; Otomatik / Arma yap / Hazır logolar sekmeleri, canlı önizleme, form alanı `logo` → `logoFromForm`; grup kurma formu da `TeamFields` kullanır) · 3) yükleme (yapıldı: `LogoUploader`, sadece kurulmuş takım/grupta; tarayıcıda kare kırpma (görselin tamamı sığacak kadar uzaklaştırılabilir), 512×512 WebP/PNG, şeffaflık korunur, `logos/<grup_id>/logo` + `saveLogo`/`deleteLogo` hemen kaydeder; arma/otomatik kaydedilince dosya silinir; grup silinince dosya depoda kalır; arka plan kaldırma yok).
