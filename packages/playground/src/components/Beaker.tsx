import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { lighten } from "../colour";
import { ParticleSystem, type Emitter } from "./particles";
import { SolidShape } from "./SolidShape";

export const VIEW_W = 340;
/** Headroom above the vessel for the hand-held bottle/dropper/spatula/cylinder. */
export const Y_OFF = 110;
export const VIEW_H = 430 + Y_OFF;
export const LEFT = 80;
export const RIGHT = 260;
export const TOP = 64;
export const BOTTOM = 364;
export const CAPACITY_ML = 150;
const PX_PER_ML = (BOTTOM - TOP - 40) / CAPACITY_ML;
const CX = (LEFT + RIGHT) / 2;
const RX = (RIGHT - LEFT) / 2;

export type SolidVisual = {
  key: string;
  substanceId: string;
  form: string;
  colour: string;
  size: number;
  remaining: number;
  remainingMs: number;
  deposit: { colour: string; durationMs: number } | null;
  tint: { colour: string; durationMs: number } | null;
};

export type PptVisual = {
  id: string;
  colour: string;
  turbidity: number;
  settleMs: number;
  dissolved: number;
};

export type BeakerProps = {
  levelMl: number;
  levelMs: number;
  liquidColour: string;
  colourMs: number;
  colourEase: "linear" | "sigmoid" | "flash-fade";
  ppts: PptVisual[];
  solids: SolidVisual[];
  oil: { ml: number; colour: string } | null;
  frozen: boolean;
  swirling: boolean;
  stirring: boolean;
  temperature: number;
  pour: { colour: string } | null;
  glow: string | null;
  shake: number;
  /** Visible gas filling the vessel (rgba) - e.g. chlorine, bromine vapour. */
  gasHaze: string | null;
  /** Burning: flame colour + strength (0-1). */
  flame: { colour: string; intensity: number; key: number } | null;
  /** Momentary flash of light (explosions, burning magnesium). */
  flash: { colour: string; intensity: number; key: number } | null;
  /** Droplets condensing on the inside of the glass (0-1). */
  condense: { colour: string; amount: number } | null;
  /** A molten metal ball skating on the surface (sodium, potassium...). */
  skate: { colour: string; key: number; durationMs: number } | null;
  /** Bunsen burner flame under the vessel. */
  burner: boolean;
  /** Render prop for the reagent held over the vessel (outer viewBox coordinates). */
  hand?: ((g: { cx: number; mouthY: number; surfaceY: number }) => ReactNode) | undefined;
};

export type BeakerHandle = {
  setEmitters: (e: Emitter[]) => void;
  flakes: (colour: string, amount: number, settleMs: number) => void;
  sparks: (colours: string[], count?: number) => void;
  drops: (colour: string, count: number, reverse?: boolean) => void;
  smoke: (colour: string, density: number, durationMs: number) => void;
  embers: (colour: string, durationMs: number) => void;
  clear: () => void;
  solidSlot: (substanceId: string) => { x0: number; x1: number; y: number } | null;
};

export function levelY(ml: number) {
  return BOTTOM - Math.min(CAPACITY_ML, ml) * PX_PER_ML;
}

function slotX(index: number, count: number) {
  const spread = Math.min(46, 150 / Math.max(1, count));
  return CX + (index - (count - 1) / 2) * spread;
}

/** Fixed droplet positions on the inner walls (deterministic so they don't jump between renders). */
const DROPLETS = Array.from({ length: 44 }, (_, i) => {
  const side = i % 2 === 0;
  const t = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const u = Math.abs(t);
  return {
    x: side ? LEFT + 5 + u * 26 : RIGHT - 5 - u * 26,
    y: TOP + 24 + ((i * 37) % (BOTTOM - TOP - 60)),
    r: 2.4 + (i % 4) * 1.1,
  };
});

/** A teardrop flame shape standing on baseY. */
function flamePath(baseY: number, height: number, width: number) {
  const top = baseY - height;
  const w = width / 2;
  return `M${CX - w},${baseY} C${CX - w},${baseY - height * 0.45} ${CX - w * 0.25},${top + height * 0.25} ${CX},${top} C${CX + w * 0.25},${top + height * 0.25} ${CX + w},${baseY - height * 0.45} ${CX + w},${baseY} Z`;
}

