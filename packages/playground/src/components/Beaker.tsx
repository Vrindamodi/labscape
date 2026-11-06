import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { lighten, withAlpha } from "../colour";
import { ParticleSystem, type Emitter } from "./particles";
import { SolidShape } from "./SolidShape";

export const VIEW_W = 340;
export const VIEW_H = 430;
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
};

export type BeakerHandle = {
  setEmitters: (e: Emitter[]) => void;
  flakes: (colour: string, amount: number, settleMs: number) => void;
  sparks: (colours: string[], count?: number) => void;
  drops: (colour: string, count: number, reverse?: boolean) => void;
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
    sys.surfaceY = hasLiquid ? y : BOTTOM + 20;
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
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
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
            <stop offset="0" stopColor={`rgba(255,${140 - heat * 80},40,${0.25 + heat * 0.75})`} />
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
        </defs>

        {/* hotplate */}
        <g>
          <rect
            x={44}
            y={382}
            width={252}
            height={26}
            rx={8}
            fill="#1a2030"
            stroke="rgba(255,255,255,0.08)"
          />
          <rect x={58} y={378} width={224} height={8} rx={4} fill="#262e42" />
          <motion.ellipse
            cx={CX}
            cy={382}
            rx={110}
            ry={14}
            fill="url(#coil-glow)"
            animate={{ opacity: heat > 0.02 ? [0.75, 1, 0.8] : 0 }}
            transition={{ duration: 2.2, repeat: Infinity }}
          />
          <circle cx={278} cy={395} r={3.5} fill={heat > 0.02 ? "#ff6a2a" : "#3a4256"} />
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
          fill="rgba(160,200,255,0.035)"
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
        </g>

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

        {/* pour stream */}
        {props.pour && (
          <g>
            <motion.g
              initial={{ rotate: 20, x: -40, y: -50, opacity: 0 }}
              animate={{ rotate: 118, x: 0, y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
            >
              <rect
                x={108}
                y={-22}
                width={34}
                height={56}
                rx={7}
                fill="rgba(220,235,255,0.18)"
                stroke="rgba(255,255,255,0.5)"
              />
              <rect
                x={110}
                y={2}
                width={30}
                height={30}
                rx={5}
                fill={withAlpha(props.pour.colour, 0.85)}
              />
              <rect
                x={118}
                y={-34}
                width={14}
                height={14}
                rx={3}
                fill="rgba(220,235,255,0.25)"
                stroke="rgba(255,255,255,0.45)"
              />
            </motion.g>
            <motion.rect
              x={CX - 18}
              width={5}
              rx={2.5}
              fill={withAlpha(props.pour.colour, 0.9)}
              y={TOP - 30}
              initial={{ height: 0 }}
              animate={{ height: Math.max(0, y - (TOP - 30)) }}
              transition={{ duration: 0.25, delay: 0.15 }}
            />
          </g>
        )}

        {/* front glass */}
        <path
          d={`M${LEFT},${TOP} L${LEFT},${BOTTOM} A${RX},12 0 0 0 ${RIGHT},${BOTTOM} L${RIGHT},${TOP}`}
          fill="url(#glass-side)"
          stroke="rgba(200,225,255,0.55)"
          strokeWidth={2}
        />
        <ellipse
          cx={CX}
          cy={TOP}
          rx={RX}
          ry={12}
          fill="none"
          stroke="rgba(220,235,255,0.65)"
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
          stroke="rgba(220,235,255,0.55)"
          strokeWidth={1}
          fontFamily="JetBrains Mono, monospace"
          fontSize={9}
          fill="rgba(220,235,255,0.6)"
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
            stroke="rgba(220,235,255,0.4)"
          />
          <circle cx={0} cy={352} r={11} fill="#ef4444" stroke="rgba(220,235,255,0.4)" />
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
              stroke="rgba(220,235,255,0.45)"
            />
          ))}
        </g>
      </svg>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </motion.div>
  );
});
