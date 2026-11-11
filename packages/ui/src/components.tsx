import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import {
  AlertTriangle,
  Atom,
  Beaker,
  Bird,
  Check,
  CircleAlert,
  CloudHail,
  Cpu,
  Dna,
  Flame,
  FlaskConical,
  FlaskRound,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  Magnet,
  Microscope,
  Mountain,
  Orbit,
  Palette,
  RefreshCw,
  Rocket,
  Scale,
  ShieldCheck,
  Sigma,
  Siren,
  Sparkles,
  Target,
  Telescope,
  TestTube,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
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

/** `color` is the bright subject hue (dark surfaces, charts), `ink` reads as text on light, `tint` fills light tiles. */
export const SUBJECTS: Record<SubjectKey, { label: string; color: string; ink: string; tint: string; icon: LucideIcon }> = {
  chemistry: { label: "Chemistry", color: colors.subject.chemistry, ink: colors.subjectInk.chemistry, tint: colors.subjectTint.chemistry, icon: FlaskConical },
  physics: { label: "Physics", color: colors.subject.physics, ink: colors.subjectInk.physics, tint: colors.subjectTint.physics, icon: Orbit },
  maths: { label: "Maths", color: colors.subject.maths, ink: colors.subjectInk.maths, tint: colors.subjectTint.maths, icon: Sigma },
};

export function SubjectChip({ subject, size = "sm" }: { subject: string; size?: "sm" | "md" }) {
  const s = SUBJECTS[subject as SubjectKey];
  if (!s) return null;
  const I = s.icon;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        "bg-card text-[color:var(--sc-ink)] shadow-[inset_0_0_0_1px_var(--sc-ring)]",
        "dark:bg-[color:var(--sc-bg)] dark:text-[color:var(--sc)]",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
      )}
      style={{ "--sc": s.color, "--sc-ink": s.ink, "--sc-bg": `${s.color}1f`, "--sc-ring": `${s.color}66` } as CSSProperties}
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

/** Flat pills. Primary is solid ink (white on dark surfaces); secondary is the soft sand fill. */
const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-ink-strong text-on-ink hover:bg-ink-strong/85",
  secondary: "bg-line text-ink hover:bg-line-strong",
  ghost: "text-ink-muted hover:bg-ink/[0.06] hover:text-ink",
  danger: "bg-[#D93025] text-white hover:bg-[#C5221F]",
  premium: "bg-tint-yellow text-[#2a1600] hover:bg-[#F5BC1C]",
};
const SIZES = { sm: "h-9 px-4 text-sm gap-1.5 rounded-full", md: "h-11 px-5 text-sm gap-2 rounded-full", lg: "h-[52px] px-7 text-base gap-2.5 rounded-full" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, iconRight, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "relative inline-flex select-none items-center justify-center font-medium outline-none transition duration-fast ease-standard",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
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
        // Light: a flat white card, no border, no shadow. Dark surfaces keep the glass card.
        "relative rounded-card bg-card",
        "dark:border dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(26,34,54,.78),rgba(18,24,41,.82))] dark:backdrop-blur-glass",
        "dark:shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_24px_60px_-30px_rgba(0,0,0,.8)]",
        glow && "dark:shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_30px_80px_-40px_var(--card-glow)]",
        className,
      )}
      style={glow ? ({ "--card-glow": glow } as CSSProperties) : undefined}
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
  // Light: pale fill + deep text. Dark surfaces: the translucent glow chips.
  const tones = {
    neutral: "bg-line text-ink ring-transparent dark:bg-white/[0.06] dark:text-white/75 dark:ring-white/10",
    blue: "bg-[#E1EBFF] text-[#1A4FB8] ring-[#C7DAFF] dark:bg-accent/15 dark:text-[#8cbcff] dark:ring-accent/30",
    success: "bg-[#DBF6E5] text-[#11703A] ring-[#B9EBCB] dark:bg-state-success/15 dark:text-[#7ee2a2] dark:ring-state-success/30",
    warning: "bg-[#FDF0CC] text-[#7F5300] ring-[#F6DE9C] dark:bg-state-warning/15 dark:text-[#fcd27b] dark:ring-state-warning/30",
    danger: "bg-[#FDE3E0] text-[#B3261E] ring-[#F8C7C2] dark:bg-state-danger/15 dark:text-[#ff9b9b] dark:ring-state-danger/30",
    violet: "bg-[#EEE7FF] text-[#5B3CC4] ring-[#DACEFF] dark:bg-ai-violet/15 dark:text-[#c4b1ff] dark:ring-ai-violet/30",
    gold: "bg-[#FDF0CC] text-[#7A5200] ring-[#F3D98C] dark:bg-[#ffc23d]/15 dark:text-[#ffd77a] dark:ring-[#ffc23d]/35",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink-muted dark:border-white/15 dark:bg-white/[0.06] dark:text-white/70">{children}</kbd>;
}

