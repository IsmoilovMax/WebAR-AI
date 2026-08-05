"use client";

type ARBoxProps = {
  position?: [number, number, number];
  color?: string;
}

function ARBox({ position = [0, 0, 0], color = "red" }: ARBoxProps) {
  return (
    <mesh position={position} >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

export default ARBox;