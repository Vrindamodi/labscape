import { motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { hexToRgba } from "../colour";
import { Formula } from "../components/bits";
import { SolidShape } from "../components/SolidShape";
import { sound } from "../sound";
import type { DispenseMode, ShelfItem } from "../types";
import { dispenseMode } from "../types";

const MAX_POUR_ML_PER_S = 16;
const GAS_ML_PER_S = 45;

export type DispenserState = {
  item: ShelfItem;
  mode: DispenseMode;
  tilt: number;
  rate: number;
  speedLabel: string;
  flowing: boolean;
  added: number;
  limited: boolean;
  squeezeKey: number;
  scoopKey: number;
  valveOpen: boolean;
  startPour: (e: RPointerEvent) => void;
  movePour: (e: RPointerEvent) => void;
  endPour: () => void;
  setTiltManual: (deg: number) => void;
  holdManual: (on: boolean) => void;
  drop: () => void;
  scoop: () => void;
  valve: (open: boolean) => void;
};

type Options = {
  item: ShelfItem;
  /** How much more of this reagent may be added (limit and vessel capacity). */
  remaining: number;
  onDispense: (delta: number) => void;
  onDone: () => void;
};

function pourRate(tilt: number) {
  if (tilt < 40) return 0;
  return MAX_POUR_ML_PER_S * Math.pow(Math.min(1, (tilt - 40) / 80), 1.6);
}

function speedLabel(mode: DispenseMode, rate: number, tilt: number) {
  if (mode !== "pour") return "";
  if (rate <= 0) return tilt > 5 ? "Tilt further…" : "Drag the bottle up to tilt and pour";
  const f = rate / MAX_POUR_ML_PER_S;
  return f < 0.18 ? "Slow trickle" : f < 0.55 ? "Steady pour" : "Fast pour";
}

export function useDispenser({ item, remaining, onDispense, onDone }: Options): DispenserState {
  const mode = dispenseMode(item);
  const [tilt, setTilt] = useState(0);
  const [held, setHeld] = useState(false);
  const [valveOpen, setValveOpen] = useState(false);
  const [added, setAdded] = useState(0);
  const [squeezeKey, setSqueezeKey] = useState(0);
  const [scoopKey, setScoopKey] = useState(0);
  const drag = useRef<{ x: number; y: number; tilt: number } | null>(null);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  const dispenseRef = useRef(onDispense);
  dispenseRef.current = onDispense;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const idle = useRef<number | null>(null);

  // reset when a new item is picked up
  useEffect(() => {
    setTilt(0);
    setAdded(0);
    setHeld(false);
    setValveOpen(false);
  }, [item.id]);

  const rate = mode === "pour" ? pourRate(tilt) : mode === "gas" && valveOpen ? GAS_ML_PER_S : 0;
  const flowing = (mode === "pour" && held && rate > 0) || (mode === "gas" && valveOpen);
  const limited = remaining <= 1e-6;

  useEffect(() => {
    if (!flowing) {
      sound.loop("pour", false);
      return;
    }
    if (mode === "pour") sound.loop("pour", true, 0.4 + rate / MAX_POUR_ML_PER_S);
    // A timer (not requestAnimationFrame) so the flow keeps going even when frames are throttled.
    let last = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const delta = Math.min(rate * dt, remainingRef.current);
      if (delta > 0) {
        dispenseRef.current(delta);
        setAdded((a) => a + delta);
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [flowing, rate, mode]);

  useEffect(() => () => sound.loop("pour", false), []);

  const scheduleDone = useCallback((ms: number) => {
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => doneRef.current(), ms);
  }, []);

  const startPour = (e: RPointerEvent) => {
    if (mode !== "pour") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tilt };
    setHeld(true);
    if (idle.current) window.clearTimeout(idle.current);
  };
  const movePour = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = d.tilt + (d.y - e.clientY) * 0.9 + (d.x - e.clientX) * 0.6;
    setTilt(Math.max(0, Math.min(125, next)));
  };
  const endPour = () => {
    if (!drag.current) return;
    drag.current = null;
    setHeld(false);
    setTilt(0);
    scheduleDone(250);
  };

  return {
    item,
    mode,
    tilt,
    rate,
    speedLabel: limited ? "That's the most this model handles" : speedLabel(mode, rate, tilt),
    flowing,
    added,
    limited,
    squeezeKey,
    scoopKey,
    valveOpen,
    startPour,
    movePour,
    endPour,
    setTiltManual: (deg) => setTilt(Math.max(0, Math.min(125, deg))),
    holdManual: (on) => {
      setHeld(on);
      if (!on) scheduleDone(250);
    },
    drop: () => {
      if (remainingRef.current < 1) return;
      setSqueezeKey((k) => k + 1);
      window.setTimeout(() => {
        sound.play("drip");
        dispenseRef.current(1);
        setAdded((a) => a + 1);
      }, 260);
      scheduleDone(700);
    },
    scoop: () => {
      const step = Math.max(
        item.limits.min,
        Math.round(((item.limits.max - item.limits.min) / 8) * 100) / 100,
      );
      const amount = Math.min(step, remainingRef.current);
      if (amount <= 1e-6) return;
      setScoopKey((k) => k + 1);
      sound.play("scoop");
      window.setTimeout(() => {
        dispenseRef.current(amount);
        setAdded((a) => a + amount);
      }, 380);
      scheduleDone(800);
    },
    valve: (open) => {
      setValveOpen(open);
      if (open) sound.play("hiss");
      else scheduleDone(250);
    },
  };
}

