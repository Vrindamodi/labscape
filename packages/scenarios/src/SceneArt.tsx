import { AnimatePresence, motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import type { Kind } from "./types";

/**
 * Illustrated 2.5D rooms for the emergency simulator, drawn in a 640x360 SVG. The room is driven by:
 * - `props`: the scene's persistent state from the scenario JSON (towel-on, power-off, window-open...);
 * - `anim`: the consequence animation of the learner's last action (adds/removes state and plays an effect at the target);
 * - `hazard` 0-100: fire grows, smoke banks down from the ceiling, sparks multiply, the spill spreads, skin reddens.
 * Consequences are shown through the hazard, never through injuries. Loops are CSS (cheap) and stop for reduced motion.
 */
export const W = 640;
export const H = 360;

export type Fx = "good" | "spark" | "flare" | "warn" | "water" | "cloud" | "powder" | "fizz" | "spatter" | "call" | "flash" | "none";
type AnimDef = { fx: Fx; adds?: string[]; removes?: string[]; caption: string };

/** What each animation id (from the scenario JSON) does to the room. */
export const ANIMS: Record<string, AnimDef> = {
  none: { fx: "none", caption: "" },
  alert: { fx: "good", caption: "You raise the alarm." },
  warn: { fx: "warn", caption: "That makes things worse." },
  call: { fx: "call", caption: "Help is on the way." },
  // gas fire
  "switch-spark": { fx: "spark", adds: ["fire-big"], caption: "The switch sparks in the gas-filled air and the flame jumps." },
  "flame-grow": { fx: "flare", adds: ["fire-big"], caption: "The fire grows while nothing useful is done." },
  "brother-leaves": { fx: "good", adds: ["brother-gone"], caption: "Your brother heads outside." },
  "cover-towel": { fx: "good", adds: ["towel-on"], removes: ["fire", "fire-big"], caption: "The wet towel smothers the flame." },
  "cover-blanket": { fx: "good", adds: ["blanket-on"], removes: ["fire", "fire-big"], caption: "The fire blanket smothers the flame." },
  "water-flare": { fx: "flare", adds: ["fire-big", "wet-floor"], caption: "The water bursts into steam and the flame flares up." },
  recoil: { fx: "warn", adds: ["fire-big"], caption: "The heat drives your hand back." },
  evacuate: { fx: "good", adds: ["door-open"], caption: "You get out and close the door behind you." },
  "knob-off": { fx: "good", adds: ["knob-off"], caption: "The regulator clicks to OFF and the hiss stops." },
  "stove-off": { fx: "warn", caption: "The stove is off, but gas still hisses from the regulator." },
  "gas-flash": { fx: "flash", caption: "The gas in the air flashes into flame!" },
  "window-open": { fx: "good", adds: ["window-open", "door-open"], removes: ["gas"], caption: "Fresh air flows through and the gas clears." },
  // electrical
  "shock-warn": { fx: "spark", caption: "Zap! Touching it puts you in the circuit too." },
  "water-spark": { fx: "spark", adds: ["wet-floor"], caption: "The water conducts and sparks fly." },
  "mcb-off": { fx: "good", adds: ["power-off", "cousin-free"], removes: ["sparks", "shock"], caption: "Click: the MCB trips the power off." },
  "stick-push": { fx: "good", adds: ["cousin-free"], removes: ["shock"], caption: "The dry wooden handle knocks the cable from her hand." },
  "co2-cloud": { fx: "cloud", adds: ["burnt-curtain"], removes: ["fire-curtain"], caption: "A blast of CO₂ smothers the flames." },
  "powder-cloud": { fx: "powder", adds: ["burnt-curtain"], removes: ["fire-curtain"], caption: "The powder knocks the flames down." },
  "power-on-spark": { fx: "spark", adds: ["sparks"], removes: ["power-off"], caption: "The burnt board arcs again!" },
  // chemical spill
  spread: { fx: "warn", adds: ["spill-big"], caption: "The spill spreads further." },
  eyewash: { fx: "water", adds: ["eyewash-on"], caption: "The eyewash streams over her eye." },
  splash: { fx: "water", caption: "A splash, then nothing: not enough water for long enough." },
  "ppe-on": { fx: "good", adds: ["ppe-on"], caption: "Goggles and gloves on." },
  contain: { fx: "good", adds: ["contained"], caption: "The absorbent rings the spill." },
  neutralise: { fx: "fizz", adds: ["neutralised"], removes: ["spill"], caption: "It fizzes, then settles: neutralised." },
  spatter: { fx: "spatter", caption: "The strong alkali spits and spatters hot liquid!" },
  // burn
  "tap-run": { fx: "water", adds: ["water-on"], caption: "Cool water runs over her fingers." },
  "ice-on": { fx: "warn", adds: ["ice-on"], caption: "The ice is too cold for burned skin." },
  smear: { fx: "warn", adds: ["smear"], caption: "It traps the heat in the skin." },
  "ring-off": { fx: "good", removes: ["ring"], caption: "The ring slides off before any swelling." },
  cling: { fx: "good", adds: ["cling-on"], caption: "Cling film laid loosely over the burn." },
  cotton: { fx: "warn", adds: ["cotton-on"], caption: "Fluffy fibres stick to the burn." },
};

/** The room state for a scene's props after an animation. */
export function sceneState(props: string[] | undefined, anim?: string | null): Set<string> {
  const s = new Set(props ?? []);
  const a = anim ? ANIMS[anim] : undefined;
  a?.removes?.forEach((r) => s.delete(r));
  a?.adds?.forEach((r) => s.add(r));
  return s;
}

export type SceneArtProps = {
  kind: Kind;
  hazard: number;
  props?: string[] | undefined;
  /** The consequence animation playing now. */
  anim?: string | null | undefined;
  /** Bumped to replay the effect. */
  animKey?: number | undefined;
  /** Where (in room coordinates) the effect plays. */
  at?: { x: number; y: number } | null | undefined;
  /** Static still: no loops, no effects (debrief thumbnails). */
  still?: boolean | undefined;
  reduced?: boolean | undefined;
  tone?: "good" | "bad" | null | undefined;
  /** Overlay drawn on top, in room coordinates (hotspots, tool markers). */
  children?: ReactNode;
  label?: string | undefined;
};

export function SceneArt({ kind, hazard, props, anim, animKey = 0, at, still, reduced, tone, children, label }: SceneArtProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const live = !still && !reduced;
  const h = Math.max(0, Math.min(100, hazard)) / 100;
  const s = sceneState(props, anim);
  const id = (n: string) => `${uid}-${n}`;
  const smoky = (kind === "fire" && (s.has("fire") || s.has("fire-big"))) || (kind === "electric" && (s.has("fire-curtain") || s.has("sparks")));
  const fx = anim ? ANIMS[anim]?.fx ?? "none" : "none";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`block h-full w-full ${live ? "" : "ls-still"}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label ?? `Emergency scene, danger ${Math.round(hazard)} out of 100`}>
      <defs>
        <style>{CSS}</style>
        <linearGradient id={id("smoke")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2a2d33" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#4b5059" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={id("flame")} cx="50%" cy="70%" r="60%">
          <stop offset="0%" stopColor="#fff9db" />
          <stop offset="35%" stopColor="#ffd43b" />
          <stop offset="70%" stopColor="#ff922b" />
          <stop offset="100%" stopColor="#e8590c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("glow")}>
          <stop offset="0%" stopColor="#ffa94d" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffa94d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("vignette")} cx="50%" cy="50%" r="72%">
          <stop offset="62%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor={h > 0.7 ? "#7a0f0f" : "#000"} stopOpacity={0.5} />
        </radialGradient>
        <linearGradient id={id("wall")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={kind === "fire" ? "#46506b" : kind === "electric" ? "#3b4763" : "#34465c"} />
          <stop offset="100%" stopColor={kind === "fire" ? "#2f374b" : kind === "electric" ? "#2a3247" : "#26364a"} />
        </linearGradient>
        <linearGradient id={id("floor")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={kind === "spill" || kind === "burn" ? "#4a5468" : "#6d5340"} />
          <stop offset="100%" stopColor={kind === "spill" || kind === "burn" ? "#2f3646" : "#3e2f24"} />
        </linearGradient>
        <linearGradient id={id("cyl")} x1="0" x2="1">
          <stop offset="0%" stopColor="#a61e1e" />
          <stop offset="45%" stopColor="#f03e3e" />
          <stop offset="100%" stopColor="#8f1818" />
        </linearGradient>
        <linearGradient id={id("sky")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#74c0fc" />
          <stop offset="100%" stopColor="#d0ebff" />
        </linearGradient>
        <linearGradient id={id("steel")} x1="0" x2="1">
          <stop offset="0%" stopColor="#868e96" />
          <stop offset="50%" stopColor="#e9ecef" />
          <stop offset="100%" stopColor="#868e96" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id("wall")})`} />
      {kind === "fire" && <Kitchen s={s} h={h} id={id} />}
      {kind === "electric" && <Room s={s} h={h} id={id} />}
      {kind === "spill" && <Lab s={s} h={h} />}
      {kind === "burn" && <Burn s={s} h={h} />}
      {smoky && <rect x={0} y={0} width={W} height={H * Math.min(0.62, 0.05 + h * 0.7)} fill={`url(#${id("smoke")})`} style={{ transition: "height 1.2s ease" }} />}
      <rect width={W} height={H} fill={`url(#${id("vignette")})`} pointerEvents="none" />
      {!still && !reduced && (
        <AnimatePresence>
          {fx !== "none" && at && <Effect key={animKey} fx={fx} at={at} flame={id("flame")} />}
          {tone && (
            <motion.rect key={`tone-${animKey}`} width={W} height={H} fill={tone === "good" ? "#20c997" : "#e03131"} initial={{ opacity: tone === "good" ? 0.18 : 0.32 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, delay: 0.5 }} pointerEvents="none" />
          )}
        </AnimatePresence>
      )}
      {children}
    </svg>
  );
}

