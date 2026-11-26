import { Html, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Backdrop, BenchTop, lathe, useGlass, type Quality } from "../bench/Bench3D";
import { KINDS } from "../engine/equipment";

/** How the substance in hand is dispensed. */
export type HeldKind = "bottle" | "dropper" | "spatula" | "gas" | "burette";

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
  /** Suspended precipitate: colour and cloudiness 0..1; settles to the bottom over time. Crystals glitter. */
  precipitate: { colour: string; turbidity: number; settled: number; form?: "powder" | "crystals" } | null;
  /** Undissolved solid at the bottom (colour, amount 0..1), optionally with a metal coating growing on it. */
  solid: { colour: string; amount: number; coat?: { colour: string; form: "coating" | "crystals"; durationMs: number; pulse: number } } | null;
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
  /** `fill` (0..1) is how full a burette still is; other tools ignore it. */
  held: { kind: HeldKind; colour: string; capColour: string; tiltDeg: number; flowing: boolean; label: string; fill?: number } | null;
  /**
   * A flame test: each new `pulse` sends the wire loop from beaker `from` into the burner's flame, which burns
   * `colour` while the loop is in it (null: the flame stays blue).
   */
  flameTest?: { pulse: number; colour: string | null; from: string } | null;
  /** What stands on the hot plate: a beaker, or a test tube (tall, narrow, small). */
  vessel?: "beaker" | "tube";
  /**
   * Gas tests held at the mouth of the vessel. Each new `pulse` plays one: a glowing splint that bursts back
   * into flame, goes out or just keeps glowing; and a pair of damp litmus papers, one blue and one red, that
   * end up the colours given ("none" leaves a paper as it was, "white" is bleached).
   */
  glowSplint?: { pulse: number; result: "relights" | "out" | "none" } | null;
  /**
   * The evaporating basin on its tripod. Each new `pulse` plays one heating of what vessel `from` held:
   * "boil" tips in a solution of colour `liquid` and boils it away, leaving `residue` (null when nothing is
   * left); "roast" heats a dry solid of colour `solid` strongly until it is `residue`. `steam` puts steam or
   * fumes over it. While it plays, the vessel it came from is drawn empty; `BASIN_MS` says how long that is.
   */
  basin?: { pulse: number; mode: "boil" | "roast"; from: string; liquid: string | null; solid: string | null; residue: string | null; steam: boolean } | null;
  litmus?: { pulse: number; blue: "red" | "white" | "none"; red: "blue" | "white" | "none" } | null;
  focus: boolean;

  /* ---- optional extras: every one may be left out ---- */
  /** Droplets condensing on the inside of the glass (pulse restarts them). Hot liquid makes them anyway. */
  condense?: { colour: string; amount: number; pulse: number } | null;
  /** An explosive pop or bang: flash, fireball and shock ring at the mouth. */
  blast?: { pulse: number; colour: string; strength: number } | null;
  /** A new colour swirling through the liquid (makes a colour change obvious). */
  colourBurst?: { pulse: number; colour: string } | null;
  /** A metal ball skating over the surface (sodium, potassium...). */
  skate?: { pulse: number; colour: string; durationMs: number } | null;
  /** An immiscible layer floating on top (oil). */
  layer?: { colour: string; volumeMl: number; position?: "top" | "bottom" } | null;
  /** A silver mirror plating the inside of the glass (Tollens' test); grows in over a few seconds. */
  mirror?: { colour: string; pulse: number } | null;
  /** Crystals growing at the waterline and on the bottom. */
  crystals?: { colour: string; amount: number; pulse: number; durationMs: number } | null;
  /** Bubble size from the engine's gas cue. */
  bubble?: "fine" | "medium" | "coarse";
  /** A thermometer standing in the beaker; targetC is where the liquid is heading. */
  thermometer?: { targetC: number } | null;
  /** Captions the page draws over the free bench area (kept here so callers can pass one view object). */
  captions?: SceneCaption[];
};

/** A caption beside the beaker. `colour` draws a swatch; `from` + `colour` draw a colour change. */
export type SceneCaption = { id: string; text: string; colour?: string; from?: string; tone?: "info" | "warn" | "bad" };

const U = 0.01;
const BEAKER = KINDS.beaker_250;
const BEAKER_H = 88 * U;
const BEAKER_R = 34 * U;
const PLATE_H = 0.16;
const LIQ_R = BEAKER_R * 0.93;
/** Small volumes are drawn a little taller (a 10 mL puddle would otherwise be a sliver). */
const fillH = (v: PlaygroundView) => Math.pow(Math.min(1, Math.max(0, v.levelMl / v.capacityMl)), 0.62) * (BEAKER_H - 0.06);

/** Pixels covered by panels on each side of the canvas: the camera frames the beaker in what is left. */
export type SceneInsets = { left: number; right: number; top: number; bottom: number };

/** A beaker standing on the bench beside the hot plate, drawn as it was last seen. */
export type BenchBeaker = {
  id: string;
  name: string;
  colour: string;
  opacity: number;
  levelMl: number;
  solid: string | null;
  /** How much it holds when full (the hot-plate vessel's capacity if left out). */
  capacityMl?: number;
  /** A test tube standing in the rack, and which of the rack's holes it is in (0 is the leftmost). */
  tube?: boolean;
  hole?: number;
};

/** Resting beakers are a little smaller than the one being worked on, and line up to the left of the hot plate. */
const REST_SCALE = 0.82;
const REST_STEP = 0.72;
const restSlot = (i: number): [number, number, number] => [-1.14 - i * REST_STEP, 0, 0.2];

/** The test-tube rack stands at the far end of the row of resting beakers. */
const RACK_HOLES = 6;
const HOLE_STEP = 0.15;
const RACK_W = RACK_HOLES * HOLE_STEP + 0.1;
const TUBE_R = 0.05;
const TUBE_H = 0.5;
/** A test tube on the hot plate is drawn as the beaker made this much narrower. */
const TUBE_SX = 0.4;
const rackCentre = (beakers: number) => restSlot(beakers)[0] + BEAKER_R * REST_SCALE - RACK_W / 2;
const rackHole = (beakers: number, hole: number): [number, number, number] => [rackCentre(beakers) + (hole - (RACK_HOLES - 1) / 2) * HOLE_STEP, 0, 0.2];

/** The id `onDropBeaker` reports when a beaker is let go over the filter funnel instead of over another beaker. */
export const FILTER_FUNNEL = "filter-funnel";
/** The funnel stands behind the row of beakers, left of the hot plate, so it never widens the view. */
const FUNNEL_AT: [number, number, number] = [-0.95, 0, -0.85];
const FUNNEL_Y = 1.02;

/** The id `onDropBeaker` reports when a beaker is let go over the Bunsen burner. */
export const BUNSEN_BURNER = "bunsen-burner";
/** What a beaker is dropped on to be heated in the evaporating basin: boiled dry if it holds a solution, heated strongly if it holds a dry solid. */
export const EVAPORATING_BASIN = "evaporating-basin";
/** The basin stands on a tripod and gauze over a burner of its own, at the back of the bench on the right. */
const BASIN_AT: [number, number, number] = [0.66, 0, -0.92];
const GAUZE_Y = 0.8;
const BASIN_S = 0.6;
const BASIN = KINDS.evaporating_basin;
/** How long each heating takes on the bench before what is left goes back in its vessel (ms). */
export const BASIN_MS = { boil: 6400, roast: 5200 } as const;
/** The burner stands behind the hot plate, between it and the funnel: in view, and clear of a bottle held on the right. */
const BURNER_AT: [number, number, number] = [-0.5, 0, -0.95];
/** Height of the top of the burner's barrel, where the flame sits. */
const BURNER_H = 0.42;
/** Seconds into a flame test at which the loop reaches the flame, and at which it is taken out again. */
const LOOP_IN = 1.1;
const LOOP_OUT = 4.4;

/**
 * @param bench other beakers on the bench, in bench order. Any beaker (these, or the one on the plate) can be
 *        dragged onto another: `onDropBeaker` is told which went onto which and where on screen it was let go.
 *        A click without a drag on a resting beaker calls `onOpenBeaker`. Dropping a beaker on the filter
 *        funnel reports `FILTER_FUNNEL` as what it went onto; a click on the funnel calls `onFunnel`.
 *        Dropping one on the Bunsen burner reports `BUNSEN_BURNER`; a click on the burner calls `onBurner`.
 *        Dropping one on the evaporating basin reports `EVAPORATING_BASIN`; a click on it calls `onBasin`.
 */
