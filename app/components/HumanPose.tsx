"use client";

import { useEffect, useRef } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export default function HumanPose() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function start() {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment"
          }
        });

      videoRef.current!.srcObject = stream;

      const vision =
        await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );

      const pose = await PoseLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath:
              "/pose_landmarker.task"
          },
          runningMode: "VIDEO"
        });

      setInterval(() => {
        const result =
          pose.detectForVideo(
            videoRef.current!,
            Date.now()
          );
        console.log(result);
      }, 300);
    }
    start();
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      style={{
        width: "100%"
      }}
    />
  )
}