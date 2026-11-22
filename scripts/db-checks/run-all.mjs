// Tüm veritabanı yetki kontrollerini gömülü Postgres'te (PGlite) çalıştırır.
// Kullanım: npm run db:check
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && !["run-all.mjs", "migrations.mjs"].includes(f)).sort()) {
  console.log(`\n=== ${f}`);
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // Çökme: sadece kontrollerin çıktısını ve hata mesajını göster
    out = (e.stdout ?? "") + "\n✗ ÇÖKTÜ: " + ((e.stderr ?? "").match(/^error: .*$/m)?.[0] ?? e.message.split("\n")[0]);
  }
  for (const line of out.split("\n").filter((l) => /^[✓✗]/.test(l))) {
    console.log(line);
    if (line.startsWith("✗")) failed++;
  }
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exit(failed ? 1 : 0);