export function PlaygroundScene({ view, reducedMotion, onBeaker, insets, bench = [], plateId = "plate", onOpenBeaker, onDropBeaker, onFunnel, onBurner, onBasin }: { view: PlaygroundView; reducedMotion: boolean; onBeaker?: () => void; insets?: SceneInsets; bench?: BenchBeaker[]; plateId?: string; onOpenBeaker?: (id: string) => void; onDropBeaker?: (from: string, onto: string, at: { x: number; y: number }) => void; onFunnel?: () => void; onBurner?: () => void; onBasin?: () => void }) {
  const [quality, setQuality] = useState<Quality>(() => (((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? "lite" : "high"));
  // The camera keeps the hot plate and every resting beaker in view: the frame only widens when there is more than one beaker.
  const resting = bench.filter((b) => !b.tube).length;
  const rack = view.vessel === "tube" || bench.some((b) => b.tube);
  const frameMinX = rack ? rackCentre(resting) - RACK_W / 2 - 0.16 : resting ? restSlot(resting - 1)[0] - BEAKER_R * REST_SCALE - 0.16 : -FRAME_W / 2;
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
      <CameraRig focus={view.focus} pulse={view.reactionPulse} blast={view.blast?.pulse ?? 0} reducedMotion={reducedMotion} insets={insets} minX={view.focus ? -FRAME_W / 2 : frameMinX} />
      <hemisphereLight args={["#bcd4ff", "#0b1020", 0.4]} />
      <directionalLight position={[3, 7, 4]} intensity={1.3} castShadow={quality === "high"} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <pointLight position={[-4, 3.6, -2.5]} intensity={10} color="#3a8cff" distance={12} decay={1.6} />
      <pointLight position={[4, 3.2, -2]} intensity={7} color="#c46bff" distance={11} decay={1.6} />
      <Backdrop />
      <BenchTop />
      {!reducedMotion && <Dust count={quality === "high" ? 220 : 80} />}
      <HotPlate plateC={view.plateC} stirring={view.stirring} />
      {view.iceBath && <IceBath reducedMotion={reducedMotion} />}
      <Beakers view={view} quality={quality} reducedMotion={reducedMotion} bench={view.focus ? [] : bench} plateId={plateId} funnel={!view.focus && !!onDropBeaker} onBeaker={onBeaker} onOpen={onOpenBeaker} onDrop={onDropBeaker} onFunnel={onFunnel} onBurner={onBurner} onBasin={onBasin} />
      {view.held && <Held held={view.held} view={view} quality={quality} reducedMotion={reducedMotion} />}
      {quality === "high" && (
        <EffectComposer multisampling={4}>
          {/* only what is lit from within (flames, the hot plate, sparks) blooms; a white solid or the filter paper does not */}
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0.6} radius={0.7} />
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
const TARGET = new THREE.Vector3(0, 0.98, 0);
const VIEW_DIR = new THREE.Vector3(0, 1.52, 4.6).normalize();
const FOCUS_DIR = new THREE.Vector3(0, 0.67, 2.6).normalize();
/** World-space box the camera keeps in view: the beaker on its plate with a bottle held above it. */
const FRAME_W = 2.0;
const FRAME_H = 2.45;

function CameraRig({ focus, pulse, blast, reducedMotion, insets, minX = -FRAME_W / 2 }: { focus: boolean; pulse: number; blast: number; reducedMotion: boolean; insets?: SceneInsets | undefined; minX?: number }) {
  const { camera, size } = useThree();
  const controls = useRef<{ update: () => void } | null>(null);
  const want = useMemo(() => new THREE.Vector3(), []);
  const moving = useRef(true);
  const kick = useRef(0);
  const dist = useRef(4.9);
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets ?? {};
  const offWant = useRef({ x: 0, y: 0 });
  const offNow = useRef({ x: 0, y: 0 });
  const sized = useRef({ w: 0, h: 0 });
  const applyOffset = () => {
    const cam = camera as THREE.PerspectiveCamera;
    const { x, y } = offNow.current;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, -x, -y, size.width, size.height);
    cam.updateProjectionMatrix();
  };
  // Centre the beaker in the free space between panels (a view offset shifts the image without
  // changing the perspective) and pull back until the frame fits that space.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const W = size.width;
    const H = size.height;
    const fw = Math.max(160, W - left - right);
    const fh = Math.max(160, H - top - bottom);
    // The frame runs from the leftmost resting beaker to the bottle held on the right of the plate.
    const frameW = FRAME_W / 2 - minX;
    const ppu = Math.min(fw / frameW, fh / FRAME_H);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    dist.current = THREE.MathUtils.clamp(H / (ppu * 2 * tan), 3.2, 12);
    // Pixels per world unit at the plate once the distance is clamped: slides the image so the frame's middle, not the plate, is centred.
    const scale = H / (2 * tan * dist.current);
    const middle = (minX + FRAME_W / 2) / 2;
    offWant.current = { x: left + fw / 2 - W / 2 - middle * scale, y: top + fh / 2 - H / 2 };
    // A resize applies at once; a panel opening glides (see useFrame).
    if (sized.current.w !== W || sized.current.h !== H) offNow.current = { ...offWant.current };
    sized.current = { w: W, h: H };
    applyOffset();
    moving.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, left, right, top, bottom, minX]);
  useEffect(() => {
    moving.current = true;
  }, [focus]);
  useEffect(() => {
    if (pulse && !reducedMotion) kick.current = 1;
  }, [pulse, reducedMotion]);
  useEffect(() => {
    // An explosion shakes the bench harder than an ordinary reaction.
    if (blast && !reducedMotion) kick.current = 3;
  }, [blast, reducedMotion]);
  useFrame(({ clock }, dt) => {
    const o = offNow.current;
    const w = offWant.current;
    if (Math.abs(o.x - w.x) > 0.5 || Math.abs(o.y - w.y) > 0.5) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
      o.x += (w.x - o.x) * k;
      o.y += (w.y - o.y) * k;
      applyOffset();
    }
    if (moving.current) {
      want.copy(TARGET).addScaledVector(focus ? FOCUS_DIR : VIEW_DIR, focus ? dist.current * 0.58 : dist.current);
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
  return <OrbitControls ref={controls as never} makeDefault target={[TARGET.x, TARGET.y, TARGET.z]} enablePan={false} minDistance={1.6} maxDistance={12} minPolarAngle={0.3} maxPolarAngle={1.35} enableDamping={!reducedMotion} />;
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
      {/* the hot zone around the beaker: dark when off, glowing red-orange as it heats */}
      <mesh position={[0, PLATE_H + 0.002, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[BEAKER_R + 0.1, 0.5, 64]} />
        <meshStandardMaterial color="#120806" emissive="#ff4a12" emissiveIntensity={heat * 2.6} toneMapped={false} transparent opacity={0.92} />
      </mesh>
      {heat > 0 && <HeatHaze heat={heat} />}
      {heat > 0 && <pointLight position={[0, PLATE_H + 0.25, 0]} color="#ff7a3d" intensity={2 + 9 * heat} distance={2.6} />}
      {/* status bar on the front: blue when off, filling orange with heat */}
      <mesh position={[0, PLATE_H * 0.55, 0.526]}>
        <boxGeometry args={[0.5, 0.035, 0.004]} />
        <meshStandardMaterial color="#0b1020" />
      </mesh>
      <mesh position={[-0.25 + 0.25 * Math.max(0.04, heat), PLATE_H * 0.55, 0.529]}>
        <boxGeometry args={[0.5 * Math.max(0.04, heat), 0.03, 0.004]} />
        <meshBasicMaterial color={heat > 0 ? "#ff8a3d" : cold ? "#7cc4ff" : "#2f80ff"} toneMapped={false} />
      </mesh>
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={x} position={[x, PLATE_H * 0.55, 0.53]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 24]} />
          <meshStandardMaterial color={i === 0 ? (heat > 0 ? "#ff8a3d" : cold ? "#7cc4ff" : "#3b4252") : stirring ? "#3d8bff" : "#3b4252"} metalness={0.6} roughness={0.3} emissive={i === 0 ? (heat > 0 ? "#ff6a2b" : "#000") : stirring ? "#3d8bff" : "#000"} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Shimmering columns of hot air above the plate. */
function HeatHaze({ heat }: { heat: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const t = (clock.elapsedTime * (0.35 + heat * 0.4) + i / 6) % 1;
      c.position.y = PLATE_H + 0.05 + t * 0.55;
      c.scale.set(0.9 + t * 0.6, 1, 1);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.16 * heat * Math.sin(Math.PI * t);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.44, PLATE_H, Math.sin(a) * 0.36]} rotation-y={-a}>
            <planeGeometry args={[0.16, 0.22]} />
            <meshBasicMaterial color="#ff9a5a" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function IceBath({ reducedMotion }: { reducedMotion: boolean }) {
  const cubes = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2 * 2 + (i % 2) * 0.25;
        const r = BEAKER_R + 0.1 + (i % 3) * 0.055;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.05 + (i % 5) * 0.045, rx: i * 0.7, ry: i * 1.3, s: 0.07 + (i % 3) * 0.02 };
      }),
    [],
  );
  const mist = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!mist.current || reducedMotion) return;
    mist.current.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.16 + i / 14) % 1;
      const a = i * 0.45 + t * 0.6;
      // Cold mist spills over the rim and rolls down onto the bench.
      const r = BEAKER_R + 0.3 + t * 0.25;
      c.position.set(Math.cos(a) * r, 0.36 - t * 0.32, Math.sin(a) * r);
      c.scale.setScalar(0.09 + t * 0.16);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.42 * Math.sin(Math.PI * t);
    });
  });
  return (
    <group position={[0, PLATE_H, 0]}>
      {/* the bowl: frosted blue plastic so it reads clearly */}
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[BEAKER_R + 0.3, BEAKER_R + 0.22, 0.34, 48, 1, true]} />
        <meshPhysicalMaterial color="#8fd0ff" transparent opacity={0.38} roughness={0.35} side={THREE.DoubleSide} depthWrite={false} emissive="#2a7fd0" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.34, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[BEAKER_R + 0.3, 0.012, 8, 64]} />
        <meshStandardMaterial color="#cfeaff" emissive="#7cc4ff" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      {/* icy water */}
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[BEAKER_R + 0.28, BEAKER_R + 0.22, 0.24, 48]} />
        <meshStandardMaterial color="#5fb4ff" transparent opacity={0.3} roughness={0.1} depthWrite={false} />
      </mesh>
      {cubes.map((c, i) => (
        <mesh key={i} position={[c.x, c.y + 0.02, c.z]} rotation={[c.rx, c.ry, 0]} castShadow>
          <boxGeometry args={[c.s, c.s * 0.85, c.s]} />
          <meshStandardMaterial color="#eaf7ff" emissive="#8fd3ff" emissiveIntensity={0.35} roughness={0.15} transparent opacity={0.9} />
        </mesh>
      ))}
      <group ref={mist}>
        {Array.from({ length: 14 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color="#f0f8ff" transparent opacity={0} depthWrite={false} roughness={1} />
          </mesh>
        ))}
      </group>
      <pointLight position={[0, 0.5, 0.3]} color="#7cc4ff" intensity={3} distance={2} />
    </group>
  );
}

/* ------------------------------------------------------------------ beakers on the bench: click one, or drag one onto another */

type DragState = { id: string; x0: number; y0: number; moving: boolean };

/**
 * The beaker on the hot plate and the ones resting beside it. Each can be picked up and carried: letting it
 * go over another beaker reports the drop (the page then asks how much to pour). A press that never moves is
 * a click. While a beaker is being carried the camera is locked, so the bench does not spin under it.
 */
