"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

type FacingMode = "user" | "environment";

export default function FaceDetectorAI() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const stopStream = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setLoading(true);
      setError(null);

      try {
        // Avvalgi streamni to'xtatamiz (kamera almashtirilganda)
        stopStream();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Detektorni faqat birinchi marta yaratamiz, keyin qayta ishlatamiz
        if (!detectorRef.current) {
          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
          );

          // detectorRef.current = await FaceDetector.createFromOptions(vision, {
          //   baseOptions: {
          //     modelAssetPath: "/models/blaze_face_full_range.tflite",
          //     delegate: "GPU",
          //   },
          //   runningMode: "VIDEO",
          // });
          detectorRef.current = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/models/blaze_face_full_range.tflite",
              delegate: "CPU", // GPU o'rniga
            },
            runningMode: "VIDEO",
          });
        }

        if (cancelled) return;

        intervalRef.current = setInterval(() => {
          if (!videoRef.current || !detectorRef.current) return;
          if (videoRef.current.readyState < 2) return; // video hali tayyor emas

          const result = detectorRef.current.detectForVideo(
            videoRef.current,
            Date.now()
          );
          console.log("FACE:", result);
        }, 500);

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error ? err.message : "Kamerani ishga tushirib bo'lmadi"
        );
        setLoading(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, stopStream]);

  // Komponent butunlay o'chirilganda detektorni tozalash
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
    <div style={{ position: "relative" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
      />

      {loading && <p>Kamera yuklanmoqda...</p>}
      {error && <p style={{ color: "red" }}>Xatolik: {error}</p>}

      <button onClick={toggleCamera} disabled={loading}>
        {facingMode === "environment" ? "Old kameraga o'tish" : "Orqa kameraga o'tish"}
      </button>
    </div>
  );
}