/* ------------------------------------------------------------------ progress */

export function ProgressRing({
  value,
  size = 56,
  stroke = 6,
  color = colors.accent.primary,
  track = "rgb(var(--ls-ink) / 0.1)",
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
      <svg width={size} height={size} className="-rotate-90" style={{ "--ls-ring-glow": `${color}80` } as CSSProperties}>
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor={color} stopOpacity=".7" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: track }} strokeWidth={stroke} />
        <motion.circle
          className="ls-ring-glow"
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
    <div className={cx("relative overflow-hidden rounded-full bg-ink/[0.08] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,.5)]", className)} style={{ height }}>
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
      {icon && <div className="grid h-14 w-14 place-items-center rounded-full bg-line text-ink-muted dark:bg-white/[0.05] dark:text-white/60 dark:ring-1 dark:ring-white/10">{icon}</div>}
      <div className="font-heading text-lg font-medium text-ink-strong">{title}</div>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
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
      <div className="font-heading font-medium text-ink-strong">{title}</div>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
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
  // `c` is the bright hue (dark surfaces); `ink` is the readable deep tone for light ones.
  const map = {
    info: { I: Info, c: colors.accent.cyan, ink: "#0E6A80", label: "Note" },
    success: { I: Check, c: colors.state.success, ink: "#11703A", label: "Done" },
    warning: { I: AlertTriangle, c: colors.state.warning, ink: "#8A5200", label: "Heads up" },
    danger: { I: CircleAlert, c: colors.state.danger, ink: "#B3261E", label: "Safety" },
  }[tone];
  return (
    <div
      className="flex gap-3 rounded-lg p-3.5 text-sm text-[color:var(--co-ink)] dark:text-[color:var(--co)]"
      style={{ "--co": map.c, "--co-ink": map.ink, background: `${map.c}17`, boxShadow: `inset 0 0 0 1px ${map.c}45` } as CSSProperties}
    >
      <map.I className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <div className="font-semibold">
          <span className="sr-only">{map.label}: </span>
          {title}
        </div>
        {children && <div className="mt-1 text-ink/80">{children}</div>}
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
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-full bg-card p-1 ring-1 ring-inset ring-line dark:bg-black/25 dark:ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative z-10 whitespace-nowrap rounded-full font-medium transition-colors duration-fast",
            size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
            o.value === value ? "text-on-ink dark:text-white" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 -z-10 rounded-full bg-ink-strong dark:bg-accent/30 dark:shadow-[inset_0_0_0_1px_rgba(110,170,255,.5)]"
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
        checked ? "bg-accent dark:shadow-[0_0_14px_-2px_rgba(47,128,255,.9)]" : "bg-ink/20 dark:bg-white/15",
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
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-center gap-1 text-xs text-[#B3261E] dark:text-[#ff9b9b]">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-ink-muted">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-full border border-line bg-card px-4 text-sm text-ink placeholder:text-ink-faint outline-none transition hover:border-line-strong focus:border-accent/70 focus:shadow-[0_0_0_4px_rgba(47,128,255,.25)] focus-visible:outline-none dark:border-white/10 dark:bg-black/25 dark:text-white dark:placeholder:text-white/35 dark:focus:border-accent/70 dark:focus:bg-black/35";

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
  // The dialog is portalled to <body>, so it would lose a dark surface it was opened from. This
  // in-place marker reads the surface at the call site and the portal carries it over.
  const anchor = useRef<HTMLSpanElement>(null);
  const [surface, setSurface] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (open) setSurface(anchor.current?.closest("[data-surface]")?.getAttribute("data-surface") ?? undefined);
  }, [open]);
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
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4" data-surface={surface}>
          <motion.div
            className="absolute inset-0 bg-[#1a1a1a]/40 backdrop-blur-sm dark:bg-[#03060f]/70"
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
            className="relative w-full overflow-hidden rounded-card bg-card text-ink shadow-pop dark:border dark:border-white/10 dark:bg-[linear-gradient(180deg,#1a2236,#121829)] dark:shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)]"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            {!hideTitle && (
              <div className="flex items-center justify-between border-b border-line px-5 py-4 dark:border-white/[0.06]">
                <h2 className="font-heading text-lg font-medium text-ink-strong">{title}</h2>
                {dismissible && (
                  <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-ink/[0.06] hover:text-ink">
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
      )}
    </>
  );
}