function Beakers({ view, quality, reducedMotion, bench, plateId, funnel, onBeaker, onOpen, onDrop, onFunnel, onBurner, onBasin }: { view: PlaygroundView; quality: Quality; reducedMotion: boolean; bench: BenchBeaker[]; plateId: string; funnel: boolean; onBeaker?: (() => void) | undefined; onOpen?: ((id: string) => void) | undefined; onDrop?: ((from: string, onto: string, at: { x: number; y: number }) => void) | undefined; onFunnel?: (() => void) | undefined; onBurner?: (() => void) | undefined; onBasin?: (() => void) | undefined }) {
  const controls = useThree((st) => st.controls) as { enabled: boolean } | null;
  const camera = useThree((st) => st.camera);
  const gl = useThree((st) => st.gl);
  const probe = useMemo(() => new THREE.Vector3(), []);
  /**
   * Is the pointer on something that stands at `at` and reaches from `low` to `high`, as it appears on screen?
   * The funnel stand and the burner are set back, so where they look to be and where they stand on the bench
   * are different places: this is judged in screen pixels.
   */
  const onStanding = (at: [number, number, number], low: number, high: number, reach: number, clientX: number, clientY: number) => {
    const r = gl.domElement.getBoundingClientRect();
    const px = (y: number): [number, number] => {
      probe.set(at[0], y, at[2]).project(camera);
      return [r.left + ((probe.x + 1) / 2) * r.width, r.top + ((1 - probe.y) / 2) * r.height];
    };
    const [ax, ay] = px(low);
    const [bx, by] = px(high);
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = Math.max(0, Math.min(1, ((clientX - ax) * (bx - ax) + (clientY - ay) * (by - ay)) / Math.max(1, len2)));
    return Math.hypot(clientX - (ax + (bx - ax) * t), clientY - (ay + (by - ay) * t)) < Math.sqrt(len2) * reach;
  };
  const groups = useRef(new Map<string, THREE.Group>());
  const drag = useRef<DragState | null>(null);
  const overRef = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [carried, setCarried] = useState<string | null>(null);
  const glass = useGlass("lite");
  const glassGeom = useMemo(() => lathe(BEAKER.profile), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const beakers = useMemo(() => bench.filter((b) => !b.tube), [bench]);
  const tubes = useMemo(() => bench.filter((b) => b.tube), [bench]);
  const narrow = view.vessel === "tube";
  const rack = narrow || tubes.length > 0;
  const homes = useMemo(() => {
    const m = new Map<string, [number, number, number]>([[plateId, [0, PLATE_H, 0]]]);
    beakers.forEach((b, i) => m.set(b.id, restSlot(i)));
    tubes.forEach((b, i) => m.set(b.id, rackHole(beakers.length, b.hole ?? i)));
    return m;
  }, [beakers, tubes, plateId]);
  // With the funnel on the bench there is always somewhere to carry a beaker, even a lone one.
  const canDrag = !!onDrop && (bench.length > 0 || funnel);
  // What a vessel held is in the basin while it is being heated there: the vessel stands empty until it comes back.
  const [inBasin, setInBasin] = useState<string | null>(null);
  const basinPulse = view.basin?.pulse ?? 0;
  const basinSeen = useRef(basinPulse);
  useEffect(() => {
    if (!view.basin || basinPulse === basinSeen.current) return;
    basinSeen.current = basinPulse;
    setInBasin(view.basin.from);
    const t = setTimeout(() => setInBasin(null), reducedMotion ? 0 : BASIN_MS[view.basin.mode]);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basinPulse]);
  const plateView = useMemo(() => (inBasin === plateId ? { ...view, levelMl: 0, precipitate: null, solid: null, crystals: null } : view), [inBasin, plateId, view]);

  const release = () => {
    drag.current = null;
    overRef.current = null;
    setOver(null);
    setCarried(null);
    if (controls) controls.enabled = true;
  };
  // If the scene goes away mid-drag (focus mode, a panel covering it), never leave the camera locked.
  useEffect(() => () => {
    if (controls) controls.enabled = true;
  }, [controls]);

  useFrame((_, dt) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    for (const [id, g] of groups.current) {
      const home = homes.get(id);
      if (!home) continue;
      const held = drag.current?.id === id && drag.current.moving;
      if (!held) {
        g.position.x += (home[0] - g.position.x) * k;
        g.position.y += (home[1] - g.position.y) * k;
        g.position.z += (home[2] - g.position.z) * k;
      }
      // A carried beaker leans towards the one it would pour into.
      const target = held && overRef.current ? (overRef.current === FILTER_FUNNEL ? FUNNEL_AT : overRef.current === BUNSEN_BURNER ? BURNER_AT : overRef.current === EVAPORATING_BASIN ? BASIN_AT : homes.get(overRef.current)) : null;
      const lean = target ? (target[0] < g.position.x ? 0.42 : -0.42) : 0;
      g.rotation.z += (lean - g.rotation.z) * k;
    }
  });

  const handlers = (id: string) => ({
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      (e.target as unknown as Element).setPointerCapture(e.pointerId);
      drag.current = { id, x0: e.nativeEvent.clientX, y0: e.nativeEvent.clientY, moving: false };
      if (controls) controls.enabled = false;
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const d = drag.current;
      if (!d || d.id !== id || !canDrag) return;
      if (!d.moving) {
        if (Math.hypot(e.nativeEvent.clientX - d.x0, e.nativeEvent.clientY - d.y0) < 6) return;
        d.moving = true;
        setCarried(id);
      }
      const g = groups.current.get(id);
      if (!g || !e.ray.intersectPlane(plane, hit)) return;
      g.position.set(THREE.MathUtils.clamp(hit.x, -4.2, 2.2), (id === plateId ? PLATE_H : 0) + 0.2, THREE.MathUtils.clamp(hit.z, -0.9, 1.3));
      // The nearest other beaker within reach is where it would be poured.
      let best: string | null = null;
      let bestD = 0.7;
      for (const [other, home] of homes) {
        if (other === id) continue;
        const dd = Math.hypot(g.position.x - home[0], g.position.z - home[2]);
        if (dd < bestD) {
          bestD = dd;
          best = other;
        }
      }
      if (funnel && onStanding(FUNNEL_AT, 0.25, FUNNEL_Y + 0.25, 0.36, e.nativeEvent.clientX, e.nativeEvent.clientY)) best = FILTER_FUNNEL;
      else if (funnel && onStanding(BURNER_AT, 0, BURNER_H + 0.4, 0.42, e.nativeEvent.clientX, e.nativeEvent.clientY)) best = BUNSEN_BURNER;
      else if (funnel && onStanding(BASIN_AT, 0.1, GAUZE_Y + 0.3, 0.36, e.nativeEvent.clientX, e.nativeEvent.clientY)) best = EVAPORATING_BASIN;
      if (best !== overRef.current) {
        overRef.current = best;
        setOver(best);
      }
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      const d = drag.current;
      if (!d || d.id !== id) return;
      e.stopPropagation();
      (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
      const onto = overRef.current;
      release();
      if (!d.moving) {
        if (id === plateId) onBeaker?.();
        else onOpen?.(id);
      } else if (onto) onDrop?.(id, onto, { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    },
    onPointerCancel: release,
    onLostPointerCapture: () => {
      if (drag.current?.id === id) release();
    },
    onPointerOver: () => {
      if (canDrag || id !== plateId) document.body.style.cursor = "grab";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  });
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);
  const keep = (id: string) => (g: THREE.Group | null) => {
    if (g) groups.current.set(id, g);
    else groups.current.delete(id);
  };

  return (
    <>
      <group ref={keep(plateId)} position={[0, PLATE_H, 0]} {...handlers(plateId)}>
        <group scale={narrow ? [TUBE_SX, 1, TUBE_SX] : 1}>
          <BeakerWithContents view={plateView} quality={quality} reducedMotion={reducedMotion} />
        </group>
        {over === plateId && <DropRing radius={narrow ? BEAKER_R * TUBE_SX + 0.1 : BEAKER_R + 0.12} />}
        <GlowSplint test={view.glowSplint ?? null} narrow={narrow} reducedMotion={reducedMotion} />
        <LitmusPapers test={view.litmus ?? null} reducedMotion={reducedMotion} />
      </group>
      {rack && <TubeRack x={rackCentre(beakers.length)} />}
      {tubes.map((b, i) => (
        <group key={b.id} ref={keep(b.id)} position={rackHole(beakers.length, b.hole ?? i)} {...handlers(b.id)}>
          <RestingTube b={inBasin === b.id ? { ...b, levelMl: 0, solid: null } : b} glass={glass} />
          {over === b.id && <DropRing radius={TUBE_R + 0.06} />}
          {carried !== b.id && (
            <Html position={[0, TUBE_H + 0.13, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
              <div style={{ whiteSpace: "nowrap", padding: over === b.id ? "2px 8px" : "1px 5px", borderRadius: 8, background: over === b.id ? "rgba(60,44,6,.92)" : "rgba(8,16,40,.8)", border: `1px solid ${over === b.id ? "#ffc23d" : "rgba(140,180,255,.25)"}`, color: over === b.id ? "#ffd98a" : "#dbe7ff", font: `600 ${over === b.id ? 12 : 10}px Inter, system-ui, sans-serif` }}>
                {over === b.id ? `Pour into ${b.name}` : b.name}
              </div>
            </Html>
          )}
        </group>
      ))}
      {funnel && <FilterStand over={over === FILTER_FUNNEL} carrying={carried !== null} onClick={onFunnel} />}
      {funnel && <BunsenBurner test={view.flameTest ?? null} from={view.flameTest ? (homes.get(view.flameTest.from) ?? homes.get(plateId)!) : null} over={over === BUNSEN_BURNER} carrying={carried !== null} reducedMotion={reducedMotion} onClick={onBurner} />}
      {funnel && <BasinStand heating={view.basin ?? null} over={over === EVAPORATING_BASIN} carrying={carried !== null} reducedMotion={reducedMotion} onClick={onBasin} />}
      {beakers.map((b, i) => (
        <group key={b.id} ref={keep(b.id)} position={restSlot(i)} {...handlers(b.id)}>
          <group scale={REST_SCALE}>
            <RestingBeaker b={inBasin === b.id ? { ...b, levelMl: 0, solid: null } : b} capacityMl={b.capacityMl ?? view.capacityMl} glass={glass} glassGeom={glassGeom} />
            {over === b.id && <DropRing radius={BEAKER_R + 0.12} />}
          </group>
          {carried !== b.id && (
            <Html position={[0, BEAKER_H * REST_SCALE + 0.16, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
              <div style={{ whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 9, background: over === b.id ? "rgba(60,44,6,.92)" : "rgba(8,16,40,.85)", border: `1px solid ${over === b.id ? "#ffc23d" : "rgba(140,180,255,.3)"}`, color: over === b.id ? "#ffd98a" : "#dbe7ff", font: "600 12px Inter, system-ui, sans-serif" }}>
                {over === b.id ? `Pour into ${b.name}` : `${b.name}${b.levelMl > 0.05 ? ` · ${b.levelMl < 10 ? b.levelMl.toFixed(1) : Math.round(b.levelMl)} mL` : b.solid ? " · solid" : " · empty"}`}
              </div>
            </Html>
          )}
        </group>
      ))}
    </>
  );
}

/** A glowing ring on the bench under the beaker a carried one would be poured into. */
function DropRing({ radius }: { radius: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]}>
      <ringGeometry args={[radius, radius + 0.045, 48]} />
      <meshBasicMaterial color="#ffc23d" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

/** A beaker that is not being worked on: glass, its liquid at the right level and colour, and any solid at the bottom. */
function RestingBeaker({ b, capacityMl, glass, glassGeom }: { b: BenchBeaker; capacityMl: number; glass: THREE.Material; glassGeom: THREE.BufferGeometry }) {
  const h = Math.pow(Math.min(1, Math.max(0, b.levelMl / capacityMl)), 0.62) * (BEAKER_H - 0.06);
  return (
    <group>
      {h > 0.004 && (
        <>
          <mesh position={[0, 0.012 + h / 2, 0]} renderOrder={1}>
            <cylinderGeometry args={[LIQ_R, LIQ_R, h, 32, 1]} />
            <meshStandardMaterial color={b.colour} emissive={b.colour} emissiveIntensity={0.08 + b.opacity * 0.12} transparent opacity={Math.min(0.96, 0.24 + b.opacity * 0.72)} roughness={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0.012 + h, 0]} rotation-x={-Math.PI / 2} renderOrder={2}>
            <circleGeometry args={[LIQ_R, 32]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.3} roughness={0} depthWrite={false} />
          </mesh>
        </>
      )}
      {b.solid && (
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[LIQ_R * 0.82, LIQ_R * 0.9, 0.035, 24]} />
          <meshStandardMaterial color={b.solid} roughness={0.9} />
        </mesh>
      )}
      <mesh geometry={glassGeom} material={glass} renderOrder={3} />
      {/* an easy thing to grab: the glass itself is thin and see-through */}
      <mesh position={[0, BEAKER_H / 2, 0]} visible={false}>
        <cylinderGeometry args={[BEAKER_R + 0.04, BEAKER_R + 0.04, BEAKER_H, 12]} />
      </mesh>
    </group>
  );
}

/** A test tube standing in the rack: glass, what is in it, and any solid at the bottom. */
function RestingTube({ b, glass }: { b: BenchBeaker; glass: THREE.Material }) {
  const inner = TUBE_R * 0.84;
  const h = Math.min(1, Math.max(0, b.levelMl / (b.capacityMl ?? 20))) * (TUBE_H - 0.08);
  const y0 = 0.03 + TUBE_R;
  return (
    <group>
      {h > 0.004 && (
        <mesh position={[0, y0 + h / 2, 0]} renderOrder={1}>
          <cylinderGeometry args={[inner, inner, h, 16]} />
          <meshStandardMaterial color={b.colour} emissive={b.colour} emissiveIntensity={0.08 + b.opacity * 0.12} transparent opacity={Math.min(0.96, 0.3 + b.opacity * 0.66)} roughness={0.08} depthWrite={false} />
        </mesh>
      )}
      {b.solid && (
        <mesh position={[0, y0 + 0.012, 0]}>
          <cylinderGeometry args={[inner, inner * 0.8, 0.035, 12]} />
          <meshStandardMaterial color={b.solid} roughness={0.9} />
        </mesh>
      )}
      <mesh position={[0, y0 + (TUBE_H - TUBE_R) / 2, 0]} material={glass} renderOrder={3}>
        <cylinderGeometry args={[TUBE_R, TUBE_R, TUBE_H - TUBE_R, 20, 1, true]} />
      </mesh>
      <mesh position={[0, y0, 0]} rotation-x={Math.PI} material={glass} renderOrder={3}>
        <sphereGeometry args={[TUBE_R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* an easy thing to grab: the glass itself is thin and see-through */}
      <mesh position={[0, 0.03 + TUBE_H / 2, 0]} visible={false}>
        <cylinderGeometry args={[TUBE_R + 0.025, TUBE_R + 0.025, TUBE_H, 8]} />
      </mesh>
    </group>
  );
}

/** A wooden test-tube rack: a base, a shelf the tubes pass through, and the two ends that hold it up. */
function TubeRack({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0.2]}>
      <mesh position={[0, 0.015, 0]} castShadow>
        <boxGeometry args={[RACK_W, 0.03, 0.24]} />
        <meshStandardMaterial color="#8a6a45" roughness={0.8} />
      </mesh>
      {/* the shelf is two rails, so the tubes between them stay in view */}
      {[-0.085, 0.085].map((z) => (
        <mesh key={z} position={[0, 0.3, z]}>
          <boxGeometry args={[RACK_W, 0.022, 0.05]} />
          <meshStandardMaterial color="#8a6a45" roughness={0.8} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (RACK_W / 2 - 0.015), 0.16, 0]}>
          <boxGeometry args={[0.03, 0.3, 0.24]} />
          <meshStandardMaterial color="#7a5c3b" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A filter funnel in a ring on a retort stand, with a folded filter paper in it. Carry a beaker to it and let
 * go to filter that beaker: the liquid runs through, the solid stays on the paper.
 */
function FilterStand({ over, carrying, onClick }: { over: boolean; carrying: boolean; onClick?: (() => void) | undefined }) {
  const glass = useGlass("lite");
  return (
    <group position={FUNNEL_AT} onClick={(e) => (e.stopPropagation(), onClick?.())}>
      <mesh position={[-0.06, 0.02, 0]} castShadow>
        <boxGeometry args={[0.56, 0.04, 0.36]} />
        <meshStandardMaterial color="#2a3350" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[-0.26, 0.7, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 1.36, 12]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      {/* boss and arm holding the ring */}
      <mesh position={[-0.26, FUNNEL_Y, 0]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshStandardMaterial color="#6b7690" roughness={0.4} metalness={0.8} />
      </mesh>
      <mesh position={[-0.19, FUNNEL_Y, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[0, FUNNEL_Y, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.125, 0.012, 8, 32]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      {/* the glass funnel: cone and stem */}
      <mesh position={[0, FUNNEL_Y + 0.06, 0]} material={glass} renderOrder={3}>
        <cylinderGeometry args={[0.21, 0.028, 0.22, 32, 1, true]} />
      </mesh>
      <mesh position={[0, FUNNEL_Y - 0.17, 0]} material={glass} renderOrder={3}>
        <cylinderGeometry args={[0.028, 0.02, 0.24, 16, 1, true]} />
      </mesh>
      {/* the filter paper sitting in it */}
      <mesh position={[0, FUNNEL_Y + 0.075, 0]}>
        <cylinderGeometry args={[0.192, 0.012, 0.19, 32, 1, true]} />
        <meshStandardMaterial color="#f7f3e6" emissive={over ? "#ffc23d" : "#000000"} emissiveIntensity={over ? 0.5 : 0} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {over && <DropRing radius={0.34} />}
      <Html position={[0, FUNNEL_Y + 0.36, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 9, background: over ? "rgba(60,44,6,.92)" : "rgba(8,16,40,.85)", border: `1px solid ${over ? "#ffc23d" : carrying ? "rgba(255,194,61,.55)" : "rgba(140,180,255,.3)"}`, color: over ? "#ffd98a" : "#dbe7ff", font: "600 12px Inter, system-ui, sans-serif" }}>
          {over ? "Filter it here" : "Filter funnel"}
        </div>
      </Html>
    </group>
  );
}

/** How long a gas test stays at the mouth of the vessel, and when its result shows. */
const GAS_TEST_S = 4.2;
const GAS_TEST_SHOWS = 0.9;

/**
 * The glowing-splint test: a splint that has been blown out, still glowing at its tip, is held in the mouth
 * of the vessel. In oxygen it bursts back into flame; a gas that will not let things burn kills the glow.
 */
function GlowSplint({ test, narrow, reducedMotion }: { test: NonNullable<PlaygroundView["glowSplint"]> | null; narrow: boolean; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ember = useRef<THREE.MeshStandardMaterial>(null);
  const flame = useRef<THREE.Group>(null);
  const seen = useRef(test?.pulse ?? 0);
  const started = useRef(-1);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (test && test.pulse !== seen.current) {
      seen.current = test.pulse;
      started.current = t;
    }
    const age = started.current < 0 ? Infinity : t - started.current;
    const on = age < GAS_TEST_S;
    const g = group.current;
    if (!g) return;
    g.visible = on;
    if (!on) return;
    const inT = Math.min(1, age / 0.35);
    const outT = Math.max(0, (age - (GAS_TEST_S - 0.4)) / 0.4);
    const k = reducedMotion ? 1 : (1 - Math.pow(1 - inT, 3)) * (1 - outT);
    g.position.set((narrow ? 0.02 : 0.06) + (1 - k) * 0.9, BEAKER_H + 0.04 + (1 - k) * 0.35, 0.02);
    const shown = reducedMotion || age >= GAS_TEST_SHOWS;
    const result = test?.result ?? "none";
    // the ember breathes while it glows; it dies in a gas that puts it out, and is lost in the flame when it relights
    if (ember.current) ember.current.emissiveIntensity = shown && result === "out" ? Math.max(0, 2 - (age - GAS_TEST_SHOWS) * 4) : 1.8 + (reducedMotion ? 0 : Math.sin(t * 6) * 0.5);
    if (flame.current) {
      const lit = shown && result === "relights";
      flame.current.visible = lit;
      if (lit) {
        const grow = reducedMotion ? 1 : Math.min(1, (age - GAS_TEST_SHOWS) / 0.25);
        flame.current.scale.set(grow * (1 + (reducedMotion ? 0 : Math.sin(age * 31) * 0.1)), grow * (1 + (reducedMotion ? 0 : Math.sin(age * 23) * 0.2)), grow);
      }
    }
  });
  return (
    <group ref={group} visible={false}>
      <mesh position={[0.32, 0.06, 0]} rotation-z={Math.PI / 2 - 0.35}>
        <cylinderGeometry args={[0.012, 0.012, 0.7, 8]} />
        <meshStandardMaterial color="#c9955a" roughness={0.8} />
      </mesh>
      <mesh position={[0.01, -0.005, 0]}>
        <sphereGeometry args={[0.02, 10, 8]} />
        <meshStandardMaterial ref={ember} color="#2a1408" emissive="#ff5a1a" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <group ref={flame} position={[0, 0.02, 0]} visible={false}>
        {[1, 0.6].map((sc, i) => (
          <mesh key={sc} position={[0, 0.07 * sc, 0]}>
            <coneGeometry args={[0.04 * sc, 0.16 * sc, 16, 1, true]} />
            <meshBasicMaterial color={i ? "#fff3c4" : "#ff9a2e"} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const PAPER = { blue: new THREE.Color("#3f6fd8"), red: new THREE.Color("#d8524a"), white: new THREE.Color("#f4f1ea") };

/**
 * Damp litmus papers held over the mouth of the vessel, one blue and one red. An acidic gas turns the blue one
 * red, an alkaline gas turns the red one blue, and chlorine bleaches them (the blue one goes red on its way).
 */
function LitmusPapers({ test, reducedMotion }: { test: NonNullable<PlaygroundView["litmus"]> | null; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const blue = useRef<THREE.MeshStandardMaterial>(null);
  const red = useRef<THREE.MeshStandardMaterial>(null);
  const seen = useRef(test?.pulse ?? 0);
  const started = useRef(-1);
  const mixed = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (test && test.pulse !== seen.current) {
      seen.current = test.pulse;
      started.current = t;
    }
    const age = started.current < 0 ? Infinity : t - started.current;
    const on = age < GAS_TEST_S + 0.6;
    const g = group.current;
    if (!g) return;
    g.visible = on;
    if (!on) return;
    const inT = Math.min(1, age / 0.35);
    const outT = Math.max(0, (age - (GAS_TEST_S + 0.2)) / 0.4);
    const k = reducedMotion ? 1 : (1 - Math.pow(1 - inT, 3)) * (1 - outT);
    g.position.set(0, BEAKER_H + 0.17 + (1 - k) * 0.5, 0);
    // how far the change has gone: 0 before it shows, 1 once it is complete
    const f = reducedMotion ? 1 : Math.max(0, Math.min(1, (age - GAS_TEST_SHOWS) / 1.1));
    if (blue.current) {
      const to = test?.blue ?? "none";
      // bleaching passes through red first: the gas is acidic before it bleaches
      if (to === "white") blue.current.color.copy(f < 0.5 ? mixed.copy(PAPER.blue).lerp(PAPER.red, f * 2) : mixed.copy(PAPER.red).lerp(PAPER.white, (f - 0.5) * 2));
      else blue.current.color.copy(mixed.copy(PAPER.blue).lerp(to === "red" ? PAPER.red : PAPER.blue, f));
    }
    if (red.current) {
      const to = test?.red ?? "none";
      red.current.color.copy(mixed.copy(PAPER.red).lerp(to === "blue" ? PAPER.blue : to === "white" ? PAPER.white : PAPER.red, f));
    }
  });
  return (
    <group ref={group} visible={false}>
      {/* the tweezers holding the two strips */}
      <mesh position={[0.2, 0.13, 0]} rotation-z={Math.PI / 2 - 0.25}>
        <cylinderGeometry args={[0.006, 0.006, 0.42, 6]} />
        <meshStandardMaterial color="#c0c7d4" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[-0.032, 0, 0]}>
        <boxGeometry args={[0.05, 0.2, 0.004]} />
        <meshStandardMaterial ref={blue} color="#3f6fd8" roughness={0.9} />
      </mesh>
      <mesh position={[0.032, 0, 0]}>
        <boxGeometry args={[0.05, 0.2, 0.004]} />
        <meshStandardMaterial ref={red} color="#d8524a" roughness={0.9} />
      </mesh>
    </group>
  );
}

const BURNER_BLUE = new THREE.Color("#4aa8ff");

/**
 * A lit Bunsen burner. Carry a beaker to it (or click it) for a flame test: a wire loop takes a little of the
 * beaker's contents into the flame, and the flame burns the colour of the metal in it.
 */
function BunsenBurner({ test, from, over, carrying, reducedMotion, onClick }: { test: NonNullable<PlaygroundView["flameTest"]> | null; from: [number, number, number] | null; over: boolean; carrying: boolean; reducedMotion: boolean; onClick?: (() => void) | undefined }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const loop = useRef<THREE.Group>(null);
  // a test that was already over when the burner came into view is not played again
  const seen = useRef(test?.pulse ?? 0);
  const started = useRef(-1);
  const colour = useMemo(() => new THREE.Color(), []);
  const top: [number, number, number] = [BURNER_AT[0], BURNER_H + 0.16, BURNER_AT[2]];

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (test && test.pulse !== seen.current) {
      seen.current = test.pulse;
      started.current = t;
    }
    const age = started.current < 0 ? Infinity : t - started.current;
    const inFlame = age >= (reducedMotion ? 0 : LOOP_IN) && age < LOOP_OUT;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    const flicker = reducedMotion ? 1 : 1 + Math.sin(t * 17) * 0.05 + Math.sin(t * 29) * 0.03;
    if (outer.current) {
      const m = outer.current.material as THREE.MeshBasicMaterial;
      m.color.lerp(inFlame && test?.colour ? colour.set(test.colour) : BURNER_BLUE, k);
      // a coloured flame is taller and fuller than the quiet blue one
      const grow = inFlame && test?.colour ? 1.35 : 1;
      outer.current.scale.x += (grow - outer.current.scale.x) * k;
      outer.current.scale.z = outer.current.scale.x;
      outer.current.scale.y = (outer.current.scale.y + (grow - outer.current.scale.y) * k) * 1;
      outer.current.position.y = BURNER_H + 0.16 * outer.current.scale.y * flicker;
    }
    if (inner.current) inner.current.scale.y = flicker;
    const g = loop.current;
    if (g) {
      const src = from ?? [0, PLATE_H, 0];
      const above: [number, number, number] = [src[0], src[1] + BEAKER_H + 0.3, src[2]];
      const dipped: [number, number, number] = [src[0], src[1] + 0.1, src[2]];
      g.visible = age < LOOP_OUT + 0.5;
      if (g.visible) {
        const mix = (a: [number, number, number], b: [number, number, number], f: number) => {
          const e = f * f * (3 - 2 * f);
          g.position.set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e);
        };
        if (reducedMotion || age >= LOOP_IN) mix(top, [top[0], top[1] + 0.5, top[2]], age < LOOP_OUT ? 0 : Math.min(1, (age - LOOP_OUT) / 0.5));
        else if (age < 0.4) mix(above, dipped, age / 0.4);
        else if (age < 0.7) mix(dipped, above, (age - 0.4) / 0.3);
        else mix(above, top, (age - 0.7) / (LOOP_IN - 0.7));
      }
    }
  });

  return (
    <>
      <group position={BURNER_AT} onClick={(e) => (e.stopPropagation(), onClick?.())}>
        {/* base, barrel, collar with its air hole, and the gas hose trailing off the back of the bench */}
        <mesh position={[0, 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.17, 0.04, 28]} />
          <meshStandardMaterial color="#2a3350" roughness={0.45} metalness={0.6} />
        </mesh>
        <mesh position={[0, BURNER_H / 2 + 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.032, 0.036, BURNER_H - 0.04, 20]} />
          <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.046, 0.046, 0.07, 20]} />
          <meshStandardMaterial color="#6b7690" roughness={0.4} metalness={0.8} />
        </mesh>
        <mesh position={[0.2, 0.05, -0.12]} rotation-z={Math.PI / 2} rotation-y={0.55}>
          <cylinderGeometry args={[0.016, 0.016, 0.5, 10]} />
          <meshStandardMaterial color="#b3472e" roughness={0.8} />
        </mesh>
        {/* the flame: a pale inner cone inside an outer one that takes the colour of the test */}
        <mesh ref={outer} position={[0, BURNER_H + 0.16, 0]} renderOrder={5}>
          <coneGeometry args={[0.055, 0.32, 20, 1, true]} />
          <meshBasicMaterial color="#4aa8ff" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={inner} position={[0, BURNER_H + 0.08, 0]} renderOrder={6}>
          <coneGeometry args={[0.026, 0.16, 16, 1, true]} />
          <meshBasicMaterial color="#cfeaff" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        {over && <DropRing radius={0.26} />}
        <Html position={[0, BURNER_H + 0.5, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 9, background: over ? "rgba(60,44,6,.92)" : "rgba(8,16,40,.85)", border: `1px solid ${over ? "#ffc23d" : carrying ? "rgba(255,194,61,.55)" : "rgba(140,180,255,.3)"}`, color: over ? "#ffd98a" : "#dbe7ff", font: "600 12px Inter, system-ui, sans-serif" }}>
            {over ? "Flame-test it here" : "Bunsen burner"}
          </div>
        </Html>
      </group>
      {/* the nichrome wire loop: a handle, a wire and the small loop that carries the sample */}
      <group ref={loop} visible={false}>
        <mesh position={[0.135, 0.37, 0]} rotation-z={-0.35}>
          <cylinderGeometry args={[0.02, 0.02, 0.3, 10]} />
          <meshStandardMaterial color="#e6dcc2" roughness={0.7} />
        </mesh>
        <mesh position={[0.045, 0.125, 0]} rotation-z={-0.35}>
          <cylinderGeometry args={[0.007, 0.007, 0.26, 6]} />
          <meshStandardMaterial color="#dfe5f0" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.03, 0.007, 8, 18]} />
          <meshStandardMaterial color="#dfe5f0" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
    </>
  );
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * Math.max(0, Math.min(1, f));
const ease = (f: number) => {
  const x = Math.max(0, Math.min(1, f));
  return x * x * (3 - 2 * x);
};
/** Where the lumps of residue sit in the bottom of the basin: [x, z, size]. */
const BASIN_LUMPS: [number, number, number][] = [[0, 0, 1.1], [0.05, 0.02, 0.9], [-0.045, 0.03, 1], [0.02, -0.05, 0.85], [-0.03, -0.04, 0.95], [0.075, -0.03, 0.7], [-0.08, -0.01, 0.75], [0.01, 0.07, 0.8], [0.06, 0.065, 0.6], [-0.06, 0.07, 0.65]];

/**
 * The evaporating basin: a porcelain dish on a tripod and gauze, over a Bunsen burner of its own. Carry a
 * beaker to it (or click it). A solution is tipped in and boiled until the water has gone and only what was
 * dissolved is left; a dry solid is heated strongly, far hotter than the hot plate can make it.
 */
function BasinStand({ heating, over, carrying, reducedMotion, onClick }: { heating: NonNullable<PlaygroundView["basin"]> | null; over: boolean; carrying: boolean; reducedMotion: boolean; onClick?: (() => void) | undefined }) {
  const dish = useMemo(() => lathe(BASIN.profile), []);
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const liquid = useRef<THREE.Mesh>(null);
  const lumps = useRef<THREE.Group>(null);
  const steam = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const seen = useRef(heating?.pulse ?? 0);
  const started = useRef(-1);
  const from = useMemo(() => new THREE.Color(), []);
  const to = useMemo(() => new THREE.Color(), []);
  const mixed = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (heating && heating.pulse !== seen.current) {
      seen.current = heating.pulse;
      started.current = t;
    }
    const mode = heating?.mode ?? "boil";
    const total = BASIN_MS[mode] / 1000;
    // with reduced motion the heating is over at once: only what is left is shown, for as long as it would have taken
    const raw = started.current < 0 ? Infinity : t - started.current;
    const age = reducedMotion && raw < total ? total - 0.01 : raw;
    const playing = age < total + 0.6;
    const hot = playing && age > 0.3 && age < total - 1;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    const flicker = reducedMotion ? 1 : 1 + Math.sin(t * 19) * 0.06 + Math.sin(t * 31) * 0.04;
    // the flame: low and quiet until something is on the gauze, then roaring and spreading under it
    if (outer.current) {
      const roar = hot ? (mode === "roast" ? 1.55 : 1.3) : 0.62;
      outer.current.scale.y += (roar - outer.current.scale.y) * k;
      outer.current.scale.x = outer.current.scale.z = 0.8 + (outer.current.scale.y - 0.62) * 0.75;
      outer.current.position.y = BURNER_H + 0.16 * outer.current.scale.y * flicker;
    }
    if (inner.current) inner.current.scale.y = flicker * (hot ? 1.2 : 0.7);
    if (glow.current) glow.current.emissiveIntensity += ((hot && mode === "roast" ? 0.5 : 0) - glow.current.emissiveIntensity) * k;

    // boiling: tipped in, then the level falls until there is none
    const l = liquid.current;
    if (l) {
      const level = mode === "boil" && playing && heating?.liquid ? (age < 0.5 ? ease(age / 0.5) : 1 - ease((age - 0.6) / (total - 2.2))) : 0;
      l.visible = level > 0.02;
      if (l.visible) {
        const boil = reducedMotion || age < 0.8 ? 0 : Math.sin(t * 23) * 0.004;
        l.position.y = lerp(9, 24, level) * U + boil;
        const r = lerp(30, 40.5, level) * U * 0.94;
        l.scale.set(r, r, 1);
        (l.material as THREE.MeshStandardMaterial).color.set(heating?.liquid ?? "#cfe6ff");
      }
    }
    // what is left: crystals growing as the last of the water goes, or a solid changing colour in the heat
    const g = lumps.current;
    if (g) {
      const gone = Math.max(0, (age - total) / 0.5);
      let size = 0;
      if (playing && heating) {
        if (mode === "boil") size = heating.residue ? ease((age - (total - 3.2)) / 2) : 0;
        else size = heating.solid || heating.residue ? ease(age / 0.4) : 0;
        size *= 1 - Math.min(1, gone);
        const start = mode === "roast" ? (heating.solid ?? heating.residue) : heating.residue;
        const end = heating.residue ?? start;
        if (start && end) mixed.copy(from.set(start)).lerp(to.set(end), mode === "roast" ? ease((age - 1.2) / 2.4) : 1);
      }
      g.visible = size > 0.01;
      g.scale.setScalar(Math.max(0.001, size));
      if (g.visible) g.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).color.copy(mixed));
    }
    if (steam.current) steam.current.visible = !reducedMotion && playing && !!heating?.steam && age > 0.9 && age < total - 0.7;
  });

  return (
    <group position={BASIN_AT} onClick={(e) => (e.stopPropagation(), onClick?.())}>
      {/* the burner: base, barrel, collar and hose */}
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.17, 0.04, 28]} />
        <meshStandardMaterial color="#2a3350" roughness={0.45} metalness={0.6} />
      </mesh>
      <mesh position={[0, BURNER_H / 2 + 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.036, BURNER_H - 0.04, 20]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.046, 0.046, 0.07, 20]} />
        <meshStandardMaterial color="#6b7690" roughness={0.4} metalness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.05, -0.12]} rotation-z={Math.PI / 2} rotation-y={0.55}>
        <cylinderGeometry args={[0.016, 0.016, 0.5, 10]} />
        <meshStandardMaterial color="#b3472e" roughness={0.8} />
      </mesh>
      <mesh ref={outer} position={[0, BURNER_H + 0.1, 0]} scale={[0.8, 0.62, 0.8]} renderOrder={5}>
        <coneGeometry args={[0.055, 0.32, 20, 1, true]} />
        <meshBasicMaterial color="#4aa8ff" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={inner} position={[0, BURNER_H + 0.07, 0]} renderOrder={6}>
        <coneGeometry args={[0.026, 0.14, 16, 1, true]} />
        <meshBasicMaterial color="#cfeaff" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* the tripod: a ring on three splayed legs */}
      <mesh position={[0, GAUZE_Y - 0.012, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[0.24, 0.013, 8, 36]} />
        <meshStandardMaterial color="#3b4252" metalness={0.75} roughness={0.35} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.275, (GAUZE_Y - 0.012) / 2, Math.sin(a) * 0.275]} rotation={[Math.sin(a) * 0.088, 0, -Math.cos(a) * 0.088]} castShadow>
            <cylinderGeometry args={[0.012, 0.012, GAUZE_Y, 8]} />
            <meshStandardMaterial color="#3b4252" metalness={0.75} roughness={0.35} />
          </mesh>
        );
      })}
      {/* wire gauze with its ceramic centre, which glows a little when the flame is roaring */}
      <mesh position={[0, GAUZE_Y, 0]}>
        <boxGeometry args={[0.56, 0.006, 0.56, 9, 1, 9]} />
        <meshStandardMaterial color="#9aa3b2" metalness={0.6} roughness={0.5} wireframe />
      </mesh>
      <mesh position={[0, GAUZE_Y + 0.004, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.15, 28]} />
        <meshStandardMaterial ref={glow} color="#e4e2da" emissive="#ff6a2a" emissiveIntensity={0} roughness={0.9} />
      </mesh>
      {/* the porcelain basin and what is in it */}
      <group position={[0, GAUZE_Y + 0.006, 0]} scale={BASIN_S}>
        <mesh geometry={dish} castShadow>
          <meshStandardMaterial color="#cfccc2" roughness={0.6} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={liquid} rotation-x={-Math.PI / 2} visible={false} renderOrder={2}>
          <circleGeometry args={[1, 36]} />
          <meshStandardMaterial color="#cfe6ff" transparent opacity={0.78} roughness={0.15} />
        </mesh>
        {/* heaped up towards the rim, so it can be seen from the front of the bench */}
        <group ref={lumps} position={[0, 0.215, 0]} visible={false}>
          {BASIN_LUMPS.map(([x, z, sz], i) => (
            <mesh key={i} position={[x * 2.6, 0.07 - Math.hypot(x, z) * 0.9 + (i % 3) * 0.012, z * 2.6]} rotation={[i * 0.9, i * 1.7, i * 0.5]}>
              <icosahedronGeometry args={[0.085 * sz, 0]} />
              <meshStandardMaterial color="#f4f6f8" roughness={0.55} flatShading />
            </mesh>
          ))}
        </group>
      </group>
      <group ref={steam} visible={false}>
        <Puffs colour="#f2f7ff" y0={GAUZE_Y + 0.2} rise={1.1} spread={0.2} count={14} opacity={0.5} speed={0.34} size={0.12} reducedMotion={reducedMotion} />
      </group>
      {over && <DropRing radius={0.36} />}
      <Html position={[0, GAUZE_Y + 0.52, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 9, background: over ? "rgba(60,44,6,.92)" : "rgba(8,16,40,.85)", border: `1px solid ${over ? "#ffc23d" : carrying ? "rgba(255,194,61,.55)" : "rgba(140,180,255,.3)"}`, color: over ? "#ffd98a" : "#dbe7ff", font: "600 12px Inter, system-ui, sans-serif" }}>
          {over ? "Heat it here" : "Evaporating basin"}
        </div>
      </Html>
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
      liquidMat.current.opacity += (Math.min(0.96, 0.2 + view.opacity * 0.76) - liquidMat.current.opacity) * k;
      // Strongly coloured liquids glow a little. The glow is the liquid's own: a light placed in the
      // beaker shows up as a bright ball reflected in the glass and burns out a pale precipitate.
      liquidMat.current.emissive.lerp(colour, k);
      liquidMat.current.emissiveIntensity = 0.08 + view.opacity * 0.12;
    }
    if (surfaceMat.current) surfaceMat.current.color.lerp(colour.clone().lerp(new THREE.Color("#ffffff"), 0.55), k);
    if (frost.current) frost.current.opacity += ((view.iceBath ? 0.5 : view.liquidC < 12 ? 0.3 : 0) - frost.current.opacity) * (1 - Math.exp(-dt * 0.6));
    if (group.current && view.swirling && !reducedMotion) {
      group.current.position.x = Math.cos(t * 9) * 0.025;
      group.current.position.z = Math.sin(t * 9) * 0.025;
    } else if (group.current) group.current.position.set(0, 0, 0);
  });

  const h = fillH(view);
  // The bath tops out at 90 °C, so "boiling" here means a hard simmer: it starts gently from 55 °C.
  const simmer = view.levelMl > 1 ? Math.max(0, Math.min(1, (view.liquidC - 55) / 30)) : 0;
  const boiling = simmer > 0.75;
  const condense = view.condense && view.condense.amount > 0 ? view.condense : null;
  // Hot liquid steams; the steam condenses into beads on the cooler glass above it.
  const steamy = view.levelMl > 1 && view.liquidC > 55;
  return (
    <group ref={group}>
      <mesh ref={liquid} position={[0, 0.012, 0]} renderOrder={1}>
        <cylinderGeometry args={[LIQ_R, LIQ_R, 1, 48, 1]} />
        <meshPhysicalMaterial ref={liquidMat} color="#cfe6ff" emissive="#000000" transparent opacity={0.3} roughness={0.05} clearcoat={0.8} ior={1.33} attenuationColor="#cfe6ff" attenuationDistance={0.6} depthWrite={false} />
      </mesh>
      <mesh ref={surface} rotation-x={-Math.PI / 2} renderOrder={2}>
        <circleGeometry args={[LIQ_R, 48]} />
        <meshPhysicalMaterial ref={surfaceMat} color="#ffffff" transparent opacity={0.38} roughness={0} clearcoat={1} envMapIntensity={1.6} depthWrite={false} />
      </mesh>
      {view.precipitate && view.levelMl > 1 && <Precipitate p={view.precipitate} height={h} quality={quality} reducedMotion={reducedMotion} />}
      {view.solid && view.solid.amount > 0.01 && <SolidLumps colour={view.solid.colour} amount={view.solid.amount} coat={view.solid.coat} reducedMotion={reducedMotion} />}
      {((view.gas > 0.01 && view.levelMl > 1) || simmer > 0) && (
        <Bubbles radius={LIQ_R * 0.85} height={h} rate={Math.max(view.gas, simmer * 0.9)} big={boiling && view.gas < 0.2} size={view.gas > 0.01 ? BUBBLE_SIZE[view.bubble ?? "fine"] : 1} count={quality === "high" ? 160 : 60} reducedMotion={reducedMotion} />
      )}
      {(condense || steamy) && <Droplets amount={Math.max(condense?.amount ?? 0, steamy ? Math.min(1, (view.liquidC - 45) / 40) : 0)} pulse={condense?.pulse ?? 0} hot={steamy} floor={view.levelMl > 0.5 ? 0.012 + h : 0.012} colour={condense?.colour ?? "#d6eeff"} count={quality === "high" ? 130 : 60} reducedMotion={reducedMotion} />}
      {view.colourBurst && view.levelMl > 1 && !reducedMotion && <InkSwirl pulse={view.colourBurst.pulse} colour={view.colourBurst.colour} top={h} />}
      {view.skate && view.levelMl > 1 && <Skater pulse={view.skate.pulse} colour={view.skate.colour} durationMs={view.skate.durationMs} top={h} reducedMotion={reducedMotion} />}
      {view.layer && view.levelMl > 1 && <OilLayer colour={view.layer.colour} fraction={Math.min(0.9, view.layer.volumeMl / Math.max(1, view.levelMl))} height={h} bottom={view.layer.position === "bottom"} />}
      {view.mirror && <SilverMirror colour={view.mirror.colour} pulse={view.mirror.pulse} top={view.levelMl > 1 ? h : BEAKER_H * 0.3} reducedMotion={reducedMotion} />}
      {view.crystals && <CrystalGrowth colour={view.crystals.colour} amount={view.crystals.amount} pulse={view.crystals.pulse} durationMs={view.crystals.durationMs} top={view.levelMl > 1 ? h : 0.03} count={quality === "high" ? 90 : 45} reducedMotion={reducedMotion} />}
      {view.blast && <Blast pulse={view.blast.pulse} colour={view.blast.colour} strength={view.blast.strength} reducedMotion={reducedMotion} />}
      {view.thermometer && view.levelMl > 0.5 && <Thermometer c={view.liquidC} target={view.thermometer.targetC} reducedMotion={reducedMotion} />}
      {view.precipitate && view.levelMl > 1 && <Cloudiness p={view.precipitate} height={h} reducedMotion={reducedMotion} />}
      {view.gas > 0.01 && view.levelMl > 1 && <Fizz top={h} intensity={view.gas} reducedMotion={reducedMotion} />}
      {view.gasColour && view.gas > 0.01 && <Plume colour={view.gasColour} top={h} intensity={view.gas} reducedMotion={reducedMotion} />}
      {view.smell && <SmellWisps colour={view.smell.colour} reducedMotion={reducedMotion} />}
      {view.smell && <SmellCloud colour={view.smell.colour} reducedMotion={reducedMotion} />}
      {view.liquidC > 38 && view.levelMl > 1 && <Steam top={h} intensity={Math.min(1, (view.liquidC - 38) / 45)} reducedMotion={reducedMotion} />}
      {view.flame && view.flame.intensity > 0.02 && <Flame colour={view.flame.colour} intensity={view.flame.intensity} reducedMotion={reducedMotion} />}
      {view.light && view.light.intensity > 0.02 && <LightFlash colour={view.light.colour} intensity={view.light.intensity} reducedMotion={reducedMotion} />}
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
const BUBBLE_SIZE = { fine: 0.85, medium: 1.35, coarse: 2 } as const;

function Bubbles({ radius, height, rate, big, size = 1, count, reducedMotion }: { radius: number; height: number; rate: number; big: boolean; size?: number; count: number; reducedMotion: boolean }) {
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
        m.scale.setScalar(b.size * grow * (big ? 2.4 : size));
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

/**
 * What a precipitate really looks like: the whole liquid goes milky (or coloured) at once, then
 * clears from the top down as the solid settles.
 */
function Cloudiness({ p, height, reducedMotion }: { p: NonNullable<PlaygroundView["precipitate"]>; height: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const settle = useRef(0);
  const appear = useRef(0);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    settle.current += (p.settled - settle.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 0.35));
    appear.current += (1 - appear.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 1.6));
    col.setStyle(p.colour);
    if (mat.current) {
      mat.current.color.lerp(col, 0.15);
      mat.current.emissive.lerp(col, 0.15);
      mat.current.opacity = appear.current * Math.min(0.9, 0.3 + p.turbidity * 0.75) * (1 - settle.current * 0.8);
    }
    if (ref.current) {
      const top = Math.max(0.01, height * (1 - settle.current * 0.85) - 0.004);
      ref.current.scale.set(1, top, 1);
      ref.current.position.y = 0.014 + top / 2;
    }
  });
  return (
    <mesh ref={ref} renderOrder={1}>
      <cylinderGeometry args={[LIQ_R * 0.985, LIQ_R * 0.985, 1, 48]} />
      <meshStandardMaterial ref={mat} color={p.colour} emissive={p.colour} emissiveIntensity={0.18} roughness={1} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Precipitate: a swirl of particles that drifts down and piles up as it settles. */
function Precipitate({ p, height, quality, reducedMotion }: { p: NonNullable<PlaygroundView["precipitate"]>; height: number; quality: Quality; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const layer = useRef<THREE.Mesh>(null);
  const layerMat = useRef<THREE.MeshStandardMaterial>(null);
  const n = quality === "high" ? 420 : 160;
  const seeds = useMemo(() => Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * LIQ_R * 0.92, y: Math.random(), sp: 0.4 + Math.random() * 0.8, s: 0.007 + Math.random() * 0.01, rot: Math.random() * 6.3 })), [n]);
  const crystal = p.form === "crystals";
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
      const lh = 0.01 + settle.current * Math.min(0.08, 0.025 + p.turbidity * 0.08);
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
        if (crystal) {
          // Thin plates that tumble as they fall, catching the light (golden rain).
          m.rotation.set(s.rot + t * 1.3 * s.sp, s.rot * 0.7, t * 0.9 * s.sp);
          m.scale.setScalar(s.s * 1.7);
        } else {
          m.rotation.set(0, 0, 0);
          m.scale.setScalar(s.s);
        }
      }
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, n]} renderOrder={2}>
        {crystal ? <boxGeometry args={[1, 0.16, 0.8]} /> : <icosahedronGeometry args={[1, 0]} />}
        <meshStandardMaterial ref={mat} color={p.colour} roughness={crystal ? 0.15 : 0.8} metalness={crystal ? 0.55 : 0} emissive={crystal ? p.colour : "#000000"} emissiveIntensity={crystal ? 0.35 : 0} transparent opacity={0.9} />
      </instancedMesh>
      <mesh ref={layer} renderOrder={1}>
        <cylinderGeometry args={[LIQ_R * 0.97, LIQ_R * 0.97, 1, 40]} />
        <meshStandardMaterial ref={layerMat} color={p.colour} roughness={0.95} transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </>
  );
}

