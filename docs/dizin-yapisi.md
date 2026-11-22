# Dizin yapısı ve sayfalar

CLAUDE.md'den taşındı. Yeni dosya/sayfa eklenince buraya tek satır ekle.

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
src/lib/user-cards.ts    Kart verisi (genel rating + yetenekler) hesap başına TEK satır: user_ratings / user_skills (anahtar user_id). Misafirler (user_id boş) eski player_ratings/player_skills'te. Okuma: loadUserCards()
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
src/components/NavHistory.tsx  Gerçek tarayıcı geçmişinin aynası; BackLink history.go(-n) ile geldiği sayfaya döner, form sayfaları geri hedefi olmaz. Yeni geri oku her zaman BackLink/Header ile yap (sabit Link koyma)
src/components/AppMenu.tsx  ☰ çekmecesi (AppMenuShell layout'ta) ve başlık düğmeleri (MenuControls: bildirim çanı + ☰); veri src/lib/menu-data.ts
src/lib/authErrors.ts    Supabase Auth hatalarının Türkçesi
src/lib/supabase/        server.ts (requireUser + karşılama yönlendirmesi), client.ts, admin.ts
src/middleware.ts        Oturum yenileme, girişsiz yönlendirme, x-pathname başlığı
src/app/                 Sayfalar (aşağıda)
supabase/migrations/     0001..0033 SQL (sırayla; hepsi canlıya uygulandı)
scripts/db-checks/       PGlite ile RLS/yetki kontrolleri (npm run db:check)
scripts/e2e/             Canlı veritabanına karşı Playwright akış testleri
scripts/perf/ttfb.mjs   Sayfa yanıt süresi ölçümü (geçici kullanıcıyla canlı site, TTFB)
scripts/recompute-all.ts Tüm ratingleri baştan hesaplar (vite-node ile, aşağıda)
```

Sayfalar: `/login` (e-posta+şifre, Google, şifremi unuttum) · `/hosgeldin` (ilk giriş: ad, il/ilçe, mevki…)
· `/` ana sayfa · `/kesfet` takım sıralaması · `/profil` · `/takim-kur` · `/grup-kur` · `/sifre-yenile`
· `/profil/ayarlar/{kisisel,futbolcu,iletisim,guvenlik,gorunurluk,engellenenler}` · `/sohbet` (genel sohbet: takım/grup/kişi; `/sohbet/[threadId]` birebir) · `/yardim` · `/geri-bildirim` · `/yetenek` (yetenek değerlendirmesi) · `/oyuncu/[userId]` (başkasının profili) · `/katil` (davet koduyla takıma/gruba katıl; `?tur=takim|grup`) · `/join/[code]` · `/g/[id]` grup/takım · `/g/[id]/{players,kadro,sohbet,matches/new,cagri/yeni,cagri/[pollId],m/[matchId],p/[playerId]}`
· takımlara özel: `/g/[id]/teklif` (bu takıma maç teklif et) · `/g/[id]/teklifler` (gelen/giden/kabul edilen) · `/g/[id]/istatistik` (herkese açık)