// --------------------------------------------------------------------------------- SVG (in vessel)

type Geom = { cx: number; mouthY: number; surfaceY: number };

export function DispenserSvg({ d, g }: { d: DispenserState; g: Geom }) {
  const colour = hexToRgba(d.item.colour, Math.max(0.5, Math.min(0.95, d.item.opacity + 0.3)));
  if (d.mode === "pour") {
    const cx = g.cx + 62;
    const cy = g.mouthY - 58;
    const rad = (d.tilt * Math.PI) / 180;
    const mouthX = cx - 46 * Math.sin(rad);
    const mouthY = cy - 46 * Math.cos(rad);
    const width = 2 + (d.rate / MAX_POUR_ML_PER_S) * 9;
    return (
      <g>
        {d.flowing && (
          <motion.path
            d={`M${mouthX - width / 2},${mouthY} Q${mouthX - 6},${(mouthY + g.surfaceY) / 2} ${mouthX - 4 - width / 2},${g.surfaceY} L${mouthX - 4 + width / 2},${g.surfaceY} Q${mouthX - 6 + width},${(mouthY + g.surfaceY) / 2} ${mouthX + width / 2},${mouthY} Z`}
            fill={colour}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.75, 1, 0.8] }}
            transition={{ duration: 0.3, repeat: Infinity }}
          />
        )}
        <motion.g
          style={{
            originX: `${cx}px`,
            originY: `${cy}px`,
            cursor: d.flowing ? "grabbing" : "grab",
          }}
          animate={{ rotate: -d.tilt }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onPointerDown={d.startPour}
          onPointerMove={d.movePour}
          onPointerUp={d.endPour}
          onPointerCancel={d.endPour}
          role="slider"
          aria-label={`Tilt the ${d.item.name} bottle to pour`}
          aria-valuenow={Math.round(d.tilt)}
          aria-valuemin={0}
          aria-valuemax={125}
        >
          <rect
            x={cx - 22}
            y={cy - 36}
            width={44}
            height={72}
            rx={9}
            fill="rgba(235,245,255,0.55)"
            stroke="rgba(40,70,110,0.7)"
            strokeWidth={1.6}
          />
          <rect x={cx - 19} y={cy - 4} width={38} height={37} rx={6} fill={colour} />
          <rect x={cx - 17} y={cy - 2} width={34} height={14} rx={2} fill="rgba(255,255,255,0.9)" />
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            fontSize={8}
            fontFamily="Inter, sans-serif"
            fill="#334155"
            fontWeight={700}
          >
            {d.item.formula.length > 9 ? d.item.formula.slice(0, 9) : d.item.formula}
          </text>
          <rect
            x={cx - 9}
            y={cy - 48}
            width={18}
            height={14}
            rx={3}
            fill="rgba(235,245,255,0.7)"
            stroke="rgba(40,70,110,0.7)"
          />
          <rect
            x={cx - 15}
            y={cy - 32}
            width={5}
            height={60}
            rx={2.5}
            fill="rgba(255,255,255,0.7)"
          />
          <circle cx={cx} cy={cy + 44} r={16} fill="transparent" />
        </motion.g>
      </g>
    );
  }
  if (d.mode === "dropper") {
    const x = g.cx - 6;
    const y = g.mouthY - 70;
    return (
      <g
        style={{ cursor: "pointer" }}
        onClick={d.drop}
        role="button"
        aria-label={`Squeeze one drop of ${d.item.name}`}
      >
        <motion.g
          key={d.squeezeKey}
          animate={{ scaleY: [1, 0.7, 1] }}
          transition={{ duration: 0.3 }}
          style={{ originX: `${x}px`, originY: `${y}px` }}
        >
          <rect x={x - 10} y={y - 30} width={20} height={26} rx={9} fill="#ef6c8a" />
        </motion.g>
        <rect
          x={x - 6}
          y={y - 6}
          width={12}
          height={46}
          rx={3}
          fill="rgba(235,245,255,0.6)"
          stroke="rgba(40,70,110,0.7)"
        />
        <rect x={x - 4} y={y + 14} width={8} height={24} rx={2} fill={colour} />
        <path
          d={`M${x - 3},${y + 40} L${x},${y + 52} L${x + 3},${y + 40} Z`}
          fill="rgba(235,245,255,0.7)"
          stroke="rgba(40,70,110,0.7)"
        />
        <motion.circle
          key={`drop-${d.squeezeKey}`}
          cx={x}
          r={3.5}
          fill={colour}
          initial={{ cy: y + 54, opacity: d.squeezeKey ? 1 : 0 }}
          animate={{ cy: g.surfaceY, opacity: [1, 1, 0] }}
          transition={{ duration: 0.45, ease: "easeIn", delay: 0.15 }}
        />
      </g>
    );
  }
  if (d.mode === "spatula") {
    const x = g.cx + 30;
    const y = g.mouthY - 40;
    return (
      <g
        style={{ cursor: "pointer" }}
        onClick={d.scoop}
        role="button"
        aria-label={`Tip a scoop of ${d.item.name} into the vessel`}
      >
        <motion.g
          key={d.scoopKey}
          style={{ originX: `${x + 50}px`, originY: `${y}px` }}
          animate={d.scoopKey ? { rotate: [0, 0, 28, 0] } : { rotate: 0 }}
          transition={{ duration: 0.7, times: [0, 0.2, 0.55, 1] }}
        >
          <rect
            x={x - 26}
            y={y - 3}
            width={92}
            height={5}
            rx={2.5}
            fill="#9aa5b1"
            stroke="#5b6672"
          />
          <ellipse cx={x - 30} cy={y} rx={14} ry={6} fill="#b4bec9" stroke="#5b6672" />
          <g transform={`translate(${x - 30},${y - 2}) scale(0.45)`}>
            <SolidShape form={d.item.solidForm ?? "powder"} fill={d.item.colour} seed={3} />
          </g>
        </motion.g>
        {d.scoopKey > 0 &&
          [0, 1, 2, 3, 4, 5].map((i) => (
            <motion.circle
              key={`${d.scoopKey}-${i}`}
              cx={x - 34 + i * 3}
              r={1.8}
              fill={d.item.colour}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.3}
              initial={{ cy: y + 4, opacity: 0 }}
              animate={{ cy: g.surfaceY + 6, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 0.5, delay: 0.32 + i * 0.03, ease: "easeIn" }}
            />
          ))}
      </g>
    );
  }
  // gas cylinder
  const x = g.cx + 70;
  const y = g.mouthY - 80;
  return (
    <g>
      <rect
        x={x - 16}
        y={y}
        width={32}
        height={86}
        rx={14}
        fill={hexToRgba(d.item.colour === "#eef3ff" ? "#8fb4ff" : d.item.colour, 0.9)}
        stroke="#334155"
        strokeWidth={1.4}
      />
      <rect x={x - 12} y={y + 30} width={24} height={16} rx={2} fill="rgba(255,255,255,0.9)" />
      <text
        x={x}
        y={y + 42}
        textAnchor="middle"
        fontSize={9}
        fontWeight={700}
        fill="#1e293b"
        fontFamily="Inter, sans-serif"
      >
        {d.item.formula}
      </text>
      <rect x={x - 5} y={y - 12} width={10} height={14} fill="#64748b" />
      <path
        d={`M${x - 5},${y - 8} L${g.cx + 10},${y - 8} Q${g.cx},${y - 8} ${g.cx},${y + 6} L${g.cx},${g.mouthY + 8}`}
        fill="none"
        stroke="#475569"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <motion.circle
        cx={x + 10}
        cy={y - 6}
        r={8}
        fill={d.valveOpen ? "#22c55e" : "#ef4444"}
        stroke="#1e293b"
        style={{ cursor: "pointer" }}
        animate={{ rotate: d.valveOpen ? 90 : 0 }}
        onPointerDown={() => d.valve(true)}
        onPointerUp={() => d.valve(false)}
        onPointerLeave={() => d.valveOpen && d.valve(false)}
        role="button"
        aria-label={`Hold to open the ${d.item.name} valve`}
      />
      {d.valveOpen && (
        <motion.circle
          cx={g.cx}
          cy={g.mouthY + 14}
          r={6}
          fill={hexToRgba(d.item.colour, 0.5)}
          animate={{ r: [4, 16], opacity: [0.8, 0] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        />
      )}
    </g>
  );
}

// --------------------------------------------------------------------------------- controls

export function DispenserControls({ d, onPutDown }: { d: DispenserState; onPutDown: () => void }) {
  const unit = d.item.limits.unit;
  const dec = unit === "drops" ? 0 : unit === "g" ? 2 : 1;
  const hint =
    d.mode === "pour"
      ? "Grab the bottle and drag it up to tilt. Tilt a little for a slow trickle, more for a fast pour."
      : d.mode === "dropper"
        ? "Click the dropper bulb to squeeze out one drop at a time."
        : d.mode === "spatula"
          ? "Click the spatula to tip a scoop of powder into the vessel."
          : "Press and hold the valve to let gas flow into the vessel.";
  return (
    <div className="lab-hand">
      <div className="flex min-w-0 items-center gap-2">
        <span className="lab-hand-swatch" style={{ background: d.item.colour }} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800">
            {d.item.name} <Formula value={d.item.formula} className="lab-formula" />
          </div>
          <div className="text-[11.5px] text-slate-500">{hint}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {d.mode === "pour" && (
          <>
            <span className={`lab-speed ${d.flowing ? "lab-speed-on" : ""}`}>{d.speedLabel}</span>
            <input
              type="range"
              className="lab-range w-28"
              min={0}
              max={125}
              value={Math.round(d.tilt)}
              onChange={(e) => d.setTiltManual(Number(e.target.value))}
              aria-label="Tilt angle"
            />
            <button
              className="lab-mini"
              onPointerDown={() => d.holdManual(true)}
              onPointerUp={() => d.holdManual(false)}
              onPointerLeave={() => d.flowing && d.holdManual(false)}
            >
              Hold to pour
            </button>
          </>
        )}
        {d.mode === "dropper" && (
          <button className="lab-mini" onClick={d.drop}>
            Squeeze a drop
          </button>
        )}
        {d.mode === "spatula" && (
          <button className="lab-mini" onClick={d.scoop}>
            Tip in a scoop
          </button>
        )}
        {d.mode === "gas" && (
          <button
            className="lab-mini"
            onPointerDown={() => d.valve(true)}
            onPointerUp={() => d.valve(false)}
          >
            Hold valve open
          </button>
        )}
        <span className="tabular rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
          +{d.added.toFixed(dec)} {unit}
        </span>
        <button className="lab-mini lab-mini-ghost" onClick={onPutDown}>
          Put down
        </button>
      </div>
    </div>
  );
}