const NEEDLES_PER_LUMP = 7;

/**
 * Undissolved lumps on the floor. A displacement coat grows over them: an even skin (copper on
 * iron) or, for silver, glittering needles sprouting outwards (the "silver tree").
 */
function SolidLumps({ colour, amount, coat, reducedMotion }: { colour: string; amount: number; coat?: NonNullable<PlaygroundView["solid"]>["coat"]; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  // One shared material for every lump's coat so a single opacity write grows them all.
  const shell = useMemo(() => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false }), []);
  useEffect(() => () => shell.dispose(), [shell]);
  useEffect(() => {
    if (!coat) return;
    shell.color.set(coat.colour);
    shell.roughness = coat.form === "crystals" ? 0.25 : 0.85;
    shell.metalness = coat.form === "crystals" ? 0.8 : 0.35;
  }, [shell, coat]);
  const needles = useRef<THREE.InstancedMesh>(null);
  const lumps = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ x: Math.cos(i * 2.4) * LIQ_R * 0.5 * ((i % 3) / 3 + 0.3), z: Math.sin(i * 2.4) * LIQ_R * 0.5 * ((i % 3) / 3 + 0.3), r: i * 0.9, s: 0.025 + (i % 4) * 0.008 })), []);
  const dirs = useMemo(
    () =>
      Array.from({ length: lumps.length * NEEDLES_PER_LUMP }, (_, i) => {
        const d = new THREE.Vector3(Math.sin(i * 2.17) * 0.9, 0.45 + ((i * 0.618) % 1) * 0.8, Math.cos(i * 1.73) * 0.9).normalize();
        return { d, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d), len: 0.025 + ((i * 0.37) % 1) * 0.035 };
      }),
    [lumps.length],
  );
  const m = useMemo(() => new THREE.Object3D(), []);
  const start = useRef(-100);
  const { clock } = useThree();
  useEffect(() => {
    if (coat?.pulse) start.current = clock.elapsedTime;
  }, [coat?.pulse, clock]);
  const shown = Math.max(1, Math.round(lumps.length * Math.min(1, amount)));
  const k = 0.85 + amount * 0.5;
  useFrame(({ clock: c }) => {
    if (ref.current && !reducedMotion) ref.current.children.forEach((ch, i) => (ch.rotation.y = c.elapsedTime * 0.1 + i));
    const g = !coat ? 0 : reducedMotion ? 1 : Math.min(1, Math.max(0, (c.elapsedTime - start.current) / Math.max(0.5, coat.durationMs / 1000)));
    shell.opacity = coat ? 0.1 + 0.85 * g : 0;
    const mesh = needles.current;
    if (!mesh) return;
    for (let i = 0; i < dirs.length; i++) {
      const lump = Math.floor(i / NEEDLES_PER_LUMP);
      const n = dirs[i]!;
      const l = lumps[lump]!;
      if (!coat || coat.form !== "crystals" || lump >= shown) m.scale.setScalar(0);
      else {
        const r = l.s * k;
        const len = n.len * Math.pow(g, 0.7);
        m.position.set(l.x + n.d.x * (r + len / 2), 0.02 + l.s * 0.5 + n.d.y * (r + len / 2), l.z + n.d.z * (r + len / 2));
        m.quaternion.copy(n.q);
        m.scale.set(0.007, Math.max(0.0001, len), 0.007);
      }
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={ref}>
        {lumps.slice(0, shown).map((l, i) => (
          <group key={i} position={[l.x, 0.02 + l.s * 0.5, l.z]} rotation={[l.r, l.r * 0.5, 0]}>
            <mesh castShadow>
              <dodecahedronGeometry args={[l.s * k, 0]} />
              <meshStandardMaterial color={colour} roughness={0.6} metalness={0.15} />
            </mesh>
            {coat && (
              <mesh scale={1.14} material={shell}>
                <dodecahedronGeometry args={[l.s * k, 1]} />
              </mesh>
            )}
          </group>
        ))}
      </group>
      {coat?.form === "crystals" && (
        <instancedMesh ref={needles} args={[undefined, undefined, dirs.length]}>
          <coneGeometry args={[1, 1, 5]} />
          <meshStandardMaterial color={coat.colour} metalness={0.9} roughness={0.15} emissive={coat.colour} emissiveIntensity={0.3} />
        </instancedMesh>
      )}
    </>
  );
}

/** A soft column of coloured gas rising out of the beaker. */
function Plume({ colour, top, intensity, reducedMotion }: { colour: string; top: number; intensity: number; reducedMotion: boolean }) {
  return <Puffs colour={colour} y0={top + 0.05} rise={1.3} spread={0.14} count={14} opacity={0.45 * Math.min(1, intensity + 0.4)} speed={0.28} size={0.16} reducedMotion={reducedMotion} />;
}

function Steam({ top, intensity, reducedMotion }: { top: number; intensity: number; reducedMotion: boolean }) {
  return <Puffs colour="#f2f7ff" y0={top + 0.04} rise={1.2} spread={0.22} count={18} opacity={0.2 + 0.45 * intensity} speed={0.2 + intensity * 0.22} size={0.15} reducedMotion={reducedMotion} />;
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

/** Igniter: a lit wooden splint swings in over the mouth, flickers and throws sparks, then leaves. */
const SPLINT_S = 2.6;
function SparkBurst({ pulse, reducedMotion }: { pulse: number; reducedMotion: boolean }) {
  const splint = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = useRef(-10);
  const { clock } = useThree();
  const n = 90;
  const dirs = useMemo(() => Array.from({ length: n }, () => ({ d: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.35 + Math.random() * 0.7), o: Math.random() })), []);
  const m = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (pulse) start.current = clock.elapsedTime;
  }, [pulse, clock]);
  useFrame(({ clock: c }) => {
    const age = c.elapsedTime - start.current;
    const on = age >= 0 && age < SPLINT_S;
    const tip = new THREE.Vector3(0.06, BEAKER_H + 0.1, 0.04);
    if (splint.current) {
      splint.current.visible = on;
      if (on) {
        // In over 0.35 s, hold, out over the last 0.4 s.
        const inT = Math.min(1, age / 0.35);
        const outT = Math.max(0, (age - (SPLINT_S - 0.4)) / 0.4);
        const k = reducedMotion ? 1 : (1 - Math.pow(1 - inT, 3)) * (1 - outT);
        splint.current.position.set(tip.x + (1 - k) * 0.9, tip.y + (1 - k) * 0.35, tip.z);
      }
    }
    if (flame.current && on && !reducedMotion) {
      flame.current.scale.set(1 + Math.sin(age * 31) * 0.1, 1 + Math.sin(age * 23) * 0.2 + Math.sin(age * 47) * 0.1, 1);
    }
    if (light.current) light.current.intensity = on ? 5 + (reducedMotion ? 0 : Math.sin(age * 37) * 1.5) : 0;
    const mesh = sparks.current;
    if (!mesh) return;
    mesh.visible = on && !reducedMotion;
    if (!mesh.visible) return;
    dirs.forEach(({ d, o }, i) => {
      const ph = (age * 1.6 + o) % 1;
      m.position.set(tip.x + d.x * ph * 0.5, tip.y + d.y * ph * 0.45 - 0.5 * ph * ph, tip.z + d.z * ph * 0.5);
      m.scale.setScalar(0.014 * (1 - ph));
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={splint} visible={false}>
        {/* the splint: a thin wooden stick reaching in from the right, charred at the end */}
        <mesh position={[0.32, 0.06, 0]} rotation-z={Math.PI / 2 - 0.35}>
          <cylinderGeometry args={[0.012, 0.012, 0.7, 8]} />
          <meshStandardMaterial color="#c9955a" roughness={0.8} />
        </mesh>
        <mesh position={[0.01, -0.005, 0]}>
          <sphereGeometry args={[0.018, 10, 8]} />
          <meshStandardMaterial color="#2a1408" emissive="#ff6a1a" emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <group ref={flame} position={[0, 0.02, 0]}>
          {[1, 0.6].map((s, i) => (
            <mesh key={s} position={[0, 0.06 * s, 0]}>
              <coneGeometry args={[0.035 * s, 0.13 * s, 16, 1, true]} />
              <meshBasicMaterial color={i ? "#fff3c4" : "#ff9a2e"} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
        <pointLight ref={light} color="#ffb04a" intensity={0} distance={2.2} position={[0, 0.06, 0]} />
      </group>
      <instancedMesh ref={sparks} args={[undefined, undefined, n]} visible={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#ffd36a" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ "show what the words say" effects */

/** Seconds since `pulse` last changed (large when it never has). */
function usePulseStart(pulse: number) {
  const start = useRef(-1000);
  const { clock } = useThree();
  useEffect(() => {
    if (pulse) start.current = clock.elapsedTime;
  }, [pulse, clock]);
  return start;
}

/**
 * Condensation: the glass mists over, then the mist gathers into beads on the inside wall that grow
 * and, once heavy enough, run down. Hot liquid keeps making new ones; when it cools the beads stay
 * and the big ones trickle back down.
 */
function Droplets({ amount, pulse, hot, floor, colour, count, reducedMotion }: { amount: number; pulse: number; hot: boolean; floor: number; colour: string; count: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const film = useRef<THREE.MeshStandardMaterial>(null);
  const m = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // Three in five beads sit on the wall facing the camera, where they read best.
        const front = i % 5 < 3;
        const a = front ? (((i * 0.618) % 1) - 0.5) * 2.4 : ((i * 0.371) % 1) * Math.PI * 2;
        return { a, y: (i * 0.4142) % 1, s: 0.55 + ((i * 0.7548) % 1) * 0.75, b: ((i * 0.5698) % 1) * 2.2, runner: i % 4 === 0, acc: 0.18 + ((i * 0.31) % 1) * 0.3, period: 4.5 + ((i * 0.83) % 1) * 3 };
      }),
    [count],
  );
  const start = usePulseStart(pulse);
  const wasHot = useRef(false);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const now = clock.elapsedTime;
    // Vapour cooling: keep the beads (as if fully grown) and let the heavy ones run down.
    if (wasHot.current && !hot) start.current = now - 2.4;
    wasHot.current = hot;
    const age = now - start.current;
    const R = BEAKER_R - 0.016;
    const top = BEAKER_H - 0.05;
    const span = Math.max(0.05, top - floor - 0.03);
    const lim = amount <= 0 ? 0 : Math.round(count * Math.min(1, 0.35 + amount * 0.65));
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      let size = 0;
      let y = floor + 0.03 + s.y * span;
      let stretch = 1;
      if (i < lim) {
        if (hot) {
          const t = reducedMotion ? 0.6 * s.period : (now + s.b * 3) % s.period;
          size = 0.026 * s.s * Math.min(1, t / 1.6);
          if (s.runner && !reducedMotion && t > 2.2) {
            const d = 0.5 * s.acc * (t - 2.2) ** 2;
            y -= d;
            stretch = 1 + Math.min(1.3, d * 9);
          }
        } else if (age >= 0) {
          const g = reducedMotion ? 1 : Math.min(1, Math.max(0, (age - s.b * 0.6) / 1.2));
          const fade = age > 45 ? Math.max(0, 1 - (age - 45) / 12) : 1;
          size = 0.026 * s.s * g * fade;
          const tt = age - 2 - s.b;
          if (s.runner && !reducedMotion && tt > 0) {
            const d = 0.5 * s.acc * tt * tt;
            y -= d;
            stretch = 1 + Math.min(1.3, d * 9);
          }
        }
        if (y < floor + 0.012) size = 0; // it has run back into the liquid
      }
      m.position.set(Math.sin(s.a) * R, y, Math.cos(s.a) * R);
      m.rotation.set(0, s.a, 0);
      // Flattened against the glass, longer when running.
      m.scale.set(size, size * stretch * 1.1, size * 0.45);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (film.current) {
      // A mist film fogs the glass first, then clears as the mist gathers into beads.
      const mist = hot ? 0.14 * amount : age >= 0 && age < 9 ? 0.4 * amount * Math.min(1, age / 0.4) * Math.max(0, 1 - Math.max(0, age - 0.8) / 6) : 0;
      film.current.opacity += (mist - film.current.opacity) * (reducedMotion ? 1 : 0.12);
    }
  });
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, count]} renderOrder={5} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshStandardMaterial color="#f4fbff" emissive={colour} emissiveIntensity={0.4} roughness={0.04} metalness={0.25} envMapIntensity={2.5} transparent opacity={0.92} />
      </instancedMesh>
      <mesh position={[0, 0.04 + (BEAKER_H * 0.9) / 2, 0]} renderOrder={4}>
        <cylinderGeometry args={[BEAKER_R - 0.01, BEAKER_R - 0.01, BEAKER_H * 0.9, 48, 1, true]} />
        <meshStandardMaterial ref={film} color="#eef8ff" transparent opacity={0} roughness={1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/** An explosive pop or bang: a fireball flash, a shock ring racing out from the mouth and a burst of light. */
function Blast({ pulse, colour, strength, reducedMotion }: { pulse: number; colour: string; strength: number; reducedMotion: boolean }) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = usePulseStart(pulse);
  useFrame(({ clock }) => {
    const age = clock.elapsedTime - start.current;
    const s = Math.max(0.3, strength);
    if (core.current) {
      const life = reducedMotion ? 0.9 : 0.45;
      core.current.visible = age >= 0 && age < life;
      if (core.current.visible) {
        const k = age / life;
        core.current.scale.setScalar(reducedMotion ? 0.22 * s : (0.12 + k * 0.55) * s);
        (core.current.material as THREE.MeshBasicMaterial).opacity = reducedMotion ? 0.35 : 0.95 * (1 - k);
      }
    }
    for (const r of [ring.current, ring2.current]) {
      if (!r) continue;
      r.visible = !reducedMotion && age >= 0 && age < 0.8;
      if (r.visible) {
        r.scale.setScalar(0.25 + age * 2.4 * s);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - age / 0.8);
      }
    }
    if (light.current) light.current.intensity = age >= 0 && age < 0.6 ? (reducedMotion ? 4 : 45 * s * Math.max(0, 1 - age * 2.2)) : 0;
  });
  return (
    <group position={[0, BEAKER_H * 0.7, 0]}>
      <mesh ref={core} visible={false} renderOrder={6}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={colour} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[0, BEAKER_H * 0.3, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} position={[0, 0.1, 0.05]} visible={false}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color={colour} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={light} color={colour} intensity={0} distance={5} />
    </group>
  );
}

/** A flash or glow from the engine's light cue: a bright core in the beaker plus real light on the bench. */
function LightFlash({ colour, intensity, reducedMotion }: { colour: string; intensity: number; reducedMotion: boolean }) {
  const core = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Burning magnesium flickers with a blinding white glare.
    const flicker = reducedMotion ? 1 : intensity > 0.9 ? 0.8 + Math.sin(t * 41) * 0.12 + Math.sin(t * 67) * 0.08 : 0.92 + Math.sin(t * 13) * 0.08;
    if (core.current) {
      core.current.scale.setScalar((0.12 + intensity * 0.22) * flicker);
      (core.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, 0.35 + intensity * 0.6) * (reducedMotion ? 0.6 : 1);
    }
    if (light.current) light.current.intensity = (reducedMotion ? 6 : 22) * intensity * flicker;
  });
  return (
    <group position={[0, BEAKER_H * 0.5, 0]}>
      <mesh ref={core} renderOrder={6}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshBasicMaterial color={colour} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color={colour} intensity={8 * intensity} distance={4} />
    </group>
  );
}

