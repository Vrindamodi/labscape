import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Backdrop, BenchTop, lathe, useGlass, type Quality } from "../bench/Bench3D";
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
  /** A smell is coming off the beaker (drawn as faint wisps). */
  smell: { colour: string } | null;
  /** A flame or glow at the mouth of the beaker, CSS colour, 0..1. */
  flame: { colour: string; intensity: number } | null;
  light: { colour: string; intensity: number } | null;
  smoke: { colour: string; density: number } | null;
  /** Hot plate setting, °C (22 = off), the liquid's own temperature, and the ice bath. */
  plateC: number;
  liquidC: number;
  iceBath: boolean;
  stirring: boolean;
  swirling: boolean;
  /** Increments on each new reaction (shockwave + sparkle) and each spark from the igniter. */
  reactionPulse: number;
  sparkPulse: number;
  /** What is in hand and how it is being used. */
  held: { kind: HeldKind; colour: string; capColour: string; tiltDeg: number; flowing: boolean; label: string } | null;
  focus: boolean;
};

const U = 0.01;
const BEAKER = KINDS.beaker_250;
const BEAKER_H = 88 * U;
const BEAKER_R = 34 * U;
const PLATE_H = 0.16;
const LIQ_R = BEAKER_R * 0.93;
/** Small volumes are drawn a little taller (a 10 mL puddle would otherwise be a sliver). */
const fillH = (v: PlaygroundView) => Math.pow(Math.min(1, Math.max(0, v.levelMl / v.capacityMl)), 0.62) * (BEAKER_H - 0.06);

