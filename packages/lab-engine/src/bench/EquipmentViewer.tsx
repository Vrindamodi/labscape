import { Bounds, Center, ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { EquipmentKind } from "../engine/equipment";
import { initialState } from "../engine/state";
import { EquipmentModel } from "./Bench3D";

/** What each item holds in the encyclopedia, so glassware is shown in use. */
const SAMPLE: Partial<Record<EquipmentKind, { reagentId: string; volumeMl: number }>> = {
  beaker_100: { reagentId: "cuso4-0.5", volumeMl: 60 },
  beaker_250: { reagentId: "cuso4-0.5", volumeMl: 140 },
  conical_flask_100: { reagentId: "cucl2", volumeMl: 45 },
  test_tube: { reagentId: "cucl2", volumeMl: 6 },
  boiling_tube: { reagentId: "cuso4-0.5", volumeMl: 16 },
  measuring_cylinder_10: { reagentId: "water", volumeMl: 7 },
  measuring_cylinder_50: { reagentId: "water", volumeMl: 36 },
  burette_50: { reagentId: "naoh-0.1", volumeMl: 46 },
  pipette_10: { reagentId: "water", volumeMl: 10 },
  reagent_bottle: { reagentId: "hcl-1", volumeMl: 180 },
  dropper_bottle: { reagentId: "univ", volumeMl: 20 },
  wash_bottle: { reagentId: "water", volumeMl: 200 },
};

export type EquipmentViewerProps = {
  kind: EquipmentKind;
  /** 0 = assembled, 1 = fully exploded. Only the burette has an exploded view. */
  explode?: number;
  highlight?: string | null;
  autoRotate?: boolean;
  reducedMotion?: boolean;
  quality?: "high" | "lite";
};

/** Turntable view of one item, lit like the bench (build plan 2.14). */
export function EquipmentViewer({ kind, explode = 0, highlight = null, autoRotate = true, reducedMotion = false, quality = "high" }: EquipmentViewerProps) {
  const exploded = kind === "burette_50" && explode > 0.001;
  return (
    <Canvas dpr={quality === "high" ? [1, 2] : [1, 1.25]} camera={{ position: [0, 1.2, 4.2], fov: 32 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
      <Environment />
      <hemisphereLight args={["#bcd4ff", "#0b1020", 0.5]} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <pointLight position={[-3, 2, -2]} intensity={8} color="#3a8cff" distance={10} />
      <pointLight position={[3, 1.5, -2]} intensity={5} color="#c46bff" distance={10} />
      {/* Key by kind and mode so the camera re-frames when the item changes. */}
      <Bounds key={`${kind}-${exploded ? "x" : "a"}`} fit clip observe margin={exploded ? 1.05 : 1.25}>
        <Center top>
          {kind === "burette_50" && explode > 0.001 ? <ExplodedBurette explode={explode} highlight={highlight} /> : <Single kind={kind} quality={quality} reducedMotion={reducedMotion} />}
        </Center>
      </Bounds>
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={6} blur={2.4} far={3} color="#000814" />
      <OrbitControls makeDefault autoRotate={autoRotate && !reducedMotion} autoRotateSpeed={1.4} enablePan={false} minDistance={1.2} maxDistance={14} />
    </Canvas>
  );
}

function Environment() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

function Single({ kind, quality, reducedMotion }: { kind: EquipmentKind; quality: "high" | "lite"; reducedMotion: boolean }) {
  const state = useMemo(() => {
    const fill = SAMPLE[kind];
    const s = initialState({ items: [{ id: "x", kind, ...(fill ? { fill } : {}), ...(kind === "watch_glass" ? { reagentId: "mg-ribbon" } : {}) }] });
    const it = s.items.x!;
    if (kind === "bunsen") {
      it.gasOn = true;
      it.airHoleOpen = true;
    }
    if (kind === "splint") it.lit = true;
    return s;
  }, [kind]);
  return <EquipmentModel item={state.items.x!} state={state} quality={quality} reducedMotion={reducedMotion} />;
}

/* ------------------------------------------------------------------ exploded burette */

const H = 3.2; // drawn tube height

function ExplodedBurette({ explode, highlight }: { explode: number; highlight: string | null }) {
  const e = useRef(explode);
  const tube = useRef<THREE.Group>(null);
  const key = useRef<THREE.Group>(null);
  const jet = useRef<THREE.Group>(null);
  useFrame(() => {
    e.current += (explode - e.current) * 0.15;
    const k = e.current;
    tube.current?.position.set(0, 0.25 + k * 0.55, 0);
    key.current?.position.set(k * 0.75, 0, 0);
    key.current?.rotation.set(0, 0, 0);
    jet.current?.position.set(0, -k * 0.5, 0);
  });
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.05, transmission: 1, thickness: 0.05, ior: 1.5, transparent: true, side: THREE.DoubleSide, depthWrite: false }), []);
  const glow = (id: string) => (highlight === id ? { emissive: "#2f80ff", emissiveIntensity: 0.9 } : { emissive: "#000000", emissiveIntensity: 0 });
  const ticks = useMemo(() => Array.from({ length: 51 }, (_, i) => i), []);

  return (
    <group>
      {/* tube + scale */}
      <group ref={tube}>
        <mesh position={[0, H / 2, 0]}>
          <cylinderGeometry args={[0.07, 0.07, H, 24, 1, true]} />
          <primitive object={glass} attach="material" />
        </mesh>
        <mesh position={[0, H * 0.46, 0]}>
          <cylinderGeometry args={[0.058, 0.058, H * 0.92, 20]} />
          <meshStandardMaterial color="#d7e9ff" transparent opacity={highlight === "tube" ? 0.7 : 0.35} {...glow("tube")} />
        </mesh>
        {ticks.map((i) => (
          <mesh key={i} position={[0, H - 0.1 - (i / 50) * (H - 0.25), 0.072]}>
            <boxGeometry args={[i % 10 === 0 ? 0.07 : i % 5 === 0 ? 0.05 : 0.03, 0.006, 0.004]} />
            <meshBasicMaterial color={highlight === "scale" ? "#7cc0ff" : "#e5edff"} />
          </mesh>
        ))}
        {[0, 10, 20, 30, 40, 50].map((v) => (
          <Html key={v} position={[0.14, H - 0.1 - (v / 50) * (H - 0.25), 0.07]} center zIndexRange={[10, 0]}>
            <span className="pointer-events-none text-[10px] font-bold text-white/70">{v}</span>
          </Html>
        ))}
        <Callout at={[-0.12, H * 0.75, 0]} text="Graduated scale" on={highlight === "scale"} side="left" />
        <Callout at={[-0.12, H * 0.3, 0]} text="Precision-bore tube" on={highlight === "tube"} side="left" />
      </group>
      {/* stopcock barrel stays put; the key slides out */}
      <mesh position={[0, 0.2, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.05, 0.26, 20]} />
        <primitive object={glass} attach="material" />
      </mesh>
      <group ref={key}>
        <mesh position={[0, 0.2, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.035, 0.03, 0.3, 16]} />
          <meshStandardMaterial color="#f8f9fa" roughness={0.3} {...glow("stopcock")} />
        </mesh>
        <mesh position={[0.2, 0.2, 0]}>
          <boxGeometry args={[0.05, 0.22, 0.06]} />
          <meshStandardMaterial color="#2f80ff" roughness={0.4} {...glow("stopcock")} />
        </mesh>
        <Callout at={[0.3, 0.2, 0]} text="Stopcock key" on={highlight === "stopcock"} side="right" />
      </group>
      <group ref={jet}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.03, 0.012, 0.3, 16, 1, true]} />
          <meshStandardMaterial color="#e5f0ff" transparent opacity={0.6} side={THREE.DoubleSide} {...glow("jet")} />
        </mesh>
        <Callout at={[-0.08, 0.0, 0]} text="Jet" on={highlight === "jet"} side="left" />
      </group>
    </group>
  );
}

function Callout({ at, text, on, side }: { at: [number, number, number]; text: string; on: boolean; side: "left" | "right" }) {
  return (
    <Html position={at} zIndexRange={[10, 0]} style={{ transform: side === "left" ? "translate(-100%, -50%)" : "translate(0, -50%)" }}>
      <span className={`pointer-events-none whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-colors ${on ? "bg-accent text-white ring-accent" : "bg-[#0a1124cc] text-white/80 ring-white/15"}`}>{text}</span>
    </Html>
  );
}