/** A new colour swirling down through the liquid from the surface, so a colour change is obvious. */
function InkSwirl({ pulse, colour, top }: { pulse: number; colour: string; top: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const n = 44;
  const m = useMemo(() => new THREE.Object3D(), []);
  const start = usePulseStart(pulse);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = (clock.elapsedTime - start.current) / 2.8;
    mesh.visible = t >= 0 && t < 1;
    if (!mesh.visible) return;
    if (mat.current) mat.current.opacity = 0.8 * (1 - t);
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + t * 3.2;
      const r = Math.min(LIQ_R * 0.9, 0.02 + (i % 5) * 0.012 + t * LIQ_R * (0.45 + (i % 7) * 0.07));
      const y = Math.max(0.02, top - 0.01 - t * top * (0.35 + ((i * 0.37) % 1) * 0.65));
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      m.rotation.set(0, -a, 0);
      const k = 0.03 + t * 0.06;
      m.scale.set(k * 1.6, k * 0.7, k);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} renderOrder={2} visible={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshStandardMaterial ref={mat} color={colour} emissive={colour} emissiveIntensity={0.3} transparent opacity={0} depthWrite={false} roughness={0.6} />
    </instancedMesh>
  );
}

/** A molten metal ball whizzing round the surface, fizzing behind it and shrinking as it reacts. */
function Skater({ pulse, colour, durationMs, top, reducedMotion }: { pulse: number; colour: string; durationMs: number; top: number; reducedMotion: boolean }) {
  const ball = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const n = 18;
  const m = useMemo(() => new THREE.Object3D(), []);
  const start = usePulseStart(pulse);
  const path = (t: number, out: THREE.Vector3) => out.set(Math.sin(t * 2.3) * LIQ_R * 0.62, top + 0.022, Math.sin(t * 3.1 + 1) * LIQ_R * 0.55);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const age = clock.elapsedTime - start.current;
    const dur = Math.max(1.5, durationMs / 1000);
    const on = age >= 0 && age < dur;
    const k = on ? 1 - age / dur : 0;
    if (ball.current) {
      ball.current.visible = on;
      if (on) {
        path(reducedMotion ? 0 : age, ball.current.position);
        ball.current.scale.setScalar(0.045 * (0.35 + 0.65 * k));
      }
    }
    const mesh = trail.current;
    if (!mesh) return;
    mesh.visible = on && !reducedMotion;
    if (!mesh.visible) return;
    for (let i = 0; i < n; i++) {
      path(Math.max(0, age - i * 0.045), p);
      m.position.set(p.x + Math.sin(i * 7.1 + age * 20) * 0.01, p.y + 0.004 + ((i * 0.37 + age * 3) % 1) * 0.03, p.z);
      m.scale.setScalar(0.009 * (1 - i / n) + 0.003);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <mesh ref={ball} visible={false} castShadow>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial color={colour} metalness={1} roughness={0.15} emissive={colour} emissiveIntensity={0.15} />
      </mesh>
      <instancedMesh ref={trail} args={[undefined, undefined, n]} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </instancedMesh>
    </>
  );
}

