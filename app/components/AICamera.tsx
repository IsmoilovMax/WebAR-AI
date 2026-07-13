"use client";

import { useEffect, useRef, useState } from "react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";

export default function AICamera() {

  const videoRef = useRef<HTMLVideoElement>(null);
  const [objects, setObjects] = useState<any[]>([]);
  const [light, setLight] = useState("");

  useEffect(() => {

    async function start() {

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment"
          }
        });


      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }


      const model =
        await cocoSsd.load();


      setInterval(async () => {

        if (!videoRef.current)
          return;


        const result =
          await model.detect(videoRef.current);


        setObjects(result);


        checkLight();


      }, 1000);

    }


    start();


  }, []);



  function checkLight() {

    const canvas = document.createElement("canvas");

    const ctx = canvas.getContext("2d");

    if (!ctx || !videoRef.current)
      return;


    canvas.width = 50;
    canvas.height = 50;


    ctx.drawImage(
      videoRef.current,
      0,
      0,
      50,
      50
    );


    const pixels =
      ctx.getImageData(
        0,
        0,
        50,
        50
      ).data;


    let value = 0;


    for (
      let i = 0;
      i < pixels.length;
      i += 4
    ) {

      value +=
        (
          pixels[i] +
          pixels[i + 1] +
          pixels[i + 2]
        ) / 3;

    }


    value =
      value / (pixels.length / 4);


    if (value < 60)
      setLight("🌙 Dark");

    else if (value < 160)
      setLight("💡 Normal");

    else
      setLight("☀️ Bright");


  }



  return (
    <div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: "100%"
        }}
      />


      <h2>
        Light: {light}
      </h2>


      {
        objects.map((obj, i) => (
          <div key={i}>
            {obj.class}
            {" "}
            {(obj.score * 100).toFixed(1)}%
          </div>
        ))
      }


    </div>
  )

}