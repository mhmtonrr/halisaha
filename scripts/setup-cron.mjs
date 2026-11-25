// Supabase'de zamanlayıcıyı kurar: pg_cron her 15 dakikada pg_net ile canlı uygulamanın /api/cron/tick yolunu çağırır.
// Anahtar (CRON_SECRET) Supabase Vault'ta saklanır; Vercel'deki CRON_SECRET ile AYNI olmalı.
// Önce: Supabase > Database > Extensions'ta pg_cron ve pg_net açık olmalı (betik açık değilse uyarır).
// Kullanım: node --env-file=.env.local scripts/setup-cron.mjs        (kurar/günceller)
//           node --env-file=.env.local scripts/setup-cron.mjs --off  (işi kaldırır)
// Gerekli: SUPABASE_ACCESS_TOKEN, CRON_SECRET (.env.local). Değerler ekrana basılmaz.

const PROJECT_REF = "hbdhbquczlvjnsmrgqxj";
const URL = "https://halisaha-tawny.vercel.app/api/cron/tick";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const secret = process.env.CRON_SECRET;
if (!token || !secret) {
  console.error("SUPABASE_ACCESS_TOKEN ve CRON_SECRET .env.local içinde tanımlı olmalı.");
  process.exit(1);
}
if (!/^[0-9a-f]{32,}$/.test(secret)) {
  console.error("CRON_SECRET beklenen biçimde değil (en az 32 onaltılık karakter).");
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.replace(secret, "***").slice(0, 400)}`);
  return JSON.parse(text);
}

const ext = await sql(`select extname from pg_extension where extname in ('pg_cron', 'pg_net')`);
const have = new Set(ext.map((r) => r.extname));
if (!have.has("pg_cron") || !have.has("pg_net")) {
  console.error(`Eksik eklenti: ${["pg_cron", "pg_net"].filter((e) => !have.has(e)).join(", ")}. Supabase > Database > Extensions'tan aç.`);
  process.exit(1);
}

if (process.argv.includes("--off")) {
  await sql(`select cron.unschedule(jobid) from cron.job where jobname = 'halisaha-tick'`);
  console.log("Zamanlayıcı kaldırıldı.");
  process.exit(0);
}

// Vault: aynı adlı anahtar varsa güncellenir
await sql(`
  do $$
  declare v_id uuid;
  begin
    select id into v_id from vault.secrets where name = 'cron_secret';
    if v_id is null then
      perform vault.create_secret('${secret}', 'cron_secret', 'halisaha /api/cron/tick anahtarı');
    else
      perform vault.update_secret(v_id, '${secret}');
    end if;
  end $$;
`);

await sql(`
  select cron.unschedule(jobid) from cron.job where jobname = 'halisaha-tick';
  select cron.schedule('halisaha-tick', '*/15 * * * *', $job$
    select net.http_post(
      url := '${URL}',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )
  $job$);
`);
const jobs = await sql(`select jobname, schedule, active from cron.job where jobname = 'halisaha-tick'`);
console.log("Kuruldu:", JSON.stringify(jobs));