/** An immiscible layer (oil) floating on top of the water, with a visible boundary between them. */
function OilLayer({ colour, fraction, height, bottom }: { colour: string; fraction: number; height: number; bottom?: boolean }) {
  const th = Math.max(0.02, height * fraction);
  return (
    <group position={[0, 0.012 + (bottom ? th / 2 : height - th / 2), 0]}>
      <mesh renderOrder={2}>
        <cylinderGeometry args={[LIQ_R * 1.002, LIQ_R * 1.002, th, 48]} />
        <meshPhysicalMaterial color={colour} emissive={colour} emissiveIntensity={0.18} transparent opacity={0.72} roughness={0.05} clearcoat={1} depthWrite={false} />
      </mesh>
      <mesh position={[0, -th / 2, 0]} rotation-x={-Math.PI / 2} renderOrder={2}>
        <ringGeometry args={[LIQ_R * 0.2, LIQ_R * 1.004, 48]} />
        <meshBasicMaterial color="#5c4a10" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** A shiny metal film creeping up the inside of the glass from the bottom to just above the liquid. */
function SilverMirror({ colour, pulse, top, reducedMotion }: { colour: string; pulse: number; top: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const start = useRef<number | null>(null);
  useEffect(() => {
    start.current = null;
  }, [pulse]);
  const full = Math.min(BEAKER_H * 0.9, top + 0.04);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const t = reducedMotion ? 1 : Math.min(1, (clock.elapsedTime - start.current) / 4);
    const k = 1 - Math.pow(1 - t, 3);
    if (ref.current) {
      ref.current.scale.y = Math.max(0.001, k);
      ref.current.position.y = 0.012 + (full * k) / 2;
    }
    if (mat.current) mat.current.opacity = 0.35 + 0.55 * k;
  });
  return (
    <mesh ref={ref} renderOrder={2}>
      <cylinderGeometry args={[BEAKER_R - 0.006, BEAKER_R - 0.006, full, 64, 1, true]} />
      <meshStandardMaterial ref={mat} color={colour} metalness={1} roughness={0.08} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** Crystals growing as a crust at the waterline and on the bottom of the beaker. */
function CrystalGrowth({ colour, amount, pulse, durationMs, top, count, reducedMotion }: { colour: string; amount: number; pulse: number; durationMs: number; top: number; count: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const rim = i % 10 < 7;
        const a = i * 2.39996;
        return { rim, a, r: rim ? LIQ_R * (0.86 + ((i * 0.37) % 1) * 0.13) : Math.sqrt((i * 0.618) % 1) * LIQ_R * 0.8, dy: (((i * 0.53) % 1) - 0.35) * 0.035, s: 0.014 + ((i * 0.71) % 1) * 0.02, b: ((i * 0.29) % 1) * 0.6, rx: i * 0.9, rz: i * 1.7 };
      }),
    [count],
  );
  const start = usePulseStart(pulse);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const age = clock.elapsedTime - start.current;
    const dur = Math.max(1, durationMs / 1000);
    const live = Math.round(count * Math.min(1, 0.4 + amount * 0.6));
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      const g = i >= live || age < 0 ? 0 : reducedMotion ? 1 : Math.pow(Math.min(1, Math.max(0, (age / dur - s.b * 0.5) / 0.6)), 0.6);
      const size = s.s * (0.7 + amount * 0.5) * g;
      m.position.set(Math.cos(s.a) * s.r, s.rim ? top + s.dy : 0.02 + size * 0.5, Math.sin(s.a) * s.r);
      m.rotation.set(s.rx, s.a, s.rz);
      m.scale.set(size, size * 1.45, size);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} renderOrder={2} castShadow>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.25} roughness={0.12} metalness={0.3} flatShading />
    </instancedMesh>
  );
}

