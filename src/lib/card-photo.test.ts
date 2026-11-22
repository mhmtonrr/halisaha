import { describe, expect, it } from "vitest";
import { alphaBounds, cardPhotoUrl, centerCrop, fitWithin, hardenAlpha, hasTransparency, isOwnCardPhotoUrl } from "./card-photo";

const SB = "https://abc123.supabase.co";
const UID = "11111111-2222-3333-4444-555555555555";

function rgba(w: number, h: number, opaque: (x: number, y: number) => boolean) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[(y * w + x) * 4 + 3] = opaque(x, y) ? 255 : 0;
  return a;
}

describe("kart fotoğrafı adresi", () => {
  it("kendi dosyasını kabul eder, başkasınınkini ve dış adresi reddeder", () => {
    const url = cardPhotoUrl(SB + "/", UID, 1700000000000);
    expect(url).toBe(`${SB}/storage/v1/object/public/avatars/${UID}/card?v=1700000000000`);
    expect(isOwnCardPhotoUrl(url, SB, UID)).toBe(true);
    expect(isOwnCardPhotoUrl(url, SB, "99999999-2222-3333-4444-555555555555")).toBe(false);
    expect(isOwnCardPhotoUrl("https://evil.com/x.webp", SB, UID)).toBe(false);
    expect(isOwnCardPhotoUrl(`${SB}/storage/v1/object/public/avatars/${UID}/../x`, SB, UID)).toBe(false);
    expect(isOwnCardPhotoUrl(`${SB}/storage/v1/object/public/avatars/${UID}/card?v=1&x=2`, SB, UID)).toBe(false);
  });
});

describe("şeffaflık ve kırpma", () => {
  it("şeffaf piksel oranını algılar", () => {
    expect(hasTransparency(rgba(10, 10, () => true))).toBe(false);
    expect(hasTransparency(rgba(10, 10, (x) => x > 2))).toBe(true);
  });

  it("görünür piksellerin çerçevesini bulur", () => {
    expect(alphaBounds(rgba(10, 8, (x, y) => x >= 2 && x <= 5 && y >= 3 && y <= 6), 10, 8)).toEqual({ x: 2, y: 3, width: 4, height: 4 });
    expect(alphaBounds(rgba(4, 4, () => false), 4, 4)).toBeNull();
  });

  it("sığdırır ama büyütmez", () => {
    expect(fitWithin(2000, 1000, 500, 600)).toEqual({ width: 500, height: 250 });
    expect(fitWithin(100, 100, 500, 600)).toEqual({ width: 100, height: 100 });
  });

  it("yatayı ortadan, dikeyi üste yakın kırpar", () => {
    expect(centerCrop(2000, 1000, 1)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
    expect(centerCrop(1000, 2000, 1)).toEqual({ x: 0, y: 250, width: 1000, height: 1000 });
  });
});

describe("hardenAlpha", () => {
  it("kalıntıyı siler, kişiyi tam opak yapar, kenarı yumuşak bırakır; rengi değiştirmez", () => {
    const px = [10, 20, 30, 60, 10, 20, 30, 150, 10, 20, 30, 200, 10, 20, 30, 136];
    hardenAlpha(px);
    expect(px).toEqual([10, 20, 30, 0, 10, 20, 30, 172, 10, 20, 30, 255, 10, 20, 30, 128]);
  });
});

import { clampCropOffset, cropBoxFromView, minCropScale } from "./card-photo";

describe("elle kırpma", () => {
  it("görsel çerçeveyi kaplar, konum sınırlanır, kutu kaynak pikselinde", () => {
    const s = minCropScale(1000, 2000, 340, 400); // 0.34 (görsel 340×680)
    expect(s).toBeCloseTo(0.34);
    const o = clampCropOffset(50, -9999, 1000, 2000, 340, 400, s);
    expect(o.x).toBe(0);
    expect(o.y).toBeCloseTo(400 - 680);
    const box = cropBoxFromView(o.x, o.y, 340, 400, s);
    expect(box).toEqual({ x: 0, y: 824, width: 1000, height: 1176 });
  });
});
