# Halısaha Performans

Arkadaş gruplarının halısaha maçlarında birbirini puanladığı, FIFA tarzı rating ve dengeli takım kurma uygulaması.

**Teknoloji:** Next.js (App Router) · Supabase (Postgres, Auth, RLS) · Tailwind · Vitest

## Yapı

| Dosya | Görev |
|---|---|
| `src/lib/rating.ts` | Puanlama motoru: oy normalizasyonu, uç değer kırpma, ikili tespiti, ağırlıklı rating, 40-99 ölçeği |
| `src/lib/teams.ts` | Dengeli takım kurma: her kadro büyüklüğü, kaleci dağıtımı, eksik takım telafisi |
| `supabase/migrations/0001_init.sql` | Şema, satır seviyesinde güvenlik, RPC'ler |

## Puanlama kuralları

1. Her oy, oyu verenin o maçtaki kendi ortalamasına göre değerlendirilir (cömert/sert oy veren farkı silinir).
2. 5+ oy alan oyuncunun en yüksek ve en düşük oyu atılır.
3. Birbirine sürekli belirgin yüksek puan veren ikililerin karşılıklı oyları %30 ağırlıkla sayılır.
4. Oy verebileceklerin yarısından azı oy verdiyse maçın ağırlığı orantılı düşer; 3'ten az oy alan oyuncunun maçı sayılmaz.
5. Galibiyet küçük bir bonus verir; gol/asist rating'e girmez (profil ve rozetler için).
6. Yakın maçlar daha ağır basar; yeni oyuncular grup ortalamasından (65) başlar.

Ayarlar `CONFIG` nesnesinde.

## Geliştirme

```bash
npm install
cp .env.example .env.local   # Supabase bilgilerini doldurun
npm test
npm run dev
```
