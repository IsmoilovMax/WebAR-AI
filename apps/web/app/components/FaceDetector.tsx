"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  FaceDetector,
  ObjectDetector,
  FilesetResolver,
  Detection,
} from "@mediapipe/tasks-vision";

type FacingMode = "user" | "environment";

// COCO datasetidagi 80 ta obyektdan qaysilari do'kon uchun muhim
// (istasangiz qo'shib/olib tashlashingiz mumkin)
const RELEVANT_OBJECTS = new Set([
  "person",
  "cell phone",
  "tv",
  "laptop",
  "handbag",
  "backpack",
  "bottle",
  "cup",
  "book",
  "chair",
  "knife",
  "scissors",
]);

export default function DetectorAI() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [status, setStatus] = useState("Boshlanmoqda...");
  const [error, setError] = useState<string | null>(null);
  const [faceCount, setFaceCount] = useState(0);
  const [objectLabels, setObjectLabels] = useState<string[]>([]);

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

  const draw = (
    faces: Detection[],
    objects: Detection[]
  ) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "18px sans-serif";
    ctx.lineWidth = 3;

    // Yuzlar — yashil
    ctx.strokeStyle = "#00ff00";
    ctx.fillStyle = "#00ff00";
    faces.forEach((det) => {
      const box = det.boundingBox;
      if (!box) return;
      ctx.strokeRect(box.originX, box.originY, box.width, box.height);
      const score = det.categories[0]?.score ?? 0;
      ctx.fillText(`Yuz ${(score * 100).toFixed(0)}%`, box.originX, box.originY - 8);
    });

    // Obyektlar — sariq
    ctx.strokeStyle = "#ffcc00";
    ctx.fillStyle = "#ffcc00";
    objects.forEach((det) => {
      const box = det.boundingBox;
      if (!box) return;
      const category = det.categories[0];
      if (!category) return;

      ctx.strokeRect(box.originX, box.originY, box.width, box.height);
      ctx.fillText(
        `${category.categoryName} ${(category.score * 100).toFixed(0)}%`,
        box.originX,
        box.originY - 8
      );
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setError(null);
      setStatus("HTTPS/kamera ruxsati tekshirilmoqda...");

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

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );

        // --- Yuz detektori ---
        if (!faceDetectorRef.current) {
          setStatus("Yuz modeli yuklanmoqda...");
          try {
            faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/blaze_face_full_range.tflite",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              minDetectionConfidence: 0.5,
            });
          } catch {
            faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/blaze_face_full_range.tflite",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              minDetectionConfidence: 0.5,
            });
          }
        }

        // --- Obyekt detektori ---
        if (!objectDetectorRef.current) {
          setStatus("Obyekt modeli yuklanmoqda...");
          try {
            objectDetectorRef.current = await ObjectDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/efficientdet_lite0.tflite",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              scoreThreshold: 0.4,
              maxResults: 10,
            });
          } catch {
            objectDetectorRef.current = await ObjectDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/efficientdet_lite0.tflite",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              scoreThreshold: 0.4,
              maxResults: 10,
            });
          }
        }

        if (cancelled) return;
        setStatus("Ishlamoqda");

        const loop = () => {
          const video = videoRef.current;
          const faceDetector = faceDetectorRef.current;
          const objectDetector = objectDetectorRef.current;

          if (
            video &&
            faceDetector &&
            objectDetector &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
          ) {
            try {
              const now = performance.now();
              const faceResult = faceDetector.detectForVideo(video, now);
              const objectResult = objectDetector.detectForVideo(video, now);

              // Faqat do'kon uchun muhim obyektlarni filtrlaymiz
              const filteredObjects = objectResult.detections.filter((d) =>
                RELEVANT_OBJECTS.has(d.categories[0]?.categoryName ?? "")
              );

              setFaceCount(faceResult.detections.length);
              setObjectLabels(
                filteredObjects.map(
                  (d) =>
                    `${d.categories[0]?.categoryName} (${(
                      (d.categories[0]?.score ?? 0) * 100
                    ).toFixed(0)}%)`
                )
              );

              draw(faceResult.detections, filteredObjects);
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
      faceDetectorRef.current?.close();
      objectDetectorRef.current?.close();
      faceDetectorRef.current = null;
      objectDetectorRef.current = null;
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
        <p>Obyektlar: {objectLabels.length > 0 ? objectLabels.join(", ") : "—"}</p>
        {error && <p style={{ color: "red" }}>Xato: {error}</p>}
      </div>

      <button onClick={toggleCamera} style={{ padding: "8px 16px" }}>
        {facingMode === "environment" ? "🤳 Old kameraga o'tish" : "📷 Orqa kameraga o'tish"}
      </button>
    </div>
  );
}