/* ------------------------------------------------------------------ avatar */

export type AvatarSpec = { hue?: number | undefined; emoji?: string | undefined };

/**
 * Avatar emblems. Profiles store the key (an emoji character, kept so saved profiles still match),
 * but the emblem is always drawn as an SVG icon, never as an emoji.
 */
export const AVATAR_EMBLEMS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "🧪", label: "Test tube", Icon: TestTube },
  { key: "⚗️", label: "Flask", Icon: FlaskRound },
  { key: "🔬", label: "Microscope", Icon: Microscope },
  { key: "🧬", label: "DNA", Icon: Dna },
  { key: "🚀", label: "Rocket", Icon: Rocket },
  { key: "⚡", label: "Lightning", Icon: Zap },
  { key: "🌋", label: "Mountain", Icon: Mountain },
  { key: "🪐", label: "Orbit", Icon: Orbit },
  { key: "🧲", label: "Magnet", Icon: Magnet },
  { key: "💡", label: "Light bulb", Icon: Lightbulb },
  { key: "🦉", label: "Bird", Icon: Bird },
];
const EMBLEM = new Map(AVATAR_EMBLEMS.map((e) => [e.key, e.Icon]));

export function Avatar({ name, spec, size = 36, ring }: { name: string; spec?: AvatarSpec | null | undefined; size?: number; ring?: string | undefined }) {
  const hue = spec?.hue ?? [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  // An unknown key falls back to the initials rather than showing a raw emoji.
  const Emblem = spec?.emoji ? EMBLEM.get(spec.emoji) : undefined;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-full font-heading font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `conic-gradient(from 200deg, hsl(${hue} 90% 60%), hsl(${(hue + 60) % 360} 90% 55%), hsl(${(hue + 140) % 360} 85% 55%), hsl(${hue} 90% 60%))`,
        boxShadow: ring ? `0 0 0 2px rgb(var(--ls-surface)), 0 0 0 4px ${ring}` : "inset 0 0 0 1px rgba(255,255,255,.25)",
      }}
      aria-hidden
    >
      {Emblem ? <Emblem style={{ width: size * 0.48, height: size * 0.48 }} strokeWidth={2.25} aria-hidden /> : initials}
    </span>
  );
}

/* ------------------------------------------------------------------ decorative blobs */

type BlobShape = "hex" | "cloud" | "pebble" | "circle";

/** Closed path through polar samples r(θ) in a -1..1 box. */
function polarPath(r: (t: number) => number, steps = 180) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const k = r(t);
    d += `${i ? "L" : "M"}${(Math.cos(t) * k).toFixed(4)} ${(Math.sin(t) * k).toFixed(4)}`;
  }
  return `${d}Z`;
}

/** Regular polygon whose corners are rounded with quadratic curves (`round` = share of each edge). */
function roundedPolygon(sides: number, round: number, rot = 0) {
  const v = Array.from({ length: sides }, (_, i) => {
    const a = rot + (i / sides) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)] as const;
  });
  const lerp = (p: readonly [number, number], q: readonly [number, number], f: number) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  let d = "";
  v.forEach((p, i) => {
    const prev = v[(i - 1 + sides) % sides]!;
    const next = v[(i + 1) % sides]!;
    const a = lerp(p, prev, round);
    const b = lerp(p, next, round);
    d += `${i ? "L" : "M"}${a[0]!.toFixed(4)} ${a[1]!.toFixed(4)}Q${p[0].toFixed(4)} ${p[1].toFixed(4)} ${b[0]!.toFixed(4)} ${b[1]!.toFixed(4)}`;
  });
  return `${d}Z`;
}

const BLOB_PATHS: Record<BlobShape, string> = {
  hex: roundedPolygon(6, 0.28, Math.PI / 6),
  cloud: polarPath((t) => 0.86 + 0.14 * Math.abs(Math.cos(t * 3.5))),
  pebble: polarPath((t) => 0.9 + 0.07 * Math.sin(2 * t + 1) + 0.04 * Math.cos(3 * t)),
  circle: polarPath(() => 1, 96),
};

/** A flat, organic colour shape for page backdrops (decorative only). Parents should clip overflow. */
export function Blob({ shape = "pebble", color, size = 320, rotate = 0, className, style }: { shape?: BlobShape; color: string; size?: number; rotate?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="-1 -1 2 2"
      width={size}
      height={size}
      className={cx("pointer-events-none select-none", className)}
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined, ...style }}
    >
      <path d={BLOB_PATHS[shape]} fill={color} />
    </svg>
  );
}
