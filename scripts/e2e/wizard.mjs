// "Maç ayarla" sihirbazını dolduran ortak yardımcı (sayfa zaten /mac-ayarla?grup= üzerinde olmalı).
const next = (page) => page.click('button:text-is("İleri")');
const heading = (page, t) => page.waitForSelector(`h2:text-is("${t}")`);

/**
 * day: "YYYY-AA-GG" (boşsa yarın) · time: "SS:DD" (boşsa saat belli değil) · pick: işaretlenecek üye/arkadaş adları (sen zaten işaretli)
 * opponent: uygulamada olmayan rakip adı · appRival: uygulamadaki rakibin adı · submit: false ise son adımda bekler
 */
export async function fillSetup(page, { day, time, size, venue, fee, opponent, appRival, pick = [], guest, submit = true, shot } = {}) {
  await heading(page, "Maç bilgileri");
  await page.fill('input[aria-label="Maç günü"]', day ?? new Date(Date.now() + 3 * 3600e3 + 864e5).toISOString().slice(0, 10));
  if (!time) await page.click('button:text-is("Belli değil")');
  else if (["19:00", "20:00", "21:00", "22:00", "23:00"].includes(time)) await page.click(`button:text-is("${time}")`);
  else {
    await page.click('button:text-is("Başka saat")');
    await page.fill('input[aria-label="Saat"]', time);
  }
  if (size) await page.click(`button:text-is("${size}v${size}")`);
  if (venue) await page.fill('input[aria-label="Saha"]', venue);
  if (fee) await page.fill('input[aria-label="Saha ücreti"]', String(fee));
  await shot?.("1-bilgiler");
  await next(page);
  // Grupta rakip adımı yok
  await page.waitForSelector('h2:text-is("Rakip"), h2:text-is("Gelenler")');
  if (await page.locator('h2:text-is("Rakip")').count()) {
    if (opponent || appRival) {
      await page.click('button:has-text("Rakip belli")');
      if (opponent) {
        await page.click('button:text-is("Uygulamada yok")');
        await page.fill('input[aria-label="Rakip adı"]', opponent);
      } else {
        await page.fill('input[aria-label="Takım ara"]', appRival);
        await page.waitForSelector(`li button:has-text("${appRival}")`);
        await shot?.("2-rakip-arama");
        await page.click(`li button:has-text("${appRival}")`);
      }
    }
    await shot?.("2-rakip");
    await next(page);
  }
  await heading(page, "Gelenler");
  for (const n of pick) await page.locator(`li button:has-text("${n}")`).first().click();
  if (guest) {
    await page.fill('input[aria-label="Misafir adı"]', guest.name);
    if (guest.position) await page.selectOption('select[aria-label="Misafir mevkisi"]', guest.position);
    await page.click('button:text-is("Ekle")');
  }
  await shot?.("3-gelenler");
  await next(page);
  await heading(page, "Son kontrol");
  await shot?.("4-son-kontrol");
  if (submit) await submitSetup(page);
}

export async function submitSetup(page) {
  await page.click('button:text-is("Maçı oluştur"), button:text-is("Maçı kur")');
  await page.waitForURL(/\/m\/[0-9a-f-]{36}/, { timeout: 30000 });
}
