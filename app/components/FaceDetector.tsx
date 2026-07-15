"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FaceDetector, FilesetResolver, Detection } from "@mediapipe/tasks-vision";

type FacingMode = "user" | "environment";

export default function FaceDetectorAI() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [status, setStatus] = useState("Boshlanmoqda...");
  const [error, setError] = useState<string | null>(null);
  const [faceCount, setFaceCount] = useState(0);

  const stopStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const drawDetections = (detections: Detection[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 4;
    ctx.font = "20px sans-serif";
    ctx.fillStyle = "#00ff00";

    detections.forEach((det) => {
      const box = det.boundingBox;
      if (!box) return;
      ctx.strokeRect(box.originX, box.originY, box.width, box.height);
      const score = det.categories[0]?.score ?? 0;
      ctx.fillText(`${(score * 100).toFixed(0)}%`, box.originX, box.originY - 8);
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setError(null);
      setStatus("HTTPS/kamera ruxsati tekshirilmoqda...");

      // HTTPS talabini tekshirish (localhost bundan mustasno)
      if (
        typeof window !== "undefined" &&
        window.location.protocol !== "https:" &&
        window.location.hostname !== "localhost"
      ) {
        setError("Kamera faqat HTTPS orqali ishlaydi. Saytni https:// orqali oching.");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Bu brauzer kamerani qo'llab-quvvatlamaydi.");
        return;
      }

      try {
        stopStream();
        setStatus("Kamera ochilmoqda...");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise<void>((resolve) => {
            if (!videoRef.current) return resolve();
            videoRef.current.onloadedmetadata = () => resolve();
          });
          await videoRef.current.play();
        }

        if (!detectorRef.current) {
          setStatus("Model yuklanmoqda (WASM)...");
          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
          );

          setStatus("Model yuklanmoqda (tflite)...");

          // Avval GPU, muvaffaqiyatsiz bo'lsa CPU'ga o'tamiz
          try {
            detectorRef.current = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/blaze_face_full_range.tflite",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              minDetectionConfidence: 0.5,
            });
          } catch {
            console.warn("GPU delegate ishlamadi, CPU'ga o'tilmoqda");
            detectorRef.current = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/blaze_face_full_range.tflite",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              minDetectionConfidence: 0.5,
            });
          }
        }

        if (cancelled) return;
        setStatus("Ishlamoqda");

        const loop = () => {
          const video = videoRef.current;
          const detector = detectorRef.current;

          if (
            video &&
            detector &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
          ) {
            try {
              const result = detector.detectForVideo(video, performance.now());
              setFaceCount(result.detections.length);
              drawDetections(result.detections);
            } catch (e) {
              console.error("Aniqlashda xato:", e);
            }
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error(err);
        let msg = err instanceof Error ? err.message : "Noma'lum xato";

        if (err instanceof DOMException) {
          if (err.name === "NotAllowedError") {
            msg = "Kamera ruxsati berilmadi. Brauzer sozlamalaridan ruxsat bering.";
          } else if (err.name === "NotFoundError") {
            msg = "Kamera topilmadi.";
          } else if (err.name === "NotReadableError") {
            msg = "Kamera boshqa dastur tomonidan band qilingan.";
          } else if (err.name === "OverconstrainedError") {
            msg = `So'ralgan kamera (${facingMode}) topilmadi.`;
          }
        }

        setError(msg);
        setStatus("Xato");
      }
    }

    init();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, stopStream]);

  useEffect(() => {
    return () => {
      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, []);

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  return (
    <div style={{ position: "relative", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ position: "relative", width: "100%" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            display: "block",
            transform: facingMode === "user" ? "scaleX(-1)" : "none",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: facingMode === "user" ? "scaleX(-1)" : "none",
            pointerEvents: "none",
          }}
        />
      </div>

      <div style={{ padding: 8, fontFamily: "monospace", fontSize: 14 }}>
        <p>Holat: {status}</p>
        <p>Aniqlangan yuzlar: {faceCount}</p>
        {error && <p style={{ color: "red" }}>Xato: {error}</p>}
      </div>

      <button onClick={toggleCamera} style={{ padding: "8px 16px" }}>
        {facingMode === "environment" ? "🤳 Old kameraga o'tish" : "📷 Orqa kameraga o'tish"}
      </button>
    </div>
  );
}