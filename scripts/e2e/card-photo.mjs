// Kart fotoğrafı: Ayarlar'da şeffaf PNG yükle (arka plan kaldırma atlanır) → önizleme → Kaydet → depo + profil adresi → sil.
// Düz (opak) fotoğrafta model denenir; indirilemezse düz kırpma yedeği çalışmalı. Canlı Supabase'e karşı; test verisini siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

let user; let browser;
try {
  const email = `e2e-photo-${Date.now()}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Foto Test" } });
  if (error) throw error;
  user = { id: data.user.id, email, password };
  await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "FWD", onboarded_at: new Date().toISOString() }).eq("id", user.id);

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  page.on("console", (m) => { if (m.type() === "warning" && m.text().includes("Arka plan")) console.log("  [uyarı]", m.text().slice(0, 300)); });
  await page.goto(BASE + "/login"); await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password);
  await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");

  // Test görselleri tarayıcıda üretilir: şeffaf zeminli daire (PNG) ve opak fotoğraf (JPEG)
  const makeImage = (type) => page.evaluate(async (type) => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 1000;
    const x = c.getContext("2d");
    if (type === "image/jpeg") { x.fillStyle = "#3a6"; x.fillRect(0, 0, 800, 1000); }
    x.fillStyle = "#d33"; x.beginPath(); x.arc(400, 450, 250, 0, Math.PI * 2); x.fill();
    return c.toDataURL(type, 0.9).split(",")[1];
  }, type);

  await page.goto(`${BASE}/profil/ayarlar/futbolcu`);
  const file = page.locator('input[type="file"]');
  await file.setInputFiles({ name: "kesim.png", mimeType: "image/png", buffer: Buffer.from(await makeImage("image/png"), "base64") });
  await page.getByRole("button", { name: "Kırp ve devam" }).click(); // kırpma adımı (PhotoCropper) her yüklemede açılır
  const ready = page.getByRole("button", { name: "Başka fotoğraf" });
  await ready.waitFor({ timeout: 20000 });
  check("şeffaf PNG'de önizleme kartta görünüyor", await page.locator('img[src^="blob:"]').count() === 1);
  await page.screenshot({ path: `${SHOTS}/card-photo-preview.png` });
  await page.getByRole("button", { name: "Kaydet", exact: true }).first().click();
  await page.getByRole("button", { name: "Fotoğrafı sil" }).waitFor({ timeout: 20000 });

  const { data: prof } = await admin.from("profiles").select("photo_url").eq("id", user.id).single();
  check("profilde kendi klasörüne işaret eden adres", !!prof.photo_url?.includes(`/avatars/${user.id}/card?v=`));
  const head = await fetch(prof.photo_url);
  check("dosya herkese açık okunuyor (webp/png, ≤512 KB)", head.ok && /image\/(webp|png)/.test(head.headers.get("content-type") ?? "") && Number(head.headers.get("content-length") ?? 0) <= 524288);
  check("kayıtlı fotoğraf kartta", await page.locator(`img[src="${prof.photo_url}"]`).count() >= 1);

  // Opak fotoğraf: model ya çalışır ya düz kırpma yedeği devreye girer; her iki durumda önizleme oluşmalı
  await file.setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await makeImage("image/jpeg"), "base64") });
  await page.getByRole("button", { name: "Kırp ve devam" }).click(); // kırpma adımı (PhotoCropper) her yüklemede açılır
  await ready.waitFor({ timeout: 180000 });
  const fallback = await page.getByText("düz kırpıldı").count();
  console.log("  · opak fotoğraf:", fallback ? "model yok → düz kırpma" : "arka plan kaldırıldı");
  check("opak fotoğrafta önizleme oluştu", await page.locator('img[src^="blob:"]').count() === 1);
  await page.screenshot({ path: `${SHOTS}/card-photo-opaque.png` });

  // Sil (onay penceresi kabul edilir)
  await page.goto(`${BASE}/profil/ayarlar/futbolcu`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Fotoğrafı sil" }).click();
  await page.getByRole("button", { name: /Fotoğraf seç/ }).waitFor({ timeout: 20000 });
  const { data: after } = await admin.from("profiles").select("photo_url").eq("id", user.id).single();
  const { data: files } = await admin.storage.from("avatars").list(user.id);
  check("silince adres boş ve dosya yok", after.photo_url === null && (files ?? []).length === 0);
} catch (e) {
  console.error(e); failed++;
} finally {
  await browser?.close();
  if (user) {
    await admin.storage.from("avatars").remove([`${user.id}/card`]);
    await removeTestUsers(admin, [user.id]);
  }
  console.log(failed ? `\n${failed} HATA` : "\nHepsi geçti");
  process.exit(failed ? 1 : 0);
}
