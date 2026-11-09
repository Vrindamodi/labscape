import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { heightOf, KINDS, lipHeightMm, type EquipmentKind } from "../engine/equipment";
import { reagent } from "../engine/reagents";
import { look, type Item, type LabState } from "../engine/state";
import { oklabToHex } from "./colour";
import type { LiveCue } from "./useLabSession";

/** 1 scene unit = 100 mm. */
const U = 0.01;
export type Quality = "high" | "lite";

export type PourAnim = { from: string; to: string | null; tiltDeg: number; rateMlPerS: number } | null;

/** What the learner is holding: lifted off the bench, carried over `over` and tilted to pour. */
export type HandState = { id: string; over: string | null; tiltDeg: number } | null;
export type MixKind = "stir" | "swirl" | "shake";

export type BenchProps = {
  /** The item in the learner's hand (carried and tilted by direct manipulation). */
  hand?: HandState;
  /** The held item was dragged and released over another item. */
  onDropOnto?: (heldId: string, targetId: string) => void;
  /** A vessel being stirred, swirled or shaken (animation only; the engine gets the event). */
  mixing?: { id: string; kind: MixKind } | null;
  state: LabState;
  cues: LiveCue[];
  selected: string | null;
  /** Items that can take what is in hand (drop targets). */
  targets: string[];
  /** Items with a glowing ring. Defaults to the selected item and the targets. */
  rings?: string[];
  /**
   * Floating name tags. Defaults to the selected item and the ringed items. They are placed with
   * collision avoidance and kept inside the canvas; the hovered item always gets one too.
   */
  labels?: BenchLabel[];
  onPick: (id: string) => void;
  onBackground: () => void;
  /** Drag-to-place: called when an item is dropped; the scene snaps to sockets within 24 px. */
  onPlace?: (id: string, xMm: number, zMm: number, socket: string | null) => void;
  draggable?: (id: string) => boolean;
  pour: PourAnim;
  quality: Quality;
  onQuality: (q: Quality) => void;
  reducedMotion: boolean;
  children?: ReactNode;
  /**
   * Camera framing: when the key changes the camera eases once to fit these items. The learner can
   * still orbit and zoom (onUserCamera tells the page, which usually stops framing). Optional.
   */
  frame?: BenchFrame | null;
  /** The learner orbited, panned or zoomed. */
  onUserCamera?: () => void;
};

/** Items to fit in view. `tall`: show tall apparatus (a clamped burette) to the top, e.g. while filling it; otherwise the view keeps to bench height so everything stays readable. */
export type BenchFrame = { key: string; ids: string[]; tall?: boolean };
/** A name tag over an item. "guide": the one thing to click next (arrow and pulse). */
export type BenchLabel = { id: string; text?: string; tone: "held" | "guide" | "target" | "hover" };

const LABEL_PRIORITY: Record<BenchLabel["tone"], number> = { held: 0, guide: 1, target: 2, hover: 3 };

