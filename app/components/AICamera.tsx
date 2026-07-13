"use client";

import { useEffect, useRef } from "react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";


export default function AICamera() {

  const videoRef =
    useRef<HTMLVideoElement>(null);

  const canvasRef =
    useRef<HTMLCanvasElement>(null);



  useEffect(() => {


    async function start() {


      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment"
          }
        });


      if (videoRef.current) {

        videoRef.current.srcObject =
          stream;

      }



      const model =
        await cocoSsd.load();



      setInterval(async () => {


        if (!videoRef.current ||
          !canvasRef.current)
          return;



        const predictions =
          await model.detect(
            videoRef.current
          );



        drawBoxes(predictions);


      }, 500);


    }


    start();


  }, []);





  function drawBoxes(
    predictions: any[]
  ) {


    const video =
      videoRef.current;


    const canvas =
      canvasRef.current;



    if (!video || !canvas)
      return;



    const ctx =
      canvas.getContext("2d");


    if (!ctx)
      return;



    canvas.width =
      video.videoWidth;


    canvas.height =
      video.videoHeight;



    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );



    predictions.forEach(item => {


      const [
        x,
        y,
        width,
        height
      ] = item.bbox;



      ctx.strokeStyle =
        "red";


      ctx.lineWidth =
        3;



      ctx.strokeRect(
        x,
        y,
        width,
        height
      );



      ctx.font =
        "20px Arial";


      ctx.fillStyle =
        "red";



      ctx.fillText(
        `${item.class} ${(item.score * 100).toFixed(0)}%`,
        x,
        y - 5
      );


    });


  }




  return (

    <div
      style={{
        position: "relative"
      }}
    >


      <video

        ref={videoRef}

        autoPlay

        playsInline

        style={{
          width: "100%"
        }}

      />



      <canvas

        ref={canvasRef}

        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%"
        }}

      />



    </div>

  )


}