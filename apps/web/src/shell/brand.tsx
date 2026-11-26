import { motion } from "framer-motion";
import { useMotion } from "@labscape/motion";
import { useId } from "react";

/** LABscape mark: a flask whose liquid is an orbiting atom. `draw` plays the stroke-draw reveal. */
export function LogoMark({ size = 32, draw = false }: { size?: number; draw?: boolean }) {
  const { d, reduced } = useMotion();
  // Per-instance gradient ids: a shared id resolves to the first copy in the DOM, and when that copy
  // sits in a hidden subtree (the sidebar on phones) the gradient never paints.
  const uid = useId().replace(/:/g, "");
  const g = `lm-g-${uid}`;
  const l = `lm-l-${uid}`;
  const animateDraw = draw && !reduced;
  const stroke = {
    initial: animateDraw ? { pathLength: 0, opacity: 0 } : false,
    animate: { pathLength: 1, opacity: 1 },
    transition: { duration: d(900), ease: [0.2, 0, 0, 1] as const },
  };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        {/* On light surfaces the pale cyan end would vanish, so the stroke starts at blue there. */}
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="[stop-color:#2f80ff] dark:[stop-color:#7ef3ff]" />
          <stop offset=".5" className="[stop-color:#2f6bff] dark:[stop-color:#2f80ff]" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={l} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity=".9" />
          <stop offset="1" stopColor="#2f80ff" stopOpacity=".9" />
        </linearGradient>
      </defs>
      <motion.path
        d="M19 6h10M20.5 6v11.5L9.6 36.3A4 4 0 0 0 13.1 42h21.8a4 4 0 0 0 3.5-5.7L27.5 17.5V6"
        fill="none"
        stroke={`url(#${g})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...stroke}
      />
      <motion.path
        d="M13.2 33h21.6l3 5.2a2.4 2.4 0 0 1-2.1 3.6H12.3a2.4 2.4 0 0 1-2.1-3.6z"
        fill={`url(#${l})`}
        initial={animateDraw ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: d(900), duration: d(300) }}
      />
      <motion.g
        initial={animateDraw ? { opacity: 0, scale: 0.4 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: d(1000), type: "spring", stiffness: 320, damping: 14 }}
        style={{ transformOrigin: "24px 27px" }}
      >
        <ellipse cx="24" cy="27" rx="7.5" ry="2.8" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="1.3" transform="rotate(-25 24 27)" />
        <circle cx="24" cy="27" r="2.2" fill="#fff" />
      </motion.g>
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="font-heading font-semibold tracking-[-0.02em] text-ink-strong" style={{ fontSize: size }}>
      LAB<span className="font-normal dark:bg-gradient-to-r dark:from-[#7ef3ff] dark:via-accent dark:to-ai-violet dark:bg-clip-text dark:text-transparent">scape</span>
    </span>
  );
}

/** Streak flame with idle flicker; blue when a freeze kept it alive, dim when the streak is 0. */
export function StreakFlame({ days, size = 22, frozen }: { days: number; size?: number; frozen?: boolean }) {
  const { reduced } = useMotion();
  const on = days > 0;
  const outer = frozen ? "#7dd3fc" : on ? "#ff8a3d" : "#a39c93";
  const inner = frozen ? "#e0f2fe" : on ? "#ffd56b" : "#c9c1b6";
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      animate={on && !reduced ? { scaleY: [1, 1.06, 0.97, 1.04, 1], scaleX: [1, 0.97, 1.02, 0.98, 1] } : {}}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformOrigin: "50% 100%", filter: on ? `drop-shadow(0 0 6px ${outer}aa)` : undefined }}
    >
      <path d="M12 2c1 3.5 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.4 1.1-3.9 2.2-5 .3 1.6 1.1 2.6 2 3C10 8 10.8 4.6 12 2z" fill={outer} />
      <path d="M12 11c.6 1.7 2.8 2.7 2.8 5.2a2.8 2.8 0 0 1-5.6 0c0-1.4.7-2.3 1.4-3 .2.8.6 1.2 1 1.4-.2-1.4.1-2.6.4-3.6z" fill={inner} />
    </motion.svg>
  );
}
