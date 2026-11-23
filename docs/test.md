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
**Dev sunucusu tuhaflığı (üretimde yok)**: `npm run dev`de kendisi yönlendiren sayfaya istemci geçişi (girişten sonra `/` → `/hosgeldin`, karşılamadan sonra `/join/…` → `/g/…`) boş sayfada kalabiliyor; canlıda doğru çalışıyor. Bu yüzden `auth-onboarding` takılırsa bir kez yeniler (`settle`). Menü/davet testlerinde çekmece içeriği `waitFor` ile beklenir.
`notifications` hatırlatma cron adımı için sunucu `CRON_SECRET=e2e-secret` ile başlatılmalı; değilse o adım "ATLANDI" yazar.
Senaryolar: `calls` (birleşik çağrı: aç, yanıt, misafir ekle/çıkar, kesinleştir, yedek, yer açıldı, adam ara, takım çağrısıyla rakibe karşı, kontenjan), `proposals-teams` (öneri, grupta rakibe karşı yok, geçici takım (RPC ile), ödünç davet, sessize alma), `nav` (geri oku), `profile-links`, `invite`, `withdrawal`, `leave`, `menu`, `profile`, `skills`, `positions-external`, `auth-onboarding`, `teams` (takım kurma, roller, görünürlük, Keşfet), `match-card` (sohbetten maç/çağrı kartı), `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`, `notifications`, `card-photo` (kırpma + arka plan kaldırma), `discover`, `dm`, `dm-invite`, `friends`, `inbox`, `settings`.
**Temizlik kuralı**: her senaryo `finally` içinde `removeTestUsers(admin, ids)` (`scripts/e2e/cleanup.mjs`) çağırır: test kullanıcılarının kurduğu/üye olduğu gruplar (başka hesaplı üyesi yoksa), teklifler ve kullanıcılar silinir; eksik kalırsa `⚠ TEMİZLİK EKSİK` yazar. Yeni senaryoda `deleteUser`'ı doğrudan çağırma (grup/maç `created_by` kullanıcıyı tutar, silme sessizce başarısız olur). Test kullanıcıları `@example.com`; kontrol: canlıda bu alan adıyla kullanıcı kalmamalı.
Kullanıcıyı API ile kuran senaryo karşılamayı atlamak için `profiles.onboarded_at` (+ il) doldurur; yoksa her sayfa `/hosgeldin`'e yönlenir.
Ekran görüntülerine bak (390px genişlik, telefon) — görsel sorunlar çoğu zaman sadece orada yakalanıyor.
Port doluysa: `fuser -k 3000/tcp`. Arayüzden kayıt (signUp) test etme: onay maili gönderir, limit saatte 2.
