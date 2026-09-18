"use client";

import { useEffect, useRef } from "react";
import {
  OVERLAY_KIND_COLORS,
  type LiveOverlay,
  type OverlayBox,
} from "@acs/types";

/** Yangilanish kechiksa box yo'qolmasin; juda uzoq eski bo'lsa yashirmaymiz. */
const STALE_MS = 2_500;
/** Keyingi yangilanishni kutmasdan biroz oldinga surish (ms). */
const EXTRAPOLATE_MS = 500;

const LABELS_UZ: Record<OverlayBox["kind"], string> = {
  person: "Odam",
  fire: "Olov",
  smoke: "Tutun",
  cigarette: "Sigaret",
  face: "Yuz",
  other: "",
};

type BBox = [number, number, number, number];

interface OverlaySnapshot {
  overlay: LiveOverlay;
  receivedAt: number;
}

/**
 * Video ustiga normallashtirilgan (x,y,w,h) box chizadi.
 * object-contain letterbox ni hisobga oladi.
 */
export function DetectionOverlay({
  videoRef,
  overlay,
  receivedAt,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlay: LiveOverlay | null;
  receivedAt: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<{
    current: OverlaySnapshot | null;
    previous: OverlaySnapshot | null;
  }>({ current: null, previous: null });

  useEffect(() => {
    if (!overlay || receivedAt === null) return;

    const history = historyRef.current;
    if (
      history.current &&
      history.current.receivedAt !== receivedAt
    ) {
      history.previous = history.current;
    }
    history.current = { overlay, receivedAt };
  }, [overlay, receivedAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    let frame = 0;

    const paint = () => {
      frame = requestAnimationFrame(paint);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = video.clientWidth;
      const height = video.clientHeight;
      if (width === 0 || height === 0) return;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      const { current, previous } = historyRef.current;
      if (!current?.overlay.boxes.length) return;
      if (Date.now() - current.receivedAt > STALE_MS) return;

      const content = videoContentRect(video);
      if (!content) return;

      const now = Date.now();
      const boxes = extrapolateBoxes(current, previous, now);

      for (const box of boxes) {
        drawBox(ctx, box, content);
      }
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden
    />
  );
}

function extrapolateBoxes(
  current: OverlaySnapshot,
  previous: OverlaySnapshot | null,
  now: number,
): OverlayBox[] {
  if (!previous) return current.overlay.boxes;

  const dt = current.receivedAt - previous.receivedAt;
  if (dt <= 0) return current.overlay.boxes;

  const lead = Math.min(Math.max(now - current.receivedAt, 0), EXTRAPOLATE_MS);
  const factor = lead / dt;

  const prevByTrack = new Map<number, BBox>();
  for (const box of previous.overlay.boxes) {
    if (box.trackId !== null && box.kind === "person") {
      prevByTrack.set(box.trackId, box.bbox as BBox);
    }
  }

  return current.overlay.boxes.map((box) => {
    if (box.kind !== "person" || box.trackId === null) return box;

    const prev = prevByTrack.get(box.trackId);
    if (!prev) return box;

    const [cx, cy, cw, ch] = box.bbox as BBox;
    const [px, py] = prev;
    return {
      ...box,
      bbox: [
        cx + (cx - px) * factor,
        cy + (cy - py) * factor,
        cw,
        ch,
      ] as BBox,
    };
  });
}

function videoContentRect(video: HTMLVideoElement) {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (!videoWidth || !videoHeight) return null;

  const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  return {
    x: (clientWidth - w) / 2,
    y: (clientHeight - h) / 2,
    w,
    h,
  };
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  box: OverlayBox,
  content: { x: number; y: number; w: number; h: number },
) {
  const [nx, ny, nw, nh] = box.bbox;
  const x = content.x + nx * content.w;
  const y = content.y + ny * content.h;
  const w = nw * content.w;
  const h = nh * content.h;

  const color = OVERLAY_KIND_COLORS[box.kind] ?? OVERLAY_KIND_COLORS.other;
  const thick = box.kind === "fire" || box.kind === "smoke" ? 3 : 2;

  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.strokeRect(x, y, w, h);

  // Person: faqat jins/yosh (남자/여자). "Odam" yozilmaydi.
  let text = "";
  if (box.kind === "person" || box.kind === "face") {
    text = box.subtitle?.trim() || "";
  } else {
    const title = LABELS_UZ[box.kind] || box.label || box.kind;
    const pct = Math.round(box.confidence * 100);
    text = box.subtitle ? `${title} · ${box.subtitle}` : `${title} ${pct}%`;
  }

  if (!text) return;

  ctx.font = "600 11px ui-sans-serif, system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  const metrics = ctx.measureText(text);
  const padX = 5;
  const labelH = 16;
  const labelY = Math.max(0, y - labelH);

  ctx.fillStyle = color;
  ctx.fillRect(x, labelY, metrics.width + padX * 2, labelH);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillText(text, x + padX, labelY + 12);
}
