// Push teslimatı: gerçek web-push kütüphanesi ve VAPID imzalamasıyla, gerçek veritabanına karşı.
//   NODE_USE_ENV_PROXY=1 npx vite-node --config scripts/recompute.vite.config.mjs scripts/e2e/push-delivery.ts
// Sahte push servisi (enjekte gönderici) ile notify'ın alıcı seçimi, ölü abonelik temizliği ve yük içeriğini;
// gerçek kütüphane ile de VAPID başlığı ve şifreli gövde üretimini doğrular. Test verisini sonunda siler.
import crypto from "node:crypto";
import fs from "node:fs";
import { generateRequestDetails, generateVAPIDKeys } from "web-push";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
Object.assign(process.env, env);
const vapid = generateVAPIDKeys(); // sadece bu test için; gerçek anahtarlar ortamda
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;

const { createClient } = await import("@supabase/supabase-js");
const { notify } = await import("@/lib/notify");
const { text } = await import("@/lib/notify-rules");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failed = 0;
const check = (label: string, cond: boolean) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const b64url = (b: Buffer) => b.toString("base64url");
/** Geçerli bir tarayıcı aboneliği gibi: P-256 genel anahtarı (65 bayt) ve 16 baytlık auth sırrı */
const fakeSub = (endpoint: string) => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) };
};

const users: string[] = [];
try {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await admin.auth.admin.createUser({ email: `e2e-push-${Date.now()}-${i}@example.com`, password: "Sifre-push9x", email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
  }
  const [a, b, c] = users;
  const subs = { a: fakeSub("https://push.example/a"), aDead: fakeSub("https://push.example/a-dead"), b: fakeSub("https://push.example/b"), c: fakeSub("https://push.example/c") };
  await admin.from("push_subscriptions").insert([
    { user_id: a, ...subs.a }, { user_id: a, ...subs.aDead }, { user_id: b, ...subs.b }, { user_id: c, ...subs.c },
  ]);
  await admin.from("notification_prefs").insert({ user_id: c, votes: false }); // c oylama bildirimini kapattı

  // 1) Alıcı seçimi + yük + ölü abonelik temizliği (enjekte sahte push servisi)
  const calls: { endpoint: string; payload: { title: string; body: string; url: string; tag: string; type: string } }[] = [];
  const sender = async (sub: { endpoint: string }, payload: string) => {
    calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    if (sub.endpoint.endsWith("/a-dead")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
  };
  const content = text.voteOpened("g1", "m1", "Rakip FK");
  const r = await notify(users, "vote", content, { excludeUserId: b, sender });
  check("alıcılar: olayı yapan (b) ve kategoriyi kapatan (c) hariç sadece a", r.stored === 1);
  check("a'nın iki cihazına gönderim denendi, b ve c'ye hiç denenmedi", calls.length === 2 && calls.every((x) => x.endpoint.includes("/a")));
  check("yük başlık, gövde, adres, etiket ve tür taşır", calls[0].payload.title === content.title && calls[0].payload.url === "/g/g1/m/m1" && calls[0].payload.tag === "vote:m1" && calls[0].payload.type === "vote");
  check("başarılı gönderim sayısı 1 (diğeri 410 ölü)", r.sent === 1);
  const left = (await admin.from("push_subscriptions").select("endpoint").in("user_id", users)).data!.map((x) => x.endpoint).sort();
  check("410 dönen ölü abonelik silindi, diğerleri durdu", !left.includes("https://push.example/a-dead") && left.length === 3);
  check("bildirim kutusuna a için yazıldı", (await admin.from("notifications").select("id").eq("user_id", a)).data!.length === 1 && (await admin.from("notifications").select("id").eq("user_id", c)).data!.length === 0);

  // 2) Sohbet birleştirme: aynı grup etiketiyle 10 dk içinde ikinci bildirim yazılmaz
  const chat = text.chat("Grup", "g9", "Ali", "Selam");
  const c1 = await notify([a], "chat", chat, { sender });
  const c2 = await notify([a], "chat", chat, { sender });
  check("sohbet: ilk bildirim yazılır, ikincisi birleşir (atlanır)", c1.stored === 1 && c2.stored === 0);
  check("farklı grubun sohbeti ayrı sayılır", (await notify([a], "chat", text.chat("Başka", "g10", "Ali", "Selam"), { sender })).stored === 1);

  // 3) Hata dayanıklılığı: gönderici patlasa da notify fırlatmaz, bildirim kutusu yazılmış kalır
  const boom = async () => { throw new Error("ağ koptu"); };
  const rb = await notify([b], "match", text.matchGathering("G", "g1", "m1", "Cum 21:00", 1, 8), { sender: boom });
  check("gönderim hatasında notify fırlatmaz; kutu yazıldı, abonelik silinmedi", rb.stored === 1 && rb.sent === 0 && (await admin.from("push_subscriptions").select("id").eq("user_id", b)).data!.length === 1);

  // 4) Gerçek kütüphane: VAPID imzası ve şifreli gövde (gönderim yapmadan istek detaylarını üretir)
  const details = generateRequestDetails(
    { endpoint: subs.b.endpoint, keys: { p256dh: subs.b.p256dh, auth: subs.b.auth } },
    JSON.stringify({ title: "Merhaba", body: "Test", url: "/", tag: "t", type: "vote" }),
    { vapidDetails: { subject: "https://halisaha-tawny.vercel.app", publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600 },
  );
  const h = details.headers as Record<string, string>;
  check("VAPID Authorization başlığı üretildi (vapid t=..., k=...)", /^vapid t=.+, k=.+$/.test(h.Authorization ?? h.authorization ?? ""));
  check("gövde aes128gcm ile şifreli ve düz metin içermiyor", h["Content-Encoding"] === "aes128gcm" && Buffer.isBuffer(details.body) && !details.body.toString("utf8").includes("Merhaba"));
  check("TTL başlığı iletildi", String(h.TTL) === "3600");

  // 5) Gerçek gönderici yolu (enjeksiyon yok): ulaşılamayan push servisinde fırlatmaz ve aboneliği silmez
  const rr = await notify([b], "match", text.matchGathering("G2", "g1", "m2", "Cum 21:00", 1, 8));
  check("gerçek gönderici ulaşılamayan servisle fırlatmaz (sent 0, abonelik kalır)", rr.sent === 0 && (await admin.from("push_subscriptions").select("id").eq("user_id", b)).data!.length === 1);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e instanceof Error ? e.message : e);
} finally {
  for (const u of users) await admin.auth.admin.deleteUser(u);
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exit(failed ? 1 : 0);