export function PlaygroundScene({ view, reducedMotion, onBeaker }: { view: PlaygroundView; reducedMotion: boolean; onBeaker?: () => void }) {
  const [quality, setQuality] = useState<Quality>(() => (((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? "lite" : "high"));
  return (
    <Canvas
      shadows={quality === "high"}
      dpr={quality === "high" ? [1, 1.6] : [1, 1.15]}
      camera={{ position: [0, 2.3, 4.6], fov: 34, near: 0.1, far: 80 }}
      gl={{ antialias: quality !== "high", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <PerformanceMonitor onDecline={() => setQuality("lite")} flipflops={2} />
      <Env />
      <CameraRig focus={view.focus} pulse={view.reactionPulse} reducedMotion={reducedMotion} />
      <hemisphereLight args={["#bcd4ff", "#0b1020", 0.4]} />
      <directionalLight position={[3, 7, 4]} intensity={1.3} castShadow={quality === "high"} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <pointLight position={[-4, 3.6, -2.5]} intensity={10} color="#3a8cff" distance={12} decay={1.6} />
      <pointLight position={[4, 3.2, -2]} intensity={7} color="#c46bff" distance={11} decay={1.6} />
      <Backdrop />
      <BenchTop />
      {!reducedMotion && <Dust count={quality === "high" ? 220 : 80} />}
      <HotPlate plateC={view.plateC} stirring={view.stirring} />
      {view.iceBath && <IceBath reducedMotion={reducedMotion} />}
      <group position={[0, PLATE_H, 0]} onClick={(e) => (e.stopPropagation(), onBeaker?.())}>
        <BeakerWithContents view={view} quality={quality} reducedMotion={reducedMotion} />
      </group>
      <TestTubeRack />
      {view.held && <Held held={view.held} view={view} quality={quality} reducedMotion={reducedMotion} />}
      {quality === "high" && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={0.72} luminanceSmoothing={0.2} intensity={0.85} radius={0.7} />
          <Vignette eskil={false} offset={0.22} darkness={0.62} />
        </EffectComposer>
      )}
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
    scene.fog = new THREE.Fog("#0b1530", 9, 18);
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

/** Focus pushes the camera in; each reaction gives it a small kick. */
function CameraRig({ focus, pulse, reducedMotion }: { focus: boolean; pulse: number; reducedMotion: boolean }) {
  const { camera } = useThree();
  const controls = useRef<{ update: () => void } | null>(null);
  const want = useMemo(() => new THREE.Vector3(), []);
  const moving = useRef(true);
  const kick = useRef(0);
  useEffect(() => {
    moving.current = true;
  }, [focus]);
  useEffect(() => {
    if (pulse && !reducedMotion) kick.current = 1;
  }, [pulse, reducedMotion]);
  useFrame(({ clock }, dt) => {
    if (moving.current) {
      want.set(0, focus ? 1.45 : 2.3, focus ? 2.6 : 4.6);
      camera.position.lerp(want, reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
      moving.current = camera.position.distanceTo(want) > 0.01;
      controls.current?.update();
    }
    if (kick.current > 0.001) {
      kick.current *= Math.exp(-dt * 5);
      camera.position.x += Math.sin(clock.elapsedTime * 60) * 0.006 * kick.current;
      camera.position.y += Math.cos(clock.elapsedTime * 47) * 0.004 * kick.current;
    }
  });
  return <OrbitControls ref={controls as never} makeDefault target={[0, 0.65, 0]} enablePan={false} minDistance={1.6} maxDistance={8} minPolarAngle={0.3} maxPolarAngle={1.35} enableDamping={!reducedMotion} />;
}

/* ------------------------------------------------------------------ ambience */

function Dust({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 8;
      p[i * 3 + 1] = Math.random() * 4;
      p[i * 3 + 2] = (Math.random() - 0.5) * 5 - 0.5;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useEffect(() => () => geom.dispose(), [geom]);
  useFrame((_, dt) => {
    const a = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = a.getY(i) + dt * 0.04;
      if (y > 4) y = 0;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(y * 3 + i) * dt * 0.02);
    }
    a.needsUpdate = true;
    if (ref.current) ref.current.rotation.y += dt * 0.005;
  });
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial size={0.012} color="#9fc4ff" transparent opacity={0.35} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function HotPlate({ plateC, stirring }: { plateC: number; stirring: boolean }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const heat = Math.max(0, Math.min(1, (plateC - 22) / 70));
  const cold = plateC < 15;
  const target = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    target.set(cold ? "#7cc4ff" : "#2f80ff").lerp(new THREE.Color("#ff5a1f"), heat);
    if (ring.current) {
      ring.current.emissive.lerp(target, 0.06);
      ring.current.emissiveIntensity += ((heat > 0 ? 2.2 + Math.sin(clock.elapsedTime * 4) * 0.25 : cold ? 1.6 : 0.7) - ring.current.emissiveIntensity) * 0.06;
    }
  });
  return (
    <group>
      <mesh position={[0, PLATE_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, PLATE_H, 1.05]} />
        <meshPhysicalMaterial color="#1c2436" metalness={0.55} roughness={0.32} clearcoat={0.6} clearcoatRoughness={0.25} />
      </mesh>
      <mesh position={[0, PLATE_H + 0.001, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[BEAKER_R + 0.07, 48]} />
        <meshStandardMaterial color="#0d121e" roughness={0.6} />
      </mesh>
      {/* heating coil under the glass top: invisible cold, glowing orange hot */}
      {[0.08, 0.16, 0.24, 0.32].map((r) => (
        <mesh key={r} position={[0, PLATE_H + 0.003, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[r, r + 0.014, 48]} />
          <meshStandardMaterial color="#160a05" emissive="#ff5a1f" emissiveIntensity={heat * 3.2} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, PLATE_H + 0.004, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[BEAKER_R + 0.06, BEAKER_R + 0.085, 64]} />
        <meshStandardMaterial ref={ring} color="#0b1020" emissive="#2f80ff" emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      {heat > 0 && <pointLight position={[0, PLATE_H + 0.15, 0]} color="#ff7a3d" intensity={2.5 * heat} distance={1.6} />}
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={x} position={[x, PLATE_H * 0.55, 0.53]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 24]} />
          <meshStandardMaterial color={i === 0 ? (heat > 0 ? "#ff8a3d" : cold ? "#7cc4ff" : "#3b4252") : stirring ? "#3d8bff" : "#3b4252"} metalness={0.6} roughness={0.3} emissive={i === 0 ? (heat > 0 ? "#ff6a2b" : "#000") : stirring ? "#3d8bff" : "#000"} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function IceBath({ reducedMotion }: { reducedMotion: boolean }) {
  const glass = useGlass("lite");
  const cubes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 + (i % 2) * 0.2;
        const r = BEAKER_R + 0.12 + (i % 3) * 0.03;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.06 + (i % 4) * 0.05, rx: i * 0.7, ry: i * 1.3, s: 0.07 + (i % 3) * 0.015 };
      }),
    [],
  );
  const mist = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!mist.current || reducedMotion) return;
    mist.current.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.12 + i / 8) % 1;
      c.position.y = PLATE_H + 0.05 + t * 0.12;
      c.scale.setScalar(0.25 + t * 0.35);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.18 * (1 - t);
    });
  });
  return (
    <group position={[0, PLATE_H, 0]}>
      {/* the bowl */}
      <mesh position={[0, 0.17, 0]} material={glass}>
        <cylinderGeometry args={[BEAKER_R + 0.26, BEAKER_R + 0.2, 0.34, 48, 1, true]} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[BEAKER_R + 0.24, BEAKER_R + 0.19, 0.22, 48, 1, true]} />
        <meshPhysicalMaterial color="#bfe6ff" transparent opacity={0.35} roughness={0.05} transmission={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {cubes.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} rotation={[c.rx, c.ry, 0]} castShadow>
          <boxGeometry args={[c.s, c.s, c.s]} />
          <meshPhysicalMaterial color="#e8f6ff" roughness={0.12} transmission={0.6} thickness={0.2} ior={1.31} clearcoat={1} />
        </mesh>
      ))}
      <group ref={mist}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[Math.cos(i) * (BEAKER_R + 0.16), 0.1, Math.sin(i) * (BEAKER_R + 0.16)]}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color="#e6f4ff" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
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
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.25} transparent opacity={0.8} roughness={0.1} />
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
  const surface = useRef<THREE.Mesh>(null);
  const surfaceMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const glow = useRef<THREE.PointLight>(null);
  const group = useRef<THREE.Group>(null);
  const colour = useMemo(() => new THREE.Color(), []);
  const level = useRef(0);
  const frost = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }, dt) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 2.5);
    level.current += (fillH(view) - level.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 4));
    const h = Math.max(0.0001, level.current);
    const t = clock.elapsedTime;
    if (liquid.current) {
      liquid.current.visible = h > 0.004;
      liquid.current.scale.set(1, h, 1);
      liquid.current.position.y = 0.012 + h / 2;
    }
    if (surface.current) {
      surface.current.visible = h > 0.004;
      surface.current.position.y = 0.012 + h;
      const boil = view.liquidC > 92 ? 1 : 0;
      const amp = view.stirring || view.swirling ? 0.03 : boil ? 0.02 : view.gas > 0 ? 0.012 : 0.004;
      // Wobble the surface disc: two slightly out-of-phase tilts read as a rolling surface.
      surface.current.rotation.x = -Math.PI / 2 + (reducedMotion ? 0 : Math.sin(t * 3.1) * amp);
      surface.current.rotation.y = reducedMotion ? 0 : Math.cos(t * 2.3) * amp;
      if (view.stirring) surface.current.rotation.z += dt * 6;
    }
    colour.setStyle(view.colour);
    if (liquidMat.current) {
      liquidMat.current.color.lerp(colour, k);
      liquidMat.current.attenuationColor.lerp(colour, k);
      liquidMat.current.opacity += (Math.min(0.96, 0.32 + view.opacity * 0.64) - liquidMat.current.opacity) * k;
      // Strongly coloured liquids glow a little under bloom.
      liquidMat.current.emissive.lerp(colour, k);
      liquidMat.current.emissiveIntensity = 0.08 + view.opacity * 0.12;
    }
    if (surfaceMat.current) surfaceMat.current.color.lerp(colour.clone().lerp(new THREE.Color("#ffffff"), 0.55), k);
    if (glow.current) glow.current.intensity += ((view.levelMl > 1 ? 0.6 + view.opacity * 1.2 : 0) - glow.current.intensity) * k;
    if (glow.current) glow.current.color.lerp(colour, k);
    if (frost.current) frost.current.opacity += ((view.iceBath ? 0.32 : view.liquidC < 10 ? 0.22 : 0) - frost.current.opacity) * (1 - Math.exp(-dt * 0.6));
    if (group.current && view.swirling && !reducedMotion) {
      group.current.position.x = Math.cos(t * 9) * 0.025;
      group.current.position.z = Math.sin(t * 9) * 0.025;
    } else if (group.current) group.current.position.set(0, 0, 0);
  });

  const h = fillH(view);
  const boiling = view.liquidC > 92 && view.levelMl > 1;
  return (
    <group ref={group}>
      <pointLight ref={glow} position={[0, 0.25, 0]} intensity={0} distance={1.4} decay={2} />
      <mesh ref={liquid} position={[0, 0.012, 0]} renderOrder={1}>
        <cylinderGeometry args={[LIQ_R, LIQ_R, 1, 48, 1]} />
        <meshPhysicalMaterial ref={liquidMat} color="#cfe6ff" emissive="#000000" transparent opacity={0.3} roughness={0.05} clearcoat={0.8} ior={1.33} attenuationColor="#cfe6ff" attenuationDistance={0.6} depthWrite={false} />
      </mesh>
      <mesh ref={surface} rotation-x={-Math.PI / 2} renderOrder={2}>
        <circleGeometry args={[LIQ_R, 48]} />
        <meshPhysicalMaterial ref={surfaceMat} color="#ffffff" transparent opacity={0.38} roughness={0} clearcoat={1} envMapIntensity={1.6} depthWrite={false} />
      </mesh>
      {view.precipitate && view.levelMl > 1 && <Precipitate p={view.precipitate} height={h} quality={quality} reducedMotion={reducedMotion} />}
      {view.solid && view.solid.amount > 0.01 && <SolidLumps colour={view.solid.colour} amount={view.solid.amount} reducedMotion={reducedMotion} />}
      {((view.gas > 0.01 && view.levelMl > 1) || boiling) && <Bubbles radius={LIQ_R * 0.85} height={h} rate={Math.max(view.gas, boiling ? 0.9 : 0)} big={boiling} count={quality === "high" ? 140 : 50} reducedMotion={reducedMotion} />}
      {view.gas > 0.01 && view.levelMl > 1 && <Fizz top={h} intensity={view.gas} reducedMotion={reducedMotion} />}
      {view.gasColour && view.gas > 0.01 && <Plume colour={view.gasColour} top={h} intensity={view.gas} reducedMotion={reducedMotion} />}
      {view.smell && <SmellWisps colour={view.smell.colour} reducedMotion={reducedMotion} />}
      {view.liquidC > 50 && view.levelMl > 1 && <Steam top={h} intensity={Math.min(1, (view.liquidC - 50) / 45)} reducedMotion={reducedMotion} />}
      {view.flame && view.flame.intensity > 0.02 && <Flame colour={view.flame.colour} intensity={view.flame.intensity} reducedMotion={reducedMotion} />}
      {view.light && view.light.intensity > 0.02 && <pointLight position={[0, BEAKER_H * 0.5, 0]} color={view.light.colour} intensity={8 * view.light.intensity} distance={3} />}
      {view.smoke && view.smoke.density > 0.02 && <Smoke colour={view.smoke.colour} density={view.smoke.density} reducedMotion={reducedMotion} />}
      {view.stirring && view.levelMl > 1 && <StirBar reducedMotion={reducedMotion} />}
      {view.held?.flowing && view.held.kind !== "gas" && view.levelMl > 0.5 && <Splash top={h} colour={view.held.colour} reducedMotion={reducedMotion} />}
      <Shockwave pulse={view.reactionPulse} top={h} colour={view.colour} reducedMotion={reducedMotion} />
      <SparkBurst pulse={view.sparkPulse} reducedMotion={reducedMotion} />
      <mesh geometry={glassGeom} material={glass} renderOrder={3} castShadow={quality === "high"} />
      {/* frost/condensation on the glass when cold */}
      <mesh renderOrder={4}>
        <cylinderGeometry args={[BEAKER_R + 0.004, BEAKER_R + 0.004, BEAKER_H * 0.85, 48, 1, true]} />
        <meshStandardMaterial ref={frost} color="#eaf6ff" transparent opacity={0} roughness={1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {[50, 100, 150, 200].map((ml) => (
        <mesh key={ml} position={[0, (ml / view.capacityMl) * (BEAKER_H - 0.06) + 0.012, BEAKER_R + 0.003]}>
          <boxGeometry args={[0.06, 0.006, 0.002]} />
          <meshBasicMaterial color="#e5edff" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ particle effects */

/** Instanced rising bubbles. Rate sets how many are live; boiling makes big rolling ones. */
function Bubbles({ radius, height, rate, big, count, reducedMotion }: { radius: number; height: number; rate: number; big: boolean; count: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), r: Math.sqrt(((i * 0.618) % 1)) * radius, s: 0.35 + ((i * 0.37) % 1) * 0.6, o: (i * 0.173) % 1, size: 0.01 + ((i * 0.53) % 1) * 0.016 })), [count, radius]);
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const live = Math.round(count * Math.min(1, 0.15 + rate));
    const t = reducedMotion ? 0.5 : clock.elapsedTime;
    seeds.forEach((b, i) => {
      if (i >= live) {
        m.scale.setScalar(0);
      } else {
        const y = ((t * b.s * (big ? 1.4 : 1) + b.o) % 1) * height;
        const wob = Math.sin(t * 8 + i) * 0.008;
        m.position.set(Math.cos(b.a) * b.r + wob, y + 0.015, Math.sin(b.a) * b.r);
        const grow = 0.6 + (y / Math.max(0.01, height)) * 0.8;
        m.scale.setScalar(b.size * grow * (big ? 2.4 : 1));
      }
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} renderOrder={2}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshPhysicalMaterial color="#ffffff" emissive="#bfe0ff" emissiveIntensity={0.25} transparent opacity={0.75} roughness={0} clearcoat={1} depthWrite={false} />
    </instancedMesh>
  );
}

/** Tiny droplets jumping off the surface while it fizzes. */
function Fizz({ top, intensity, reducedMotion }: { top: number; intensity: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 40;
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const ph = (clock.elapsedTime * (1.6 + (i % 5) * 0.3) + i * 0.137) % 1;
      const a = i * 2.4;
      const r = ((i * 0.61) % 1) * LIQ_R * 0.9;
      m.position.set(Math.cos(a) * r, top + 0.015 + Math.sin(ph * Math.PI) * 0.05 * intensity, Math.sin(a) * r);
      m.scale.setScalar(ph < 0.95 ? 0.008 : 0);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
    </instancedMesh>
  );
}

/** Precipitate: a swirl of particles that drifts down and piles up as it settles. */
function Precipitate({ p, height, quality, reducedMotion }: { p: NonNullable<PlaygroundView["precipitate"]>; height: number; quality: Quality; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const layer = useRef<THREE.Mesh>(null);
  const layerMat = useRef<THREE.MeshStandardMaterial>(null);
  const n = quality === "high" ? 420 : 160;
  const seeds = useMemo(() => Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * LIQ_R * 0.92, y: Math.random(), sp: 0.4 + Math.random() * 0.8, s: 0.004 + Math.random() * 0.006 })), [n]);
  const m = useMemo(() => new THREE.Object3D(), []);
  const settle = useRef(0);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }, dt) => {
    settle.current += (p.settled - settle.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 0.35));
    col.setStyle(p.colour);
    if (mat.current) mat.current.color.lerp(col, 0.1);
    if (layerMat.current) {
      layerMat.current.color.lerp(col, 0.1);
      layerMat.current.opacity = Math.min(0.95, 0.25 + settle.current * 0.7);
    }
    if (layer.current) {
      const lh = 0.008 + settle.current * Math.min(0.05, p.turbidity * 0.06);
      layer.current.scale.set(1, lh, 1);
      layer.current.position.y = 0.012 + lh / 2;
    }
    const mesh = ref.current;
    if (!mesh) return;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    const live = Math.round(n * Math.min(1, p.turbidity * 1.4) * (1 - settle.current * 0.8));
    seeds.forEach((s, i) => {
      if (i >= live) m.scale.setScalar(0);
      else {
        // Particles swirl round the beaker and drift down; the settled fraction pulls them to the floor.
        const a = s.a + t * 0.25 * s.sp;
        const yTop = height * (1 - settle.current * 0.92);
        const y = ((s.y - t * 0.02 * s.sp) % 1 + 1) % 1;
        m.position.set(Math.cos(a) * s.r, 0.016 + y * Math.max(0.01, yTop), Math.sin(a) * s.r);
        m.scale.setScalar(s.s);
      }
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, n]} renderOrder={2}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial ref={mat} color={p.colour} roughness={0.8} transparent opacity={0.9} />
      </instancedMesh>
      <mesh ref={layer} renderOrder={1}>
        <cylinderGeometry args={[LIQ_R * 0.97, LIQ_R * 0.97, 1, 40]} />
        <meshStandardMaterial ref={layerMat} color={p.colour} roughness={0.95} transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </>
  );
}

