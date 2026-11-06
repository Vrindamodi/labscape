import { animate, motion, useReducedMotion } from "framer-motion";
import katex from "katex";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hexToRgba } from "../colour";
import type { ShelfItem } from "../types";
import { SolidShape } from "./SolidShape";

/** "CuSO4·5H2O" -> Cu SO₄ · 5 H₂O with real subscripts. */
export function Formula({ value, className }: { value: string; className?: string }) {
  const caret = value.indexOf("^");
  if (caret >= 0) {
    return (
      <span className={className}>
        <Formula value={value.slice(0, caret)} />
        <sup>{value.slice(caret + 1)}</sup>
      </span>
    );
  }
  const parts: { t: string; sub: boolean }[] = [];
  let afterDot = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const prev = i > 0 ? value.charAt(i - 1) : "";
    const isDigit = ch >= "0" && ch <= "9";
    if (ch === "·") afterDot = true;
    const sub = isDigit && !afterDot && /[A-Za-z)\]]/.test(prev);
    if (!isDigit) afterDot = ch === "·" ? true : false;
    const last = parts[parts.length - 1];
    if (last && last.sub === sub) last.t += ch;
    else parts.push({ t: ch, sub });
  }
  return (
    <span className={className}>
      {parts.map((p, i) => (p.sub ? <sub key={i}>{p.t}</sub> : <span key={i}>{p.t}</span>))}
    </span>
  );
}

export function Equation({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, { throwOnError: false, displayMode: display, output: "html" }),
    [latex, display],
  );
  return <span className="ls-katex" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function NumberTicker({
  value,
  decimals = 1,
  durationMs = 600,
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: durationMs / 1000,
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, durationMs, reduced]);
  return <span className={`tabular ${className ?? ""}`}>{shown.toFixed(decimals)}</span>;
}

const HAZARD: Record<string, { label: string; path: string }> = {
  radioactive: {
    label: "Radioactive",
    path: "M9 9 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M9 7 L7 3.6 A6 6 0 0 1 11 3.6 Z M7.3 10 L5.3 13.4 A6 6 0 0 1 3.4 9.9 Z M10.7 10 L14.6 9.9 A6 6 0 0 1 12.7 13.4 Z",
  },
  corrosive: { label: "Corrosive", path: "M6 4h6l-1 4H7z M5 12c2 0 2 2 4 2s2-2 4-2M4 15h10" },
  irritant: { label: "Irritant / harmful", path: "M9 4v6 M9 13v1" },
  oxidising: { label: "Oxidising", path: "M9 4c2 2 3 3 3 5a3 3 0 1 1-6 0c0-2 1-3 3-5z M4 14h10" },
  flammable: {
    label: "Flammable",
    path: "M9 3c3 3 4 5 4 7a4 4 0 1 1-8 0c0-1 .5-2 1.5-3 0 1.5.8 2.2 1.5 2.2C8 7 8.5 5 9 3z",
  },
  toxic: {
    label: "Toxic",
    path: "M9 4a3 3 0 0 1 3 3c0 1.5-1 2.3-1 3H7c0-.7-1-1.5-1-3a3 3 0 0 1 3-3z M5 13l8-2 M5 11l8 2",
  },
  environmental: {
    label: "Harmful to aquatic life",
    path: "M4 13c2-1 3-3 3-6 M7 7l2-2 M10 12c1-2 3-2 4 0-1 2-3 2-4 0z",
  },
};

export function HazardIcon({ kind }: { kind: string }) {
  const h = HAZARD[kind];
  if (!h) return null;
  return (
    <span className="ls-hazard" title={h.label} aria-label={h.label}>
      <svg viewBox="0 0 18 18" width="14" height="14">
        <path d="M9 0.8 L17.2 9 L9 17.2 L0.8 9 Z" fill="#fff" stroke="#ef4444" strokeWidth="1.6" />
        <path
          d={h.path}
          fill="none"
          stroke="#111"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(0,0.5) scale(1)"
        />
      </svg>
    </span>
  );
}

/** Reagent bottle or sample dish art for shelf cards. */
export function ReagentArt({ item, size = 56 }: { item: ShelfItem; size?: number }) {
  if (item.form === "gas") {
    return (
      <svg viewBox="0 0 40 56" width={size * 0.72} height={size} aria-hidden>
        <rect
          x="10"
          y="10"
          width="20"
          height="44"
          rx="9"
          fill={hexToRgba(item.colour, 0.9)}
          stroke="#334155"
          strokeWidth="1.4"
        />
        <rect x="16" y="3" width="8" height="8" fill="#64748b" />
        <rect x="12" y="26" width="16" height="10" rx="1.5" fill="rgba(255,255,255,0.9)" />
      </svg>
    );
  }
  if (item.form === "solid") {
    return (
      <svg viewBox="-34 -30 68 44" width={size} height={size * 0.65} aria-hidden>
        <ellipse
          cx="0"
          cy="6"
          rx="30"
          ry="7"
          fill="rgba(255,255,255,0.06)"
          stroke="rgba(255,255,255,0.25)"
        />
        <g transform="translate(0,4)">
          <SolidShape form={item.solidForm ?? "powder"} fill={item.colour} seed={item.id.length} />
        </g>
      </svg>
    );
  }
  const dropper = item.limits.unit === "drops";
  const liquidFill = hexToRgba(item.colour, Math.max(0.25, Math.min(0.95, item.opacity + 0.2)));
  return (
    <svg viewBox="0 0 40 56" width={size * 0.72} height={size} aria-hidden>
      <defs>
        <linearGradient id={`g-${item.id}`} x1="0" x2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="0.25" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.15)" />
        </linearGradient>
      </defs>
      {dropper ? (
        <>
          <rect x="16" y="2" width="8" height="10" rx="3" fill="#2b3348" />
          <rect x="14" y="11" width="12" height="4" rx="1" fill="#3a4561" />
          <path
            d="M11 16 h18 v30 a6 6 0 0 1 -6 6 h-6 a6 6 0 0 1 -6 -6z"
            fill="rgba(170,110,50,0.35)"
            stroke="rgba(255,255,255,0.4)"
          />
          <path d="M12 28 h16 v18 a5 5 0 0 1 -5 5 h-6 a5 5 0 0 1 -5 -5z" fill={liquidFill} />
        </>
      ) : (
        <>
          <rect x="15" y="1" width="10" height="7" rx="2" fill="#2b3348" />
          <path
            d="M16 8 h8 v5 l6 6 v28 a6 6 0 0 1 -6 6 h-8 a6 6 0 0 1 -6 -6 v-28 l6 -6z"
            fill="rgba(220,235,255,0.08)"
            stroke="rgba(255,255,255,0.45)"
          />
          <path d="M11 26 h18 v21 a5 5 0 0 1 -5 5 h-8 a5 5 0 0 1 -5 -5z" fill={liquidFill} />
          <rect x="12" y="30" width="16" height="9" rx="1.5" fill="rgba(255,255,255,0.82)" />
        </>
      )}
      <path d="M13 20 v26" stroke={`url(#g-${item.id})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <motion.div
      animate={active ? { y: [0, -4, 0] } : { y: 0 }}
      transition={
        active ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }
      }
    >
      {children}
    </motion.div>
  );
}
