import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Backdrop, BenchTop, Bubbles, lathe, SmallFlame, useGlass, type Quality } from "../bench/Bench3D";
import { KINDS } from "../engine/equipment";

/** How the substance in hand is dispensed. */
export type HeldKind = "bottle" | "dropper" | "spatula" | "gas";

/**
 * Everything the open-playground bench shows. The scene only draws; what happens chemically comes
 * from the server safety engine as cues, which the page turns into these props.
 */
export type PlaygroundView = {
  /** Liquid in the beaker, mL (0..capacity). */
  levelMl: number;
  capacityMl: number;
  /** Liquid colour (CSS) and how see-through it is (0 clear .. 1 opaque). */
  colour: string;
  opacity: number;
  /** Suspended precipitate: colour and cloudiness 0..1; settles to the bottom over time. */
  precipitate: { colour: string; turbidity: number; settled: number } | null;
  /** Undissolved solid at the bottom (colour, amount 0..1). */
  solid: { colour: string; amount: number } | null;
  /** Gas bubbling: 0 none .. 1 vigorous; optional coloured gas above the liquid. */
  gas: number;
  gasColour: string | null;
  /** A flame or glow at the mouth of the beaker, CSS colour, 0..1. */
  flame: { colour: string; intensity: number } | null;
  light: { colour: string; intensity: number } | null;
  smoke: { colour: string; density: number } | null;
  /** Hot plate setting, °C (22 = off), and whether the stirrer spins. */
  plateC: number;
  stirring: boolean;
  swirling: boolean;
  /** What is in hand and how it is being used. */
  held: { kind: HeldKind; colour: string; capColour: string; tiltDeg: number; flowing: boolean; label: string } | null;
  focus: boolean;
};

const U = 0.01;
const BEAKER = KINDS.beaker_250;
const BEAKER_H = 88 * U;
const BEAKER_R = 34 * U;
const PLATE_H = 0.16;

