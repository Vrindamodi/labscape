import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  AlertTriangle,
  Atom,
  Beaker,
  Check,
  CircleAlert,
  CloudHail,
  Cpu,
  Flame,
  FlaskConical,
  Info,
  ListChecks,
  Loader2,
  Microscope,
  Orbit,
  Palette,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sigma,
  Siren,
  Sparkles,
  Target,
  Telescope,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { colors } from "./tokens";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ icons by name */

/** Curated name -> icon map for icons named by the API (badges, challenges). */
export const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  "flask-conical": FlaskConical,
  atom: Atom,
  orbit: Orbit,
  sigma: Sigma,
  target: Target,
  flame: Flame,
  "shield-check": ShieldCheck,
  telescope: Telescope,
  microscope: Microscope,
  cpu: Cpu,
  wind: Wind,
  "cloud-hail": CloudHail,
  zap: Zap,
  palette: Palette,
  scale: Scale,
  beaker: Beaker,
  "list-checks": ListChecks,
  siren: Siren,
};

export function NamedIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const I = ICONS[name] ?? Sparkles;
  return <I className={className} style={style} aria-hidden />;
}

/* ------------------------------------------------------------------ subjects */

export type SubjectKey = "chemistry" | "physics" | "maths";

export const SUBJECTS: Record<SubjectKey, { label: string; color: string; icon: LucideIcon }> = {
  chemistry: { label: "Chemistry", color: colors.subject.chemistry, icon: FlaskConical },
  physics: { label: "Physics", color: colors.subject.physics, icon: Orbit },
  maths: { label: "Maths", color: colors.subject.maths, icon: Sigma },
};

export function SubjectChip({ subject, size = "sm" }: { subject: string; size?: "sm" | "md" }) {
  const s = SUBJECTS[subject as SubjectKey];
  if (!s) return null;
  const I = s.icon;
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full font-medium", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm")}
      style={{ color: s.color, background: `${s.color}1f`, boxShadow: `inset 0 0 0 1px ${s.color}40` }}
    >
      <I className="h-3.5 w-3.5" aria-hidden />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "premium";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "text-white bg-[linear-gradient(180deg,#4b93ff,#2f80ff_45%,#1f63e0)] shadow-[0_10px_30px_-10px_rgba(47,128,255,.9),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-110",
  secondary:
    "text-white/90 bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)] hover:bg-white/[0.1] hover:text-white",
  ghost: "text-white/70 hover:text-white hover:bg-white/[0.06]",
  danger:
    "text-white bg-[linear-gradient(180deg,#f26363,#ef4444_50%,#d42f2f)] shadow-[0_10px_30px_-12px_rgba(239,68,68,.9),inset_0_1px_0_rgba(255,255,255,.3)] hover:brightness-110",
  premium:
    "text-[#2a1600] bg-[linear-gradient(135deg,#fff1b8,#ffc23d_40%,#ff8a3d)] shadow-[0_10px_30px_-10px_rgba(255,170,60,.9),inset_0_1px_0_rgba(255,255,255,.6)] hover:brightness-105",
};
const SIZES = { sm: "h-9 px-3 text-sm gap-1.5 rounded-md", md: "h-11 px-4 text-sm gap-2 rounded-md", lg: "h-[52px] px-6 text-base gap-2.5 rounded-lg" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, iconRight, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "relative inline-flex select-none items-center justify-center font-semibold outline-none transition duration-fast ease-standard",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  className,
  glow,
  as: As = "div",
  ...rest
}: { children: ReactNode; className?: string | undefined; glow?: string | undefined; as?: "div" | "section" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As
      className={cx(
        "relative rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(26,34,54,.78),rgba(18,24,41,.82))] backdrop-blur-glass",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_24px_60px_-30px_rgba(0,0,0,.8)]",
        className,
      )}
      style={glow ? { boxShadow: `inset 0 1px 0 rgba(255,255,255,.06), 0 30px 80px -40px ${glow}` } : undefined}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Tilts toward the pointer (max 6 degrees) with a sheen that follows it. Off under reduced motion. */
export function TiltCard({ children, className, disabled }: { children: ReactNode; className?: string | undefined; disabled?: boolean | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [6, -6]), { stiffness: 220, damping: 26 });
  const ry = useSpring(useTransform(mx, [0, 1], [-6, 6]), { stiffness: 220, damping: 26 });
  const sheen = useTransform([mx, my] as never, ([x, y]: number[]) =>
    `radial-gradient(420px circle at ${(x ?? 0.5) * 100}% ${(y ?? 0.5) * 100}%, rgba(255,255,255,.10), transparent 45%)`,
  );
  const reduced = typeof document !== "undefined" && document.documentElement.dataset.reducedMotion === "true";
  const off = disabled || reduced;
  return (
    <motion.div
      ref={ref}
      className={cx("relative [transform-style:preserve-3d]", className)}
      style={off ? {} : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (off || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
    >
      {children}
      {!off && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: sheen }} />}
    </motion.div>
  );
}