/** A smell made visible: soft coloured puffs wafting up and out of the beaker towards you. */
function SmellCloud({ colour, reducedMotion }: { colour: string; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const n = 12;
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = reducedMotion ? (i + 0.5) / n : (clock.elapsedTime * 0.16 + i / n) % 1;
      c.position.set(0.05 + t * 0.75 + Math.sin(t * 6 + i) * 0.06, BEAKER_H + 0.04 + t * 0.55 + Math.sin(t * 9 + i * 2) * 0.04, 0.05 + t * 0.45);
      c.scale.setScalar(0.07 + t * 0.2);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.3 * Math.sin(Math.PI * t);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} renderOrder={5}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.25} transparent opacity={0} depthWrite={false} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** A thermometer standing in the beaker with a live readout above it. */
function Thermometer({ c, target, reducedMotion }: { c: number; target: number; reducedMotion: boolean }) {
  const column = useRef<THREE.Mesh>(null);
  const L = 1.12;
  const shown = useRef(c);
  useFrame((_, dt) => {
    shown.current += (c - shown.current) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
    if (column.current) {
      const h = Math.max(0.01, L * 0.9 * Math.min(1, Math.max(0.02, (shown.current + 10) / 110)));
      column.current.scale.set(1, h, 1);
      column.current.position.y = 0.03 + h / 2;
    }
  });
  const trend = target - c > 0.4 ? "up" : target - c < -0.4 ? "down" : null;
  return (
    <group position={[-BEAKER_R * 0.48, 0.02, -BEAKER_R * 0.4]} rotation-z={0.2}>
      <mesh position={[0, L / 2, 0]} renderOrder={3}>
        <cylinderGeometry args={[0.016, 0.016, L, 16]} />
        <meshPhysicalMaterial color="#eef6ff" transparent opacity={0.35} roughness={0.05} clearcoat={1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.024, 16, 12]} />
        <meshStandardMaterial color="#ff3b3b" emissive="#ff2a2a" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      <mesh ref={column}>
        <cylinderGeometry args={[0.0075, 0.0075, 1, 10]} />
        <meshStandardMaterial color="#ff3b3b" emissive="#ff2a2a" emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      <Html position={[0, L + 0.06, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ whiteSpace: "nowrap", padding: "3px 8px", borderRadius: 9, background: "rgba(8,16,40,.85)", border: `1px solid ${trend === "up" ? "#ff8a3d" : trend === "down" ? "#7cc4ff" : "rgba(140,180,255,.3)"}`, color: "#fff", font: "700 12px/1.2 Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums" }} aria-label={`Liquid temperature ${c.toFixed(1)} degrees`}>
          🌡 {c.toFixed(1)} °C{trend === "up" ? <span style={{ color: "#ffb36b" }}> ▲</span> : trend === "down" ? <span style={{ color: "#7cc4ff" }}> ▼</span> : null}
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------ what is in hand */

const REAGENT = KINDS.reagent_bottle;
const BOTTLE_H = 125 * U;
const BOTTLE_S = 0.5;
/** A dropper's length from the pivot it is held by down to its tip. */
const DROPPER_L = 0.32;
/** A burette: the graduated tube above its tap, and the tap and jet below it. */
const BURETTE_L = 0.86;
const BURETTE_R = 0.03;
const BURETTE_JET = 0.16;

function Held({ held, view, quality, reducedMotion }: { held: NonNullable<PlaygroundView["held"]>; view: PlaygroundView; quality: Quality; reducedMotion: boolean }) {
  const glass = useGlass(quality);
  const bottleGeom = useMemo(() => lathe(REAGENT.profile, BOTTLE_S), []);
  const pivot = useRef<THREE.Group>(null);
  const tilt = useRef(0);
  const appear = useRef(0);
  const liquidTop = PLATE_H + 0.012 + fillH(view);
  const rim = PLATE_H + BEAKER_H;
  // A bottle's mouth sits just above and outside the rim; the body hangs below it and swings out as it
  // tilts, and the stream arcs in. A dropper and a spatula let go straight down, so they are held over
  // the opening instead: anything they drop has to land inside the glass.
  // over a test tube the opening is much smaller, so everything is held closer to the middle
  const narrow = view.vessel === "tube";
  const sx = narrow ? TUBE_SX : 1;
  const mouth = useMemo(
    () =>
      held.kind === "dropper"
        ? new THREE.Vector3(narrow ? -0.06 : BEAKER_R * 0.3, rim + 0.12 + DROPPER_L, narrow ? 0 : 0.05)
        : held.kind === "spatula"
          ? new THREE.Vector3(BEAKER_R * 0.35 * sx, rim + 0.16, narrow ? 0 : 0.05)
          : held.kind === "burette"
            ? new THREE.Vector3(BEAKER_R * 0.3 * sx, rim + 0.08, 0)
            : new THREE.Vector3(BEAKER_R * sx + 0.16, rim + 0.2, narrow ? 0.02 : 0.05),
    [held.kind, rim, narrow, sx],
  );
  // Where drops and grains leave the tool: the dropper's tip swings out a little as it tilts; the
  // spatula's heap sits just under the point it turns about.
  const lean = (held.tiltDeg * Math.PI) / 180;
  const tip =
    held.kind === "dropper"
      ? new THREE.Vector3(mouth.x + DROPPER_L * Math.sin(lean), mouth.y - DROPPER_L * Math.cos(lean), mouth.z)
      : held.kind === "burette"
        ? mouth
        : new THREE.Vector3(mouth.x, mouth.y - 0.05, mouth.z);
  const clamped = held.kind === "burette";
  useFrame(({ clock }, dt) => {
    const g = pivot.current;
    if (!g) return;
    // Tilting and bringing the bottle in ease over ~0.5 s, so a pour starts and ends gently.
    const kt = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.5);
    const ka = reducedMotion ? 1 : 1 - Math.exp(-dt * 5.5);
    tilt.current += ((held.tiltDeg * Math.PI) / 180 - tilt.current) * kt;
    appear.current += (1 - appear.current) * ka;
    // a burette is clamped: it neither tilts nor sways in the hand
    g.rotation.z = clamped ? 0 : tilt.current + (reducedMotion || held.flowing ? 0 : Math.sin(clock.elapsedTime * 1.4) * 0.02);
    g.position.set(mouth.x + (1 - appear.current) * 0.8, mouth.y + (1 - appear.current) * 0.3 + (clamped || held.flowing || reducedMotion ? 0 : Math.sin(clock.elapsedTime * 1.1) * 0.012), mouth.z);
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
          <group position={[0, -DROPPER_L, 0]}>
            <mesh position={[0, DROPPER_L / 2, 0]} material={glass}>
              <cylinderGeometry args={[0.025, 0.012, DROPPER_L, 16]} />
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
        {held.kind === "burette" && <Burette colour={held.colour} fill={held.fill ?? 1} glass={glass} />}
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
      {held.flowing && held.kind === "bottle" && <Stream from={mouth} toY={liquidTop} endX={LIQ_R * 0.35 * sx} colour={held.colour} reducedMotion={reducedMotion} />}
      {held.flowing && (held.kind === "dropper" || held.kind === "burette") && <Drops from={tip} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} />}
      {held.flowing && held.kind === "spatula" && <Drops from={tip} toY={liquidTop} colour={held.colour} reducedMotion={reducedMotion} grains />}
      {held.kind === "gas" && <GasHose from={new THREE.Vector3(mouth.x + 0.35, mouth.y - 0.1, mouth.z)} />}
    </>
  );
}

