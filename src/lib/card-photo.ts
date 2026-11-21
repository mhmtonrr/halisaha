// Kart fotoğrafı: saf yardımcılar (tarayıcı tuvali ve depo dışında; testli).

/** Depodaki dosya yolu: kişinin kendi klasöründe tek dosya (her yüklemede üzerine yazılır) */
export function cardPhotoPath(userId: string) {
  return `${userId}/card`;
}

/** Kaydedilecek herkese açık adres; `?v=` önbellek kırıcı (aynı yol yeniden yüklenince kart yeni görseli alsın) */
export function cardPhotoUrl(supabaseUrl: string, userId: string, version: number) {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/avatars/${cardPhotoPath(userId)}?v=${Math.floor(version)}`;
}

/** Adres bu kişinin kendi depo dosyasını mı gösteriyor (veritabanındaki `photo_url_ok` ile aynı kural) */
export function isOwnCardPhotoUrl(url: string, supabaseUrl: string, userId: string) {
  const base = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/avatars/${userId}/`;
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\//.test(base) || url.length > 300 || !url.startsWith(base)) return false;
  return /^[A-Za-z0-9._-]+(\?v=[0-9]+)?$/.test(url.slice(base.length));
}

/** Gerçekten şeffaf piksel var mı (RGBA dizisi): en az %1'i belirgin şeffafsa evet → arka plan kaldırma atlanır */
export function hasTransparency(rgba: ArrayLike<number>, minShare = 0.01) {
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return false;
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 200) clear++;
  return clear / pixels >= minShare;
}

/** Görünür (alfa > eşik) piksellerin çerçevesi; hiç yoksa null */
export function alphaBounds(rgba: ArrayLike<number>, width: number, height: number, threshold = 16) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Modelin yumuşak maskesini sertleştirir (yerinde): alfa `lo` ve altı → tam şeffaf (arka plan kalıntısı),
 * `hi` ve üstü → tam opak (kişi yarı saydam görünmesin); arası doğrusal (kenarda ince yumuşaklık kalsın).
 */
export function hardenAlpha(rgba: { length: number; [i: number]: number }, lo = 96, hi = 176) {
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    rgba[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
  }
  return rgba;
}

/** En-boy oranını koruyarak sınırlara sığdırır (büyütmez) */
export function fitWithin(width: number, height: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Kartın fotoğraf alanının oranı (genişlik/yükseklik) — arka plan kaldırılamazsa düz kırpma bu orana yapılır */
export const PHOTO_ASPECT = 0.85;

/** Ortadan, üst kısmı (yüz) koruyarak verilen orana kırpma çerçevesi */
export function centerCrop(width: number, height: number, aspect = PHOTO_ASPECT) {
  if (width / height > aspect) {
    const w = Math.round(height * aspect);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / aspect);
  // Portrede yüz genelde üstte: dikey fazlanın %25'i üstten kesilir
  return { x: 0, y: Math.round((height - h) * 0.25), width, height: h };
}

/** Depo sınırı 512 KB; biraz pay bırak */
export const MAX_PHOTO_BYTES = 500 * 1024;
