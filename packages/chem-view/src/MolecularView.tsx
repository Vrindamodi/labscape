import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { ATOM_STYLE, buildScene, type EmissionScene, type ReactionScene, type Scene } from "./molecules";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (t: number, a: number, b: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const MOVE: [number, number] = [0.2, 0.68];

type Clock = { t: number; playing: boolean; speed: number };

/**
 * Molecular view (build plan 2.13): atoms travel from reactants to products, bonds fade out as they
 * break and in as they form, electrons fly across in redox reactions, and an atom counter proves
 * nothing is created or destroyed. Flame tests get an emission view instead.
 */
export function MolecularView({ scene, reducedMotion = false, height = 360 }: { scene: Scene; reducedMotion?: boolean; height?: number }) {
  const clock = useRef<Clock>({ t: reducedMotion ? 1 : 0, playing: !reducedMotion, speed: 1 });
  const [ui, setUi] = useState({ t: clock.current.t, playing: clock.current.playing, speed: 1 });
  const [metal, setMetal] = useState(0);
  const built = useMemo(() => (scene.kind === "reaction" ? buildScene(scene) : null), [scene]);

  useEffect(() => {
    const id = window.setInterval(() => setUi({ t: clock.current.t, playing: clock.current.playing, speed: clock.current.speed }), 100);
    return () => window.clearInterval(id);
  }, []);

  const caption = [...scene.captions].reverse().find(([at]) => ui.t >= at)?.[1] ?? scene.captions[0]?.[1];
  const set = (patch: Partial<Clock>) => {
    Object.assign(clock.current, patch);
    setUi({ t: clock.current.t, playing: clock.current.playing, speed: clock.current.speed });
  };

  return (
    <div className="overflow-hidden rounded-xl bg-[radial-gradient(600px_300px_at_50%_0%,#1a2c5a,#0a1124)] ring-1 ring-inset ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <p className="text-sm font-bold text-white">{scene.title}</p>
        {scene.kind === "reaction" && <p className="font-mono text-sm text-[#bcd6ff]">{scene.equation}</p>}
        {scene.kind === "emission" && (
          <div className="flex gap-1" role="radiogroup" aria-label="Metal">
            {scene.metals.map((m, i) => (
              <button
                key={m.symbol}
                role="radio"
                aria-checked={metal === i}
                onClick={() => {
                  setMetal(i);
                  set({ t: 0, playing: true });
                }}
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${metal === i ? "text-white" : "text-white/55 ring-white/15"}`}
                style={metal === i ? { background: `${m.colour}40`, boxShadow: `inset 0 0 0 1px ${m.colour}` } : undefined}
              >
                {m.symbol}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ height }} className="relative">
        <Canvas camera={{ position: [0, 1.4, 10], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <ambientLight intensity={0.55} />
          <directionalLight position={[4, 6, 6]} intensity={1.4} />
          <directionalLight position={[-5, -2, 3]} intensity={0.4} color="#88aaff" />
          <Ticker clock={clock} />
          {scene.kind === "reaction" && built && <Reaction scene={scene} built={built} clock={clock} reducedMotion={reducedMotion} />}
          {scene.kind === "emission" && <Emission scene={scene} metal={metal} clock={clock} />}
          <OrbitControls enablePan={false} minDistance={5} maxDistance={18} />
        </Canvas>
      </div>
      <div className="space-y-3 px-4 pb-4">
        <p className="min-h-[2.5rem] text-sm leading-relaxed text-white/85" aria-live="polite">
          {caption}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => set(clock.current.t >= 1 ? { t: 0, playing: true } : { playing: !clock.current.playing })}
            className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-white"
            aria-label={ui.playing ? "Pause" : "Play"}
          >
            {ui.playing ? "Pause" : ui.t >= 1 ? "Replay" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(ui.t * 1000)}
            onChange={(e) => set({ t: Number(e.target.value) / 1000, playing: false })}
            className="h-1 flex-1 accent-[#2f80ff]"
            aria-label="Reaction progress"
          />
          <button onClick={() => set({ speed: clock.current.speed === 1 ? 0.4 : 1 })} className="rounded-full px-2.5 py-1 text-xs font-semibold text-[#8cbcff] ring-1 ring-inset ring-accent/40">
            {ui.speed === 1 ? "Slow-mo" : "Normal speed"}
          </button>
        </div>
        {built && (
          <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Atom counter">
            <span className="font-semibold uppercase tracking-wide text-white/45">Atoms</span>
            {Object.keys(built.counts.before).map((sym) => {
              const ok = built.counts.before[sym] === built.counts.after[sym];
              return (
                <span key={sym} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 ring-1 ring-inset ring-white/10">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ATOM_STYLE[sym as keyof typeof ATOM_STYLE].colour }} />
                  <b className="text-white">{sym}</b>
                  <span className="text-white/70">
                    {built.counts.before[sym]} → {built.counts.after[sym] ?? 0}
                  </span>
                  <span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "✓" : "✗"}</span>
                </span>
              );
            })}
            <span className="text-white/45">Every atom is still there: only the bonds changed.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Ticker({ clock }: { clock: MutableRefObject<Clock> }) {
  useFrame((_, dt) => {
    const c = clock.current;
    if (!c.playing) return;
    c.t = Math.min(1, c.t + (dt * c.speed) / 9);
    if (c.t >= 1) c.playing = false;
  });
  return null;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function Reaction({ scene, built, clock, reducedMotion }: { scene: ReactionScene; built: ReturnType<typeof buildScene>; clock: MutableRefObject<Clock>; reducedMotion: boolean }) {
  const atomRefs = useRef<(THREE.Mesh | null)[]>([]);
  const bondRefs = useRef<(THREE.Mesh | null)[]>([]);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const electronRefs = useRef<(THREE.Mesh | null)[]>([]);
  const heat = useRef<THREE.PointLight>(null);
  const pos = useMemo(() => built.atoms.map(() => new THREE.Vector3()), [built]);

  useFrame(({ clock: c }) => {
    const t = clock.current.t;
    const k = smooth(t, MOVE[0], MOVE[1]);
    const time = c.elapsedTime;
    built.atoms.forEach((a, i) => {
      const p = pos[i]!;
      p.set(a.start[0] + (a.end[0] - a.start[0]) * k, a.start[1] + (a.end[1] - a.start[1]) * k, a.start[2] + (a.end[2] - a.start[2]) * k);
      if (!reducedMotion) p.y += Math.sin(time * 1.7 + i * 1.3) * 0.04;
      atomRefs.current[i]?.position.copy(p);
    });
    built.bonds.forEach((b, i) => {
      const m = bondRefs.current[i];
      if (!m) return;
      const op = b.kind === "kept" ? 1 : b.kind === "broken" ? 1 - smooth(t, 0.26, 0.46) : smooth(t, 0.48, 0.7);
      tmpA.copy(pos[b.a]!);
      tmpB.copy(pos[b.b]!);
      const len = tmpA.distanceTo(tmpB);
      m.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
      m.scale.set(1, len, 1);
      const mat = m.material as THREE.MeshStandardMaterial;
      // A breaking bond stretches and glows before it goes.
      mat.opacity = op * (built.atoms[b.a]!.spectator ? 0.35 : 1);
      mat.emissiveIntensity = b.kind === "broken" ? smooth(t, 0.18, 0.3) * 1.2 : b.kind === "formed" ? (1 - smooth(t, 0.7, 0.9)) * op : 0;
      m.visible = op > 0.01;
    });
    built.labels.forEach((l, i) => {
      const el = labelRefs.current[i];
      if (!el) return;
      const op = l.phase === "start" ? 1 - smooth(t, 0.12, 0.3) : smooth(t, 0.7, 0.86);
      el.style.opacity = String(op * (l.spectator ? 0.55 : 1));
    });
    if (scene.electrons) {
      const from = pos[scene.electrons.from]!;
      scene.electrons.to.forEach((to, j) => {
        const m = electronRefs.current[j];
        if (!m) return;
        const s = clamp01((t - 0.28 - j * 0.06) / 0.24);
        m.visible = s > 0 && s < 1;
        const dst = pos[to]!;
        m.position.lerpVectors(from, dst, s);
        m.position.y += Math.sin(s * Math.PI) * 1.1;
      });
    }
    if (heat.current) heat.current.intensity = scene.exothermic ? Math.sin(Math.PI * clamp01((t - 0.5) / 0.3)) * 18 : 0;
  });

  return (
    <group>
      <pointLight ref={heat} position={[0, 0.4, 1.5]} color="#ff8a3d" distance={10} intensity={0} />
      {built.atoms.map((a, i) => {
        const st = ATOM_STYLE[a.sym];
        return (
          <mesh key={i} ref={(m) => (atomRefs.current[i] = m)} position={a.start}>
            <sphereGeometry args={[st.r, 32, 24]} />
            <meshStandardMaterial color={st.colour} roughness={0.32} metalness={a.sym === "Cu" || a.sym === "Fe" || a.sym === "Mg" ? 0.35 : 0.05} transparent opacity={a.spectator ? 0.45 : 1} />
          </mesh>
        );
      })}
      {built.bonds.map((b, i) => (
        <mesh key={i} ref={(m) => (bondRefs.current[i] = m)}>
          <cylinderGeometry args={[0.075, 0.075, 1, 12]} />
          <meshStandardMaterial color="#dfe7f5" roughness={0.4} transparent emissive={b.kind === "broken" ? "#ff5a5a" : "#5ad1ff"} emissiveIntensity={0} />
        </mesh>
      ))}
      {scene.electrons?.to.map((_, j) => (
        <mesh key={j} ref={(m) => (electronRefs.current[j] = m)} visible={false}>
          <sphereGeometry args={[0.11, 16, 12]} />
          <meshBasicMaterial color="#7cf3ff" />
          <pointLight color="#7cf3ff" intensity={3} distance={2} />
        </mesh>
      ))}
      {built.labels.map((l, i) => (
        <Html key={i} position={l.at} center zIndexRange={[10, 0]}>
          <div ref={(el) => (labelRefs.current[i] = el)} className="pointer-events-none whitespace-nowrap rounded-full bg-[#0a1124cc] px-2 py-0.5 text-xs font-bold text-white ring-1 ring-white/15" style={{ opacity: l.phase === "start" ? 1 : 0 }}>
            {l.text}
          </div>
        </Html>
      ))}
    </group>
  );
}

function Emission({ scene, metal, clock }: { scene: EmissionScene; metal: number; clock: MutableRefObject<Clock> }) {
  const m = scene.metals[metal]!;
  const outer = m.shells.length - 1;
  const ringR = (i: number) => 0.95 + i * 0.62;
  const electron = useRef<THREE.Mesh>(null);
  const photon = useRef<THREE.Group>(null);
  const flash = useRef<THREE.PointLight>(null);
  const spin = useRef<THREE.Group>(null);
  const wave = useMemo(() => Array.from({ length: 80 }, (_, i) => new THREE.Vector3(i * 0.05, Math.sin(i * 0.5) * 0.18, 0)), []);

  useFrame((_, dt) => {
    const t = clock.current.t;
    if (spin.current) spin.current.rotation.z += dt * 0.35;
    const up = smooth(t, 0.22, 0.38) - smooth(t, 0.55, 0.62);
    const r = ringR(outer) + up * 1.05;
    if (electron.current) {
      const a = 0.6;
      electron.current.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      (electron.current.material as THREE.MeshBasicMaterial).color.set(up > 0.05 ? "#ffffff" : "#8cc4ff");
      electron.current.scale.setScalar(1 + up * 0.5);
    }
    const p = clamp01((t - 0.6) / 0.35);
    if (photon.current) {
      photon.current.visible = p > 0 && p < 1;
      photon.current.position.set(Math.cos(0.6) * ringR(outer) + p * 5, Math.sin(0.6) * ringR(outer) + p * 1.2, 0);
    }
    if (flash.current) flash.current.intensity = Math.sin(Math.PI * clamp01((t - 0.58) / 0.25)) * 25;
  });

  return (
    <group position={[-0.8, -0.2, 0]}>
      <pointLight ref={flash} position={[1.5, 1, 2]} color={m.colour} distance={14} intensity={0} />
      <mesh>
        <sphereGeometry args={[0.45, 32, 24]} />
        <meshStandardMaterial color="#ffb4a8" roughness={0.4} emissive="#ff5a3d" emissiveIntensity={0.25} />
      </mesh>
      <Html center>
        <span className="pointer-events-none text-sm font-black text-white drop-shadow">{m.symbol}</span>
      </Html>
      <group ref={spin}>
        {m.shells.map((count, i) => {
          const r = ringR(i);
          const shown = i === outer ? count - 1 : Math.min(count, 18);
          return (
            <group key={i}>
              <mesh>
                <torusGeometry args={[r, 0.012, 8, 96]} />
                <meshBasicMaterial color="#5f86c9" transparent opacity={0.5} />
              </mesh>
              {Array.from({ length: shown }, (_, k) => {
                const a = (k / Math.max(1, i === outer ? count : shown)) * Math.PI * 2 + 2.2;
                return (
                  <mesh key={k} position={[Math.cos(a) * r, Math.sin(a) * r, 0]}>
                    <sphereGeometry args={[0.07, 12, 8]} />
                    <meshBasicMaterial color="#8cc4ff" />
                  </mesh>
                );
              })}
            </group>
          );
        })}
      </group>
      {/* the excited level */}
      <mesh>
        <torusGeometry args={[ringR(outer) + 1.05, 0.008, 8, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.18} />
      </mesh>
      <mesh ref={electron}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshBasicMaterial color="#8cc4ff" />
      </mesh>
      <group ref={photon} visible={false}>
        <Line points={wave} color={m.colour} lineWidth={3} />
      </group>
      <Html position={[ringR(outer) + 2.6, -1.6, 0]} center>
        <div className="pointer-events-none whitespace-nowrap rounded-lg bg-[#0a1124cc] px-2.5 py-1 text-xs text-white ring-1 ring-white/15">
          <b style={{ color: m.colour }}>{m.name}</b> · {m.nm} nm
        </div>
      </Html>
    </group>
  );
}
