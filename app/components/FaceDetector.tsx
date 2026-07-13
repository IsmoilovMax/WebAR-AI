"use client";

import {
  useEffect,
  useRef
} from "react";


import {
  FaceDetector,
  FilesetResolver
}
  from "@mediapipe/tasks-vision";



export default function FaceDetectorAI() {


  const videoRef =
    useRef<HTMLVideoElement>(null);


  useEffect(() => {


    async function start() {


      const stream =
        await navigator.mediaDevices.getUserMedia({

          video: {
            facingMode: "environment"
          }

        });


      videoRef.current!.srcObject =
        stream;



      const vision =
        await FilesetResolver.forVisionTasks(

          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"

        );



      const detector =
        await FaceDetector.createFromOptions(

          vision,

          {

            baseOptions: {

              modelAssetPath:
                "/models/face_detector.task"

            },

            runningMode: "VIDEO"

          }

        );



      setInterval(() => {


        const result =
          detector.detectForVideo(

            videoRef.current!,

            Date.now()

          );



        console.log(
          "FACE:",
          result
        );



      }, 500);



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