export function PlaygroundScene({ view, reducedMotion, onBeaker }: { view: PlaygroundView; reducedMotion: boolean; onBeaker?: () => void }) {
  const [quality, setQuality] = useState<Quality>(() => (((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? "lite" : "high"));
  return (
    <Canvas
      shadows={quality === "high"}
      dpr={quality === "high" ? [1, 1.6] : [1, 1.15]}
      camera={{ position: [0, 2.3, 4.6], fov: 34, near: 0.1, far: 80 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      style={{ touchAction: "none" }}
    >
      <PerformanceMonitor onDecline={() => setQuality("lite")} flipflops={2} />
      <Env />
      <CameraRig focus={view.focus} reducedMotion={reducedMotion} />
      <hemisphereLight args={["#bcd4ff", "#0b1020", 0.4]} />
      <directionalLight position={[3, 7, 4]} intensity={1.3} castShadow={quality === "high"} shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3.6, -2.5]} intensity={10} color="#3a8cff" distance={12} decay={1.6} />
      <pointLight position={[4, 3.2, -2]} intensity={7} color="#c46bff" distance={11} decay={1.6} />
      <Backdrop />
      <BenchTop />
      <HotPlate plateC={view.plateC} stirring={view.stirring} />
      <group position={[0, PLATE_H, 0]} onClick={(e) => (e.stopPropagation(), onBeaker?.())}>
        <BeakerWithContents view={view} quality={quality} reducedMotion={reducedMotion} />
      </group>
      <TestTubeRack />
      {view.held && <Held held={view.held} view={view} quality={quality} reducedMotion={reducedMotion} />}
    </Canvas>
  );
}

function Env() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    scene.background = new THREE.Color("#0b1530");
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

function CameraRig({ focus, reducedMotion }: { focus: boolean; reducedMotion: boolean }) {
  const { camera } = useThree();
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const want = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(focus);
  useFrame((_, dt) => {
    // Focus mode pushes the camera in on the beaker; leaving it pulls back.
    if (last.current === focus && !moving.current) return;
    last.current = focus;
    want.set(0, focus ? 1.45 : 2.3, focus ? 2.6 : 4.6);
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(want, k);
    moving.current = camera.position.distanceTo(want) > 0.01;
    controls.current?.update();
  });
  const moving = useRef(false);
  useEffect(() => {
    moving.current = true;
  }, [focus]);
  return <OrbitControls ref={controls as never} makeDefault target={[0, 0.65, 0]} enablePan={false} minDistance={1.8} maxDistance={8} minPolarAngle={0.3} maxPolarAngle={1.35} enableDamping={!reducedMotion} />;
}

function HotPlate({ plateC, stirring }: { plateC: number; stirring: boolean }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const heat = Math.max(0, Math.min(1, (plateC - 22) / 180));
  const cold = plateC < 15;
  useFrame(() => {
    if (!ring.current) return;
    const target = cold ? new THREE.Color("#7cc4ff") : new THREE.Color("#2f80ff").lerp(new THREE.Color("#ff6a2b"), heat);
    ring.current.emissive.lerp(target, 0.1);
    ring.current.emissiveIntensity += ((heat > 0 || cold ? 1.6 : 0.6) - ring.current.emissiveIntensity) * 0.1;
  });
  return (
    <group>
      <mesh position={[0, PLATE_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, PLATE_H, 1.05]} />
        <meshStandardMaterial color="#1c2436" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, PLATE_H + 0.002, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[BEAKER_R + 0.02, BEAKER_R + 0.06, 48]} />
        <meshStandardMaterial ref={ring} color="#0b1020" emissive="#2f80ff" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      {/* knob and stir indicator */}
      <mesh position={[0.42, PLATE_H * 0.55, 0.53]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, 0.05, 24]} />
        <meshStandardMaterial color={stirring ? "#3d8bff" : "#3b4252"} metalness={0.6} roughness={0.3} emissive={stirring ? "#3d8bff" : "#000"} emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[-0.42, PLATE_H * 0.55, 0.53]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, 0.05, 24]} />
        <meshStandardMaterial color={heat > 0 ? "#ff8a3d" : cold ? "#7cc4ff" : "#3b4252"} metalness={0.6} roughness={0.3} emissive={heat > 0 ? "#ff6a2b" : "#000"} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function TestTubeRack() {
  const glass = useGlass("lite");
  const cols = ["#ff7ab6", "#39d6ff", "#ffd23f"];
  return (
    <group position={[-1.55, 0, -0.35]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[0.9, 0.05, 0.28]} />
        <meshStandardMaterial color="#a8743f" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.9, 0.05, 0.28]} />
        <meshStandardMaterial color="#8b5e30" roughness={0.6} />
      </mesh>
      {cols.map((c, i) => (
        <group key={c} position={[-0.26 + i * 0.26, 0.08, 0]}>
          <mesh position={[0, 0.32, 0]} material={glass}>
            <cylinderGeometry args={[0.07, 0.07, 0.64, 16, 1, true]} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.28, 16]} />
            <meshStandardMaterial color={c} transparent opacity={0.75} roughness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ the beaker */

function BeakerWithContents({ view, quality, reducedMotion }: { view: PlaygroundView; quality: Quality; reducedMotion: boolean }) {
  const glass = useGlass(quality);
  const glassGeom = useMemo(() => lathe(BEAKER.profile), []);
  const liquid = useRef<THREE.Mesh>(null);
  const liquidMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const precip = useRef<THREE.Mesh>(null);
  const precipMat = useRef<THREE.MeshStandardMaterial>(null);
  const surface = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const colour = useMemo(() => new THREE.Color(), []);
  const pCol = useMemo(() => new THREE.Color(), []);
  const level = useRef(0);
  const settled = useRef(0);

  useFrame(({ clock }, dt) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 2.5);
    const targetH = Math.min(1, view.levelMl / view.capacityMl) * (BEAKER_H - 0.06);
    level.current += (targetH - level.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 4));
    const h = Math.max(0.0001, level.current);
    if (liquid.current) {
      liquid.current.visible = h > 0.004;
      liquid.current.scale.set(1, h, 1);
      liquid.current.position.y = 0.012 + h / 2;
    }
    if (surface.current) {
      surface.current.visible = h > 0.004;
      surface.current.position.y = 0.012 + h;
      // A gentle wobble; stirring makes a shallow vortex-like ripple.
      const amp = view.stirring || view.swirling ? 0.012 : view.gas > 0 ? 0.006 : 0.002;
      surface.current.rotation.x = -Math.PI / 2 + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 3) * amp);
    }
    if (liquidMat.current) {
      colour.setStyle(view.colour);
      liquidMat.current.color.lerp(colour, k);
      liquidMat.current.opacity += (Math.min(0.96, 0.3 + view.opacity * 0.66) - liquidMat.current.opacity) * k;
    }
    // Precipitate: a cloud through the liquid that sinks into a layer.
    settled.current += ((view.precipitate?.settled ?? 0) - settled.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 0.8));
    if (precip.current && precipMat.current) {
      const p = view.precipitate;
      precip.current.visible = !!p && h > 0.01;
      if (p) {
        const layer = Math.max(0.02, h * (1 - settled.current * 0.85));
        precip.current.scale.set(1, layer, 1);
        precip.current.position.y = 0.014 + layer / 2;
        pCol.setStyle(p.colour);
        precipMat.current.color.lerp(pCol, k);
        precipMat.current.opacity += (Math.min(0.92, p.turbidity * (0.45 + settled.current * 0.5)) - precipMat.current.opacity) * k;
      }
    }
    if (group.current && view.swirling && !reducedMotion) {
      group.current.position.x = Math.cos(clock.elapsedTime * 9) * 0.025;
      group.current.position.z = Math.sin(clock.elapsedTime * 9) * 0.025;
    } else if (group.current) group.current.position.set(0, 0, 0);
  });

  const r = BEAKER_R * 0.93;
  return (
    <group ref={group}>
      <mesh ref={liquid} position={[0, 0.012, 0]} renderOrder={1}>
        <cylinderGeometry args={[r, r, 1, 48, 1]} />
        <meshPhysicalMaterial ref={liquidMat} color="#cfe6ff" transparent opacity={0.3} roughness={0.06} clearcoat={0.6} depthWrite={false} />
      </mesh>
      <mesh ref={surface} rotation-x={-Math.PI / 2} renderOrder={2}>
        <circleGeometry args={[r, 48]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.18} roughness={0} clearcoat={1} depthWrite={false} />
      </mesh>
      <mesh ref={precip} renderOrder={1}>
        <cylinderGeometry args={[r * 0.98, r * 0.98, 1, 40, 1]} />
        <meshStandardMaterial ref={precipMat} color="#ffffff" transparent opacity={0} roughness={0.9} depthWrite={false} />
      </mesh>
      {view.solid && view.solid.amount > 0.01 && (
        <mesh position={[0, 0.02 + view.solid.amount * 0.03, 0]}>
          <cylinderGeometry args={[r * (0.4 + view.solid.amount * 0.5), r * (0.55 + view.solid.amount * 0.4), 0.02 + view.solid.amount * 0.06, 24]} />
          <meshStandardMaterial color={view.solid.colour} roughness={0.95} />
        </mesh>
      )}
      {view.gas > 0.01 && view.levelMl > 1 && <Bubbles radius={r * 0.8} height={Math.min(1, view.levelMl / view.capacityMl) * (BEAKER_H - 0.06)} count={Math.round((quality === "high" ? 90 : 30) * Math.min(1, view.gas + 0.2))} reducedMotion={reducedMotion} />}
      {view.gasColour && view.gas > 0.01 && (
        <mesh position={[0, BEAKER_H * 0.98, 0]}>
          <sphereGeometry args={[BEAKER_R * 1.05, 20, 12]} />
          <meshStandardMaterial color={view.gasColour} transparent opacity={0.22 * Math.min(1, view.gas + 0.3)} depthWrite={false} />
        </mesh>
      )}
      {view.flame && view.flame.intensity > 0.02 && <SmallFlame position={[0, BEAKER_H + 0.08, 0]} colour={view.flame.colour} big open={false} test reducedMotion={reducedMotion} />}
      {view.light && view.light.intensity > 0.02 && <pointLight position={[0, BEAKER_H * 0.5, 0]} color={view.light.colour} intensity={6 * view.light.intensity} distance={3} />}
      {view.smoke && view.smoke.density > 0.02 && <Smoke colour={view.smoke.colour} density={view.smoke.density} reducedMotion={reducedMotion} />}
      {view.stirring && view.levelMl > 1 && <StirBar reducedMotion={reducedMotion} />}
      <mesh geometry={glassGeom} material={glass} renderOrder={3} castShadow={quality === "high"} />
      {/* graduations */}
      {[50, 100, 150, 200].map((ml) => (
        <mesh key={ml} position={[0, (ml / view.capacityMl) * (BEAKER_H - 0.06) + 0.012, BEAKER_R + 0.003]}>
          <boxGeometry args={[0.06, 0.006, 0.002]} />
          <meshBasicMaterial color="#e5edff" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function StirBar({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion) ref.current.rotation.y += dt * 14;
  });
  return (
    <mesh ref={ref} position={[0, 0.03, 0]} rotation-z={Math.PI / 2}>
      <capsuleGeometry args={[0.018, 0.14, 4, 10]} />
      <meshStandardMaterial color="#f1f5f9" roughness={0.3} />
    </mesh>
  );
}

function Smoke({ colour, density, reducedMotion }: { colour: string; density: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const puffs = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ o: i / 10, x: Math.sin(i * 2.3) * 0.08, s: 0.12 + (i % 3) * 0.05 })), []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const p = puffs[i]!;
      const t = reducedMotion ? p.o : (clock.elapsedTime * 0.35 + p.o) % 1;
      c.position.set(p.x + Math.sin(t * 6 + i) * 0.05, BEAKER_H + t * 1.1, Math.cos(i) * 0.04);
      c.scale.setScalar(p.s * (0.6 + t * 1.6));
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = density * 0.45 * (1 - t);
    });
  });
  return (
    <group ref={ref}>
      {puffs.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color={colour} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ what is in hand */

const REAGENT = KINDS.reagent_bottle;
const BOTTLE_H = 125 * U;
const BOTTLE_S = 0.5;

function Held({ held, view, quality, reducedMotion }: { held: NonNullable<PlaygroundView["held"]>; view: PlaygroundView; quality: Quality; reducedMotion: boolean }) {
  const glass = useGlass(quality);
  const bottleGeom = useMemo(() => lathe(REAGENT.profile, BOTTLE_S), []);
  const pivot = useRef<THREE.Group>(null);
  const tilt = useRef(0);
  const appear = useRef(0);
  const liquidTop = PLATE_H + 0.012 + Math.min(1, view.levelMl / view.capacityMl) * (BEAKER_H - 0.06);
  // The mouth sits just above and outside the rim; the body hangs below it and swings out as it tilts.
  const mouth = useMemo(() => new THREE.Vector3(BEAKER_R + 0.16, PLATE_H + BEAKER_H + 0.2, 0.05), []);
  useFrame((_, dt) => {
    const g = pivot.current;
    if (!g) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    tilt.current += ((held.tiltDeg * Math.PI) / 180 - tilt.current) * k;
    appear.current += (1 - appear.current) * k;
    g.rotation.z = tilt.current;
    g.position.set(mouth.x + (1 - appear.current) * 0.8, mouth.y + (1 - appear.current) * 0.3, mouth.z);
  });

  const h = BOTTLE_H * BOTTLE_S;
  return (
    <>
      <group ref={pivot} position={mouth}>
        {held.kind === "bottle" && (
          <group position={[0, -h, 0]}>
            <mesh position={[0, h * 0.35, 0]}>
              <cylinderGeometry args={[REAGENT.profile[0]![0] * U * BOTTLE_S * 0.92, REAGENT.profile[0]![0] * U * BOTTLE_S * 0.92, h * 0.62, 32]} />
              <meshStandardMaterial color={held.colour} transparent opacity={0.72} roughness={0.1} />
            </mesh>
            <mesh geometry={bottleGeom} material={glass} renderOrder={3} />
            <mesh position={[0, h * 0.42, 0]}>
              <cylinderGeometry args={[REAGENT.profile[0]![0] * U * BOTTLE_S + 0.006, REAGENT.profile[0]![0] * U * BOTTLE_S + 0.006, h * 0.28, 32, 1, true]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.6} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, h * 0.42, 0]}>
              <cylinderGeometry args={[REAGENT.profile[0]![0] * U * BOTTLE_S + 0.008, REAGENT.profile[0]![0] * U * BOTTLE_S + 0.008, h * 0.06, 32, 1, true]} />
              <meshStandardMaterial color={held.capColour} roughness={0.5} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}
        {held.kind === "dropper" && (
          <group position={[0, -0.32, 0]}>
            <mesh position={[0, 0.16, 0]} material={glass}>
              <cylinderGeometry args={[0.025, 0.012, 0.32, 16]} />
            </mesh>
            <mesh position={[0, 0.1, 0]}>
              <cylinderGeometry args={[0.02, 0.011, 0.16, 16]} />
              <meshStandardMaterial color={held.colour} transparent opacity={0.8} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <sphereGeometry args={[0.05, 16, 12]} />
              <meshStandardMaterial color="#1f2937" roughness={0.6} />
            </mesh>
          </group>
        )}
        {held.kind === "spatula" && (
          <group position={[0.2, -0.04, 0]} rotation-z={0.1}>
            <mesh>
              <boxGeometry args={[0.55, 0.012, 0.06]} />
              <meshStandardMaterial color="#c0c7d4" metalness={0.9} roughness={0.25} />
            </mesh>
            <mesh position={[-0.22, 0.02, 0]}>
              <sphereGeometry args={[0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={held.colour} roughness={0.95} />
            </mesh>
          </group>
        )}
        {held.kind === "gas" && (
          <group position={[0.35, -0.55, 0]}>
            <mesh>
              <cylinderGeometry args={[0.09, 0.09, 0.7, 24]} />
              <meshStandardMaterial color={held.capColour} metalness={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.4, 0]}>
              <cylinderGeometry args={[0.03, 0.05, 0.1, 12]} />
              <meshStandardMaterial color="#c0c7d4" metalness={0.9} />
            </mesh>
          </group>
        )}
      </group>
      {held.flowing && held.kind === "bottle" && <Stream from={mouth} toY={liquidTop} colour={held.colour} />}
      {held.flowing && held.kind === "dropper" && <Drops from={mouth} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} />}
      {held.flowing && held.kind === "spatula" && <Drops from={new THREE.Vector3(mouth.x - 0.05, mouth.y - 0.06, mouth.z)} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} grains />}
      {held.kind === "gas" && <GasHose from={new THREE.Vector3(mouth.x + 0.35, mouth.y - 0.1, mouth.z)} />}
    </>
  );
}