const CSS = `
.ls-flick{animation:ls-flick .42s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
.ls-flick.b{animation-duration:.57s;animation-delay:-.2s}
.ls-flick.c{animation-duration:.33s;animation-delay:-.1s}
@keyframes ls-flick{from{transform:scale(1,1) skewX(0)}to{transform:scale(.9,1.14) skewX(3deg)}}
.ls-blink{animation:ls-blink .3s steps(2,jump-none) infinite}
.ls-blink.b{animation-duration:.45s;animation-delay:-.15s}
@keyframes ls-blink{0%{opacity:1}100%{opacity:0}}
.ls-drift{animation:ls-drift 2.6s ease-in-out infinite alternate}
.ls-drift.b{animation-duration:3.4s;animation-delay:-1s}
@keyframes ls-drift{from{transform:translate(0,4px);opacity:.25}to{transform:translate(6px,-8px);opacity:.6}}
.ls-flow{stroke-dasharray:6 6;animation:ls-flow .5s linear infinite}
@keyframes ls-flow{to{stroke-dashoffset:-12}}
.ls-steam{animation:ls-steam 2.2s ease-out infinite}
.ls-steam.b{animation-delay:-1.1s}
@keyframes ls-steam{from{transform:translateY(0);opacity:.7}to{transform:translateY(-26px);opacity:0}}
.ls-air{animation:ls-air 2.4s linear infinite}
.ls-air.b{animation-delay:-1.2s}
@keyframes ls-air{from{transform:translateX(0);opacity:0}30%{opacity:.8}to{transform:translateX(-90px);opacity:0}}
.ls-buzz{animation:ls-buzz .12s linear infinite alternate}
@keyframes ls-buzz{from{transform:translate(-1px,0)}to{transform:translate(1px,.5px)}}
.ls-pulse{animation:ls-pulse 1.6s ease-in-out infinite}
@keyframes ls-pulse{0%,100%{opacity:.35}50%{opacity:.9}}
.ls-still *{animation:none!important}
@media (prefers-reduced-motion:reduce){svg *{animation:none!important}}
`;

/* ------------------------------------------------------------------ shared bits */

function Flames({ x, y, size, flame, glow }: { x: number; y: number; size: number; flame: string; glow?: string }) {
  if (size < 0.05) return null;
  const k = size;
  const tongue = (dx: number, w: number, hgt: number) => `M ${x + dx - w} ${y} C ${x + dx - w} ${y - hgt * 0.5}, ${x + dx - w * 0.2} ${y - hgt * 0.7}, ${x + dx} ${y - hgt} C ${x + dx + w * 0.3} ${y - hgt * 0.65}, ${x + dx + w} ${y - hgt * 0.45}, ${x + dx + w} ${y} Z`;
  return (
    <g pointerEvents="none">
      {glow && <ellipse cx={x} cy={y - 20 * k} rx={70 * k + 20} ry={60 * k + 16} fill={`url(#${glow})`} />}
      <path className="ls-flick" d={tongue(0, 16 * k + 4, 70 * k + 14)} fill="#e8590c" opacity={0.9} />
      <path className="ls-flick b" d={tongue(-10 * k, 11 * k + 3, 50 * k + 10)} fill="#ff922b" />
      <path className="ls-flick c" d={tongue(9 * k, 10 * k + 3, 46 * k + 10)} fill="#ff922b" />
      <path className="ls-flick b" d={tongue(0, 9 * k + 2, 36 * k + 8)} fill={`url(#${flame})`} />
      <path className="ls-flick" d={tongue(1, 5 * k + 1, 18 * k + 5)} fill="#fff3bf" />
    </g>
  );
}

