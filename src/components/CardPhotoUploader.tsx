"use client";
import { Icon } from "@/components/Icon";

import { useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CardFace } from "./PlayerCard";
import { PhotoCropper } from "./PhotoCropper";
import { Button } from "./ui";
import { createClient } from "@/lib/supabase/client";
import { deleteCardPhoto, saveCardPhoto } from "@/lib/actions";
import { MAX_PHOTO_BYTES, alphaBounds, cardPhotoPath, centerCrop, fitWithin, cleanEdges, hardenAlpha, hasTransparency, keepMainBlobs } from "@/lib/card-photo";

type Preview = Omit<ComponentProps<typeof CardFace>, "photoUrl" | "compact" | "fontSize" | "className">;
type Box = { x: number; y: number; width: number; height: number };
/** Dışarıdan (karşılama sihirbazı) bekleyen fotoğrafı kaydettirmek için; false = kaydedilemedi, hata ekranda */
export type CardPhotoHandle = { savePending: () => Promise<boolean> };

/** İşlemeden önce büyük fotoğraf bu boyuta indirilir (model hızı/bellek) */
const INPUT_MAX = 1280;
/** Kayıtlı görselin en büyük boyutu (kart alanı küçük; ~100-200 KB) */
const OUT_W = 480;
const OUT_H = 600;

function loadImage(src: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel açılamadı")); };
    img.src = url;
  });
}

function canvasOf(src: CanvasImageSource, sw: number, sh: number, box: Box = { x: 0, y: 0, width: sw, height: sh }, max = { w: INPUT_MAX, h: INPUT_MAX }) {
  const size = fitWithin(box.width, box.height, max.w, max.h);
  const c = document.createElement("canvas");
  c.width = size.width;
  c.height = size.height;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, box.x, box.y, box.width, box.height, 0, 0, size.width, size.height);
  return c;
}

const pixels = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;

/** Şeffaf kenarları kırpar ve kayıt boyutuna indirir */
function trimmed(c: HTMLCanvasElement) {
  const box = alphaBounds(pixels(c), c.width, c.height);
  if (!box) throw new Error("Fotoğrafta kişi bulunamadı");
  return canvasOf(c, c.width, c.height, box, { w: OUT_W, h: OUT_H });
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, q));

/** WebP'ye çevirir (Safari WebP yazamaz → PNG); depo sınırına sığana dek kaliteyi/boyutu düşürür */
async function encode(c: HTMLCanvasElement): Promise<Blob> {
  let canvas = c;
  for (let i = 0; i < 8; i++) {
    for (const q of [0.85, 0.7, 0.55]) {
      const b = await toBlob(canvas, "image/webp", q);
      if (b && b.type !== "image/webp") break; // tarayıcı WebP desteklemiyor
      if (b && b.size <= MAX_PHOTO_BYTES) return b;
    }
    const png = await toBlob(canvas, "image/png");
    if (png && png.type === "image/png" && png.size <= MAX_PHOTO_BYTES) return png;
    canvas = canvasOf(canvas, canvas.width, canvas.height, undefined, { w: canvas.width * 0.8, h: canvas.height * 0.8 });
  }
  throw new Error("Fotoğraf küçültülemedi");
}

/**
 * Kart fotoğrafı: seç → arka planı tarayıcıda kaldır (fotoğraf sunucuya ham gitmez) → kartta önizle → Kaydet / Başka fotoğraf.
 * Model (~80 MB) sadece fotoğraf seçilince indirilir. Şeffaf PNG/WebP yüklenirse işlem atlanır; model çalışmazsa düz kırpılır.
 */
