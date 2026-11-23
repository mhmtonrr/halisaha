# Bildirim, canlı güncelleme, sohbet

(CLAUDE.md'den taşındı; ilgili konuda çalışırken oku. Konu değişirse sadece bu dosyayı güncelle.)

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
Olaylar: oylama açıldı (`submitResult`/`settle_linked_match` sonrası, iki takım), oylama hatırlatması (günlük cron), çağrı/adam arama açıldı, çağrı güncellendi,
kadrodasın/yedektesin/alınmadın, adam aramaya başvuru ve yer açıldı (organizatöre), maç kuruldu, teklif geldi/yanıtlandı, sohbet mesajı. Olayı yapan kendi işlemi için bildirim almaz. Kategori tercihi
(`notification_prefs`: votes, matches, offers, chat; satır yoksa hepsi açık) kapalıysa ne kutuya ne push'a yazılır. **Sohbet**: bir kullanıcıya aynı
gruptan 10 dakikada en fazla 1 bildirim (etiket `chat:<grup>`; mesaj doğrudan DB'ye yazıldığından gönderenin tarayıcısı `notifyChatMessage` ile bildirir,
sunucu mesajın çağıranın ve <60 sn olduğunu doğrular). Gönderim yanıttan sonra (`later` = `after`) yapılır; hata asıl işlemi bozmaz. Ölü abonelik (404/410)
silinir. İzin kartı (`PushPrompt`) anlamlı anda çıkar: oy verince, çağrıya yanıt verince; 14 gün "şimdi değil"; iPhone'da önce ana ekrana ekleme anlatılır.
**Ortam değişkenleri (Vercel; yoksa sadece uygulama içi kutu çalışır)**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (üretmek için
`npx web-push generate-vapid-keys`; özel anahtarı asla commit etme/yazdırma), isteğe bağlı `VAPID_SUBJECT` (varsayılan site adresi; kişisel e-posta koyma),
`CRON_SECRET` (hatırlatma cron'u için; yoksa `/api/cron/vote-reminders` kapalıdır, Vercel Cron `vercel.json` ile günde 1 kez 18:00 TR çağırır).
Test: `scripts/e2e/notifications.mjs` (sunucu `CRON_SECRET=e2e-secret` ile başlatılmalı) ve gerçek kütüphane/VAPID imzalı
`NODE_USE_ENV_PROXY=1 npx vite-node --config scripts/recompute.vite.config.mjs scripts/e2e/push-delivery.ts`. Gerçek cihaza teslim sadece elle denenebilir. **Tanılama**: profil → Ayarlar → Bildirimler'de cihaz "açık ✓" ise **"Test bildirimi gönder"** (`sendTestNotification` → `sendTestPush`) abonelik/VAPID/push servisini uçtan uca dener ve nedeni açıklar
(`explainPushFailure`: 401/403 = VAPID çifti uyuşmuyor, 404/410 = geçersiz abonelik…); abonelik başarısızsa gerçek tarayıcı hatası gösterilir (`explainSubscribeError`: AbortError = push servisine ulaşılamadı, Brave ayarı…).
Gönderim hataları artık Vercel kayıtlarına `[push] <kod> <mesaj>` olarak düşer. Hatırlatma: **kişi kendi işleminden bildirim almaz** (kendi sohbet mesajı sana push göndermez); test için ikinci hesap veya test düğmesi gerekir.
Aboneliğin sunucuya kaydı `push_subscriptions` tablosundan kontrol edilir (0 satır = cihaz hiç abone olmamış).
**Android ekran kapalıyken gelmeme (kullanıcı raporu)**: push `urgency: "high"` ile gönderilir (normal öncelik Doze'da bekletilir); `sw.js` `renotify`+`vibrate` kullanır. Hâlâ gelmezse cihaz tarafı: Chrome için pil
kısıtlaması kapalı ("Sınırsız"), site bildirim kanalı önemi "Yüksek", veri tasarrufu/Rahatsız etme kapalı.
Tuzak: `web-push` adlandırılmış içe aktarımla kullanılır (varsayılan dışa aktarımı yok; derleme uyarısı verir ve üretimde çöker).

**Sohbet** (group_messages/chat_reads): Realtime postgres_changes, RLS'e uyar (sadece üyeler; takım sohbeti de
sadece oyunculara). İstemci abone olmadan önce `realtime.setAuth(token)` çağırır ve (yeniden) bağlanınca
kaçırılanları çeker — bunu kaldırma, yoksa mesajlar ara sıra düşmüyor. Etkinlik kartları DB tetikleyicileriyle
(çağrı açıldı, maç kuruldu, oylama açıldı); "sonuçlar açıklandı" kartı finalize başarılı olunca koddan yazılır.
Spam: dakikada 20 mesaj, 1000 karakter. Silme `delete_message` RPC (yazar veya yetkili; içerik silinir).

**Birebir sohbet + davet (migration 0029; DB + `/sohbet` gelen kutusu + birebir sohbet + davet arayüzü yapıldı)**: `dm_threads` (user_a<user_b, tek konuşma),
`dm_messages` (text|invite), `dm_reads`, `group_invites`. Yazma sadece RPC: `start_dm` (herkes herkese; engel iki yönde keser), `send_dm`,
`respond_dm_request`, `delete_dm_message`, `mark_dm_read`, `dm_unread_counts`, `invite_to_group` (sadece kaptan/yetkili; davet kartı konuşmaya düşer,
konuşma yoksa istek açılır), `respond_group_invite` (kabul = `join_group` ile aynı katılma), `cancel_group_invite`.
**İstek kuralı**: tanımadığına ilk mesaj `pending`; gönderen kabul edilene kadar en fazla 1 metin atar (davet kartı sayılmaz); alıcı yazarsa kabul sayılır,
reddedilen konuşmada gönderen yazamaz. Davet 20/gün, aynı kişiye aynı gruptan tek bekleyen davet. `group_invites` grup adı/türünü saklar
(özel grubu davetli göremez). Bildirim türleri `dm`, `invite` eklendi (kod henüz bildirim göndermiyor). Kontrol: `scripts/db-checks/direct-chat.mjs`.

**Genel sohbet ekranı (WhatsApp mantığı, tam ekran; popup yok — telefonda baloncuk klavye/geri tuşuyla çakışır)**: `/sohbet` takım+grup+kişi sohbetlerini tek listede
son mesaja göre sıralar (okunmamış rozeti, "Mesaj istekleri" bölümü üstte); `/sohbet/[threadId]` birebir konuşma (`DmRoom.tsx`, kendi Realtime aboneliği, `ChatRoom`
ile aynı yakalama/okundu mantığı). Giriş noktaları: başlıkta 💬 düğmesi (`MenuControls`, rozet `useChatUnread` = grup + birebir okunmamış), ☰ menüde "Sohbetler",
`/oyuncu/[id]` sayfasında "Mesaj gönder" (`openDm` form eylemi: `start_dm` + yönlendirme; GET ile konuşma açılmaz, Link ön yüklemesi yan etki yaratmasın).
Birebir bildirim: `notifyDm` (tür `dm`, tercih "chat", etiket `dm:<konuşma>`, 10 dk birleştirme); istekse başlık "… sana mesaj isteği gönderdi". `BottomNav` konuşma ekranlarında gizlenir (gelen kutusunda görünür).
Test: `scripts/e2e/dm.mjs` (istek → kabul → canlı yazışma, bildirim, ekran görüntüleri).
**Davet arayüzü**: `/oyuncu/[id]` sayfasında, görüntüleyen kaptan/yetkili olduğu takım/gruplar için "Takıma / gruba davet et" kutusu çıkar (kişi zaten üyeyse veya bekleyen davet varsa o grup listelenmez; `inviteToGroup` eylemi RPC'yi çağırır, yetkiyi RPC denetler).
Davet kartı davet edilenin konuşmasında "Katıl / Reddet" düğmeli görünür (`respondGroupInvite`; kabul = üyelik + gruba yönlendirme), gönderende "Daveti geri çek". Davet edilene `invite` bildirimi gider (kart ve bildirim `/sohbet/<konuşma>` açar).
Davet kabul/red edilince daveti gönderene `invite` bildirimi gider (`text.inviteReply`). Üye olmayan biri takım sayfasından "Kaptana mesaj yaz" ile kaptana birebir yazabilir (özel gruplarda yok; gruplar zaten kapalı). Test: `scripts/e2e/dm-invite.mjs`.

**Arkadaşlık (migration 0030 + arayüz yapıldı)**: `friendships` (user_a<user_b, `pending|accepted`, karşılıklı onaylı). Yazma sadece RPC:
`send_friend_request` (karşı taraf zaten istek atmışsa kendiliğinden kabul; engelliye atılamaz; 30/gün), `respond_friend_request` (reddedilen istek silinir),
`remove_friendship` (arkadaşlıktan çık / kendi bekleyen isteğini geri çek), `are_friends`. **Arkadaşlar arasında mesaj isteği yok**: `start_dm` arkadaşa
doğrudan `accepted` konuşma açar; bekleyen konuşma varsa arkadaşlık kabulü onu açar. Engel arkadaşlığı siler (tetikleyici). Bildirim türü `friend` (tercih "chat").
Tuzak: PL/pgSQL'de satır değişkeni için `if v_f is not null` tüm alanlar doluysa doğrudur (boş sütunlu satırı "yok" sayar) → `select … into` sonrası `found` kullan. Kontrol: `scripts/db-checks/friendships.mjs`.
**Sosyal sayfası (`/sosyal`, ☰ menüde "Sosyal", bekleyen istek sayısı rozetli)**: sekmeler Arkadaşlar (gelen istekler, arkadaşlarım + "Mesaj", gönderilenler) / Takımlar / Gruplar (üyeliklerim, sohbet kısayolu).
Arkadaşlık işlemleri tek form eylemi `friendAction` (op = add|accept|decline|remove, `back` ile aynı sayfaya döner); `/oyuncu/[id]` sayfasında duruma göre Arkadaş ekle / İstek gönderildi (geri çek) / Kabul-Reddet / Arkadaşsınız (çıkar).
Bildirimler: istek gitti → karşı tarafa; kabul (veya karşılıklı istek) → isteği atana. Test: `scripts/e2e/friends.mjs`.

**Geri gezinti (`NavHistory.tsx`)**: geri ok (`BackLink`; `Header` ve sohbet ekranları kullanır) **tarayıcının gerçek geçmişiyle** `history.go(-n)` yapar, asla `router.push` ile ileriye kayıt eklemez (eskiden ekliyordu; telefonun geri hareketiyle ok uyuşmuyor, döngü oluşuyordu). sessionStorage'daki yığın (`hs-nav2`) geçmişin aynasıdır; her girdinin sırası `history.state.__hsIdx`'e damgalanır (geri/ileri/yenileme/bfcache'te sıra girdiden okunur). Next yenileme/server action'da state'i baştan yazdığı için `replaceState` sarmalanır ve damga korunur (router.replace da böylece doğru çalışır). Ok, aynı yoldaki kayıtları (`?sekme=` değişimleri) ve **form/oluşturma sayfalarını (grup-kur, takim-kur, katil, join, matches/new, cagri/yeni, teklif…)** atlayıp kaç adım gideceğini hesaplar; uygulama içi geçmiş yoksa `fallback`'e gider. Yeni oluşturma sayfası eklersen `TRANSIENT_PATHS`'e ekle; `NavTracker` `useSearchParams` kullandığı için layout'ta `Suspense` içinde. Test: `src/components/NavHistory.test.ts`, `scripts/e2e/nav.mjs`.
Geçiş efekti: `app/template.tsx` (160 ms solma, **transform yok** — sabit konumlu yazma kutusu bozulmasın), konuşma ekranı için `sohbet/[threadId]/loading.tsx` iskeleti.

**Sohbet listesi ve kısayollar**: `/sohbet` listesi istemci bileşeni `InboxList` (anında arama — Türkçe harf/aksan farkı yok — ve süzgeçler Tümü/Okunmamış/Kişiler/Gruplar; sunucu satırları düz veri olarak verir).
"Mesaj" kısayolu (`openDm` formu) var: grup/takım üye listesi (`/g/[id]/players`, hesabı olan üyelerde 💬), Keşfet oyuncu sonuçları (satır artık Link + yanında form; iç içe etkileşimli öğe yok), Sosyal arkadaş satırı.
Sosyal arkadaş satırında kaptan/yetkili isen 🛡️ kısayolu `/oyuncu/[id]#davet` (davet kutusuna) götürür. Test: `scripts/e2e/inbox.mjs`.

**Maça davet kartı (migration 0031 + arayüz yapıldı)**: `dm_messages.kind='match'`, `card` (paylaşım anındaki özet: tür, grup adı/türü, tarih, saha, ihtiyaç/kapasite — özel grubun içi alıcıya açılmasın diye)
+ `poll_id | match_id` (0035'te `listing_id` kalktı). Tek RPC `share_match_card(p_user_id, p_type: poll|match, p_ref)`: kaptan/yetkili veya çağrıyı/maçı açan (0034), açık/kesinleşmiş çağrı (kartta `purpose`, `time_tbd`) / planlı maç; günde 20 kart, aynı kart aynı kişiye günde 1;
engel iki yönde keser; konuşma `start_dm` ile (arkadaşa açık, tanımayana istek). Çağrı/maç kartında üyeyse yanıt verir, değilse sadece özet. Kontrol: `scripts/db-checks/match-cards.mjs`.
**Davet kartı arayüzü**: çağrı ve planlı maç sayfasında "💬 Sohbetten davet et" (`SendInviteLink`) → `/davet/gonder?tur=poll|match&ref=<id>` seçici (arkadaşlar + ad araması; `shareMatchCard` eylemi sayfada kalır, `?ok=<kişi>` ile "✓ Gönderildi").
Alıcı `DmRoom`'da `MatchCardView` görür: çağrı ("Maç çağrısı"/"Adam aranıyor")/maç → grubun üyesiyse "Çağrıya yanıt ver"/"Maça bak", üye olmayan takım için "Takıma bak", özel grup için sadece özet notu.
Güncel durum (açık/kapalı, tarih geçti) sunucuda sorgulanır, kapalı kartta düğme yerine "Yine de sayfayı aç". Bildirim `invite` türü ("⚽ Maç daveti"). Tuzak: `matches` → `groups` iliştirmesi `groups!matches_group_id_fkey(name)` ile yapılmalı (iki ilişki var). Test: `scripts/e2e/match-card.mjs`.
