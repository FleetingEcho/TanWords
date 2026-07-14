import React, { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox, useCursor } from "@react-three/drei";
import { KITCHEN_MANIFEST } from "@/features/scene-lab/kitchenManifest";
import type { KitchenObjectDef } from "@/features/scene-lab/types";

function KitchenObject({ item, selected, weak, onSelect }: { item: KitchenObjectDef; selected: boolean; weak: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const isRound = ["tomato", "plate", "saucepan", "frying_pan", "mixing_bowl", "colander", "mug", "kettle"].includes(item.key);
  return (
    <group name={item.key} position={item.position} onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      {isRound ? (
        <mesh scale={item.size} castShadow receiveShadow>
          <sphereGeometry args={[0.5, 20, 14]} />
          <meshStandardMaterial color={selected ? "#f59e0b" : weak ? "#ef8b79" : item.color} emissive={selected ? "#7c2d12" : "#000000"} emissiveIntensity={selected ? 0.35 : 0} />
        </mesh>
      ) : (
        <RoundedBox args={item.size} radius={0.06} smoothness={2} castShadow receiveShadow>
          <meshStandardMaterial color={selected ? "#f59e0b" : weak ? "#ef8b79" : item.color} emissive={selected ? "#7c2d12" : "#000000"} emissiveIntensity={selected ? 0.35 : 0} />
        </RoundedBox>
      )}
      {selected && <Html center position={[0, item.size[1] / 2 + 0.35, 0]}><span className="pointer-events-none whitespace-nowrap rounded-full bg-background/95 px-2 py-1 text-xs font-semibold shadow">{item.labelEn}</span></Html>}
    </group>
  );
}

function KitchenScene({ selectedKey, weakKeys, onSelect }: { selectedKey: string | null; weakKeys: Set<string>; onSelect: (key: string) => void }) {
  return (
    <>
      <color attach="background" args={["#e8e2d8"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, 7, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh position={[0, -0.06, 0]} receiveShadow><boxGeometry args={[11, 0.1, 8]} /><meshStandardMaterial color="#d8cabb" /></mesh>
      <mesh position={[0, 2.2, -3.35]} receiveShadow><boxGeometry args={[11, 4.5, 0.1]} /><meshStandardMaterial color="#f1ece4" /></mesh>
      <mesh position={[-5.45, 2.2, 0]} receiveShadow><boxGeometry args={[0.1, 4.5, 6.8]} /><meshStandardMaterial color="#ebe4da" /></mesh>
      {KITCHEN_MANIFEST.objects.map((item) => <KitchenObject key={item.key} item={item} selected={selectedKey === item.key} weak={weakKeys.has(item.key)} onSelect={() => onSelect(item.key)} />)}
      <OrbitControls makeDefault target={[0, 1, -0.5]} minDistance={4.5} maxDistance={13} minPolarAngle={0.45} maxPolarAngle={1.45} />
    </>
  );
}

export function KitchenCanvas(props: { selectedKey: string | null; weakKeys?: Set<string>; onSelect: (key: string) => void }) {
  return (
    <div className="h-full min-h-[420px] w-full overflow-hidden rounded-2xl bg-muted">
      <Canvas shadows camera={{ position: [7, 5.2, 8], fov: 46 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
        <Suspense fallback={null}><KitchenScene selectedKey={props.selectedKey} weakKeys={props.weakKeys ?? new Set()} onSelect={props.onSelect} /></Suspense>
      </Canvas>
    </div>
  );
}