function Stream({ from, toY, colour }: { from: THREE.Vector3; toY: number; colour: string }) {
  const geom = useMemo(() => {
    const start = new THREE.Vector3(from.x - 0.04, from.y - 0.02, from.z);
    const end = new THREE.Vector3(BEAKER_R * 0.35, toY, 0.02);
    const mid = new THREE.Vector3((start.x + end.x) / 2 + 0.02, (start.y + end.y) / 2 + 0.06, 0.03);
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 20, 0.014, 8, false);
  }, [from, toY]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} renderOrder={4}>
      <meshStandardMaterial color={colour} transparent opacity={0.82} roughness={0.05} />
    </mesh>
  );
}

function Drops({ from, toY, colour, reducedMotion, grains }: { from: THREE.Vector3; toY: number; colour: string; reducedMotion: boolean; grains?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = reducedMotion ? 0.5 : (clock.elapsedTime * (grains ? 2.2 : 1.4) + i / g.children.length) % 1;
      c.position.set(from.x - 0.03 + (grains ? Math.sin(i * 3.1) * 0.03 : 0), from.y - 0.02 - t * t * (from.y - toY), from.z + (grains ? Math.cos(i * 1.7) * 0.03 : 0));
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: grains ? 9 : 3 }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[grains ? 0.008 : 0.016, 8, 8]} />
          <meshStandardMaterial color={colour} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function GasHose({ from }: { from: THREE.Vector3 }) {
  const geom = useMemo(() => {
    const end = new THREE.Vector3(0.05, PLATE_H + 0.1, 0.02);
    const c1 = new THREE.Vector3(from.x, from.y + 0.25, from.z);
    const c2 = new THREE.Vector3(0.05, PLATE_H + BEAKER_H + 0.4, 0.02);
    return new THREE.TubeGeometry(new THREE.CubicBezierCurve3(from, c1, c2, end), 40, 0.012, 8, false);
  }, [from]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial color="#e2e8f0" transparent opacity={0.55} roughness={0.2} />
    </mesh>
  );
}
