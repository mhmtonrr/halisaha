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

/** Elle kırpma: görsel çerçeveye `scale` (çerçeve pikseli / kaynak pikseli) ile yerleşir; `ox,oy` görselin çerçevedeki sol-üst konumu */
export function minCropScale(imgW: number, imgH: number, frameW: number, frameH: number) {
  return Math.max(frameW / imgW, frameH / imgH);
}

/** Görselin çerçeveyi her zaman tamamen kaplaması için konumu sınırlar */
export function clampCropOffset(ox: number, oy: number, imgW: number, imgH: number, frameW: number, frameH: number, scale: number) {
  return {
    x: Math.min(0, Math.max(frameW - imgW * scale, ox)),
    y: Math.min(0, Math.max(frameH - imgH * scale, oy)),
  };
}

/** Çerçevenin kaynak görseldeki karşılığı (piksel) */
export function cropBoxFromView(ox: number, oy: number, frameW: number, frameH: number, scale: number) {
  return { x: Math.round(-ox / scale) || 0, y: Math.round(-oy / scale) || 0, width: Math.round(frameW / scale), height: Math.round(frameH / scale) };
}

/**
 * Kişi dışındaki kalıntıları siler (yerinde): alfası eşiğin üstünde bağlantılı bölgelerden en büyüğü
 * (ve en büyüğün `keepShare` oranından büyük olanlar, ör. ayrı duran kol) kalır; geri kalan adacıklar şeffaflaşır.
 */
export function keepMainBlobs(rgba: { length: number; [i: number]: number }, width: number, height: number, threshold = 128, keepShare = 0.15) {
  const n = width * height;
  const label = new Int32Array(n); // 0 = etiketsiz
  const sizes: number[] = [0];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (label[start] || rgba[start * 4 + 3] <= threshold) continue;
    const id = sizes.length;
    let size = 0, sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % width, y = (p - x) / width;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb) {
        if (q >= 0 && !label[q] && rgba[q * 4 + 3] > threshold) { label[q] = id; stack[sp++] = q; }
      }
    }
    sizes.push(size);
  }
  const biggest = Math.max(0, ...sizes);
  for (let p = 0; p < n; p++) {
    const id = label[p];
    if (id ? sizes[id] < biggest * keepShare : rgba[p * 4 + 3] > 0) {
      // kalan adacık ya da bir bölgeye bağlanmamış silik piksel (eşik altı) — silik pikseller kenar yumuşaklığı olarak
      // sadece bir bölgenin komşusuysa kalsın
      if (id) rgba[p * 4 + 3] = 0;
    }
  }
  // Hiçbir bölgeye komşu olmayan silik (eşik altı) pikselleri de temizle
  for (let p = 0; p < n; p++) {
    if (label[p] || rgba[p * 4 + 3] === 0) continue;
    const x = p % width, y = (p - x) / width;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const l = label[ny * width + nx];
        if (l && sizes[l] >= biggest * keepShare) { near = true; break; }
      }
    }
    if (!near) rgba[p * 4 + 3] = 0;
  }
  return rgba;
}

/**
 * Kenar temizliği (yerinde): alfayı `radius` piksel aşındırır (arka plan renginin sızdığı dış halka gider),
 * sonra kalan yarı saydam kenar piksellerinin rengini içteki tam opak komşulardan alır (renk kirliliği kalmaz).
 */
export function cleanEdges(rgba: { length: number; [i: number]: number }, width: number, height: number, radius = 1) {
  const n = width * height;
  const alpha = new Uint8Array(n);
  for (let p = 0; p < n; p++) alpha[p] = rgba[p * 4 + 3];
  const eroded = new Uint8Array(alpha);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = alpha[y * width + x];
      for (let dy = -radius; dy <= radius && m; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          // Görsel kenarı "boş" sayılmaz (kesilmiş kişi kenarda erimesin)
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const a = alpha[ny * width + nx];
          if (a < m) m = a;
        }
      }
      eroded[y * width + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (eroded[p] > 0 && eroded[p] < 255) {
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const q = ny * width + nx;
            if (eroded[q] === 255) { r += rgba[q * 4]; g += rgba[q * 4 + 1]; b += rgba[q * 4 + 2]; c++; }
          }
        }
        if (c) { rgba[p * 4] = Math.round(r / c); rgba[p * 4 + 1] = Math.round(g / c); rgba[p * 4 + 2] = Math.round(b / c); }
      }
      rgba[p * 4 + 3] = eroded[p];
    }
  }
  return rgba;
}
