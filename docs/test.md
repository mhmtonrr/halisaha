# Test ayrıntıları

CLAUDE.md'den taşındı.

## Uçtan uca (e2e)

Uçtan uca (canlı Supabase'e karşı; test kullanıcıları/grupları oluşturur ve **sonunda siler**):
**Yerel (Windows):** Playwright geliştirme bağımlılığı (`npm install` ile gelir); tarayıcı bir kez indirilir: `npx playwright install chromium`.
`npm run dev` açıkken (localhost:3000) tek senaryo: `node scripts/e2e/nav.mjs`. `npm install` sonrası açık dev sunucusu bozulabilir
("Jest worker encountered … child process exceptions") → sunucuyu yeniden başlat.
**Tuzak:** dev sunucusu açıkken `npm run build` çalıştırma; `.next`in üzerine yazar, sunucu JS dosyalarını 404 verir, sayfa canlanmaz (giriş formu `/login?` diye GET olur, e2e girişte takılır) → sunucuyu yeniden başlat.
```bash
node scripts/e2e/nav.mjs
```
**Bilinen bozuk/kırılgan senaryolar (benim değişikliklerimle ilgisiz)**: `teams-polls` ("grup üyesi maç/çağrı açamıyor" ve "Doğrudan maç" eski varsayımlar, üye çağrısından/0013'ten önce yazıldı), `auth-onboarding` (ilçe artık `input[name=district]` değil seçim listesi),
`teams-polls`, `match-card`, `notifications` eski çağrı/ilan akışını kullanıyor (0035 birleşik çağrı); 4. parçada yeniden yazılacak (`member-poll`, `listings` silindi). Menü/davet testlerinde çekmece içeriği `waitFor` ile beklenir.
Senaryolar: `calls` (birleşik çağrı: aç, yanıt, kesinleştir, yedek, yer açıldı, adam ara, rakibe karşı/ödünç), `proposals-teams` (öneri, hızlı/geçici takım, ödünç davet, sessize alma), `nav` (geri oku), `profile-links`, `invite`, `withdrawal`, `leave`, `menu`, `profile`, `skills`, `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`, `notifications`.
Ekran görüntülerine bak (390px genişlik, telefon) — görsel sorunlar çoğu zaman sadece orada yakalanıyor.
Port doluysa: `fuser -k 3000/tcp`. Arayüzden kayıt (signUp) test etme: onay maili gönderir, limit saatte 2.
