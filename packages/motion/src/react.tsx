import { animate, motion, useInView, useReducedMotion, type Variants } from "framer-motion";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { dur, ease, reducedMotion, stagger, type ParticlePreset } from "./tokens";

/* ------------------------------------------------------------------ preferences */

export type MotionPrefs = {
  /** Animation speed setting, 0.5x - 2x. Scales UI durations only. */
  speed: number;
  /** "system" follows the OS setting. */
  reduced: "system" | "on" | "off";
};

type Resolved = { speed: number; reduced: boolean; d: (ms: number) => number };

const Ctx = createContext<Resolved>({ speed: 1, reduced: false, d: (ms) => ms / 1000 });

export function MotionProvider({ prefs, children }: { prefs: MotionPrefs; children: ReactNode }) {
  const system = useReducedMotion() ?? false;
  const reduced = prefs.reduced === "system" ? system : prefs.reduced === "on";
  const value = useMemo<Resolved>(
    () => ({
      speed: prefs.speed,
      reduced,
      // Higher speed = shorter durations. Reduced motion caps everything at a 150 ms crossfade.
      d: (ms) => (reduced ? Math.min(ms, reducedMotion.maxCrossfadeMs) : ms / prefs.speed) / 1000,
    }),
    [prefs.speed, reduced],
  );
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? "true" : "false";
    document.documentElement.style.setProperty("--ls-speed", String(prefs.speed));
  }, [reduced, prefs.speed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Durations in seconds, already scaled by the speed setting and reduced motion. */
export function useMotion() {
  return useContext(Ctx);
}

/* ------------------------------------------------------------------ reveal / stagger */

export function Reveal({
  children,
  delay = 0,
  y = 12,
  as = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "article" | "header";
  className?: string;
}) {
  const { d, reduced } = useMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: d(dur.base), delay: reduced ? 0 : delay, ease: ease.enter }}
    >
      {children}
    </Comp>
  );
}

/** Children rise and fade in 40 ms apart; only the first 8 are staggered. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const { d, reduced } = useMotion();
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : stagger.perItemMs / 1000 } },
  };
  return (
    <motion.div className={className} variants={variants} initial="hidden" animate="show" data-dur={d(dur.base)}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  const { d, reduced } = useMotion();
  const late = index >= stagger.maxItems;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduced || late ? 0 : 12 },
        show: { opacity: 1, y: 0, transition: { duration: d(dur.base), ease: ease.enter } },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ numbers */

/** Counts up from 0 (or the previous value) when it enters the viewport. */
export function CountUp({ value, durationMs = 600, format }: { value: number; durationMs?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const { d, reduced } = useMotion();
  const prev = useRef(0);
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());
    if (reduced) {
      node.textContent = fmt(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: d(durationMs),
      ease: ease.standard,
      onUpdate: (n) => (node.textContent = fmt(n)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, inView, reduced, d, durationMs, format]);
  return <span ref={ref} className="tabular-nums" />;
}

/* ------------------------------------------------------------------ celebrate() */

export type CelebrateOptions = {
  preset?: ParticlePreset;
  /** Viewport point the burst comes from; defaults to the centre. */
  origin?: { x: number; y: number };
  count?: number;
  colors?: string[];
};

type Listener = (o: CelebrateOptions) => void;
const listeners = new Set<Listener>();

/** Fire a particle burst from anywhere. Needs one <CelebrationLayer/> mounted (the shell does this). */
export function celebrate(options: CelebrateOptions = {}) {
  listeners.forEach((l) => l(options));
}

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; rot: number; vr: number; shape: 0 | 1 | 2 };

const PALETTE = ["#2F80FF", "#22D3EE", "#8B5CF6", "#E879F9", "#22C55E", "#F59E0B", "#FFFFFF"];

export function CelebrationLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reduced } = useMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let parts: P[] = [];
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts = parts.filter((p) => p.life < p.max);
      for (const p of parts) {
        p.life++;
        p.vy += p.shape === 2 ? -0.01 : 0.18;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const a = 1 - p.life / p.max;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else if (p.shape === 1) {
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const ang = (i * Math.PI) / 2;
            ctx.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
            ctx.lineTo(Math.cos(ang + Math.PI / 4) * p.size * 0.3, Math.sin(ang + Math.PI / 4) * p.size * 0.3);
          }
          ctx.fill();
        } else {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(tick) : 0;
    };

    const onBurst: Listener = (o) => {
      const scale = reducedRef.current ? reducedMotion.particleScale : 1;
      const n = Math.round((o.count ?? 80) * scale);
      const ox = o.origin?.x ?? window.innerWidth / 2;
      const oy = o.origin?.y ?? window.innerHeight / 2;
      const colors = o.colors ?? PALETTE;
      const preset = o.preset ?? "confetti";
      for (let i = 0; i < n; i++) {
        const ang = preset === "bubbles" ? -Math.PI / 2 + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
        const sp = preset === "sparkle" ? 2 + Math.random() * 5 : preset === "bubbles" ? 1 + Math.random() * 2 : 4 + Math.random() * 9;
        parts.push({
          x: ox,
          y: oy,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - (preset === "confetti" ? 4 : 0),
          life: 0,
          max: 60 + Math.random() * 50,
          size: preset === "sparkle" ? 3 + Math.random() * 4 : 5 + Math.random() * 6,
          color: colors[i % colors.length] ?? "#fff",
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 0.3,
          shape: preset === "sparkle" ? 1 : preset === "bubbles" ? 2 : 0,
        });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    listeners.add(onBurst);
    return () => {
      listeners.delete(onBurst);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[90] h-full w-full" />;
}

/** Small helper so components can read the OS setting without the provider. */
export function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(mq.matches);
    const on = () => setR(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return r;
}