function Person({ x, y, scale = 1, shirt, hair = "#2b1d14", skin = "#c68a5b", long = false, children }: { x: number; y: number; scale?: number; shirt: string; hair?: string; skin?: string; long?: boolean; children?: ReactNode }) {
  // (x, y) = feet centre
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={0} cy={2} rx={22} ry={5} fill="#000" opacity={0.25} />
      <rect x={-12} y={-70} width={10} height={70} rx={4} fill="#343a40" />
      <rect x={2} y={-70} width={10} height={70} rx={4} fill="#3d434a" />
      <rect x={-18} y={-128} width={36} height={66} rx={12} fill={shirt} />
      <rect x={-24} y={-122} width={9} height={50} rx={4.5} fill={shirt} />
      <rect x={15} y={-122} width={9} height={50} rx={4.5} fill={shirt} />
      <circle cx={-19.5} cy={-70} r={5} fill={skin} />
      <circle cx={19.5} cy={-70} r={5} fill={skin} />
      <rect x={-5} y={-136} width={10} height={10} fill={skin} />
      <circle cx={0} cy={-148} r={15} fill={skin} />
      <path d={long ? "M -16 -150 C -16 -170, 16 -170, 16 -150 L 17 -118 L 9 -120 L 10 -150 C 4 -156, -4 -156, -10 -150 L -9 -120 L -17 -118 Z" : "M -16 -148 C -16 -168, 16 -168, 16 -148 C 12 -156, -12 -156, -16 -148 Z"} fill={hair} />
      {children}
    </g>
  );
}

