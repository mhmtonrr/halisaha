# Test ayrıntıları

CLAUDE.md'den taşındı.

## Uçtan uca (e2e)

Uçtan uca (canlı Supabase'e karşı; test kullanıcıları/grupları oluşturur ve **sonunda siler**):
```bash
(NODE_USE_ENV_PROXY=1 npx next start -p 3000 > /tmp/server.log 2>&1 &)
NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 node scripts/e2e/chat.mjs /tmp/shots
```
**Bilinen bozuk/kırılgan senaryolar (benim değişikliklerimle ilgisiz)**: `teams-polls` ("grup üyesi maç/çağrı açamıyor" ve "Doğrudan maç" eski varsayımlar, üye çağrısından/0013'ten önce yazıldı), `auth-onboarding` (ilçe artık `input[name=district]` değil seçim listesi),
`member-poll` (akşam saatlerinde formun varsayılan 21:00 maçı "en az 3 saat sonra" kuralına takılır → günün saatine bağlı). Menü/davet testlerinde çekmece içeriği `waitFor` ile beklenir.
Senaryolar: `profile-links`, `invite`, `withdrawal`, `leave`, `menu`, `profile`, `skills`, `positions-external`, `auth-onboarding`, `teams-polls`, `regions-community`, `chat`, `challenges`, `guest-match`, `realtime`, `member-poll`, `listings`, `notifications`.
Ekran görüntülerine bak (390px genişlik, telefon) — görsel sorunlar çoğu zaman sadece orada yakalanıyor.
Port doluysa: `fuser -k 3000/tcp`. Arayüzden kayıt (signUp) test etme: onay maili gönderir, limit saatte 2.