/**
 * A burette in a clamp on a retort stand, drawn from its jet (the origin) upwards: jet, tap, then the graduated
 * tube with the liquid still in it. The stand is off to the right, behind where a bottle would be held.
 */
function Burette({ colour, fill, glass }: { colour: string; fill: number; glass: THREE.Material }) {
  const tube0 = BURETTE_JET + 0.05;
  const level = Math.max(0, Math.min(1, fill)) * (BURETTE_L - 0.06);
  const standX = 0.62;
  const standZ = -0.2;
  const clampY = tube0 + BURETTE_L * 0.45;
  const arm = Math.hypot(standX, standZ);
  return (
    <group>
      {/* jet and tap */}
      <mesh position={[0, BURETTE_JET / 2, 0]} material={glass} renderOrder={3}>
        <cylinderGeometry args={[0.012, 0.006, BURETTE_JET, 10]} />
      </mesh>
      <mesh position={[0, BURETTE_JET + 0.025, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.018, 0.018, 0.11, 10]} />
        <meshStandardMaterial color="#3d8bff" roughness={0.4} />
      </mesh>
      {/* the graduated tube, the liquid in it, and a few marks */}
      <mesh position={[0, tube0 + BURETTE_L / 2, 0]} material={glass} renderOrder={3}>
        <cylinderGeometry args={[BURETTE_R, BURETTE_R, BURETTE_L, 20, 1, true]} />
      </mesh>
      {level > 0.002 && (
        <mesh position={[0, tube0 + level / 2, 0]}>
          <cylinderGeometry args={[BURETTE_R * 0.82, BURETTE_R * 0.82, level, 16]} />
          <meshStandardMaterial color={colour} transparent opacity={0.78} roughness={0.1} />
        </mesh>
      )}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} position={[0, tube0 + 0.03 + (i / 10) * (BURETTE_L - 0.06), 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[BURETTE_R + 0.001, i % 5 === 0 ? 0.0035 : 0.002, 4, 20, Math.PI]} />
          <meshBasicMaterial color="#dbe7ff" transparent opacity={0.75} />
        </mesh>
      ))}
      {/* the stand: base, rod, and the boss and arm that hold the burette */}
      <mesh position={[standX, 0.02 - (PLATE_H + BEAKER_H + 0.08), standZ]} castShadow>
        <boxGeometry args={[0.4, 0.04, 0.5]} />
        <meshStandardMaterial color="#2a3350" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[standX, (tube0 + BURETTE_L * 0.7 - (PLATE_H + BEAKER_H + 0.08)) / 2, standZ]}>
        <cylinderGeometry args={[0.018, 0.018, tube0 + BURETTE_L * 0.7 + PLATE_H + BEAKER_H + 0.08, 12]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[standX, clampY, standZ]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshStandardMaterial color="#6b7690" roughness={0.4} metalness={0.8} />
      </mesh>
      <mesh position={[standX / 2, clampY, standZ / 2]} rotation-y={Math.atan2(-standZ, standX)} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.012, 0.012, arm, 8]} />
        <meshStandardMaterial color="#aab4c8" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[0, clampY, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[BURETTE_R + 0.012, 0.012, 8, 20]} />
        <meshStandardMaterial color="#6b7690" roughness={0.4} metalness={0.8} />
      </mesh>
    </group>
  );
}

/** The pour: a tube whose surface texture scrolls, so the stream visibly flows. */
function Stream({ from, toY, endX, colour, reducedMotion }: { from: THREE.Vector3; toY: number; endX: number; colour: string; reducedMotion: boolean }) {
  const geom = useMemo(() => {
    const start = new THREE.Vector3(from.x - 0.04, from.y - 0.02, from.z);
    const end = new THREE.Vector3(endX, toY, 0.02);
    const mid = new THREE.Vector3((start.x + end.x) / 2 + 0.02, (start.y + end.y) / 2 + 0.06, 0.03);
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 32, 0.014, 10, false);
  }, [from, toY, endX]);
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
      c.position.set(from.x + (grains ? Math.sin(i * 3.1) * 0.03 : 0), from.y - 0.02 - t * t * (from.y - toY), from.z + (grains ? Math.cos(i * 1.7) * 0.03 : 0));
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