function Spark({ x, y, n = 8, r = 14 }: { x: number; y: number; n?: number; r?: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={r * 0.5} fill="#fff3bf" className="ls-blink" opacity={0.8} />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + i;
        const len = r * (0.7 + ((i * 37) % 10) / 12);
        return (
          <path
            key={i}
            className={`ls-blink ${i % 2 ? "b" : ""}`}
            d={`M ${x + Math.cos(a) * 3} ${y + Math.sin(a) * 3} L ${x + Math.cos(a) * len * 0.6 + 3} ${y + Math.sin(a) * len * 0.6 - 2} L ${x + Math.cos(a) * len} ${y + Math.sin(a) * len}`}
            stroke={i % 3 ? "#ffe066" : "#fff"}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

function GasWisps({ x, y, spread = 1 }: { x: number; y: number; spread?: number }) {
  return (
    <g pointerEvents="none" stroke="#b2f2bb" strokeWidth={3} fill="none" strokeLinecap="round">
      <path className="ls-drift" d={`M ${x} ${y} c -8 -10, 8 -18, 0 -28 c -8 -10, 8 -18, 0 -28`} opacity={0.5} />
      <path className="ls-drift b" d={`M ${x + 16 * spread} ${y + 4} c -8 -10, 8 -18, 0 -28 c -8 -10, 8 -18, 0 -26`} opacity={0.4} />
      <path className="ls-drift" d={`M ${x - 18 * spread} ${y + 6} c -6 -8, 6 -14, 0 -22`} opacity={0.35} />
    </g>
  );
}

/* ------------------------------------------------------------------ kitchen (LPG regulator fire) */

function Kitchen({ s, h, id }: { s: Set<string>; h: number; id: (n: string) => string }) {
  const fire = s.has("fire") || s.has("fire-big");
  const size = 0.3 + h * 0.9 + (s.has("fire-big") ? 0.35 : 0);
  const gas = s.has("gas") && !s.has("window-open");
  return (
    <g>
      {/* tiled splashback */}
      <rect x={96} y={104} width={308} height={72} fill="#55607a" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`v${i}`} x1={96 + i * 38.5} y1={104} x2={96 + i * 38.5} y2={176} stroke="#46506a" strokeWidth={2} />
      ))}
      <line x1={96} y1={140} x2={404} y2={140} stroke="#46506a" strokeWidth={2} />
      {/* floor */}
      <path d={`M0 262 H${W} V${H} H0 Z`} fill={`url(#${id("floor")})`} />
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={0} y1={276 + i * 24} x2={W} y2={276 + i * 24} stroke="#00000033" />
      ))}
      {s.has("wet-floor") && <ellipse cx={330} cy={318} rx={90} ry={12} fill="#74c0fc" opacity={0.35} />}
      {/* LPG is heavier than air: it pools at floor level */}
      {gas && <g opacity={0.14} pointerEvents="none"><rect className="ls-pulse" x={0} y={300} width={W} height={60} fill="#b2f2bb" /></g>}

      {/* doorway to the next room, brother watching TV */}
      <rect x={14} y={96} width={70} height={196} fill="#161b27" />
      <rect x={14} y={96} width={70} height={196} fill="none" stroke="#7b6650" strokeWidth={6} />
      <g opacity={0.4}><rect x={22} y={130} width={26} height={18} rx={2} fill="#4dabf7" className="ls-pulse" /></g>
      {!s.has("brother-gone") && <Person x={56} y={288} scale={0.78} shirt="#4dabf7" />}

      {/* exhaust fan */}
      <rect x={216} y={46} width={68} height={68} rx={8} fill="#3b4252" stroke="#5c677d" strokeWidth={3} />
      <circle cx={250} cy={80} r={27} fill="#1f232b" />
      {[0, 120, 240].map((a) => (
        <ellipse key={a} cx={250} cy={66} rx={7} ry={13} fill="#868e96" transform={`rotate(${a} 250 80)`} />
      ))}
      <circle cx={250} cy={80} r={4} fill="#adb5bd" />

      {/* window */}
      <rect x={400} y={46} width={112} height={104} fill={`url(#${id("sky")})`} />
      {s.has("window-open") ? (
        <g>
          <path d="M400 46 L370 56 L370 140 L400 150 Z" fill="#a5d8ff" opacity={0.75} stroke="#e9e2d4" strokeWidth={4} />
          <path d="M512 46 L542 56 L542 140 L512 150 Z" fill="#a5d8ff" opacity={0.75} stroke="#e9e2d4" strokeWidth={4} />
          <g stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.8}>
            <path className="ls-air" d="M470 80 q -10 -6 -20 0 t -20 0" />
            <path className="ls-air b" d="M480 112 q -10 -6 -20 0 t -20 0" />
          </g>
        </g>
      ) : (
        <g stroke="#e9e2d4" strokeWidth={5} fill="none">
          <rect x={400} y={46} width={112} height={104} />
          <line x1={456} y1={46} x2={456} y2={150} />
        </g>
      )}
      <rect x={394} y={150} width={124} height={7} rx={2} fill="#e9e2d4" />

      {/* switchboard */}
      <rect x={526} y={158} width={30} height={44} rx={3} fill="#f1f3f5" stroke="#ced4da" />
      <rect x={532} y={166} width={7} height={11} rx={1} fill="#495057" />
      <rect x={543} y={166} width={7} height={11} rx={1} fill="#495057" />
      <circle cx={541} cy={190} r={4} fill="#adb5bd" />

      {/* door to outside */}
      {s.has("door-open") ? (
        <g>
          <rect x={568} y={92} width={66} height={204} fill="#ffe8a3" opacity={0.9} />
          <rect x={568} y={240} width={66} height={56} fill="#69db7c" opacity={0.6} />
          <path d="M568 92 L548 100 L548 300 L568 296 Z" fill="#7c5236" />
        </g>
      ) : (
        <g>
          <rect x={568} y={92} width={66} height={204} fill="#8a5a3b" />
          <rect x={576} y={102} width={50} height={80} rx={3} fill="none" stroke="#6f4630" strokeWidth={3} />
          <rect x={576} y={196} width={50} height={88} rx={3} fill="none" stroke="#6f4630" strokeWidth={3} />
          <circle cx={580} cy={192} r={4} fill="#e9ecef" />
        </g>
      )}
      <rect x={564} y={88} width={74} height={208} fill="none" stroke="#e9e2d4" strokeWidth={4} />

      {/* counter */}
      <rect x={96} y={186} width={308} height={84} fill="#b89f80" />
      {[104, 204, 304].map((x) => (
        <g key={x}>
          <rect x={x} y={194} width={92} height={68} rx={3} fill="#c9b293" stroke="#9c8466" strokeWidth={2} />
          <rect x={x + 40} y={202} width={12} height={4} rx={2} fill="#6c5a45" />
        </g>
      ))}
      <rect x={90} y={174} width={320} height={14} rx={3} fill="#ece6da" />
      <rect x={90} y={186} width={320} height={4} fill="#00000022" />

      {/* stove + kettle */}
      <rect x={128} y={160} width={152} height={16} rx={4} fill="#25262b" />
      <rect x={128} y={170} width={152} height={6} fill="#1a1b1e" />
      {[188, 204, 220].map((x) => (
        <circle key={x} cx={x} cy={173} r={2.6} fill={s.has("stove-off") ? "#adb5bd" : "#868e96"} />
      ))}
      <ellipse cx={168} cy={160} rx={18} ry={4} fill="none" stroke="#5c5f66" strokeWidth={3} />
      <ellipse cx={244} cy={160} rx={18} ry={4} fill="none" stroke="#5c5f66" strokeWidth={3} />
      {s.has("kettle") && (
        <g>
          <path d="M150 158 C 148 132, 188 132, 186 158 Z" fill={`url(#${id("steel")})`} />
          <path d="M186 146 L200 136" stroke="#adb5bd" strokeWidth={5} strokeLinecap="round" />
          <path d="M156 136 C 156 120, 180 120, 180 136" stroke="#495057" strokeWidth={3} fill="none" />
          {!s.has("towel-on") && !s.has("blanket-on") && (
            <g stroke="#f1f3f5" strokeWidth={2} fill="none" opacity={0.6}>
              <path className="ls-steam" d="M200 132 q -4 -6 0 -12" />
              <path className="ls-steam b" d="M204 130 q 4 -6 0 -12" />
            </g>
          )}
        </g>
      )}

      {/* hose: regulator to stove */}
      <path d="M342 196 C 380 186, 310 150, 280 168" stroke="#141414" strokeWidth={4.5} fill="none" />
      {/* LPG cylinder */}
      <ellipse cx={331} cy={306} rx={36} ry={6} fill="#000" opacity={0.3} />
      <rect x={302} y={214} width={58} height={92} rx={24} fill={`url(#${id("cyl")})`} />
      <rect x={305} y={296} width={52} height={10} rx={3} fill="#7a1414" />
      <text x={331} y={262} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" opacity={0.85}>
        LPG
      </text>
      <path d="M310 216 C 310 200, 352 200, 352 216 Z" fill="#c92a2a" />
      <rect x={312} y={198} width={38} height={14} rx={5} fill="none" stroke="#a61e1e" strokeWidth={4} />
      {/* regulator */}
      <rect x={318} y={186} width={26} height={14} rx={3} fill="#ced4da" stroke="#868e96" />
      <g transform={`rotate(${s.has("knob-off") ? 90 : 0} 331 185)`} style={{ transition: "transform .6s ease" }}>
        <circle cx={331} cy={185} r={7.5} fill="#212529" />
        <rect x={329.5} y={178} width={3} height={7} rx={1} fill={s.has("knob-off") ? "#51cf66" : "#ff6b6b"} />
      </g>
      {gas && !s.has("knob-off") && <GasWisps x={350} y={190} />}
      {gas && s.has("knob-off") && <GasWisps x={420} y={300} spread={3} />}
      {s.has("towel-on") && (
        <g>
          <path d="M304 222 C 300 196, 314 176, 331 176 C 348 176, 362 196, 358 222 L 352 236 L 342 226 L 332 238 L 322 226 L 310 236 Z" fill="#3b5bdb" />
          <path d="M309 206 C 320 200, 342 200, 354 206" stroke="#91a7ff" strokeWidth={3} fill="none" />
          <path d="M314 236 q 2 6 0 8 M 348 236 q 2 6 0 8" stroke="#74c0fc" strokeWidth={2.5} strokeLinecap="round" />
        </g>
      )}
      {s.has("blanket-on") && (
        <g>
          <path d="M298 226 C 296 194, 312 172, 331 172 C 350 172, 366 194, 364 226 L 356 240 L 331 234 L 306 240 Z" fill="#e9ecef" stroke="#ced4da" />
          <rect x={322} y={180} width={18} height={8} rx={2} fill="#e03131" />
        </g>
      )}
      {fire && <Flames x={331} y={196} size={size} flame={id("flame")} glow={id("glow")} />}
    </g>
  );
}

/* ------------------------------------------------------------------ bedroom (electrical short) */