function SolidLumps({ colour, amount, reducedMotion }: { colour: string; amount: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const lumps = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ x: Math.cos(i * 2.4) * LIQ_R * 0.5 * ((i % 3) / 3 + 0.3), z: Math.sin(i * 2.4) * LIQ_R * 0.5 * ((i % 3) / 3 + 0.3), r: i * 0.9, s: 0.025 + (i % 4) * 0.008 })), []);
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return;
    ref.current.children.forEach((c, i) => (c.rotation.y = clock.elapsedTime * 0.1 + i));
  });
  const shown = Math.max(1, Math.round(lumps.length * Math.min(1, amount)));
  return (
    <group ref={ref}>
      {lumps.slice(0, shown).map((l, i) => (
        <mesh key={i} position={[l.x, 0.02 + l.s * 0.5, l.z]} rotation={[l.r, l.r * 0.5, 0]} castShadow>
          <dodecahedronGeometry args={[l.s * (0.6 + amount * 0.6), 0]} />
          <meshStandardMaterial color={colour} roughness={0.6} metalness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

/** A soft column of coloured gas rising out of the beaker. */
function Plume({ colour, top, intensity, reducedMotion }: { colour: string; top: number; intensity: number; reducedMotion: boolean }) {
  return <Puffs colour={colour} y0={top + 0.05} rise={1.3} spread={0.14} count={14} opacity={0.45 * Math.min(1, intensity + 0.4)} speed={0.28} size={0.16} reducedMotion={reducedMotion} />;
}

function Steam({ top, intensity, reducedMotion }: { top: number; intensity: number; reducedMotion: boolean }) {
  return <Puffs colour="#f2f7ff" y0={top + 0.04} rise={1.1} spread={0.18} count={12} opacity={0.38 * intensity} speed={0.22 + intensity * 0.2} size={0.14} reducedMotion={reducedMotion} />;
}

function Smoke({ colour, density, reducedMotion }: { colour: string; density: number; reducedMotion: boolean }) {
  return <Puffs colour={colour} y0={BEAKER_H} rise={1.6} spread={0.25} count={16} opacity={0.42 * density} speed={0.3} size={0.16} reducedMotion={reducedMotion} />;
}

function Puffs({ colour, y0, rise, spread, count, opacity, speed, size, reducedMotion }: { colour: string; y0: number; rise: number; spread: number; count: number; opacity: number; speed: number; size: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ o: i / count, x: Math.sin(i * 2.3) * spread * 0.5, z: Math.cos(i * 1.7) * spread * 0.4, w: 0.5 + (i % 3) * 0.3 })), [count, spread]);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const s = seeds[i]!;
      const t = reducedMotion ? s.o : (clock.elapsedTime * speed + s.o) % 1;
      c.position.set(s.x + Math.sin(t * 5 + i) * spread * 0.5 * t, y0 + t * rise, s.z + Math.cos(t * 4 + i) * spread * 0.3 * t);
      c.scale.setScalar(size * s.w * (0.5 + t * 2.2));
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = opacity * Math.sin(Math.PI * Math.min(1, t * 1.2));
    });
  });
  return (
    <group ref={ref}>
      {seeds.map((_, i) => (
        <mesh key={i} renderOrder={5}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshStandardMaterial color={colour} transparent opacity={0} depthWrite={false} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** A smell made visible: faint curling ribbons drifting up and away (waft, never sniff). */
function SmellWisps({ colour, reducedMotion }: { colour: string; reducedMotion: boolean }) {
  const lines = useMemo(() => [0, 1, 2].map((i) => {
    const pts = Array.from({ length: 40 }, (_, k) => new THREE.Vector3(0, 0, 0).setY(k / 39));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return { g, i };
  }), []);
  useEffect(() => () => lines.forEach((l) => l.g.dispose()), [lines]);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = reducedMotion ? 0 : clock.elapsedTime;
    g.children.forEach((c, i) => {
      const geo = (c as THREE.Line).geometry;
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < a.count; k++) {
        const y = k / (a.count - 1);
        a.setXYZ(k, Math.sin(y * 7 + t * 1.6 + i * 2) * 0.08 * y + (i - 1) * 0.12 + y * 0.35, BEAKER_H + 0.05 + y * 0.9, Math.cos(y * 5 + t + i) * 0.06 * y);
      }
      a.needsUpdate = true;
      ((c as THREE.Line).material as THREE.LineBasicMaterial).opacity = 0.35 + Math.sin(t * 2 + i) * 0.15;
    });
  });
  return (
    <group ref={ref}>
      {lines.map((l) => (
        <line key={l.i}>
          <primitive object={l.g} attach="geometry" />
          <lineBasicMaterial color={colour} transparent opacity={0.4} depthWrite={false} />
        </line>
      ))}
    </group>
  );
}

function Flame({ colour, intensity, reducedMotion }: { colour: string; intensity: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current && !reducedMotion) {
      ref.current.children.forEach((c, i) => {
        c.scale.y = 1 + Math.sin(t * (19 + i * 7)) * 0.12 + Math.sin(t * (31 + i * 3)) * 0.08;
        c.scale.x = c.scale.z = 1 + Math.sin(t * (13 + i * 5)) * 0.06;
      });
    }
    if (light.current) light.current.intensity = 4 * intensity * (reducedMotion ? 1 : 0.85 + Math.sin(t * 23) * 0.15);
  });
  const h = 0.25 + intensity * 0.35;
  return (
    <group position={[0, BEAKER_H + 0.02, 0]}>
      <group ref={ref}>
        {[1, 0.7, 0.42].map((s, i) => (
          <mesh key={s} position={[0, (h * s) / 2, 0]}>
            <coneGeometry args={[0.13 * s, h * s, 24, 1, true]} />
            <meshBasicMaterial color={i === 2 ? "#ffffff" : colour} transparent opacity={i === 0 ? 0.55 : 0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <Embers colour={colour} reducedMotion={reducedMotion} />
      <pointLight ref={light} color={colour} intensity={4 * intensity} distance={3} position={[0, 0.15, 0]} />
    </group>
  );
}

function Embers({ colour, reducedMotion }: { colour: string; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 30;
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const ph = (clock.elapsedTime * (0.6 + (i % 4) * 0.2) + i * 0.173) % 1;
      m.position.set(Math.sin(i * 3.1 + ph * 4) * 0.12 * ph, ph * 0.7, Math.cos(i * 1.9 + ph * 3) * 0.1 * ph);
      m.scale.setScalar(0.008 * (1 - ph));
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial color={colour} toneMapped={false} />
    </instancedMesh>
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

/** Where the pour lands: expanding ripple rings and droplets jumping up. */
function Splash({ top, colour, reducedMotion }: { top: number; colour: string; reducedMotion: boolean }) {
  const rings = useRef<THREE.Group>(null);
  const drops = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Object3D(), []);
  const cx = LIQ_R * 0.35;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    rings.current?.children.forEach((c, i) => {
      const ph = reducedMotion ? 0.5 : (t * 1.4 + i / 3) % 1;
      c.scale.setScalar(0.02 + ph * 0.14);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ph);
    });
    const mesh = drops.current;
    if (!mesh || reducedMotion) return;
    for (let i = 0; i < 18; i++) {
      const ph = (t * 2.4 + i * 0.29) % 1;
      const a = i * 2.1;
      m.position.set(cx + Math.cos(a) * 0.05 * ph, top + 0.02 + Math.sin(ph * Math.PI) * 0.07, Math.sin(a) * 0.05 * ph);
      m.scale.setScalar(0.006);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={rings} position={[cx, top + 0.014, 0]} rotation-x={-Math.PI / 2}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <ringGeometry args={[0.8, 1, 32]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={drops} args={[undefined, undefined, 18]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial color={colour} transparent opacity={0.85} />
      </instancedMesh>
    </>
  );
}

/** A ring of light that races out across the bench when a reaction starts. */
function Shockwave({ pulse, top, colour, reducedMotion }: { pulse: number; top: number; colour: string; reducedMotion: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.PointLight>(null);
  const start = useRef(-10);
  const { clock } = useThree();
  useEffect(() => {
    if (pulse) start.current = clock.elapsedTime;
  }, [pulse, clock]);
  useFrame(({ clock: c }) => {
    const age = c.elapsedTime - start.current;
    const on = age >= 0 && age < 1.4 && !reducedMotion;
    if (ring.current) {
      ring.current.visible = on;
      if (on) {
        ring.current.scale.setScalar(0.3 + age * 2.4);
        ((ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age / 1.4));
      }
    }
    if (flash.current) flash.current.intensity = on ? 6 * Math.max(0, 1 - age * 1.6) : 0;
  });
  return (
    <>
      <mesh ref={ring} position={[0, top + 0.02, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.36, 0.4, 64]} />
        <meshBasicMaterial color={colour} transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <pointLight ref={flash} position={[0, top + 0.2, 0]} color={colour} intensity={0} distance={2.5} />
    </>
  );
}

/** Igniter: a burst of bright sparks at the mouth. */
function SparkBurst({ pulse, reducedMotion }: { pulse: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const start = useRef(-10);
  const { clock } = useThree();
  const n = 60;
  const dirs = useMemo(() => Array.from({ length: n }, () => new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(0.4 + Math.random() * 0.6)), []);
  const m = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (pulse) start.current = clock.elapsedTime;
  }, [pulse, clock]);
  useFrame(({ clock: c }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const age = c.elapsedTime - start.current;
    const on = age >= 0 && age < 0.9 && !reducedMotion;
    mesh.visible = on;
    if (!on) return;
    dirs.forEach((d, i) => {
      m.position.set(d.x * age, BEAKER_H + 0.08 + d.y * age - 1.2 * age * age, d.z * age);
      m.scale.setScalar(0.009 * (1 - age / 0.9));
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} visible={false}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshBasicMaterial color="#ffe08a" toneMapped={false} />
    </instancedMesh>
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
  const liquidTop = PLATE_H + 0.012 + fillH(view);
  // The mouth sits just above and outside the rim; the body hangs below it and swings out as it tilts.
  const mouth = useMemo(() => new THREE.Vector3(BEAKER_R + 0.16, PLATE_H + BEAKER_H + 0.2, 0.05), []);
  useFrame(({ clock }, dt) => {
    const g = pivot.current;
    if (!g) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    tilt.current += ((held.tiltDeg * Math.PI) / 180 - tilt.current) * k;
    appear.current += (1 - appear.current) * k;
    g.rotation.z = tilt.current + (reducedMotion || held.flowing ? 0 : Math.sin(clock.elapsedTime * 1.4) * 0.02);
    g.position.set(mouth.x + (1 - appear.current) * 0.8, mouth.y + (1 - appear.current) * 0.3 + (held.flowing || reducedMotion ? 0 : Math.sin(clock.elapsedTime * 1.1) * 0.012), mouth.z);
  });

  const h = BOTTLE_H * BOTTLE_S;
  const r0 = REAGENT.profile[0]![0] * U * BOTTLE_S;
  return (
    <>
      <group ref={pivot} position={mouth}>
        {held.kind === "bottle" && (
          <group position={[0, -h, 0]}>
            <mesh position={[0, h * 0.35, 0]}>
              <cylinderGeometry args={[r0 * 0.92, r0 * 0.92, h * 0.62, 32]} />
              <meshPhysicalMaterial color={held.colour} transparent opacity={0.72} roughness={0.05} clearcoat={0.8} />
            </mesh>
            <mesh geometry={bottleGeom} material={glass} renderOrder={3} castShadow />
            <mesh position={[0, h * 0.42, 0]}>
              <cylinderGeometry args={[r0 + 0.006, r0 + 0.006, h * 0.28, 32, 1, true]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.6} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, h * 0.42, 0]}>
              <cylinderGeometry args={[r0 + 0.008, r0 + 0.008, h * 0.06, 32, 1, true]} />
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
            <mesh castShadow>
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
            <mesh castShadow>
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
      {held.flowing && held.kind === "bottle" && <Stream from={mouth} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} />}
      {held.flowing && held.kind === "dropper" && <Drops from={mouth} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} />}
      {held.flowing && held.kind === "spatula" && <Drops from={new THREE.Vector3(mouth.x - 0.05, mouth.y - 0.06, mouth.z)} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} grains />}
      {held.kind === "gas" && <GasHose from={new THREE.Vector3(mouth.x + 0.35, mouth.y - 0.1, mouth.z)} />}
    </>
  );
}

/** The pour: a tube whose surface texture scrolls, so the stream visibly flows. */
function Stream({ from, toY, colour, reducedMotion }: { from: THREE.Vector3; toY: number; colour: string; reducedMotion: boolean }) {
  const geom = useMemo(() => {
    const start = new THREE.Vector3(from.x - 0.04, from.y - 0.02, from.z);
    const end = new THREE.Vector3(LIQ_R * 0.35, toY, 0.02);
    const mid = new THREE.Vector3((start.x + end.x) / 2 + 0.02, (start.y + end.y) / 2 + 0.06, 0.03);
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 32, 0.014, 10, false);
  }, [from, toY]);
  useEffect(() => () => geom.dispose(), [geom]);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 64;
    const g = c.getContext("2d")!;
    for (let y = 0; y < 64; y++) {
      g.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.sin((y / 64) * Math.PI * 6)})`;
      g.fillRect(0, y, 4, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 3);
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((_, dt) => {
    if (!reducedMotion) tex.offset.x -= dt * 2.5;
  });
  return (
    <mesh geometry={geom} renderOrder={4}>
      <meshPhysicalMaterial color={colour} alphaMap={tex} transparent opacity={0.9} roughness={0.02} clearcoat={1} emissive={colour} emissiveIntensity={0.15} depthWrite={false} />
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
      if (!grains) c.scale.set(1, 1 + t * 0.6, 1);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: grains ? 14 : 3 }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[grains ? 0.007 : 0.016, 8, 8]} />
          <meshPhysicalMaterial color={colour} transparent opacity={0.9} roughness={0.05} clearcoat={1} />
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