export function Chip({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "blue" | "success" | "warning" | "danger" | "violet" | "gold"; className?: string | undefined }) {
  const tones = {
    neutral: "bg-white/[0.06] text-white/75 ring-white/10",
    blue: "bg-accent/15 text-[#8cbcff] ring-accent/30",
    success: "bg-state-success/15 text-[#7ee2a2] ring-state-success/30",
    warning: "bg-state-warning/15 text-[#fcd27b] ring-state-warning/30",
    danger: "bg-state-danger/15 text-[#ff9b9b] ring-state-danger/30",
    violet: "bg-ai-violet/15 text-[#c4b1ff] ring-ai-violet/30",
    gold: "bg-[#ffc23d]/15 text-[#ffd77a] ring-[#ffc23d]/35",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/70">{children}</kbd>;
}

/* ------------------------------------------------------------------ progress */

export function ProgressRing({
  value,
  size = 56,
  stroke = 6,
  color = colors.accent.primary,
  track = "rgba(255,255,255,.08)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const id = useId();
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor={color} stopOpacity=".7" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

/** XP bar: a liquid fill with a curved meniscus at its leading edge and a slow shimmer. */
export function XpBar({ value, height = 10, className }: { value: number; height?: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cx("relative overflow-hidden rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgba(0,0,0,.5)]", className)} style={{ height }}>
      <motion.div
        className="ls-liquid absolute inset-y-0 left-0 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${v * 100}%` }}
        transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
      >
        <span className="ls-meniscus" />
      </motion.div>
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string | undefined; style?: CSSProperties | undefined }) {
  return <div className={cx("ls-skeleton rounded-md", className)} style={style} aria-hidden />;
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.05] text-white/60 ring-1 ring-white/10">{icon}</div>}
      <div className="font-heading text-lg font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-white/60">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", body, onRetry }: { title?: string | undefined; body?: string | undefined; onRetry?: (() => void) | undefined }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-state-danger/15 text-state-danger ring-1 ring-state-danger/30">
        <CircleAlert className="h-6 w-6" aria-hidden />
      </div>
      <div className="font-heading font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-white/60">{body}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** State colours never carry meaning alone: every callout has an icon and a label. */
export function Callout({ tone, title, children }: { tone: "info" | "success" | "warning" | "danger"; title: string; children?: ReactNode }) {
  const map = {
    info: { I: Info, c: colors.accent.cyan, label: "Note" },
    success: { I: Check, c: colors.state.success, label: "Done" },
    warning: { I: AlertTriangle, c: colors.state.warning, label: "Heads up" },
    danger: { I: CircleAlert, c: colors.state.danger, label: "Safety" },
  }[tone];
  return (
    <div className="flex gap-3 rounded-lg p-3.5 text-sm" style={{ background: `${map.c}14`, boxShadow: `inset 0 0 0 1px ${map.c}40` }}>
      <map.I className="mt-0.5 h-4 w-4 shrink-0" style={{ color: map.c }} aria-hidden />
      <div>
        <div className="font-semibold" style={{ color: map.c }}>
          <span className="sr-only">{map.label}: </span>
          {title}
        </div>
        {children && <div className="mt-1 text-white/70">{children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-lg bg-black/25 p-1 ring-1 ring-inset ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative z-10 rounded-md font-medium transition-colors duration-fast",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            o.value === value ? "text-white" : "text-white/55 hover:text-white/85",
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 -z-10 rounded-md bg-accent/30 shadow-[inset_0_0_0_1px_rgba(110,170,255,.5)]"
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        checked ? "bg-accent shadow-[0_0_14px_-2px_rgba(47,128,255,.9)]" : "bg-white/15",
      )}
    >
      <motion.span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
        animate={{ left: checked ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/80">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-center gap-1 text-xs text-[#ff9b9b]">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-white/45">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-md border border-white/10 bg-black/25 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-accent/70 focus:bg-black/35 focus:shadow-[0_0_0_4px_rgba(47,128,255,.15)]";

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissible = true,
  width = 480,
  hideTitle,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Safety modals cannot be dismissed by clicking outside. */
  dismissible?: boolean;
  width?: number;
  hideTitle?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea");
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, dismissible, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-[#03060f]/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,#1a2236,#121829)] shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)]"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            {!hideTitle && (
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <h2 className="font-heading text-lg font-semibold">{title}</h2>
                {dismissible && (
                  <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ avatar */

export type AvatarSpec = { hue?: number | undefined; emoji?: string | undefined };

export function Avatar({ name, spec, size = 36, ring }: { name: string; spec?: AvatarSpec | null | undefined; size?: number; ring?: string | undefined }) {
  const hue = spec?.hue ?? [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-full font-heading font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `conic-gradient(from 200deg, hsl(${hue} 90% 60%), hsl(${(hue + 60) % 360} 90% 55%), hsl(${(hue + 140) % 360} 85% 55%), hsl(${hue} 90% 60%))`,
        boxShadow: ring ? `0 0 0 2px #0b1020, 0 0 0 4px ${ring}` : "inset 0 0 0 1px rgba(255,255,255,.25)",
      }}
      aria-hidden
    >
      {spec?.emoji ? <span style={{ fontSize: size * 0.5 }}>{spec.emoji}</span> : initials}
    </span>
  );
}