function Room({ s, h, id }: { s: Set<string>; h: number; id: (n: string) => string }) {
  const off = s.has("power-off");
  const shock = s.has("shock") && !s.has("cousin-free");
  return (
    <g>
      <path d={`M0 270 H${W} V${H} H0 Z`} fill={`url(#${id("floor")})`} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <line key={i} x1={i * 92} y1={270} x2={i * 92 - 30} y2={H} stroke="#00000030" />
      ))}
      {s.has("wet-floor") && <ellipse cx={390} cy={300} rx={110} ry={14} fill="#74c0fc" opacity={0.35} />}
      <rect x={0} y={262} width={W} height={8} fill="#5a4636" />

      {/* door */}
      {s.has("door-open") ? (
        <g>
          <rect x={10} y={96} width={70} height={204} fill="#ffe8a3" opacity={0.85} />
          <path d="M80 96 L100 104 L100 304 L80 300 Z" fill="#7c5236" />
        </g>
      ) : (
        <g>
          <rect x={10} y={96} width={70} height={204} fill="#7c5236" />
          <rect x={18} y={106} width={54} height={86} rx={3} fill="none" stroke="#603e28" strokeWidth={3} />
          <rect x={18} y={204} width={54} height={86} rx={3} fill="none" stroke="#603e28" strokeWidth={3} />
          <circle cx={70} cy={198} r={4} fill="#e9ecef" />
        </g>
      )}
      <rect x={6} y={92} width={78} height={208} fill="none" stroke="#d6cdbd" strokeWidth={4} />

      {/* MCB box */}
      <rect x={96} y={56} width={56} height={72} rx={5} fill="#e9ecef" stroke="#868e96" strokeWidth={2} />
      <rect x={100} y={60} width={48} height={11} rx={2} fill="#495057" />
      <text x={124} y={69} textAnchor="middle" fontSize={8} fontWeight={800} fill="#fff">
        MCB
      </text>
      <rect x={102} y={78} width={44} height={40} rx={2} fill="#dee2e6" />
      {[106, 116, 126, 136].map((x, i) => (
        <g key={x}>
          <rect x={x} y={82} width={8} height={30} rx={1.5} fill={i === 0 ? "#c92a2a" : "#343a40"} />
          <rect x={x + 1.5} y={off ? 100 : 84} width={5} height={10} rx={1} fill="#f8f9fa" style={{ transition: "y .35s ease" }} />
        </g>
      ))}
      <circle cx={146} cy={122} r={3} fill={off ? "#adb5bd" : "#51cf66"} />

      {/* laptop on a low table */}
      <rect x={120} y={226} width={120} height={8} rx={2} fill="#9c7a55" />
      <rect x={128} y={234} width={6} height={36} fill="#7c5f40" />
      <rect x={226} y={234} width={6} height={36} fill="#7c5f40" />
      <path d="M146 218 L152 184 L208 184 L204 218 Z" fill="#343a40" />
      <path d="M152 214 L156 188 L204 188 L201 214 Z" fill={off ? "#1c1f24" : "#4dabf7"} opacity={off ? 1 : 0.6} />
      <rect x={138} y={218} width={76} height={8} rx={2} fill="#adb5bd" />
      {/* cable laptop -> board, gripped by the cousin */}
      <path d={shock ? "M210 224 C 250 240, 300 262, 352 270" : "M210 224 C 250 250, 300 276, 352 270"} stroke="#111" strokeWidth={3} fill="none" />

      {/* cousin, kneeling */}
      <g className={shock ? "ls-buzz" : undefined}>
        <ellipse cx={292} cy={292} rx={34} ry={5} fill="#000" opacity={0.25} />
        <rect x={270} y={256} width={50} height={22} rx={10} fill="#5c7cfa" />
        <rect x={276} y={196} width={34} height={64} rx={12} fill="#f783ac" />
        <rect x={286} y={180} width={10} height={10} fill="#c68a5b" />
        <circle cx={292} cy={172} r={14} fill="#c68a5b" />
        <path d="M277 174 C 277 152, 307 152, 307 174 L 309 204 L 301 200 L 302 172 C 296 166, 288 166, 282 172 L 283 200 L 275 204 Z" fill="#2b1d14" />
        {shock ? <path d="M306 206 L 330 248" stroke="#c68a5b" strokeWidth={8} strokeLinecap="round" /> : <path d="M306 206 L 312 236" stroke="#c68a5b" strokeWidth={8} strokeLinecap="round" />}
        <path d="M280 206 L 272 238" stroke="#c68a5b" strokeWidth={8} strokeLinecap="round" />
      </g>
      {shock && (
        <g stroke="#ffe066" strokeWidth={2.5} fill="none" strokeLinecap="round" pointerEvents="none">
          <path className="ls-blink" d="M262 160 l8 8 l-6 4 l10 10" />
          <path className="ls-blink b" d="M322 160 l-8 8 l6 4 l-10 10" />
          <path className="ls-blink" d="M336 236 l10 -4 l-2 8 l10 -4" />
          <path className="ls-blink b" d="M260 230 l-10 -2 l4 6 l-10 -2" />
        </g>
      )}

      {/* extension board */}
      <ellipse cx={392} cy={284} rx={58} ry={6} fill="#000" opacity={0.3} />
      {(s.has("sparks") || s.has("burnt-curtain") || s.has("fire-curtain") || off) && <ellipse cx={400} cy={270} rx={34} ry={7} fill="#212529" opacity={0.55} />}
      <rect x={340} y={266} width={104} height={16} rx={4} fill="#f1f3f5" />
      <rect x={344} y={270} width={10} height={6} rx={2} fill={off ? "#495057" : "#ff6b6b"} />
      {[360, 380, 400, 420].map((x, i) => (
        <g key={x}>
          <rect x={x} y={252} width={14} height={16} rx={2} fill={i === 2 ? "#5c4033" : "#343a40"} />
          <path d={`M${x + 7} 252 C ${x + 7} 236, ${x + 30 - i * 6} 240, ${x + 40 - i * 4} 232`} stroke="#212529" strokeWidth={2.5} fill="none" />
        </g>
      ))}
      {s.has("sparks") && !off && <Spark x={404} y={258} n={Math.round(6 + h * 10)} r={14 + h * 16} />}

      {/* window + curtains */}
      <rect x={470} y={50} width={130} height={140} fill="#33507a" />
      <circle cx={570} cy={84} r={12} fill="#fff3bf" opacity={0.85} />
      <g stroke="#d6cdbd" strokeWidth={5} fill="none">
        <rect x={470} y={50} width={130} height={140} />
        <line x1={535} y1={50} x2={535} y2={190} />
      </g>
      <rect x={444} y={40} width={176} height={6} rx={3} fill="#868e96" />
      <path d="M576 46 C 584 100, 572 150, 586 206 L 616 206 C 606 150, 618 100, 612 46 Z" fill="#e8a33d" />
      {s.has("burnt-curtain") ? (
        <g>
          <path d="M452 46 C 462 100, 448 160, 460 214 L 470 222 L 480 210 L 490 220 L 498 204 C 490 150, 500 100, 494 46 Z" fill="#e8a33d" />
          <path d="M460 214 L 470 222 L 480 210 L 490 220 L 498 204 L 496 190 C 484 196, 470 196, 458 192 Z" fill="#3d2b1f" />
        </g>
      ) : (
        <g>
          <path d="M452 46 C 462 110, 446 190, 458 262 L 500 262 C 490 190, 502 110, 494 46 Z" fill="#e8a33d" />
          <path d="M466 60 C 470 120, 460 200, 468 258 M 482 60 C 484 120, 478 200, 486 258" stroke="#c98a2a" strokeWidth={2} fill="none" />
          {s.has("fire-curtain") && <path d="M456 262 C 460 240, 498 236, 500 262 Z" fill="#3d2b1f" />}
        </g>
      )}
      {s.has("fire-curtain") && <Flames x={478} y={262} size={0.35 + h * 0.9} flame={id("flame")} glow={id("glow")} />}
    </g>
  );
}

