"use client";

import { useRef, useState } from "react";
import { Button } from "./ui";
import { PHOTO_ASPECT, clampCropOffset, cropBoxFromView, minCropScale } from "@/lib/card-photo";

const FRAME_W = 300;
const FRAME_H = Math.round(FRAME_W / PHOTO_ASPECT);

/** Kart fotoğrafı için elle kırpma: sürükle + yakınlaştır; çerçeve kartın fotoğraf alanı oranında */
export function PhotoCropper({
  img,
  onConfirm,
  onSkip,
  onCancel,
}: {
  img: HTMLImageElement;
  onConfirm: (box: { x: number; y: number; width: number; height: number }) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const min = minCropScale(w, h, FRAME_W, FRAME_H);
  const [zoom, setZoom] = useState(1); // 1 = çerçeveyi kaplayan en küçük boyut
  const [pos, setPos] = useState(() => clampCropOffset((FRAME_W - w * min) / 2, (FRAME_H - h * min) / 4, w, h, FRAME_W, FRAME_H, min));
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const scale = min * zoom;

  function changeZoom(z: number) {
    const ns = min * z;
    // Çerçevenin merkezindeki nokta sabit kalsın
    const cx = (FRAME_W / 2 - pos.x) / scale;
    const cy = (FRAME_H / 2 - pos.y) / scale;
    setZoom(z);
    setPos(clampCropOffset(FRAME_W / 2 - cx * ns, FRAME_H / 2 - cy * ns, w, h, FRAME_W, FRAME_H, ns));
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted">Yüzün çerçevede olacak şekilde sürükle ve yakınlaştır</p>
      <div
        className="relative mx-auto touch-none select-none overflow-hidden rounded-2xl bg-black"
        style={{ width: FRAME_W, height: FRAME_H }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPos(clampCropOffset(d.ox + e.clientX - d.px, d.oy + e.clientY - d.py, w, h, FRAME_W, FRAME_H, scale));
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
          style={{ left: pos.x, top: pos.y, width: w * scale, height: h * scale }}
        />
      </div>
      <input
        type="range"
        min={1}
        max={4}
        step={0.01}
        value={zoom}
        onChange={(e) => changeZoom(Number(e.target.value))}
        className="w-full"
        aria-label="Yakınlaştır"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => onConfirm(cropBoxFromView(pos.x, pos.y, FRAME_W, FRAME_H, scale))}>Kırp ve devam</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Vazgeç</Button>
      </div>
      <button type="button" onClick={onSkip} className="mx-auto block text-xs text-muted underline">Kırpmadan devam et</button>
    </div>
  );
}
