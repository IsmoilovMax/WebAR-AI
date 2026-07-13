"use client";

import { useEffect, useRef, useState } from "react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { DetectedObject } from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";

function getLightLevel(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  canvas.width = 50;
  canvas.height = 50;
  ctx.drawImage(video, 0, 0, 50, 50);
  const pixels = ctx.getImageData(0, 0, 50, 50).data;

  let value = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    value += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
  }

  value /= pixels.length / 4;

  if (value < 60) return "🌙 Dark";
  if (value < 160) return "💡 Normal";
  return "☀️ Bright";
}

export default function AICamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const [light, setLight] = useState("");

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stream: MediaStream | undefined;
    let model: cocoSsd.ObjectDetection | undefined;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      model = await cocoSsd.load();
      interval = setInterval(async () => {
        if (!videoRef.current || !model) return;

        setObjects(await model.detect(videoRef.current));
        setLight(getLightLevel(videoRef.current));
      }, 1000);
    }

    void start();

    return () => {
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach((track) => track.stop());
      model?.dispose();
    };
  }, []);

  return (
    <div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: "100%" }}
      />
      <h2>Light: {light}</h2>
      {objects.map((object) => (
        <div key={`${object.class}-${object.bbox.join("-")}`}>
          {object.class} {(object.score * 100).toFixed(1)}%
        </div>
      ))}
    </div>
  );
}