/* ------------------------------------------------------------------ school lab (acid spill) */

function Lab({ s, h }: { s: Set<string>; h: number }) {
  const big = s.has("spill-big") ? 0.35 : 0;
  const spread = Math.min(1, h + big);
  const acid = s.has("spill");
  const atWash = s.has("eyewash-on");
  return (
    <g>
      {/* wall tiles */}
      {Array.from({ length: 6 }, (_, r) => (
        <line key={r} x1={0} y1={40 + r * 40} x2={W} y2={40 + r * 40} stroke="#ffffff0d" />
      ))}
      <path d={`M0 280 H${W} V${H} H0 Z`} fill="#3b4252" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={i * 80 - (i % 2 ? 0 : 0)} y={280 + (i % 2) * 40} width={40} height={40} fill="#ffffff08" />
      ))}

      {/* shelf with bottles (gap where the bottle fell) */}
      <rect x={106} y={92} width={290} height={6} rx={2} fill="#8d6e4f" />
      {[126, 168, 210, 300, 342].map((x, i) => (
        <g key={x}>
          <rect x={x} y={58} width={24} height={34} rx={5} fill={i % 2 ? "#a9713f" : "#dbe4ff"} opacity={0.85} />
          <rect x={x + 7} y={50} width={10} height={9} fill="#495057" />
          <rect x={x + 3} y={68} width={18} height={10} fill="#fff" opacity={0.8} />
        </g>
      ))}

      {/* lab partner (moves to the eyewash when it's running) */}
      {!atWash && (
        <g>
          <Person x={50} y={296} scale={0.95} shirt="#f1f3f5" long hair="#1b120c">
            <path d="M 15 -118 C 26 -130, 18 -146, 6 -150" stroke="#f1f3f5" strokeWidth={9} strokeLinecap="round" fill="none" />
            <circle cx={6} cy={-150} r={5} fill="#c68a5b" />
          </Person>
          <g stroke="#ff8787" strokeWidth={2.5} strokeLinecap="round" className="ls-pulse">
            <path d="M84 140 l8 -6 M86 152 l10 0 M84 164 l8 6" />
          </g>
        </g>
      )}

      {/* bench */}
      <rect x={100} y={208} width={332} height={72} fill="#8a6d4a" />
      {[108, 218, 328].map((x) => (
        <rect key={x} x={x} y={216} width={98} height={56} rx={3} fill="#977a55" stroke="#6f5638" strokeWidth={2} />
      ))}
      <rect x={94} y={196} width={344} height={14} rx={2} fill="#2b3036" />

      {/* the spill */}
      {acid && (
        <g>
          <ellipse cx={245} cy={201} rx={40 + spread * 50} ry={5 + spread * 2} fill="#ffe066" opacity={0.6} />
          <path d={`M ${300} 208 q 3 ${20 + spread * 30} 0 ${30 + spread * 40}`} stroke="#ffe066" strokeWidth={3} opacity={0.6} className="ls-flow" fill="none" />
          <ellipse cx={300} cy={300} rx={10 + spread * 60} ry={3 + spread * 9} fill="#ffe066" opacity={0.45} />
          <g stroke="#fff3bf" strokeWidth={1.5} fill="none" opacity={0.6}>
            <path className="ls-steam" d="M230 196 q -3 -6 0 -10" />
            <path className="ls-steam b" d="M260 196 q 3 -6 0 -10" />
          </g>
        </g>
      )}
      {s.has("neutralised") && <ellipse cx={245} cy={201} rx={70} ry={6} fill="#e9ecef" opacity={0.85} />}
      {s.has("neutralised") && <ellipse cx={300} cy={300} rx={40} ry={7} fill="#e9ecef" opacity={0.6} />}
      {s.has("contained") && (
        <g fill="none" stroke="#c08a4a" strokeWidth={6} strokeLinecap="round" strokeDasharray="2 7">
          <ellipse cx={245} cy={201} rx={86} ry={9} />
          <ellipse cx={300} cy={300} rx={62} ry={12} />
        </g>
      )}
      {/* broken glass */}
      {s.has("glass") && (
        <g fill="#dbe4ff" opacity={0.85} stroke="#a5b4fc" strokeWidth={1}>
          <path d="M338 196 l10 -14 l6 14 z" />
          <path d="M356 196 l4 -9 l8 9 z" />
          <path d="M372 196 l-2 -8 l9 4 z" />
          <path d="M346 196 l2 -5 l5 5 z" />
          <rect x={330} y={180} width={10} height={12} rx={2} transform="rotate(-30 335 186)" />
        </g>
      )}

      {/* doorway with the teacher */}
      <rect x={436} y={88} width={66} height={208} fill="#1d2330" />
      <rect x={432} y={84} width={74} height={212} fill="none" stroke="#adb5bd" strokeWidth={4} />
      <Person x={470} y={294} scale={1} shirt="#7048e8" long hair="#3b2a20">
        <rect x={-10} y={-152} width={20} height={6} rx={3} fill="none" stroke="#212529" strokeWidth={2} />
      </Person>

      {/* eyewash station + sink */}
      <rect x={528} y={74} width={98} height={24} rx={3} fill="#2f9e44" />
      <text x={577} y={90} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff">
        EYE WASH
      </text>
      <rect x={570} y={140} width={14} height={60} fill="#adb5bd" />
      <path d="M552 146 h50" stroke="#adb5bd" strokeWidth={6} strokeLinecap="round" />
      <circle cx={556} cy={140} r={6} fill="#fab005" />
      <circle cx={598} cy={140} r={6} fill="#fab005" />
      <rect x={516} y={198} width={116} height={30} rx={4} fill={`#ced4da`} />
      <rect x={524} y={202} width={100} height={18} rx={3} fill="#868e96" />
      {atWash && (
        <g>
          <g stroke="#74c0fc" strokeWidth={3} fill="none" strokeLinecap="round">
            <path className="ls-flow" d="M556 134 C 556 118, 566 112, 572 120" />
            <path className="ls-flow" d="M598 134 C 598 118, 588 112, 582 120" />
          </g>
          <Person x={577} y={300} scale={0.9} shirt="#f1f3f5" long hair="#1b120c" />
        </g>
      )}

      {/* you (PPE target) */}
      <g>
        <rect x={100} y={300} width={112} height={52} rx={12} fill="#1b2232" stroke="#4dabf7" strokeWidth={2} />
        <circle cx={128} cy={326} r={14} fill="#c68a5b" />
        <path d="M114 322 C 114 306, 142 306, 142 322 C 136 316, 120 316, 114 322 Z" fill="#2b1d14" />
        {s.has("ppe-on") && <rect x={115} y={320} width={26} height={8} rx={4} fill="#74c0fc" opacity={0.9} stroke="#1971c2" />}
        <text x={150} y={322} fontSize={13} fontWeight={800} fill="#fff">
          You
        </text>
        <text x={150} y={338} fontSize={9} fill="#a5d8ff">
          {s.has("ppe-on") ? "goggles + gloves" : "no PPE"}
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ school lab (minor burn) */