export function Bench3D(props: BenchProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const [hovered, setHovered] = useState<string | null>(null);
  const base: BenchLabel[] = props.labels ?? [
    ...(props.selected ? [{ id: props.selected, tone: "held" as const }] : []),
    ...(props.rings ?? props.targets).filter((id) => id !== props.selected).map((id) => ({ id, tone: "target" as const })),
  ];
  const labels = [...base];
  if (hovered && !labels.some((l) => l.id === hovered) && props.state.items[hovered]) labels.push({ id: hovered, tone: "hover" });
  const shown = labels.filter((l) => props.state.items[l.id] && props.state.items[l.id]!.socket !== "worn").sort((a, b) => LABEL_PRIORITY[a.tone] - LABEL_PRIORITY[b.tone]);
  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={props.quality === "high"}
        dpr={props.quality === "high" ? [1, 1.6] : [1, 1.15]}
        camera={{ position: [0, 4.4, 7.6], fov: 34, near: 0.1, far: 80 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onPointerMissed={props.onBackground}
        style={{ touchAction: "none" }}
      >
        <PerformanceMonitor onDecline={() => props.onQuality("lite")} flipflops={2} />
        <Scene {...props} onHover={setHovered} />
        <LabelLayer labels={shown} overlay={overlay} els={els} state={props.state} />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {shown.map((l) => {
          const it = props.state.items[l.id]!;
          const vol = it.liquid && it.liquid.volumeMl > 0.001 ? ` · ${fmtMl(it.liquid.volumeMl)}` : "";
          return (
            <div
              key={l.id}
              ref={(el) => {
                if (el) els.current.set(l.id, el);
                else els.current.delete(l.id);
              }}
              data-highlight-id={l.id}
              data-label-tone={l.tone}
              className={
                "absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-[10px] border px-2.5 py-1 font-sans text-[13px] font-semibold leading-tight text-white opacity-0 shadow-[0_6px_18px_-8px_rgba(0,0,0,.8)] " +
                (l.tone === "held"
                  ? "border-[#8cbcff] bg-[rgba(47,128,255,.94)]"
                  : l.tone === "guide"
                    ? "border-[#7ff0ff] bg-[rgba(6,60,80,.94)] text-[#e8fdff]"
                    : l.tone === "target"
                      ? "border-[#22d3ee] bg-[rgba(8,16,38,.9)]"
                      : "border-white/25 bg-[rgba(8,16,38,.88)] text-[#dbe7ff]")
              }
              style={{ willChange: "transform" }}
            >
              {l.tone === "guide" && <span className="motion-safe:animate-bounce text-[#7ff0ff]">▼</span>}
              {l.text ?? `${it.label}${vol}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Scene(p: BenchProps & { onHover: (id: string | null) => void }) {
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

  const items = Object.values(p.state.items).filter((it) => it.socket !== "worn");
  return (
    <>
      <OrbitControls makeDefault target={[0, 0.7, 0]} enablePan minDistance={2.4} maxDistance={16} minPolarAngle={0.35} maxPolarAngle={1.32} enableDamping={!p.reducedMotion} />
      <hemisphereLight args={["#bcd4ff", "#0b1020", 0.35]} />
      <directionalLight position={[3, 7, 4]} intensity={1.25} castShadow={p.quality === "high"} shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <pointLight position={[-4.5, 4, -3]} intensity={10} color="#3a8cff" distance={12} decay={1.6} />
      <pointLight position={[4.5, 3.6, -2.5]} intensity={6} color="#c46bff" distance={11} decay={1.6} />
      <Backdrop />
      <BenchTop />
      {items.map((it) => (
        <ItemNode key={it.id} item={it} {...p} />
      ))}
      <DragPlane {...p} />
      <HandDragPlane {...p} />
      {p.frame && <CameraRig frame={p.frame} state={p.state} reducedMotion={p.reducedMotion} onUserCamera={p.onUserCamera} />}
      {p.children}
    </>
  );
}

/** Item groups by id, so name tags can follow an item while it is carried. */
const groups = new Map<string, THREE.Object3D>();

/**
 * Places the name tags every frame: projected above each item, kept inside the canvas, and pushed
 * apart when they would overlap (higher-priority tags keep their place).
 */
function LabelLayer({ labels, overlay, els, state }: { labels: BenchLabel[]; overlay: RefObject<HTMLDivElement | null>; els: MutableRefObject<Map<string, HTMLDivElement>>; state: LabState }) {
  const camera = useThree((s) => s.camera);
  const v = useMemo(() => new THREE.Vector3(), []);
  const latest = useRef({ labels, state });
  latest.current = { labels, state };
  useFrame(() => {
    const box = overlay.current;
    if (!box) return;
    const W = box.clientWidth;
    const H = box.clientHeight;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const pad = 6;
    for (const l of latest.current.labels) {
      const el = els.current.get(l.id);
      const g = groups.get(l.id);
      const it = latest.current.state.items[l.id];
      if (!el) continue;
      if (!g || !it) {
        el.style.opacity = "0";
        continue;
      }
      g.getWorldPosition(v);
      v.y += Math.max(0.3, Math.min(lipHeightMm(it.kind) * U, 3.2)) + 0.14;
      v.project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.opacity = "0";
        continue;
      }
      const sx = ((v.x + 1) / 2) * W;
      const sy = ((1 - v.y) / 2) * H;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = Math.max(pad, Math.min(W - w - pad, sx - w / 2));
      let y = Math.max(pad, Math.min(H - h - pad, sy - h));
      // Push down (or up, near the bottom) until it no longer overlaps a tag already placed.
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.find((r) => x < r.x + r.w + 4 && x + w + 4 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y);
        if (!hit) break;
        const below = hit.y + hit.h + 4;
        y = below + h <= H - pad ? below : Math.max(pad, hit.y - h - 4);
        if (tries > 3) x = Math.max(pad, Math.min(W - w - pad, hit.x + hit.w + 6));
      }
      placed.push({ x, y, w, h });
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.opacity = "1";
    }
  });
  return null;
}

/* ------------------------------------------------------------------ room */

function Backdrop() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const g = c.getContext("2d")!;
    const wall = g.createLinearGradient(0, 0, 0, 512);
    wall.addColorStop(0, "#14234a");
    wall.addColorStop(1, "#0c1630");
    g.fillStyle = wall;
    g.fillRect(0, 0, 1024, 512);
    // window glow
    const win = g.createLinearGradient(0, 60, 0, 300);
    win.addColorStop(0, "#3f63c7");
    win.addColorStop(1, "#a8b9ee");
    g.fillStyle = win;
    g.fillRect(400, 60, 240, 230);
    g.fillStyle = "#0f1b38";
    g.fillRect(515, 60, 10, 230);
    g.fillRect(400, 170, 240, 8);
    // shelves with bottles
    g.fillStyle = "#24365f";
    g.fillRect(60, 200, 280, 8);
    g.fillRect(700, 220, 280, 8);
    const cols = ["#4f7bd9", "#a35bd6", "#3fb3c9", "#d9a83f", "#5a9f6a", "#d2557a"];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[i]!;
      g.globalAlpha = 0.65;
      g.fillRect(80 + i * 42, 150 - (i % 2) * 10, 26, 50 + (i % 2) * 10);
      g.fillRect(720 + i * 42, 170 - ((i + 1) % 2) * 12, 26, 50 + ((i + 1) % 2) * 12);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh position={[0, 3.2, -4.2]}>
      <planeGeometry args={[18, 9]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

function BenchTop() {
  return (
    <group>
      <mesh position={[0, -0.13, 0.2]} receiveShadow>
        <boxGeometry args={[9.2, 0.26, 4.6]} />
        <meshPhysicalMaterial color="#0a1020" roughness={0.42} clearcoat={0.5} clearcoatRoughness={0.35} metalness={0.1} envMapIntensity={0.25} />
      </mesh>
      <mesh position={[0, -0.02, 2.48]}>
        <boxGeometry args={[9.2, 0.04, 0.04]} />
        <meshStandardMaterial color="#2f80ff" emissive="#2f80ff" emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ items */

const SOCKET_HEIGHT: Record<string, number> = { clamp: 1.12, rack: 0.06, tile: 0.03, tripod: 0.62 };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function baseY(item: Item, _state: LabState): number {
  if (!item.socket) return 0;
  const kind = item.socket.split(":")[0] ?? "";
  if (kind === "vessel") return 0.3;
  return SOCKET_HEIGHT[kind] ?? 0;
}

/** Where a dragged held item currently is (scene units), shared between the drag plane and the item. */
const handDrag: { active: boolean; x: number; z: number; begin: (() => void) | null } = { active: false, x: 0, z: 0, begin: null };

/**
 * Starts carrying the item in hand with the pointer from outside the canvas (a shelf drag). Give the
 * item's bench position (mm); releasing the pointer over a glowing target uses it, as on the bench.
 */
export function beginHandDrag(xMm: number, zMm: number) {
  handDrag.active = true;
  handDrag.x = xMm * U;
  handDrag.z = zMm * U;
  handDrag.begin?.();
}

function ItemNode({ item, state, cues, selected, targets, rings, onPick, onHover, pour, hand, mixing, quality, reducedMotion }: BenchProps & { item: Item; onHover: (id: string | null) => void }) {
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (g) groups.set(item.id, g);
    return () => {
      if (groups.get(item.id) === g) groups.delete(item.id);
    };
  }, [item.id]);
  const isSel = selected === item.id;
  const isTarget = (rings ?? targets).includes(item.id);
  const held = hand?.id === item.id;
  const pouring = pour?.from === item.id || (held && !!hand?.over);
  const overId = pour?.from === item.id ? pour.to : held ? hand!.over : null;
  const target = pouring && overId ? state.items[overId] : null;
  const tiltDeg = pour?.from === item.id ? pour.tiltDeg : held ? hand!.tiltDeg : 0;
  const mix = mixing?.id === item.id ? mixing.kind : null;
  const bx = item.x * U, by = baseY(item, state), bz = item.z * U;
  const want = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    // Rest on the bench; lift into the hand; follow a drag; carry over the target and tilt to pour.
    want.set(bx, by, bz);
    let tilt = 0;
    if (pouring && target) {
      // Pour from the side facing the camera's right, lip just above the target's rim.
      want.set(target.x * U + 0.42, baseY(target, state) + lipHeightMm(target.kind) * U + 0.55, target.z * U);
      tilt = THREE.MathUtils.degToRad(tiltDeg);
    } else if (held && handDrag.active) {
      want.set(handDrag.x, 0.55, handDrag.z);
    } else if (held) {
      want.set(bx, by + 0.38, bz + 0.25);
    } else if (isSel) want.y += 0.08;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 12);
    g.position.lerp(want, k);
    g.rotation.z += (tilt - g.rotation.z) * k;
    // Mixing: swirl traces a small circle, shake rattles side to side, stir rocks gently.
    if (mix && !reducedMotion) {
      const t = clock.elapsedTime;
      if (mix === "swirl") {
        g.position.x += Math.cos(t * 9) * 0.035;
        g.position.z += Math.sin(t * 9) * 0.035;
      } else if (mix === "shake") {
        g.position.x += Math.sin(t * 38) * 0.05;
        g.rotation.z = Math.sin(t * 38) * 0.18;
      } else {
        g.rotation.y = t * 2.2;
      }
    } else if (!mix) g.rotation.y += (0 - g.rotation.y) * k;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (handDrag.active) return;
    onPick(item.id);
  };

  return (
    <group
      ref={group}
      position={[bx, by, bz]}
      userData={{ itemId: item.id }}
      onClick={click}
      onPointerDown={(e) => {
        // Grab the held item to drag it onto a target.
        if (!held || hand?.over) return;
        e.stopPropagation();
        handDrag.begin?.();
        handDrag.active = true;
        handDrag.x = e.point.x;
        handDrag.z = e.point.z;
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = held ? "grab" : "pointer";
        onHover(item.id);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
        onHover(null);
      }}
    >
      <Visual item={item} state={state} cues={cues} quality={quality} reducedMotion={reducedMotion} />
      {(isSel || isTarget) && !held && <SelectionRing radius={footprint(item.kind)} colour={isSel ? "#2f80ff" : "#22d3ee"} pulse={isTarget} />}
    </group>
  );
}

function fmtMl(v: number) {
  return v < 10 ? `${v.toFixed(2)} mL` : `${v.toFixed(1)} mL`;
}

function footprint(kind: EquipmentKind): number {
  const p = KINDS[kind].profile;
  const r = p.length ? Math.max(...p.map(([x]) => x)) : 25;
  return Math.max(0.18, r * U + 0.08);
}

function SelectionRing({ radius, colour, pulse }: { radius: number; colour: string; pulse: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current && pulse) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5) * 0.06);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.006, 0]}>
      <ringGeometry args={[radius, radius + 0.035, 48]} />
      <meshBasicMaterial color={colour} transparent opacity={0.9} toneMapped={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ materials */

/** One glass material per quality level, shared by every vessel (a material per item was a big
 *  part of the demo stutter: each transmission material costs shader work and GPU memory). */
const GLASS: Partial<Record<Quality, THREE.Material>> = {};
export function useGlass(quality: Quality) {
  return (GLASS[quality] ??=
    quality === "high"
      ? new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.04, transmission: 1, thickness: 0.05, ior: 1.5, clearcoat: 1, envMapIntensity: 1.3, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: "#dbe8ff", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
}

/** Disposes a geometry built in render when it is replaced or unmounted. */
function useDisposable<T extends { dispose: () => void } | null | undefined>(g: T): T {
  useEffect(() => () => g?.dispose(), [g]);
  return g;
}

function lathe(profile: [number, number][], scale = 1, segments = 48) {
  return new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(Math.max(0.0001, r * U * scale), h * U)), segments);
}

/** The liquid inside a vessel: the profile cut at the fill height, closed with a surface disc. */
function liquidGeometry(kind: EquipmentKind, volumeMl: number) {
  const prof = KINDS[kind].profile;
  const h = heightOf(kind, volumeMl);
  if (h <= 0.05) return null;
  const pts: [number, number][] = [[0, 0.6]];
  for (const [r, y] of prof) {
    if (y >= h) break;
    pts.push([r * 0.93, Math.max(0.6, y)]);
  }
  // radius at the surface by interpolation
  let rTop = prof[0]?.[0] ?? 1;
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1]!;
    const [r1, y1] = prof[i]!;
    if (h <= y1) {
      rTop = y1 === y0 ? r1 : r0 + ((r1 - r0) * (h - y0)) / (y1 - y0);
      break;
    }
  }
  pts.push([rTop * 0.93, h]);
  pts.push([0, h - 0.6]); // a slightly concave meniscus
  return { geom: lathe(pts), h: h * U, rTop: rTop * 0.93 * U };
}

/* ------------------------------------------------------------------ visuals per kind */

function Visual({ item, state, cues, quality, reducedMotion }: { item: Item; state: LabState; cues: LiveCue[]; quality: Quality; reducedMotion: boolean }) {
  const glass = useGlass(quality);
  const def = KINDS[item.kind];
  switch (item.kind) {
    case "white_tile":
      return (
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[0.9, 0.03, 0.9]} />
          <meshStandardMaterial color="#f4f7fb" roughness={0.25} />
        </mesh>
      );
    case "clamp_stand":
      return (
        <group>
          <mesh position={[0, 0.02, 0]} castShadow>
            <boxGeometry args={[0.7, 0.04, 0.5]} />
            <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.6, -0.12]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 3.2, 16]} />
            <meshStandardMaterial color="#c0c7d4" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.2, 0.15]}>
            <boxGeometry args={[0.08, 0.06, 0.6]} />
            <meshStandardMaterial color="#374151" metalness={0.5} />
          </mesh>
        </group>
      );
    case "test_tube_rack":
      return (
        <group>
          {/* Two thin rails instead of a solid top board, so the bottom of each tube (where small
              volumes and precipitates sit) stays visible from the usual raised camera. */}
          {[-0.13, 0.13].map((z) => (
            <mesh key={z} position={[0, 0.25, z]} castShadow receiveShadow>
              <boxGeometry args={[1.2, 0.04, 0.05]} />
              <meshStandardMaterial color="#a8743f" roughness={0.6} />
            </mesh>
          ))}
          <mesh position={[0, 0.04, 0]} receiveShadow>
            <boxGeometry args={[1.2, 0.05, 0.32]} />
            <meshStandardMaterial color="#8b5e30" roughness={0.6} />
          </mesh>
          {[-0.58, 0.58].map((x) => (
            <mesh key={x} position={[x, 0.15, 0]}>
              <boxGeometry args={[0.04, 0.26, 0.3]} />
              <meshStandardMaterial color="#8b5e30" roughness={0.6} />
            </mesh>
          ))}
        </group>
      );
    case "bunsen":
      return <Bunsen item={item} cues={cues} reducedMotion={reducedMotion} />;
    case "thermometer":
      return (
        <group rotation-z={item.inVessel ? 0.12 : Math.PI / 2} position={[0, item.inVessel ? 0.4 : 0.03, 0]}>
          <mesh>
            <cylinderGeometry args={[0.025, 0.025, 1.4, 12]} />
            <primitive object={glass} attach="material" />
          </mesh>
          <mesh position={[0, -0.7 + ((item.readingC ?? 22) + 10) / 120 * 0.7, 0]}>
            <cylinderGeometry args={[0.009, 0.009, ((item.readingC ?? 22) + 10) / 120 * 1.4, 8]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.4} />
          </mesh>
        </group>
      );
    case "splint":
      return (
        <group rotation-z={Math.PI / 2} position={[0, 0.03, 0]}>
          <mesh>
            <cylinderGeometry args={[0.018, 0.018, 1.1, 8]} />
            <meshStandardMaterial color="#d6a96b" roughness={0.8} />
          </mesh>
          {item.lit && <SmallFlame position={[0, 0.6, 0]} colour="#ffb347" reducedMotion={reducedMotion} />}
          {item.glowing && (
            <mesh position={[0, 0.56, 0]}>
              <sphereGeometry args={[0.022, 10, 8]} />
              <meshStandardMaterial color="#ff5a1f" emissive="#ff3d00" emissiveIntensity={1.5} />
            </mesh>
          )}
        </group>
      );
    case "wire_loop":
      return (
        <group rotation-z={Math.PI / 2.2} position={[0, 0.05, 0]}>
          <mesh>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 10]} />
            <meshStandardMaterial color="#2a3346" />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.45, 6]} />
            <meshStandardMaterial color={(item.inFlameMs ?? 0) > 0 ? "#ff9c4a" : "#9aa3b2"} emissive={(item.inFlameMs ?? 0) > 0 ? "#ff6a00" : "#000"} metalness={0.8} />
          </mesh>
          <mesh position={[0, 0.74, 0]}>
            <torusGeometry args={[0.035, 0.006, 6, 16]} />
            <meshStandardMaterial color="#9aa3b2" metalness={0.8} />
          </mesh>
        </group>
      );
    case "goggles":
      return (
        <group position={[0, 0.06, 0]}>
          {[-0.13, 0.13].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.1, 0.03, 10, 24]} />
              <meshStandardMaterial color="#2f80ff" roughness={0.4} />
            </mesh>
          ))}
        </group>
      );
    case "watch_glass":
      return <WatchGlass item={item} />;
    case "litmus_paper":
      return (
        <mesh position={[0, 0.01, 0]}>
          <boxGeometry args={[0.08, 0.004, 0.28]} />
          <meshStandardMaterial color={item.litmus === "red" ? "#d6336c" : item.litmus === "bleached" ? "#f1f3f5" : "#3b5bdb"} roughness={0.9} />
        </mesh>
      );
    case "glass_rod":
      return (
        <mesh rotation-z={Math.PI / 2} position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 1, 10]} />
          <primitive object={glass} attach="material" />
        </mesh>
      );
    case "funnel":
      return <Funnel glass={glass} />;
    case "tripod":
      return <Tripod />;
    case "burette_50":
      return <Burette item={item} glass={glass} state={state} cues={cues} />;
    default:
      if (def.capacityMl > 0) return <Vessel item={item} glass={glass} cues={cues} quality={quality} reducedMotion={reducedMotion} />;
      return null;
  }
}

/** A single piece of equipment outside the bench, for the encyclopedia turntable. */
export function EquipmentModel({ item, state, quality = "high", reducedMotion = false }: { item: Item; state: LabState; quality?: Quality; reducedMotion?: boolean }) {
  return <Visual item={item} state={state} cues={[]} quality={quality} reducedMotion={reducedMotion} />;
}

const FUNNEL_PROFILE: [number, number][] = [[3.5, 0], [3.5, 60], [5, 64], [36, 100], [38, 102]];

function Funnel({ glass }: { glass: THREE.Material }) {
  const geom = useMemo(() => lathe(FUNNEL_PROFILE), []);
  return (
    <group>
      <mesh geometry={geom} material={glass} renderOrder={3} />
      {/* folded filter paper */}
      <mesh position={[0, 0.83, 0]} rotation-x={Math.PI}>
        <coneGeometry args={[0.33, 0.36, 32, 1, true]} />
        <meshStandardMaterial color="#f5f1e6" roughness={0.95} side={THREE.DoubleSide} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

function Tripod() {
  return (
    <group>
      <mesh position={[0, 0.6, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[0.36, 0.018, 10, 40]} />
        <meshStandardMaterial color="#3b4252" metalness={0.75} roughness={0.35} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4]} rotation={[Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.62, 8]} />
            <meshStandardMaterial color="#3b4252" metalness={0.75} roughness={0.35} />
          </mesh>
        );
      })}
      {/* wire gauze with its ceramic centre */}
      <mesh position={[0, 0.622, 0]}>
        <boxGeometry args={[0.9, 0.008, 0.9]} />
        <meshStandardMaterial color="#9aa3b2" metalness={0.6} roughness={0.5} wireframe />
      </mesh>
      <mesh position={[0, 0.624, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.24, 32]} />
        <meshStandardMaterial color="#e9ecef" roughness={0.9} />
      </mesh>
    </group>
  );
}

function WatchGlass({ item }: { item: Item }) {
  const r = item.reagentId ? reagent(item.reagentId) : null;
  return (
    <group position={[0, 0.02, 0]}>
      <mesh rotation-x={Math.PI}>
        <sphereGeometry args={[0.28, 24, 8, 0, Math.PI * 2, 0, 0.5]} />
        <meshStandardMaterial color="#dbe8ff" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {r?.metal?.symbol === "Mg" && (
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.32, 0.05]} />
          <meshStandardMaterial color="#c9ccd2" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r?.metal?.symbol === "Fe" && (
        <mesh position={[0, 0.04, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.018, 0.018, 0.4, 10]} />
          <meshStandardMaterial color="#8a8f99" metalness={0.85} roughness={0.35} />
        </mesh>
      )}
    </group>
  );
}

function Vessel({ item, glass, quality, reducedMotion }: { item: Item; glass: THREE.Material; cues: LiveCue[]; quality: Quality; reducedMotion: boolean }) {
  const def = KINDS[item.kind];
  const glassGeom = useMemo(() => lathe(def.profile, 1.0), [def]);
  const l = look(item);
  const vol = item.liquid?.volumeMl ?? 0;
  const liquid = useMemo(() => liquidGeometry(item.kind, vol), [item.kind, Math.round(vol * 50)]); // eslint-disable-line react-hooks/exhaustive-deps
  useDisposable(liquid?.geom);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  const plumeMat = useRef<THREE.MeshStandardMaterial>(null);
  const target = useMemo(() => new THREE.Color(l ? oklabToHex(l.colour) : "#cfe6ff"), [l]);
  // The level eases to its new height (no popping when liquid goes in or out).
  const liqMesh = useRef<THREE.Mesh>(null);
  const shownH = useRef<number>(liquid?.h ?? 0);

  useFrame((_, dt) => {
    const m = liqMesh.current;
    if (!liquid) shownH.current = 0;
    else if (m) {
      shownH.current = reducedMotion ? liquid.h : shownH.current + (liquid.h - shownH.current) * (1 - Math.exp(-dt * 5));
      if (Math.abs(shownH.current - liquid.h) < 1e-4) shownH.current = liquid.h;
      m.scale.y = liquid.h > 1e-6 ? Math.max(0.001, shownH.current / liquid.h) : 1;
    }
    // Colour changes interpolate smoothly toward what the engine says (timing stays the engine's).
    if (mat.current) {
      mat.current.color.lerp(target, reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
      mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, l ? Math.min(0.95, 0.35 + l.opacity * 0.65) : 0, 0.1);
    }
    if (plumeMat.current) plumeMat.current.opacity = THREE.MathUtils.lerp(plumeMat.current.opacity, l?.plume ? l.plume.strength * 0.85 : 0, 0.15);
  });

  const isTube = item.kind === "test_tube" || item.kind === "boiling_tube";
  const isBottle = item.kind === "reagent_bottle" || item.kind === "dropper_bottle" || item.kind === "wash_bottle";
  const sediment = item.liquid ? Object.values(item.liquid.solids).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const gasActive = item.metals.some((m) => m.symbol === "Mg" && m.mol > 1e-6) || (item.liquid?.tempC ?? 0) > 99 || !!item.bubbling;
  const label = isBottle && item.reagentId ? reagent(item.reagentId) : null;

  return (
    <group>
      {liquid && (
        <mesh ref={liqMesh} geometry={liquid.geom} renderOrder={1}>
          <meshPhysicalMaterial ref={mat} color={target} transparent opacity={0.5} roughness={0.08} clearcoat={0.6} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {liquid && l?.plume && (
        <mesh position={[0, liquid.h * 0.7, 0]} scale={[liquid.rTop * 0.6, liquid.h * 0.35, liquid.rTop * 0.6]} renderOrder={2}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial ref={plumeMat} color={oklabToHex(l.plume.colour)} transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {liquid && sediment > 1e-6 && (
        <mesh position={[0, 0.012 + Math.min(0.08, sediment * 60) / 2, 0]} renderOrder={1}>
          <cylinderGeometry args={[liquid.rTop * 0.95, liquid.rTop * 0.95, Math.min(0.08, sediment * 60), 24]} />
          <meshStandardMaterial color={l?.sedimentColour ? oklabToHex(l.sedimentColour) : "#ffffff"} roughness={0.9} />
        </mesh>
      )}
      {liquid && gasActive && <Bubbles radius={liquid.rTop * 0.8} height={liquid.h} count={quality === "high" ? 70 : 24} reducedMotion={reducedMotion} />}
      {item.metals.map((m, i) =>
        m.mol > 1e-7 ? (
          <mesh key={i} position={[0, 0.05, 0]} rotation-z={m.symbol === "Fe" && m.area < 0.5 ? 0.25 : 0}>
            {m.symbol === "Fe" && m.area < 0.5 ? <cylinderGeometry args={[0.018, 0.018, Math.min(1.2, lipHeightMm(item.kind) * U * 0.9), 10]} /> : <boxGeometry args={[0.08 * Math.cbrt(m.mol / m.initialMol), 0.012, 0.04]} />}
            <meshStandardMaterial color={metalColour(m.symbol, item)} metalness={0.8} roughness={0.35} />
          </mesh>
        ) : null,
      )}
      {liquid && (item.foamMl ?? 0) > 1 && <Foam item={item} rTop={liquid.rTop} h={liquid.h} />}
      {item.electrodes && <Electrodes item={item} />}
      <mesh geometry={glassGeom} material={glass} renderOrder={3} castShadow={quality === "high"} />
      {isBottle && (
        <>
          <mesh position={[0, lipHeightMm(item.kind) * U + 0.04, 0]}>
            <cylinderGeometry args={[def.neckMm * U * 1.25 + 0.01, def.neckMm * U * 1.25 + 0.01, 0.12, 20]} />
            <meshStandardMaterial color={item.kind === "dropper_bottle" ? "#1f2937" : label?.corrosive ? "#dc2626" : "#2f80ff"} roughness={0.5} />
          </mesh>
          {label && <BottleLabel text={label.formula} sub={label.name} y={lipHeightMm(item.kind) * U * 0.42} r={def.profile[0]![0] * U + 0.004} hazard={label.corrosive} />}
        </>
      )}
      {isTube && item.gasTo === null && (item.gasMl?.["H2"] ?? 0) > 0 && null}
    </group>
  );
}

/* Part 5 visuals: metal colours after displacement, foam, electrodes, litmus paper. */
const METAL_HEX: Record<string, string> = { Mg: "#c9ccd2", Zn: "#a9b1bb", Fe: "#8a8f99", Cu: "#c27a4a" };
const DEPOSIT_HEX: Record<string, string> = { Cu: "#b5673d", Zn: "#5f6670", Fe: "#2e3136", Mg: "#d9dce1" };

function metalColour(symbol: string, item: Item) {
  // An iron nail in copper(II) sulfate keeps its original look; other pairs coat with the displaced metal.
  const to = item.depositOf ? DEPOSIT_HEX[item.depositOf]! : symbol === "Fe" ? DEPOSIT_HEX.Cu! : null;
  const base = new THREE.Color(METAL_HEX[symbol] ?? "#c9ccd2");
  return to ? base.lerp(new THREE.Color(to), Math.min(1, item.depositMol / 2e-3)) : base;
}

/** Foam standing on the liquid and spilling out of the top (elephant toothpaste). */
function Foam({ item, rTop, h }: { item: Item; rTop: number; h: number }) {
  const lip = lipHeightMm(item.kind) * U;
  const area = Math.PI * Math.pow(rTop / U, 2); // mm²
  const height = Math.min(lip * 2.6, ((item.foamMl ?? 0) * 1000) / Math.max(area, 1) * U);
  return (
    <group>
      <mesh position={[0, h + height / 2, 0]} renderOrder={2}>
        <cylinderGeometry args={[rTop * 1.02, rTop * 0.98, height, 20]} />
        <meshStandardMaterial color="#fbf3dc" roughness={1} transparent opacity={0.95} />
      </mesh>
      {h + height > lip && (
        <mesh position={[0, h + height, 0]} renderOrder={2}>
          <sphereGeometry args={[rTop * 1.5, 16, 12]} />
          <meshStandardMaterial color="#fdf6e3" roughness={1} />
        </mesh>
      )}
    </group>
  );
}

/** Two carbon rods dipping into the cell: cathode (-) left, anode (+) right. */
function Electrodes({ item }: { item: Item }) {
  const lip = lipHeightMm(item.kind) * U;
  const r = KINDS[item.kind].profile[0]![0] * U;
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * r * 0.45, lip * 0.65, 0]}>
          <mesh>
            <cylinderGeometry args={[0.022, 0.022, lip * 1.1, 10]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.6} />
          </mesh>
          <mesh position={[0, lip * 0.58, 0]}>
            <sphereGeometry args={[0.03, 10, 8]} />
            <meshStandardMaterial color={side < 0 ? "#1f2937" : "#dc2626"} emissive={(item.volts ?? 0) > 0 ? (side < 0 ? "#334155" : "#ef4444") : "#000"} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BottleLabel({ text, sub, y, r, hazard }: { text: string; sub: string; y: number; r: number; hazard?: boolean | undefined }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fbfdff";
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = hazard ? "#dc2626" : "#2f80ff";
    g.fillRect(0, 0, 256, 24);
    g.fillStyle = "#0f172a";
    g.font = "800 46px Inter, sans-serif";
    g.textAlign = "center";
    g.fillText(text, 128, 78);
    g.font = "600 15px Inter, sans-serif";
    g.fillStyle = "#475569";
    g.fillText(sub.length > 28 ? `${sub.slice(0, 27)}…` : sub, 128, 108);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, sub, hazard]);
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[r, r, 0.32, 32, 1, true, -0.9, 1.8]} />
      <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.6} />
    </mesh>
  );
}

function Burette({ item, glass, state }: { item: Item; glass: THREE.Material; state: LabState; cues: LiveCue[] }) {
  void state;
  const v = item.liquid?.volumeMl ?? 0;
  const tube = 5.6;
  const colourHex = item.liquid && v > 0 ? oklabToHex(look(item)!.colour) : "#cfe6ff";
  return (
    <group>
      <mesh position={[0, tube / 2 + 0.25, 0]}>
        <cylinderGeometry args={[0.06, 0.06, tube, 20, 1, true]} />
        <primitive object={glass} attach="material" />
      </mesh>
      {v > 0 && (
        <mesh position={[0, 0.25 + ((v / 52) * tube) / 2, 0]}>
          <cylinderGeometry args={[0.052, 0.052, (v / 52) * tube, 16]} />
          <meshStandardMaterial color={colourHex} transparent opacity={0.6} />
        </mesh>
      )}
      {/* stopcock: the handle turns with the opening */}
      <mesh position={[0, 0.22, 0]} rotation-x={(item.stopcock ?? 0) * (Math.PI / 2)}>
        <boxGeometry args={[0.32, 0.04, 0.05]} />
        <meshStandardMaterial color="#2f80ff" />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.012, 0.02, 0.2, 10]} />
        <primitive object={glass} attach="material" />
      </mesh>
      {item.tipBubble && (
        <mesh position={[0, 0.12, 0]}>
          <sphereGeometry args={[0.014, 8, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.9} />
        </mesh>
      )}
      {(item.stopcock ?? 0) > 0 && v > 0 && <Drips rate={item.stopcock ?? 0} colour={colourHex} />}
      {/* graduation ticks */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} position={[0.062, 0.25 + tube - (i * tube) / 10.4, 0]}>
          <boxGeometry args={[0.01, 0.006, 0.03]} />
          <meshBasicMaterial color="#e5edff" />
        </mesh>
      ))}
    </group>
  );
}

function Drips({ rate, colour }: { rate: number; colour: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (rate > 0.6) {
      ref.current.scale.set(1, 1, 1);
      ref.current.position.y = -0.25;
      return;
    }
    const period = 1 / (0.6 + rate * 6);
    const ph = (clock.elapsedTime % period) / period;
    ref.current.position.y = -0.02 - ph * 0.6;
    ref.current.scale.setScalar(0.6 + ph * 0.4);
  });
  return (
    <mesh ref={ref}>
      {rate > 0.6 ? <cylinderGeometry args={[0.01, 0.01, 0.5, 8]} /> : <sphereGeometry args={[0.018, 8, 8]} />}
      <meshStandardMaterial color={colour} transparent opacity={0.85} />
    </mesh>
  );
}

function Bunsen({ item, cues, reducedMotion }: { item: Item; cues: LiveCue[]; reducedMotion: boolean }) {
  const now = performance.now();
  const test = [...cues].reverse().find((c) => c.kind === "flame" && c.target === item.id && c.durationMs > 0 && now - c.at < c.durationMs);
  const colour = test && test.kind === "flame" ? oklabToHex(test.colour) : item.airHoleOpen ? "#5b8cff" : "#ffb347";
  return (
    <group>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.06, 24]} />
        <meshStandardMaterial color="#1f2937" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.7, 16]} />
        <meshStandardMaterial color="#c0c7d4" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.1, 16]} />
        <meshStandardMaterial color={item.airHoleOpen ? "#2f80ff" : "#64748b"} metalness={0.6} />
      </mesh>
      {item.gasOn && <SmallFlame position={[0, 0.98, 0]} colour={colour} big open={!!item.airHoleOpen} test={!!test} reducedMotion={reducedMotion} />}
    </group>
  );
}

function SmallFlame({ position, colour, big, open, test, reducedMotion }: { position: [number, number, number]; colour: string; big?: boolean; open?: boolean; test?: boolean; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return;
    const t = clock.elapsedTime;
    ref.current.scale.y = 1 + Math.sin(t * 23) * 0.05 + Math.sin(t * 37) * 0.04;
    ref.current.scale.x = ref.current.scale.z = 1 + Math.sin(t * 17) * 0.03;
  });
  const h = big ? (open ? 0.5 : 0.75) : 0.16;
  const w = big ? 0.09 : 0.04;
  return (
    <group ref={ref} position={position}>
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[w, h, 20, 1, true]} />
        <meshBasicMaterial color={colour} transparent opacity={test ? 0.95 : open ? 0.55 : 0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {big && open && !test && (
        <mesh position={[0, -h * 0.25, 0]}>
          <coneGeometry args={[w * 0.55, h * 0.45, 16, 1, true]} />
          <meshBasicMaterial color="#9fd0ff" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <pointLight color={colour} intensity={big ? 2.5 : 0.8} distance={big ? 2.5 : 1} />
    </group>
  );
}

function Bubbles({ radius, height, count, reducedMotion }: { radius: number; height: number; count: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = reducedMotion ? Math.ceil(count * 0.2) : count;
  const seeds = useMemo(() => Array.from({ length: n }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), r: ((i * 0.618) % 1) * radius, s: 0.25 + ((i * 0.37) % 1) * 0.5, o: (i * 0.173) % 1, size: 0.006 + ((i * 0.53) % 1) * 0.012 })), [n, radius]);
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    seeds.forEach((b, i) => {
      // larger bubbles rise faster and wobble
      const y = ((clock.elapsedTime * b.s * (1 + b.size * 30) + b.o) % 1) * height;
      m.position.set(Math.cos(b.a) * b.r + Math.sin(clock.elapsedTime * 6 + i) * 0.006, y + 0.01, Math.sin(b.a) * b.r);
      m.scale.setScalar(b.size * (y > height * 0.95 ? 1.6 : 1));
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} renderOrder={2}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.75} roughness={0} />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ pour stream */

export function PourStream({ state, pour }: { state: LabState; pour: PourAnim }) {
  const from = pour ? state.items[pour.from] : null;
  const to = pour?.to ? state.items[pour.to] : null;
  const colour = from ? oklabToHex(look(from)?.colour ?? { L: 0.9, a: 0, b: 0 }) : "#cfe6ff";
  const geom = useMemo(() => {
    if (!from || !to || !pour || pour.rateMlPerS <= 0) return null;
    const topY = baseY(to, state) + lipHeightMm(to.kind) * U;
    const start = new THREE.Vector3(to.x * U + 0.22, topY + 0.5, to.z * U);
    const end = new THREE.Vector3(to.x * U + 0.02, baseY(to, state) + heightOf(to.kind, to.liquid?.volumeMl ?? 0) * U + 0.02, to.z * U);
    const mid = new THREE.Vector3((start.x + end.x) / 2 + 0.05, (start.y + end.y) / 2 + 0.12, start.z);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const width = Math.min(0.03, 0.004 + Math.sqrt(pour.rateMlPerS) * 0.006);
    return new THREE.TubeGeometry(curve, 24, width, 8, false);
    // Rebuild only when the stream visibly changes, not on every engine tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.id, to?.id, pour?.rateMlPerS ? Math.round(pour.rateMlPerS * 4) : 0, to ? Math.round((to.liquid?.volumeMl ?? 0) * 2) : 0]);
  useDisposable(geom);
  // The stream falls from the lip into the vessel when a pour starts (drawn in over ~0.3 s).
  const reveal = useRef(0);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  if (!geom) reveal.current = 0;
  useFrame((_, dt) => {
    if (!geom) return;
    reveal.current = Math.min(1, reveal.current + dt / 0.3);
    const count = geom.index ? geom.index.count : 0;
    geom.setDrawRange(0, Math.ceil((count * reveal.current) / 6) * 6);
    if (mat.current) mat.current.opacity = 0.35 + 0.45 * reveal.current;
  });
  if (!geom) return null;
  return (
    <mesh geometry={geom} renderOrder={4}>
      <meshStandardMaterial ref={mat} color={colour} transparent opacity={0.35} roughness={0.05} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ drag to place */

function DragPlane({ state, selected, draggable, onPlace }: BenchProps) {
  const [drag, setDrag] = useState<{ id: string; x: number; z: number } | null>(null);
  const can = selected && draggable?.(selected);
  if (!can || !onPlace) return null;
  const item = state.items[selected!]!;
  const providers = Object.values(state.items).filter((i) => (KINDS[i.kind].provides ?? []).some((s) => (KINDS[item.kind].fits as string[]).includes(s)));
  return (
    <>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.001, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          setDrag({ id: item.id, x: e.point.x, z: e.point.z });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, x: e.point.x, z: e.point.z })}
        onPointerUp={() => {
          if (!drag) return;
          // Snap sockets attract within ~24 px (0.35 scene units at this zoom).
          let snap: { id: string; kind: string; x: number; z: number } | null = null;
          let best = 0.35;
          for (const p of providers) {
            const d = Math.hypot(p.x * U - drag.x, p.z * U - drag.z);
            if (d < best) {
              best = d;
              snap = { id: p.id, kind: (KINDS[p.kind].provides ?? [])[0] ?? "bench", x: p.x, z: p.z };
            }
          }
          onPlace(drag.id, snap ? snap.x : Math.round(drag.x / U), snap ? snap.z : Math.round(drag.z / U), snap ? `${snap.kind}:${snap.id}` : null);
          setDrag(null);
        }}
      >
        <planeGeometry args={[9, 4.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {drag && (
        <mesh position={[drag.x, 0.01, drag.z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.25, 0.29, 40]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} toneMapped={false} />
        </mesh>
      )}
      {providers.map((p) => (
        <mesh key={p.id} position={[p.x * U, 0.012, p.z * U]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.36, 0.4, 40]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.45} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ carry the held item */

/**
 * While something is in hand and not yet over a target, pressing on it and dragging carries it
 * across the bench; releasing near a valid target hands it to onDropOnto. Orbit is paused for the
 * duration so the camera does not swing.
 */
function HandDragPlane({ hand, state, targets, onDropOnto }: BenchProps) {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const [, force] = useState(0);
  const nearRef = useRef<string | null>(null);
  const active = !!hand && !hand.over && !!onDropOnto;
  const latest = useRef({ hand, targets, state, onDropOnto });
  latest.current = { hand, targets, state, onDropOnto };

  useEffect(() => {
    if (!active) {
      handDrag.active = false;
      handDrag.begin = null;
      return;
    }
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const nearest = (x: number, z: number) => {
      let best: string | null = null;
      let d0 = 0.55;
      for (const id of latest.current.targets) {
        const t = latest.current.state.items[id];
        if (!t) continue;
        const d = Math.hypot(t.x * U - x, t.z * U - z);
        if (d < d0) {
          d0 = d;
          best = id;
        }
      }
      return best;
    };
    const move = (e: PointerEvent) => {
      if (!handDrag.active) return;
      const r = dom.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      handDrag.x = hit.x;
      handDrag.z = hit.z;
      nearRef.current = nearest(hit.x, hit.z);
    };
    const up = () => {
      if (!handDrag.active) return;
      handDrag.active = false;
      if (controls) controls.enabled = true;
      const near = nearRef.current;
      nearRef.current = null;
      const { hand: h, onDropOnto: drop } = latest.current;
      if (h && near) drop?.(h.id, near);
      force((n) => n + 1);
    };
    // Grabbing the held item pauses orbit straight away, before the camera can start to turn.
    handDrag.begin = () => {
      if (controls) controls.enabled = false;
    };
    // A drag that started on a shelf outside the canvas is already under way.
    if (handDrag.active && controls) controls.enabled = false;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (controls) controls.enabled = true;
    };
  }, [active, camera, dom, controls]);
  return null;
}

/* ------------------------------------------------------------------ camera framing */

/** Rough height of a piece of equipment (mm), from its glass profile. */
function tallMm(kind: EquipmentKind): number {
  const p = KINDS[kind].profile;
  return p.length ? Math.max(...p.map(([, h]) => h)) : kind === "clamp_stand" || kind === "burette_50" ? 520 : 120;
}

/** Viewing direction (from the target towards the camera): about 24 degrees above the bench. */
const VIEW_DIR = new THREE.Vector3(0, 0.41, 0.91).normalize();

/** Fits a set of items in view: the camera position and look-at point. Never closer than 3.2 units. */
function fitItems(items: Item[], camera: THREE.PerspectiveCamera, width: number, height: number, tall = false) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = 0;
  for (const it of items) {
    const r = footprint(it.kind);
    minX = Math.min(minX, it.x * U - r);
    maxX = Math.max(maxX, it.x * U + r);
    minZ = Math.min(minZ, it.z * U - r);
    maxZ = Math.max(maxZ, it.z * U + r);
    top = Math.max(top, Math.min(tall ? 9 : 3.6, tallMm(it.kind) * U + (it.socket?.startsWith("clamp") ? SOCKET_HEIGHT.clamp! : 0)));
  }
  const centre = new THREE.Vector3((minX + maxX) / 2, Math.min(tall ? 3.4 : 1.7, top * 0.45 + 0.1), (minZ + maxZ) / 2);
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  // Room either side for the hand to carry and tilt a vessel over its target, and for name tags.
  const w = (maxX - minX + 1.3) * 1.12;
  const h = Math.max(top + 0.9, (maxZ - minZ) * 0.45 + 0.9) * 1.12;
  const dist = THREE.MathUtils.clamp(Math.max(w / 2 / Math.tan(hfov / 2), h / 2 / Math.tan(vfov / 2)), 3.2, tall ? 15 : 11);
  return { pos: centre.clone().addScaledVector(VIEW_DIR, dist), target: centre };
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * Eases the camera once to fit a set of items whenever the frame key changes (one calm move per
 * beat or step, never continuous re-targeting). If the learner orbits, pans or zooms, the move
 * stops and onUserCamera is called; the page then usually stops framing until "Re-centre".
 */
function CameraRig({ frame, state, reducedMotion, onUserCamera }: { frame: BenchFrame; state: LabState; reducedMotion: boolean; onUserCamera?: (() => void) | undefined }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as (THREE.EventDispatcher<{ start: object; end: object; change: object }> & { target: THREE.Vector3; update: () => void }) | null;
  const size = useThree((s) => s.size);
  const anim = useRef<{ start: number; dur: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const userCb = useRef(onUserCamera);
  userCb.current = onUserCamera;
  const lastSize = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const items = frame.ids.map((id) => stateRef.current.items[id]).filter((it): it is Item => !!it && it.socket !== "worn");
    if (!items.length || !controls) return;
    const { pos, target } = fitItems(items, camera, size.width, size.height, !!frame.tall);
    const resized = lastSize.current.w !== 0 && (lastSize.current.w !== size.width || lastSize.current.h !== size.height);
    lastSize.current = { w: size.width, h: size.height };
    if (reducedMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    // Skip a move too small to notice (no little nudges between beats).
    if (camera.position.distanceTo(pos) < 0.12 && controls.target.distanceTo(target) < 0.08) return;
    anim.current = { start: performance.now(), dur: resized ? 400 : 1100, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), pos, target };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.key, frame.ids.join("|"), size.width, size.height, controls]);

  useEffect(() => {
    if (!controls) return;
    let interacting = false;
    const from = new THREE.Vector3();
    const start = () => {
      interacting = true;
      from.copy(camera.position);
    };
    const end = () => (interacting = false);
    const change = () => {
      // A click with a little jitter is not a camera move.
      if (!interacting || camera.position.distanceTo(from) < 0.06) return;
      interacting = false;
      anim.current = null;
      userCb.current?.();
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    controls.addEventListener("change", change);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
      controls.removeEventListener("change", change);
    };
  }, [controls, camera]);

  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const k = Math.min(1, (performance.now() - a.start) / a.dur);
    const e = easeInOut(k);
    camera.position.lerpVectors(a.fromPos, a.pos, e);
    controls.target.lerpVectors(a.fromTarget, a.target, e);
    controls.update();
    if (k >= 1) anim.current = null;
  });
  return null;
}

export { Backdrop, BenchTop, Bubbles, SmallFlame, lathe, U as SCENE_UNIT };
