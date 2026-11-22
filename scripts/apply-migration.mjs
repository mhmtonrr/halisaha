// Bir migration dosyasını canlı Supabase veritabanına tek istekte (tek transaction) uygular.
// Kullanım: node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/00NN_x.sql
// Gerekli: .env.local içinde SUPABASE_ACCESS_TOKEN (Supabase > Account > Access Tokens). Değer ekrana basılmaz.
import { readFileSync } from "node:fs";

const PROJECT_REF = "hbdhbquczlvjnsmrgqxj";
const file = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!file) {
  console.error("Kullanım: node --env-file=.env.local scripts/apply-migration.mjs <dosya.sql>");
  process.exit(1);
}
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN .env.local içinde tanımlı değil.");
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: readFileSync(file, "utf8") }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
// process.exit() yerine exitCode: Windows'ta açık fetch bağlantısıyla exit libuv assert'ine düşüyor.
process.exitCode = res.ok ? 0 : 1;
