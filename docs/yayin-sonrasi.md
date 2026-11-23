# Yayın sonrası / gerçek hosting'e geçince yapılacaklar

(Şimdilik Vercel'de çalışıyoruz; aşağıdakiler kullanıcı kararıyla ertelendi. Yeni bir madde çıkarsa buraya ekle.)

## Gerçek hosting'e geçince
- **E-posta onayı**: şu an kapalı (kullanıcı kapattı). Resend/SMTP kurulunca (alan adı gerekir; vercel.app doğrulanamaz) Supabase'de "Confirm email" tekrar açılacak. Risk: şimdilik başkasının e-postasıyla kayıt olunabilir.
- **Kart fotoğrafı arka plan modeli**: `@imgly/background-removal` modeli (~80 MB) varsayılan olarak üçüncü taraf CDN'den iniyor. Hosting'e geçince dosyaları kendi depolamamıza koyup (`publicPath` ile) oradan sun. Repoya koyma (boyut: GitHub 100 MB/dosya, Vercel dağıtımı şişer); Supabase Storage'da genel klasör düşünülüyor ama ücretsiz planda tek dosya sınırı 50 MB → önce parça boyutlarına bak. Bu konteynerde `card-photo` e2e'nin düşmesi büyük ihtimalle bu adrese erişilememesinden (doğrulanmadı).
- **Maç Başlama Hatırlatıcıları** (tasarımda var, yok): kadrodaki oyunculara maçtan 2 saat önce bildirim. Yeni bildirim kategorisi (Ayarlar'da anahtar), sık çalışan cron (en az saatlik; Vercel ücretsiz planda cron günde bir) ve "gönderildi" kaydı gerekir. Oylama hatırlatmasındaki cron (`src/lib/reminders.ts`) uyarlanabilir.
- **Telefon doğrulama (SMS)**: şimdilik sadece e-posta doğrulaması. SMS sağlayıcısı (ücretli) gerekir.
- **Çoklu dil**: Ayarlar'da "Türkçe (TR)" sabit. Tüm arayüz metinleri çeviri altyapısına taşınmalı (büyük iş).
- **İkinci tema ("Klasik Gece")**: tasarımı yok; seçici "yakında" gösteriyor.
- **Hukuki**: KVKK aydınlatma metni, 18 yaş altı kuralı (yol haritası madde 6).
- **Web push (Android)**: ekran kapalıyken gelmiyordu; `urgency: "high"` yapıldı, telefonda yeniden denenmeli (pil "Sınırsız", bildirim önemi "Yüksek").
- **Hız**: ana sayfa her açılışta tüm grupların `finalizeExpired`/`close_stale_polls` kontrolünü yapıyor; kök `loading.tsx` güvenli yolla denenebilir; `scripts/perf/ttfb.mjs` ile önce/sonra ölç.

## Sırada (hosting'e bağlı değil, sonra yapılacak)
- **Maç süresi (60 / 90 dk)**: maç kurarken süre seçilecek (`matches`'e süre alanı, eski maçlar 60 dk varsayılan); İstatistik'teki "dk saha" şimdiki tahminin (maç × 60) yerine bundan hesaplanacak. Parçalar: 1) DB + maç kurma formu, 2) hesap + ekran.
- **Öne çıkanlar engellemeye göre süzülsün**: ana sayfa öne çıkanları bölge başına ortak önbellekten geliyor, engellediklerim süzülmüyor. Önbelleğe dokunmadan sayfa açılırken kişiye göre süzülebilir (`src/lib/featured-data.ts`, `user_blocks`).

## Karar: yapılmayacaklar
- **"Pas Ustası" rozeti**: pas isabeti verisi toplanmıyor; rozet kapsam dışı.
