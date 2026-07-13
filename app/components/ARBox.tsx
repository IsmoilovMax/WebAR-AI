"use client";

export default function ARBox({
  position = [0, 0, 0],
  color = "red"
}: any) {
  return (
    <mesh
      position={position}
    >
      <boxGeometry
        args={[
          1,
          1,
          1
        ]}
      />
      <meshStandardMaterial
        color={color}
      />
    </mesh>

  )

}