function Burn({ s, h }: { s: Set<string>; h: number }) {
  const red = 0.15 + h * 0.75;
  return (
    <g>
      <path d={`M0 290 H${W} V${H} H0 Z`} fill="#3b4252" />
      {/* first-aid box on the wall */}
      <rect x={556} y={48} width={60} height={46} rx={4} fill="#2f9e44" />
      <path d="M586 58 v26 M573 71 h26" stroke="#fff" strokeWidth={6} />

      {/* friend behind the bench */}
      <g>
        <rect x={204} y={86} width={56} height={120} rx={20} fill="#3bc9db" />
        <rect x={227} y={74} width={10} height={14} fill="#c68a5b" />
        <circle cx={232} cy={60} r={18} fill="#c68a5b" />
        <path d="M213 60 C 213 34, 251 34, 251 60 C 246 48, 218 48, 213 60 Z" fill="#1b120c" />
        <path d="M250 56 C 262 66, 262 90, 254 104" stroke="#1b120c" strokeWidth={6} fill="none" strokeLinecap="round" />
        <path d="M224 66 q 8 5 16 0" stroke="#7c4a2d" strokeWidth={2} fill="none" />
      </g>

      {/* bench with inset sink */}
      <rect x={0} y={200} width={W} height={18} fill="#2b3036" />
      <rect x={0} y={218} width={W} height={72} fill="#8a6d4a" />
      <rect x={330} y={202} width={150} height={10} rx={4} fill="#495057" />
      {/* teacher, standing at the end of the bench */}
      <Person x={32} y={300} scale={0.95} shirt="#7048e8" long hair="#3b2a20">
        <rect x={-10} y={-152} width={20} height={6} rx={3} fill="none" stroke="#212529" strokeWidth={2} />
      </Person>

      {/* tripod, gauze, beaker */}
      <path d="M98 200 L110 150 M142 200 L130 150 M120 200 L120 150" stroke="#495057" strokeWidth={3} />
      <rect x={100} y={146} width={40} height={5} fill="#868e96" />
      <path d="M104 146 L106 104 L134 104 L136 146 Z" fill="#dbe4ff" opacity={0.6} stroke="#a5b4fc" />
      <rect x={106} y={124} width={28} height={20} fill="#74c0fc" opacity={0.5} />
      <g stroke="#ffa8a8" strokeWidth={2} fill="none" opacity={0.7}>
        <path className="ls-steam" d="M114 100 q -3 -6 0 -12" />
        <path className="ls-steam b" d="M126 100 q 3 -6 0 -12" />
      </g>
      <text x={96} y={82} fontSize={11} fontWeight={800} fill="#ffa8a8">
        HOT
      </text>

      {/* tap over the sink */}
      <rect x={462} y={120} width={12} height={84} rx={3} fill="#adb5bd" />
      <path d="M468 124 C 468 96, 380 96, 376 118" stroke="#ced4da" strokeWidth={9} fill="none" strokeLinecap="round" />
      <rect x={450} y={150} width={36} height={10} rx={5} fill="#4dabf7" />
      {s.has("water-on") && (
        <g>
          <path d="M376 124 L 376 200" stroke="#a5d8ff" strokeWidth={8} opacity={0.75} />
          <path className="ls-flow" d="M376 124 L 376 200" stroke="#e7f5ff" strokeWidth={3} />
          <ellipse cx={376} cy={202} rx={18} ry={3} fill="#a5d8ff" opacity={0.7} />
        </g>
      )}

      {/* her arm and hand, resting over the sink edge */}
      <path d="M252 110 C 272 128, 282 150, 292 168" stroke="#3bc9db" strokeWidth={18} strokeLinecap="round" fill="none" />
      <g>
        <ellipse cx={304} cy={172} rx={20} ry={14} fill="#d9a07a" />
        {[158, 166, 174, 182].map((y, i) => (
          <rect key={y} x={312} y={y} width={i === 3 ? 48 : 64} height={7.5} rx={3.75} fill="#d9a07a" stroke="#b97a52" strokeWidth={0.7} />
        ))}
        <rect x={290} y={180} width={22} height={8} rx={4} fill="#d9a07a" transform="rotate(20 300 184)" />
        {/* redness on the two burned fingertips */}
        <ellipse cx={368} cy={162} rx={9} ry={5} fill="#e03131" opacity={red} />
        <ellipse cx={370} cy={170} rx={9} ry={5} fill="#e03131" opacity={red * 0.9} />
        {s.has("blister") && <ellipse cx={372} cy={166} rx={4.5} ry={3.5} fill="#fff4e6" stroke="#ffc9c9" />}
        {s.has("ring") && <rect x={326} y={164} width={5} height={10} rx={1.5} fill="#fcc419" stroke="#e67700" strokeWidth={0.8} />}
        {s.has("ice-on") && (
          <g>
            <rect x={356} y={150} width={14} height={14} rx={3} fill="#d0ebff" stroke="#74c0fc" />
            <rect x={366} y={164} width={12} height={12} rx={3} fill="#a5d8ff" stroke="#74c0fc" />
          </g>
        )}
        {s.has("smear") && <ellipse cx={368} cy={166} rx={12} ry={9} fill="#ffe066" opacity={0.75} />}
        {s.has("cotton-on") && (
          <g fill="#fff">
            <circle cx={364} cy={164} r={7} />
            <circle cx={374} cy={170} r={6} />
            <circle cx={360} cy={172} r={5} />
          </g>
        )}
        {s.has("cling-on") && <rect x={344} y={152} width={36} height={36} rx={6} fill="#d0ebff" opacity={0.45} stroke="#a5d8ff" />}
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ consequence effects */

function Effect({ fx, at, flame }: { fx: Fx; at: { x: number; y: number }; flame: string }) {
  const { x, y } = at;
  const fade = { initial: { opacity: 1 }, exit: { opacity: 0 } };
  switch (fx) {
    case "good":
      return (
        <motion.g {...fade} pointerEvents="none">
          <motion.circle cx={x} cy={y} fill="none" stroke="#51cf66" strokeWidth={4} initial={{ r: 6, opacity: 1 }} animate={{ r: 46, opacity: 0 }} transition={{ duration: 1.1 }} />
          <motion.path d={`M ${x - 10} ${y} l 7 7 l 14 -15`} stroke="#51cf66" strokeWidth={5} fill="none" strokeLinecap="round" initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: [1, 1, 0] }} transition={{ duration: 1.4 }} />
        </motion.g>
      );
    case "warn":
      return (
        <motion.g {...fade} pointerEvents="none">
          <motion.circle cx={x} cy={y} fill="#e03131" initial={{ r: 4, opacity: 0.5 }} animate={{ r: 50, opacity: 0 }} transition={{ duration: 0.9, repeat: 1 }} />
          <motion.text x={x} y={y + 9} textAnchor="middle" fontSize={30} fontWeight={900} fill="#ff8787" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 1.6 }}>
            !
          </motion.text>
        </motion.g>
      );
    case "spark":
    case "flash":
      return (
        <motion.g {...fade} pointerEvents="none">
          {fx === "flash" && <motion.rect width={W} height={H} fill="#ffa94d" initial={{ opacity: 0.7 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} />}
          <motion.circle cx={x} cy={y} fill="#fff9db" initial={{ r: 4, opacity: 1 }} animate={{ r: fx === "flash" ? 120 : 34, opacity: 0 }} transition={{ duration: 0.5 }} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <motion.line key={i} x1={x} y1={y} stroke={i % 2 ? "#ffe066" : "#fff"} strokeWidth={2.5} strokeLinecap="round" initial={{ x2: x, y2: y, opacity: 1 }} animate={{ x2: x + Math.cos(a) * 48, y2: y + Math.sin(a) * 48, opacity: 0 }} transition={{ duration: 0.55, delay: (i % 3) * 0.08, repeat: 2, repeatDelay: 0.1 }} />;
          })}
        </motion.g>
      );
    case "flare":
      return (
        <motion.g {...fade} pointerEvents="none" style={{ transformOrigin: `${x}px ${y}px` }}>
          <motion.ellipse cx={x} cy={y - 30} rx={50} ry={70} fill={`url(#${flame})`} initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: [0.2, 1.6, 1.2], opacity: [0.9, 1, 0] }} transition={{ duration: 1.3 }} style={{ transformOrigin: `${x}px ${y}px` }} />
          <motion.ellipse cx={x} cy={y - 50} rx={40} ry={26} fill="#f1f3f5" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.6, 0], cy: y - 110 }} transition={{ duration: 1.6 }} />
        </motion.g>
      );
    case "water":
      return (
        <motion.g {...fade} pointerEvents="none">
          {Array.from({ length: 10 }, (_, i) => (
            <motion.circle key={i} r={3 + (i % 3)} fill="#74c0fc" initial={{ cx: x - 40 + i * 4, cy: y - 60, opacity: 0.9 }} animate={{ cx: x - 14 + i * 3, cy: y + 10, opacity: 0 }} transition={{ duration: 0.8, delay: i * 0.05, repeat: 1 }} />
          ))}
        </motion.g>
      );
    case "cloud":
    case "powder":
      return (
        <motion.g {...fade} pointerEvents="none">
          {Array.from({ length: 7 }, (_, i) => (
            <motion.circle key={i} cx={x - 30 + i * 10} cy={y - 10 - (i % 3) * 14} fill={fx === "cloud" ? "#f8f9fa" : "#ffe3e3"} initial={{ r: 2, opacity: 0.95 }} animate={{ r: 26 + (i % 3) * 8, opacity: 0 }} transition={{ duration: 1.6, delay: i * 0.07 }} />
          ))}
        </motion.g>
      );
    case "fizz":
      return (
        <motion.g {...fade} pointerEvents="none">
          {Array.from({ length: 14 }, (_, i) => (
            <motion.circle key={i} r={2 + (i % 3)} fill="none" stroke="#f8f9fa" strokeWidth={1.5} initial={{ cx: x - 50 + i * 7, cy: y, opacity: 1 }} animate={{ cy: y - 30 - (i % 4) * 8, opacity: 0 }} transition={{ duration: 0.9, delay: (i % 5) * 0.12, repeat: 2 }} />
          ))}
        </motion.g>
      );
    case "spatter":
      return (
        <motion.g {...fade} pointerEvents="none">
          {Array.from({ length: 12 }, (_, i) => {
            const a = Math.PI + (i / 11) * Math.PI;
            return <motion.circle key={i} r={3} fill="#ffd43b" initial={{ cx: x, cy: y, opacity: 1 }} animate={{ cx: x + Math.cos(a) * 70, cy: y + Math.sin(a) * 50, opacity: 0 }} transition={{ duration: 0.7, delay: (i % 4) * 0.05, repeat: 1 }} />;
          })}
          <motion.circle cx={x} cy={y} fill="#ff8787" initial={{ r: 4, opacity: 0.5 }} animate={{ r: 50, opacity: 0 }} transition={{ duration: 0.8 }} />
        </motion.g>
      );
    case "call":
      return (
        <motion.g {...fade} pointerEvents="none">
          {[0, 1, 2].map((i) => (
            <motion.circle key={i} cx={x} cy={y} fill="none" stroke="#4dabf7" strokeWidth={3} initial={{ r: 8, opacity: 0.9 }} animate={{ r: 50, opacity: 0 }} transition={{ duration: 1.2, delay: i * 0.3 }} />
          ))}
        </motion.g>
      );
    default:
      return null;
  }
}
