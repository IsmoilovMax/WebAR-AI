"use client";

import {
  Canvas
} from "@react-three/fiber";

import {
  OrbitControls
} from "@react-three/drei";

import ARBox from "./ARBox";



export default function ARScene() {
  return (
    <Canvas
      camera={{
        position: [
          0,
          0,
          5
        ]
      }}
    >
      <ambientLight />
      <ARBox
        position={[
          0,
          0,
          0
        ]}
      />
      <OrbitControls />
    </Canvas>
  )
}