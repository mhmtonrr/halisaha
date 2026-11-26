# Dizin yapısı ve sayfalar

CLAUDE.md'den taşındı. Yeni dosya/sayfa eklenince buraya tek satır ekle.

```
src/lib/search.ts          Türkçe i/ı/İ/I ayırmayan ad arama deseni (imatch / RegExp)
src/lib/rating.ts        Puanlama motoru (saf, testli) — en kritik dosya
src/lib/teams.ts         Dengeli takım kurma (saf, testli)
src/lib/attributes.ts    Kart özellikleri FRM/İST/GOL|KRT/AST/GAL/MVP (saf, testli)
src/lib/teams-data.ts    Takım rating'i (en iyi 7), rol etiketleri, takım/üyelik sorguları
src/lib/formations.ts    Sabit dizilişler (5-11 kişilik, slot koordinatları), otomatik yerleştirme (saf, testli)
src/lib/call-rules.ts    Birleşik çağrı: varsayılan seçim, yedek/başvuru sırası, karar zamanı, gün/saat metinleri (saf, testli)
src/lib/match-actions.ts Yeni maç yapısı Server Action'ları: Maç ayarla (setupMatch), Geliyorum/Gelemem (respondMatch) + bildirimler
src/lib/match-manage-actions.ts  Maç ekranı yönetimi (4b): kadro/yedek/başvuru, ilan, bağlantı kodu, rakip/teklif/karşı teklif, kesinleştir/ertele/iptal + bildirimler
src/app/g/[groupId]/m/[matchId]/ManageSections.tsx  Maç ekranı yönetim bölümleri (kadro, adam ara, rakip, kesinleştir/ertele/iptal) + CounterForm
src/app/g/[groupId]/m/[matchId]/AddPlayer.tsx  Oyuncu ekle: arkadaşlardan / uygulamada arayarak davet, misafir (GuestForm)
src/app/g/[groupId]/m/[matchId]/InviteBox.tsx  Davet bağlantısı kutusu; RivalChooser.tsx maç ekranında rakip seçimi (components/RivalPicker.tsx: Maç ayarla ile ortak)
src/app/g/[groupId]/m/[matchId]/GatheringPanel.tsx  Toplanan/kesin maç şeridi: sayaç, benim durumum, Geliyorum/Gelemem
src/lib/listings-data.ts Maç özeti (match_overview) ve Keşfet "Adam arayan" ilanları (open_listings, engellenen süzülür)
src/lib/match-rules.ts   Maç kuralları (saf, testli): varsayılan kadro, saat belli değil metni, direkt kesin mi
src/lib/join-actions.ts  Katılma isteği: gönder, geri al, karar (kabul/ret) + bildirimler
src/lib/proposal-actions.ts  Üye maç önerisi eylemleri (öner, onayla → toplanan maç, geri çek) + bildirimler
src/lib/match-notify.ts  Kadroda yer açılınca (yedek varsa) maçı yönetenlere bildirim (service role)
src/lib/membership-notify.ts  Üye katıldı (yetkililere) ve rol değişti (kişiye) bildirimleri
src/app/g/[groupId]/GroupExtras.tsx  Grup sayfası ekleri: geçici/dağıtılmış takım şeridi, sessize al, maç önerisi formu, öneri kararları (ProposalDecisions)
src/app/g/[groupId]/istekler/page.tsx  Bekleyen istekler (6a): katılma, ilan onayı, öneri, başvuru sekmeleri (pending_requests)
src/lib/reliability.ts   Güvenilirlik: oynadığı / (oynadığı + gelmediği) (saf, testli)
src/lib/notify-rules.ts  Bildirim kuralları: kategori/tercih, alıcı planı, sohbet birleştirme, metinler, push sonucu (saf, testli)
src/lib/notify.ts        notify(): kutuya yaz + web push gönder (service role; asla fırlatmaz); later(): yanıttan sonra çalıştır
src/lib/recipients.ts    Alıcı bulma: grup üyeleri/yetkilileri, maç kadrosu, bağlı maçlar
src/lib/cron-tick.ts     Zamanlanmış işler (/api/cron/tick, 15 dk): yedekten otomatik kadro, toplanan maç iptal, sonuçsuz, bugün maç var, skor/oylama hatırlatması
src/lib/reminders.ts     Oylama hatırlatması (cron): kapanmasına <6 saat (eski günlük yol 24) kalan maçlarda oy vermeyenlere, kişi başı 1
src/lib/push-client.ts   Tarayıcı tarafı abonelik yardımcıları; components/PushControls.tsx (izin kartı + profil ayarı)
public/sw.js             Service worker: push'u gösterir, tıklayınca aynı site içi adresi açar (önbellek yok)
src/lib/skills.ts        Yetenek itibarı: 12 kategori (saha HIZ/ŞUT/PAS/DRİ/DEF/FİZ, kaleci REF/ATL/HAV/YER/DAĞ/İLT), 1-10 puanlardan 40-99 değer (saf, testli)
src/lib/skills-data.ts   Değerlendirmelerden kişinin yeteneklerini hesaplayıp player_skills'e yazar (service role; recomputeSkills / recomputeSkillsForVoter)
src/lib/user-cards.ts    Kart verisi (genel rating + yetenekler) hesap başına TEK satır: user_ratings / user_skills (anahtar user_id). Misafirler (user_id boş) eski player_ratings/player_skills'te. Okuma: loadUserCards()
src/lib/skill-queue.ts   Değerlendirmeni bekleyen oyuncular (skill_queue RPC)
src/lib/profile-stats.ts Kişinin TÜM grup/takım maçlarından istatistik özeti: toplamlar, form, seri, rakip/iç, grup bazında, mevki (saf, testli)
src/lib/profile-data.ts  Kişi bazlı veri (service role): loadPerson, loadPersonMatches, canViewStats, loadProfileForViewer
src/lib/invite.ts        Davet kodu: linkten/yazıdan kodu çıkarma, XXXXX-XXXXX biçimi, tür eşleşmesi (saf, testli)
src/lib/fetch-in.ts      Büyük `in (...)` sorgularını parçalayıp sayfalayan yardımcı
src/components/profile/ProfileView.tsx  Sekmeli profil (Genel/İstatistik/Maçlar/Ayarlar); /profil ve /oyuncu/[id] aynı bileşeni kullanır
src/lib/team-stats.ts    Takım karnesi, form, seri, rakip bazlı geçmiş, oyuncu liderleri (saf, testli)
src/lib/player-search.ts  Oyuncu arama süzgeçleri/sıralama/URL ayrıştırma (saf, testli); veri: src/lib/players-data.ts (service role, sadece `discoverable` kişiler)
src/lib/featured-data.ts  Ana sayfa "öne çıkanlar" (havuzlar 5 dk `unstable_cache`, etiket `featured`; kademe kuralları src/lib/featured-rules.ts, testli); src/components/FeaturedSections.tsx (Suspense ile akar)
src/lib/challenges-data.ts  Maç teklifleri sorguları (gelen/giden, bekleyen sayısı)
src/lib/badges.ts        Profil rozetleri: maç kayıtlarından hesaplanır, saklanmaz (saf, testli)
src/lib/card-name.ts     Karttaki ad: kısaltma ve "kartta görünen ad" doğrulaması + küfür kontrolü (saf, testli)
src/lib/card-photo.ts    Kart fotoğrafı saf yardımcıları: depo yolu, kırpma/boyut hesapları (testli)
src/lib/data.ts          Ortak sorgular, mevki/ayak sabitleri, tarih yardımcıları (TR saati)
src/lib/regions.ts       81 il + src/data/districts.json (973 ilçe, iki kaynakla doğrulandı)
src/lib/actions.ts       Server Action'lar (maç ayarlama: match-actions/match-manage-actions, öneri: proposal-actions) (yetkiyi RLS yapar; burada sadece çağrı + yönlendirme)
src/lib/finalize.ts      Oylama kapanışı, hesap bazlı genel rating hesabı ve yazımı (service role)
src/components/LiveRefresh.tsx  Canlı güncelleme: Realtime dinler, router.refresh() yapar (filtre yardımcısı src/lib/live.ts)
src/components/SubmitButton.tsx  Form gönderilirken anında "…" durumu (useFormStatus)
src/components/PlayerCard.tsx  Oyuncu kartları (FullCard tam kart, saha/kompakt kart); bronz/gümüş/altın eşikleri
src/components/LineupPitch.tsx  Diziliş sahası parçaları (Pitch, SlotBox, PitchCard, EmptySlot)
src/components/JoinMatchCard.tsx  Maça katıl kartı (kod girişi → openMatchByCode; ana sayfada yaklaşan maç yoksa kart, varsa başlıktaki düğmeyle açılır pencere)
src/components/JoinRequest.tsx  Katılma isteği düğmesi (mesajlı gönder / bekliyor · geri al); Keşfet Gruplar ve takım sayfası
src/components/Avatar.tsx  Yuvarlak avatar: kart fotoğrafı varsa o, yoksa baş harfler
src/components/CardPhotoUploader.tsx  Kart fotoğrafı yükleme: küçült, arka plan kaldır, önizle, kaydet/sil; PhotoCropper.tsx elle kırpma
src/components/BottomNav.tsx  Alt gezinme çubuğu (sohbet ekranında gizlenir); NotificationBadge.tsx okunmamış bildirim rozeti (Realtime)
src/components/ui.tsx  Ortak parçalar (Card, Button/LinkButton, Input, Label, SectionTitle, Header, Badge, ErrorNote) Obsidian Pitch/profil stilinde; `cx` = tailwind-merge (sonradan verilen sınıf kazanır)
src/components/Icon.tsx  Material Symbols ikonu (tasarımdaki adlarla)
src/components/home/UpcomingMatches.tsx  Yaklaşan maç kartları (sürükle/kaydır, Tümü, boşken Maça katıl kartı)
src/components/home/  Ana sayfa parçaları: ActionItem (Yapılacaklar satırı, aciliyet rengi), HomeTabs (Takımlar/Gruplar hap sekmesi, istemci)
src/lib/home.ts  Ana sayfa yardımcıları: seviye ilerlemesi, maça kalan gün, kadro kapasitesi (saf, testli)
src/components/AutoOpenDetails.tsx  İlk yüklemede bir kez açılan açılır bölüm
src/components/ProfileFields.tsx  Profil ve karşılama formlarının ortak alanları; RegionSelect.tsx bağlı il/ilçe seçimi
src/components/TeamFields.tsx  Takım kurma ve takım/grup bilgileri düzenleme form alanları; TeamSizeSelect.tsx kaç kişilik (5v5…11v11); TeamBadge.tsx renkli baş harf rozeti
src/components/RosterTabs.tsx  Kadro / Misafirler sekmesi
src/components/ShareLink.tsx  Sayfa linkini paylaş (paylaşım menüsü ya da panoya kopyala); profile/ShareButton.tsx profil için
src/components/SkillBars.tsx  Kartın 6 yeteneği çubuk olarak; SkillQueueBanner.tsx değerlendirme bekleyen varsa /yetenek kartı
src/components/profile/  FlipCard (kart çevirme), MatchesList (geçmiş maçlar + filtre), ProfileBars (başlık), RadarChart (yetenek altıgeni)
src/components/settings/  blocks (Ayarlar bölüm/satır), Interactive (bildirim anahtarları, müsaitlik, paylaşım), SubScreen (alt ekran iskeleti)
src/components/NavHistory.tsx  Gerçek tarayıcı geçmişinin aynası; BackLink history.go(-n) ile geldiği sayfaya döner, form sayfaları geri hedefi olmaz. Yeni geri oku her zaman BackLink/Header ile yap (sabit Link koyma)
src/components/AppMenu.tsx  ☰ çekmecesi (AppMenuShell layout'ta) ve başlık düğmeleri (MenuControls: bildirim çanı + ☰); veri src/lib/menu-data.ts
src/lib/authErrors.ts    Supabase Auth hatalarının Türkçesi
src/lib/supabase/        server.ts (requireUser + karşılama yönlendirmesi), client.ts, admin.ts
src/middleware.ts        Oturum yenileme, girişsiz yönlendirme, x-pathname başlığı
src/app/                 Sayfalar (aşağıda)
supabase/migrations/     0001..0052 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/setup-cron.mjs   Supabase pg_cron+pg_net ile /api/cron/tick'i 15 dakikada bir çağıran işi kurar/kaldırır (Vault'ta CRON_SECRET)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
scripts/perf/ttfb.mjs   Sayfa yanıt süresi ölçümü (geçici kullanıcıyla canlı site, TTFB)
scripts/recompute-all.ts Tüm ratingleri baştan hesaplar (vite-node ile, aşağıda)
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması (`?sekme=oyuncu` oyuncu arama, `?sekme=mac` adam arayan maçlar) · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/profil/ayarlar/{kisisel,futbolcu,iletisim,guvenlik,gorunurluk,engellenenler}` · `/sohbet` (genel sohbet: takım/grup/kişi; `/sohbet/[threadId]` birebir) · `/sosyal` (arkadaşlar ve istekler, takımlarım, gruplarım) · `/bildirimler` (bildirim kutusu, son 50) · `/privacy` (gizlilik) · `/yardim` · `/geri-bildirim` · `/yetenek` (yetenek değerlendirmesi) · `/oyuncu/[userId]` (başkasının profili) · `/katil` (davet koduyla takıma/gruba katıl; `?tur=takim|grup`) · `/join/[code]` · `/mac-ayarla` (Maç ayarla sihirbazı: `MatchSetupForm` + `components/RivalPicker`; `?grup=&rakip=&adim=`) · `/davet/m/[code]` (maç davet bağlantısı: özet, kadro, Başvur) · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,cagri/[pollId],m/[matchId],p/[playerId]}` (`matches/new` ve `cagri/yeni` → `/mac-ayarla`)
· takımlara özel: `/g/[id]/teklif` (bu takıma maç teklif et) · `/g/[id]/teklifler` (gelen/giden/kabul edilen) · `/g/[id]/istatistik` (herkese açık)
