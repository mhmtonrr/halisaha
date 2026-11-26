"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteLogo, saveLogo } from "@/lib/actions";
import { MAX_PHOTO_BYTES } from "@/lib/card-photo";
import { clampLogoOffset, logoPath } from "@/lib/crest";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./Icon";
import { Button } from "./ui";

/** Ekrandaki kırpma çerçevesi (kare) ve kaydedilen görselin kenarı */
const FRAME = 260;
const OUT = 512;

type View = { zoom: number; x: number; y: number };

/** Çerçevede görüneni kare görsele çizer; boş kalan yerler şeffaftır */
function render(img: HTMLImageElement, view: View, scale: number, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const k = size / FRAME;
  ctx.drawImage(img, view.x * k, view.y * k, img.naturalWidth * scale * k, img.naturalHeight * scale * k);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, q));

/** WebP (Safari yazamazsa PNG); depo sınırına sığana dek kalite ve boyut düşer */
async function encode(img: HTMLImageElement, view: View, scale: number): Promise<Blob> {
  for (const size of [OUT, 384, 256]) {
    const c = render(img, view, scale, size);
    for (const q of [0.9, 0.75]) {
      const b = await toBlob(c, "image/webp", q);
      if (!b || b.type !== "image/webp") break;
      if (b.size <= MAX_PHOTO_BYTES) return b;
    }
    const png = await toBlob(c, "image/png");
    if (png && png.size <= MAX_PHOTO_BYTES) return png;
  }
  throw new Error("Görsel küçültülemedi");
}

/**
 * Takım/grup logosu yükleme: görsel seç → kare çerçevede sürükle/yakınlaştır → kaydet (hemen kaydedilir).
 * Başlangıçta görselin tamamı sığar; şeffaflık korunur, arka plan silinmez.
 */
export function LogoUploader({ groupId, uploaded }: { groupId: string; uploaded: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.src); }, [img]);

  /** zoom 1 = görselin tamamı çerçevede */
  const fit = img ? FRAME / Math.max(img.naturalWidth, img.naturalHeight) : 1;
  const scale = fit * view.zoom;

  function place(zoom: number, x: number, y: number, of: HTMLImageElement): View {
    const s = (FRAME / Math.max(of.naturalWidth, of.naturalHeight)) * zoom;
    return { zoom, x: clampLogoOffset(x, of.naturalWidth * s, FRAME), y: clampLogoOffset(y, of.naturalHeight * s, FRAME) };
  }

  async function pick(file: File) {
    setError(null);
    const next = new Image();
    next.src = URL.createObjectURL(file);
    try {
      await next.decode();
      if (!next.naturalWidth || !next.naturalHeight) throw new Error();
      setImg(next);
      setView(place(1, 0, 0, next));
    } catch {
      URL.revokeObjectURL(next.src);
      setError("Görsel açılamadı; PNG, JPG veya WebP seç");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  function changeZoom(zoom: number) {
    if (!img) return;
    const ns = fit * zoom;
    // Çerçevenin merkezindeki nokta sabit kalsın
    const cx = (FRAME / 2 - view.x) / scale;
    const cy = (FRAME / 2 - view.y) / scale;
    setView(place(zoom, FRAME / 2 - cx * ns, FRAME / 2 - cy * ns, img));
  }

  async function save() {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await encode(img, view, scale);
      const { error: upErr } = await createClient()
        .storage.from("logos")
        .upload(logoPath(groupId), blob, { upsert: true, contentType: blob.type, cacheControl: "3600" });
      if (upErr) throw new Error("Logo yüklenemedi");
      const res = await saveLogo(groupId, Date.now());
      if (res.error) throw new Error(res.error);
      setImg(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo yüklenemedi");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Yüklenen logo silinsin mi?")) return;
    setBusy(true);
    setError(null);
    const res = await deleteLogo(groupId);
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {/* name verilmez: dosya, çevreleyen formla gönderilmez */}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }}
      />
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-center text-sm text-red-300">{error}</p>}

      {img ? (
        <>
          <p className="text-center text-xs text-muted">Sürükle ve yakınlaştır; kare içinde kalan kısım logo olur</p>
          <div
            className="relative mx-auto touch-none select-none overflow-hidden rounded-2xl border border-line bg-pitch-950"
            style={{ width: FRAME, height: FRAME, boxSizing: "content-box" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setView(place(view.zoom, d.ox + e.clientX - d.px, d.oy + e.clientY - d.py, img));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: view.x, top: view.y, width: img.naturalWidth * scale, height: img.naturalHeight * scale }}
            />
          </div>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={view.zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-full"
            aria-label="Yakınlaştır"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={save} disabled={busy}>{busy ? "Kaydediliyor…" : "Logoyu kaydet"}</Button>
            <Button type="button" variant="secondary" onClick={() => setImg(null)} disabled={busy}>Vazgeç</Button>
          </div>
        </>
      ) : (
        <div className={uploaded ? "grid grid-cols-2 gap-2" : ""}>
          <Button type="button" variant="secondary" className="w-full" onClick={() => input.current?.click()} disabled={busy}>
            <Icon name="upload" className="text-[20px]" />
            {uploaded ? "Değiştir" : "Görsel seç"}
          </Button>
          {uploaded && (
            <Button type="button" variant="secondary" onClick={remove} disabled={busy}>Logoyu sil</Button>
          )}
        </div>
      )}
      <p className="text-center text-xs text-muted">
        Şeffaf PNG şeffaf kalır. Sadece kullanma hakkın olan, uygun görselleri yükle; logo herkese görünür.
      </p>
    </div>
  );
}