export function CardPhotoUploader({
  userId, currentUrl, preview, handleRef, onWorkingChange,
}: {
  userId: string;
  currentUrl: string | null;
  preview: Preview;
  handleRef?: Ref<CardPhotoHandle>;
  /** Kırpma ya da işleme sürerken true */
  onWorkingChange?: (working: boolean) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; img: HTMLImageElement } | null>(null);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const working = busy || !!pending;
  useEffect(() => { onWorkingChange?.(working); }, [working, onWorkingChange]);

  /** Seçilen dosyayı açıp kırpma adımına geçer */
  async function pick(file: File) {
    setError(null);
    setNote(null);
    setResult(null);
    if (!file.type.startsWith("image/")) return setError("Bir fotoğraf seç");
    try {
      const blobImg = await loadImage(file);
      // Kırpıcıda gösterim için kalıcı adres (loadImage adresi hemen bırakıyor)
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode().catch(() => undefined);
      setPending({ file, img: img.naturalWidth ? img : blobImg });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fotoğraf açılamadı");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  function closePending() {
    if (pending) URL.revokeObjectURL(pending.img.src);
    setPending(null);
  }

  async function process(file: File, img: HTMLImageElement, crop?: Box) {
    setBusy(true);
    try {
      setStatus("Fotoğraf hazırlanıyor…");
      const base = crop
        ? canvasOf(img, img.naturalWidth, img.naturalHeight, crop)
        : canvasOf(img, img.naturalWidth, img.naturalHeight);
      let out: HTMLCanvasElement;
      if (/png|webp/.test(file.type) && hasTransparency(pixels(base))) {
        out = trimmed(base); // zaten dekupe edilmiş
      } else {
        try {
          setStatus("Arka plan kaldırılıyor…");
          const { removeBackground } = await import("@imgly/background-removal");
          const input = (await toBlob(base, "image/jpeg", 0.92))!;
          const cut = await removeBackground(input, {
            model: "isnet_fp16", // quint8 düşük kontrastta (beyaz duvar) kararsız, yüzü yarı saydam bırakıyordu
            output: { format: "image/png" },
            progress: (key, current, total) => {
              if (key.startsWith("fetch") && total > 0) setStatus(`Yapay zekâ modeli indiriliyor… %${Math.round((current / total) * 100)}`);
              else setStatus("Arka plan kaldırılıyor…");
            },
          });
          const cutImg = await loadImage(cut);
          const cutCanvas = canvasOf(cutImg, cutImg.naturalWidth, cutImg.naturalHeight);
          // Yumuşak maske yüzü yarı saydam, arka planı yarım silinmiş bırakabiliyor → sertleştir
          const ctx = cutCanvas.getContext("2d")!;
          const data = ctx.getImageData(0, 0, cutCanvas.width, cutCanvas.height);
          hardenAlpha(data.data);
          keepMainBlobs(data.data, data.width, data.height); // arka plan adacıkları
          cleanEdges(data.data, data.width, data.height); // kenar halkası + renk kirliliği
          ctx.putImageData(data, 0, 0);
          out = trimmed(cutCanvas);
        } catch (e) {
          console.warn("Arka plan kaldırılamadı", e);
          const crop = centerCrop(base.width, base.height);
          out = canvasOf(base, base.width, base.height, crop, { w: OUT_W, h: OUT_H });
          setNote("Arka plan bu cihazda kaldırılamadı; fotoğraf düz kırpıldı. İstersen arka planı olmayan bir fotoğraf (şeffaf PNG) seçebilirsin.");
        }
      }
      setStatus("Sıkıştırılıyor…");
      const blob = await encode(out);
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fotoğraf işlenemedi");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  async function save(refresh = true) {
    if (!result) return true;
    setBusy(true);
    setError(null);
    setStatus("Kaydediliyor…");
    const { error: upErr } = await createClient()
      .storage.from("avatars")
      .upload(cardPhotoPath(userId), result.blob, { upsert: true, contentType: result.blob.type, cacheControl: "3600" });
    const res = upErr ? { error: "Fotoğraf yüklenemedi" } : await saveCardPhoto(Date.now());
    setBusy(false);
    setStatus(null);
    if (res.error) {
      setError(res.error);
      return false;
    }
    setResult(null);
    setNote(null);
    if (refresh) router.refresh();
    return true;
  }

  // Ardından sayfa değişeceği için yenileme yapılmaz
  useImperativeHandle(handleRef, () => ({ savePending: () => save(false) }));

  async function remove() {
    if (!confirm("Kart fotoğrafın silinsin mi?")) return;
    setBusy(true);
    setError(null);
    const res = await deleteCardPhoto();
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  const shown = result?.url ?? currentUrl;

  if (pending) {
    const { file, img } = pending;
    return (
      <PhotoCropper
        img={img}
        onConfirm={(box) => { setPending(null); process(file, img, box).finally(() => URL.revokeObjectURL(img.src)); }}
        onSkip={() => { setPending(null); process(file, img).finally(() => URL.revokeObjectURL(img.src)); }}
        onCancel={closePending}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <CardFace {...preview} photoUrl={shown} fontSize="17px" />
      </div>
      {status && <p className="text-center text-sm text-muted" aria-live="polite">{status}</p>}
      {note && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">{note}</p>}
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-center text-sm text-red-300">{error}</p>}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }}
      />
      {result ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" onClick={() => save()} disabled={busy}>{busy ? "…" : "Kaydet"}</Button>
          <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>Başka fotoğraf</Button>
        </div>
      ) : (
        <div className={currentUrl ? "grid grid-cols-2 gap-2" : ""}>
          <Button type="button" variant="secondary" className="w-full" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "İşleniyor…" : currentUrl ? "Fotoğrafı değiştir" : <><Icon name="photo_camera" className="text-[20px]" />Fotoğraf seç</>}
          </Button>
          {currentUrl && (
            <Button type="button" variant="secondary" onClick={remove} disabled={busy}>Fotoğrafı sil</Button>
          )}
        </div>
      )}
      <p className="text-center text-xs text-muted">
        Arka plan telefonunda/bilgisayarında kaldırılır; fotoğrafın sadece kartında görünür. İlk seferde ~80 MB model indirilir (sonra önbellekte).
      </p>
    </div>
  );
}