const EASE = {
  linear: [0, 0, 1, 1] as const,
  sigmoid: [0.65, 0, 0.35, 1] as const,
  "flash-fade": [0.9, 0, 0.1, 1] as const,
};

export const Beaker = forwardRef<BeakerHandle, BeakerProps>(function Beaker(props, ref) {
  const reduced = useReducedMotion() ?? false;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sysRef = useRef<ParticleSystem | null>(null);
  const solidsRef = useRef(props.solids);
  solidsRef.current = props.solids;

  const y = levelY(props.levelMl);
  const hasLiquid = props.levelMl > 0.4;
  const controls = useAnimationControls();

  useEffect(() => {
    if (props.shake > 0 && !reduced) {
      void controls.start({ x: [0, -12, 10, -8, 5, -2, 0], transition: { duration: 0.5 } });
    }
  }, [props.shake, controls, reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const sys = new ParticleSystem(
      canvas,
      VIEW_W,
      VIEW_H,
      { left: LEFT, right: RIGHT, bottom: BOTTOM + 8 },
      reduced,
    );
    sys.offsetY = Y_OFF;
    sysRef.current = sys;
    const ro = new ResizeObserver(() => sys.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    sys.resize(wrap.clientWidth, wrap.clientHeight);
    sys.start();
    return () => {
      ro.disconnect();
      sys.stop();
    };
  }, [reduced]);

  useEffect(() => {
    const sys = sysRef.current;
    if (!sys) return;
    sys.surfaceY = hasLiquid ? y : BOTTOM + 4;
    sys.mouthY = TOP;
    sys.stirring = props.stirring || props.swirling;
    sys.steamLevel =
      props.temperature > 58 && hasLiquid ? Math.min(1, (props.temperature - 58) / 30) : 0;
  }, [y, hasLiquid, props.stirring, props.swirling, props.temperature]);

  useImperativeHandle(ref, () => ({
    setEmitters: (e) => sysRef.current?.setEmitters(e),
    flakes: (c, a, s) => sysRef.current?.flakes(c, a, s),
    sparks: (colours, count) =>
      sysRef.current?.sparks(CX, levelY(props.levelMl) - 10, colours, count),
    drops: (c, n, reverse) => sysRef.current?.drops(CX - 16, TOP - 30, c, n, reverse),
    smoke: (c, d, ms) => sysRef.current?.smoke(c, d, ms),
    embers: (c, ms) => sysRef.current?.embers(c, ms),
    clear: () => sysRef.current?.clear(),
    solidSlot: (id) => {
      const list = solidsRef.current;
      const i = list.findIndex((s) => s.substanceId === id);
      if (i < 0) return null;
      const x = slotX(i, list.length);
      return { x0: x - 18, x1: x + 18, y: BOTTOM + 2 };
    },
  }));

  const ease = EASE[props.colourEase];
  const surface = lighten(props.liquidColour, 0.35, 0.12);
  const oilTop = props.oil ? y : y;
  const oilH = props.oil ? props.oil.ml * PX_PER_ML : 0;
  const heat = Math.max(0, Math.min(1, (props.temperature - 24) / 66));

  return (
    <motion.div ref={wrapRef} className="relative h-full w-full" animate={controls}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="absolute inset-0 h-full w-full">
        <g transform={`translate(0,${Y_OFF})`} aria-hidden>
          <defs>
            <clipPath id="beaker-inner">
              <path
                d={`M${LEFT},${TOP} L${LEFT},${BOTTOM} A${RX},12 0 0 0 ${RIGHT},${BOTTOM} L${RIGHT},${TOP} Z`}
              />
            </clipPath>
            <linearGradient id="glass-side" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.20)" />
              <stop offset="0.12" stopColor="rgba(255,255,255,0.04)" />
              <stop offset="0.85" stopColor="rgba(255,255,255,0.02)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.14)" />
            </linearGradient>
            <linearGradient id="liquid-depth" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(0,0,0,0.28)" />
              <stop offset="0.3" stopColor="rgba(0,0,0,0)" />
              <stop offset="0.7" stopColor="rgba(0,0,0,0)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.32)" />
            </linearGradient>
            <linearGradient id="highlight" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.0)" />
              <stop offset="0.2" stopColor="rgba(255,255,255,0.45)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.0)" />
            </linearGradient>
            <radialGradient id="coil-glow" cx="0.5" cy="0.5" r="0.5">
              <stop
                offset="0"
                stopColor={`rgba(255,${140 - heat * 80},40,${0.25 + heat * 0.75})`}
              />
              <stop offset="1" stopColor="rgba(255,80,20,0)" />
            </radialGradient>
            <pattern
              id="hatch"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="10" height="10" fill="rgba(245,158,11,0.06)" />
              <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(245,158,11,0.55)" strokeWidth="3" />
            </pattern>
            <filter id="frost">
              <feColorMatrix type="saturate" values="0.15" />
            </filter>
            <filter id="glow-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <pattern id="gauze" width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M0,0 L4,4 M4,0 L0,4" stroke="#3a434e" strokeWidth="0.6" />
            </pattern>
            <radialGradient id="flash-grad" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="0.35" stopColor={props.flash?.colour ?? "#ffffff"} stopOpacity="0.85" />
              <stop offset="1" stopColor={props.flash?.colour ?? "#ffffff"} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* tripod, gauze and Bunsen burner */}
          <g>
            <line
              x1={LEFT - 6}
              y1={378}
              x2={LEFT - 22}
              y2={428}
              stroke="#55606e"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <line
              x1={RIGHT + 6}
              y1={378}
              x2={RIGHT + 22}
              y2={428}
              stroke="#55606e"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <rect
              x={LEFT - 14}
              y={374}
              width={RIGHT - LEFT + 28}
              height={6}
              rx={2}
              fill="#7b8794"
            />
            <rect
              x={LEFT - 10}
              y={374}
              width={RIGHT - LEFT + 20}
              height={6}
              rx={2}
              fill="url(#gauze)"
              opacity={0.7}
            />
            <motion.ellipse
              cx={CX}
              cy={377}
              rx={70}
              ry={6}
              fill="url(#coil-glow)"
              animate={{ opacity: heat > 0.02 || props.burner ? [0.6, 1, 0.75] : 0 }}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            <rect
              x={CX - 9}
              y={398}
              width={18}
              height={30}
              rx={3}
              fill="#9aa5b1"
              stroke="#5b6672"
            />
            <rect x={CX - 26} y={424} width={52} height={6} rx={3} fill="#5b6672" />
            <rect x={CX - 12} y={410} width={6} height={6} rx={1} fill="#3a434e" />
            {props.burner && (
              <motion.g
                style={{ originX: `${CX}px`, originY: "398px" }}
                animate={{ scaleY: [1, 1.12, 0.94, 1.08, 1], scaleX: [1, 0.95, 1.04, 0.97, 1] }}
                transition={{ duration: 0.35, repeat: Infinity }}
              >
                <path
                  d={`M${CX - 9},398 C${CX - 10},388 ${CX - 4},382 ${CX},376 C${CX + 4},382 ${CX + 10},388 ${CX + 9},398 Z`}
                  fill="rgba(80,140,255,0.55)"
                />
                <path
                  d={`M${CX - 5},398 C${CX - 5},391 ${CX - 2},387 ${CX},383 C${CX + 2},387 ${CX + 5},391 ${CX + 5},398 Z`}
                  fill="rgba(170,220,255,0.9)"
                />
              </motion.g>
            )}
          </g>

          {/* outcome glow behind the glass */}
          {props.glow && (
            <motion.ellipse
              cx={CX}
              cy={(TOP + BOTTOM) / 2}
              rx={RX + 30}
              ry={(BOTTOM - TOP) / 2 + 20}
              fill={props.glow}
              filter="url(#glow-blur)"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.55, 0.3] }}
              transition={{ duration: 1.4 }}
            />
          )}

          {/* back glass */}
          <path
            d={`M${LEFT},${TOP} L${LEFT},${BOTTOM} A${RX},12 0 0 0 ${RIGHT},${BOTTOM} L${RIGHT},${TOP} Z`}
            fill="rgba(200,230,255,0.25)"
          />
          <ellipse cx={CX} cy={TOP} rx={RX} ry={12} fill="rgba(255,255,255,0.03)" />

          {/* contents */}
          <g clipPath="url(#beaker-inner)" filter={props.frozen ? "url(#frost)" : undefined}>
            <motion.g initial={false} animate={{ y: hasLiquid ? 0 : 0 }}>
              <motion.rect
                x={LEFT - 2}
                width={RIGHT - LEFT + 4}
                initial={false}
                animate={{ attrY: y, height: BOTTOM + 14 - y, fill: props.liquidColour }}
                transition={{
                  attrY: { duration: props.levelMs / 1000, ease: [0.3, 0, 0.2, 1] },
                  height: { duration: props.levelMs / 1000, ease: [0.3, 0, 0.2, 1] },
                  fill: { duration: props.colourMs / 1000, ease },
                }}
              />
              {hasLiquid && (
                <motion.rect
                  x={LEFT - 2}
                  width={RIGHT - LEFT + 4}
                  fill="url(#liquid-depth)"
                  initial={false}
                  animate={{ attrY: y, height: BOTTOM + 14 - y }}
                  transition={{ duration: props.levelMs / 1000 }}
                />
              )}
            </motion.g>

            {/* precipitate clouds + sediment */}
            {props.ppts.map((p, i) => {
              const keep = 1 - p.dissolved;
              const settle = reduced ? 0.2 : p.settleMs / 1000;
              return (
                <g key={p.id}>
                  <motion.rect
                    x={LEFT}
                    width={RIGHT - LEFT}
                    initial={{ opacity: 0, attrY: y, height: BOTTOM - y + 12 }}
                    animate={{
                      opacity: [
                        0,
                        p.turbidity * keep,
                        p.turbidity * 0.85 * keep,
                        p.turbidity * 0.22 * keep,
                      ],
                      attrY: y,
                      height: BOTTOM - y + 12,
                    }}
                    transition={{ duration: 0.8 + settle + 1.5, times: [0, 0.18, 0.55, 1] }}
                    fill={p.colour}
                  />
                  <motion.ellipse
                    cx={CX}
                    cy={BOTTOM + 4}
                    rx={RX - 4}
                    initial={{ ry: 0, opacity: 0 }}
                    animate={{
                      ry: (6 + p.turbidity * 10) * keep + i * 2,
                      opacity: keep > 0.02 ? 0.95 : 0,
                    }}
                    transition={{ duration: 0.8 + settle, delay: 0.4 }}
                    fill={p.colour}
                  />
                </g>
              );
            })}

            {/* oil layer */}
            {props.oil && (
              <motion.rect
                x={LEFT - 2}
                width={RIGHT - LEFT + 4}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, attrY: oilTop, height: oilH }}
                transition={{ duration: 0.6 }}
                fill={props.oil.colour}
              />
            )}

            {/* solids */}
            {props.solids.map((s, i) => {
              const x = slotX(i, props.solids.length);
              const scale = Math.max(0, s.remaining) * s.size;
              return (
                <motion.g
                  key={s.key}
                  initial={{ x, y: TOP - 60, opacity: 0, scale: s.size }}
                  animate={{ x, y: BOTTOM + 6, opacity: s.remaining < 0.03 ? 0 : 1, scale }}
                  transition={{
                    y: { type: "spring", stiffness: 260, damping: 18 },
                    opacity: { duration: s.remaining < 0.03 ? s.remainingMs / 1000 : 0.2 },
                    scale: { duration: s.remainingMs / 1000, ease: "easeInOut" },
                  }}
                  style={{ originX: 0.5, originY: 1 }}
                >
                  <SolidShape form={s.form} fill={s.colour} seed={i + 1} />
                  {s.tint && (
                    <motion.g
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: s.tint.durationMs / 1000 }}
                    >
                      <SolidShape form={s.form} fill={s.tint.colour} seed={i + 1} />
                    </motion.g>
                  )}
                  {s.deposit && (
                    <motion.g
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.9 }}
                      transition={{ duration: s.deposit.durationMs / 1000 }}
                    >
                      <SolidShape
                        form={s.form}
                        fill={s.deposit.colour}
                        stroke={s.deposit.colour}
                        seed={i + 1}
                      />
                    </motion.g>
                  )}
                </motion.g>
              );
            })}

            {/* surface */}
            {hasLiquid && (
              <motion.ellipse
                cx={CX}
                rx={RX}
                initial={false}
                animate={{
                  cy: props.oil ? oilTop : y,
                  ry: props.swirling || props.stirring ? [9, 6, 10, 7, 9] : 9,
                  fill: props.oil ? lighten(props.oil.colour, 0.3) : surface,
                }}
                transition={{
                  cy: { duration: props.levelMs / 1000, ease: [0.3, 0, 0.2, 1] },
                  ry: { duration: 1.2, repeat: props.swirling || props.stirring ? Infinity : 0 },
                  fill: { duration: props.colourMs / 1000, ease },
                }}
              />
            )}
            {hasLiquid && (
              <motion.ellipse
                cx={CX - 30}
                rx={34}
                ry={2.5}
                fill="rgba(255,255,255,0.35)"
                initial={false}
                animate={{ cy: (props.oil ? oilTop : y) - 2 }}
                transition={{ duration: props.levelMs / 1000 }}
              />
            )}

            {/* gas filling the space above the liquid */}
            <motion.rect
              x={LEFT - 2}
              y={TOP - 12}
              width={RIGHT - LEFT + 4}
              initial={false}
              animate={{
                height: Math.max(0, (hasLiquid ? y : BOTTOM + 12) - (TOP - 12)),
                fill: props.gasHaze ?? "rgba(255,255,255,0)",
                opacity: props.gasHaze ? 1 : 0,
              }}
              transition={{ duration: 1.2 }}
            />

            {/* molten metal ball skating on the surface */}
            {props.skate && hasLiquid && (
              <motion.g
                key={props.skate.key}
                initial={{ x: CX, opacity: 1, scale: 1 }}
                animate={{
                  x: [CX, LEFT + 30, RIGHT - 40, LEFT + 60, RIGHT - 30, CX - 20, CX + 30],
                  opacity: [1, 1, 1, 1, 1, 0.8, 0],
                  scale: [1, 0.95, 0.85, 0.75, 0.6, 0.4, 0.1],
                }}
                transition={{ duration: props.skate.durationMs / 1000, ease: "easeInOut" }}
              >
                <ellipse
                  cx={0}
                  cy={y - 1}
                  rx={9}
                  ry={6}
                  fill={props.skate.colour}
                  stroke="rgba(60,70,90,0.6)"
                />
                <ellipse cx={-3} cy={y - 3} rx={3} ry={1.6} fill="rgba(255,255,255,0.9)" />
              </motion.g>
            )}
          </g>

          {/* condensation droplets on the inside of the glass */}
          {props.condense && (
            <g>
              {DROPLETS.map((d, i) => (
                <motion.ellipse
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  rx={d.r}
                  ry={d.r * 1.25}
                  fill={props.condense?.colour ?? "rgba(190,228,255,0.8)"}
                  stroke="rgba(30,100,160,0.55)"
                  strokeWidth={0.8}
                  initial={{ opacity: 0, scale: 0.2 }}
                  animate={{
                    opacity: i / DROPLETS.length < (props.condense?.amount ?? 0) + 0.25 ? 0.9 : 0,
                    scale: 1,
                  }}
                  transition={{ duration: 0.6, delay: 0.3 + i * 0.03 }}
                />
              ))}
            </g>
          )}

          {/* flames rising out of the vessel */}
          {props.flame && (
            <motion.g
              key={props.flame.key}
              style={{ originX: `${CX}px`, originY: `${(hasLiquid ? y : BOTTOM) + 4}px` }}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: [0.2, 1, 0.85, 1.05, 0.9, 1], opacity: 1 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            >
              <motion.g
                animate={{ skewX: [0, 4, -3, 2, 0], scaleY: [1, 1.08, 0.95, 1.04, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                style={{ originX: `${CX}px`, originY: `${(hasLiquid ? y : BOTTOM) + 4}px` }}
              >
                <path
                  d={flamePath((hasLiquid ? y : BOTTOM) + 4, 50 + props.flame.intensity * 90, 46)}
                  fill={props.flame.colour}
                  opacity={0.55}
                  filter="url(#glow-blur)"
                />
                <path
                  d={flamePath((hasLiquid ? y : BOTTOM) + 4, 40 + props.flame.intensity * 80, 34)}
                  fill={props.flame.colour}
                  opacity={0.85}
                />
                <path
                  d={flamePath((hasLiquid ? y : BOTTOM) + 4, 22 + props.flame.intensity * 40, 16)}
                  fill="rgba(255,255,240,0.95)"
                />
              </motion.g>
            </motion.g>
          )}

          {/* a flash of light */}
          {props.flash && (
            <motion.circle
              key={props.flash.key}
              cx={CX}
              cy={(TOP + BOTTOM) / 2}
              fill="url(#flash-grad)"
              initial={{ r: 20, opacity: 0 }}
              animate={{
                r: [20, 150 + props.flash.intensity * 120, 220],
                opacity: [0, props.flash.intensity, 0],
              }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          )}

          {/* unsupported: hatched overlay */}
          {props.frozen && (
            <motion.path
              d={`M${LEFT},${TOP} L${LEFT},${BOTTOM} A${RX},12 0 0 0 ${RIGHT},${BOTTOM} L${RIGHT},${TOP} Z`}
              fill="url(#hatch)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            />
          )}

          {/* waiting on the safety engine: scanning ring */}
          {props.swirling && (
            <motion.ellipse
              cx={CX}
              rx={RX + 14}
              ry={16}
              fill="none"
              stroke="rgba(34,211,238,0.7)"
              strokeWidth={1.5}
              strokeDasharray="6 8"
              initial={{ cy: BOTTOM, opacity: 0 }}
              animate={{ cy: [BOTTOM, TOP + 20, BOTTOM], opacity: [0, 1, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {/* front glass */}
          <path
            d={`M${LEFT},${TOP} L${LEFT},${BOTTOM} A${RX},12 0 0 0 ${RIGHT},${BOTTOM} L${RIGHT},${TOP}`}
            fill="url(#glass-side)"
            stroke="rgba(40,70,110,0.55)"
            strokeWidth={2}
          />
          <ellipse
            cx={CX}
            cy={TOP}
            rx={RX}
            ry={12}
            fill="none"
            stroke="rgba(40,70,110,0.6)"
            strokeWidth={2}
          />
          <path
            d={`M${LEFT - 2},${TOP - 2} q-10,-2 -14,-10`}
            stroke="rgba(220,235,255,0.6)"
            strokeWidth={2}
            fill="none"
          />
          <rect
            x={LEFT + 10}
            y={TOP + 22}
            width={9}
            height={BOTTOM - TOP - 44}
            rx={4.5}
            fill="url(#highlight)"
          />
          <rect
            x={RIGHT - 16}
            y={TOP + 40}
            width={3}
            height={BOTTOM - TOP - 90}
            rx={1.5}
            fill="rgba(255,255,255,0.12)"
          />

          {/* graduations */}
          <g
            stroke="rgba(40,70,110,0.6)"
            strokeWidth={1}
            fontFamily="JetBrains Mono, monospace"
            fontSize={9}
            fill="rgba(40,70,110,0.75)"
          >
            {Array.from({ length: CAPACITY_ML / 25 }, (_, i) => (i + 1) * 25).map((ml) => {
              const gy = levelY(ml);
              const major = ml % 50 === 0;
              return (
                <g key={ml}>
                  <line x1={RIGHT - 34} x2={RIGHT - (major ? 14 : 24)} y1={gy} y2={gy} />
                  {major && (
                    <text x={RIGHT - 52} y={gy + 3} stroke="none">
                      {ml}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={RIGHT - 46} y={TOP + 22} stroke="none" fontSize={8}>
              mL
            </text>
          </g>

          {/* thermometer */}
          <g transform="translate(300,0)">
            <rect
              x={-5}
              y={92}
              width={10}
              height={250}
              rx={5}
              fill="rgba(255,255,255,0.08)"
              stroke="rgba(40,70,110,0.45)"
            />
            <circle cx={0} cy={352} r={11} fill="#ef4444" stroke="rgba(40,70,110,0.45)" />
            <motion.rect
              x={-2.5}
              width={5}
              rx={2.5}
              fill="#ef4444"
              initial={false}
              animate={{
                attrY: 340 - (Math.min(100, Math.max(0, props.temperature)) / 100) * 240,
                height: 12 + (Math.min(100, Math.max(0, props.temperature)) / 100) * 240,
              }}
              transition={{ duration: 0.4 }}
            />
            {[0, 25, 50, 75, 100].map((t) => (
              <line
                key={t}
                x1={6}
                x2={11}
                y1={340 - (t / 100) * 240}
                y2={340 - (t / 100) * 240}
                stroke="rgba(40,70,110,0.5)"
              />
            ))}
          </g>
        </g>
        {props.hand?.({ cx: CX, mouthY: TOP + Y_OFF, surfaceY: (hasLiquid ? y : BOTTOM) + Y_OFF })}
      </svg>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </motion.div>
  );
});
