import { cx } from "@labscape/ui";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

/**
 * The lab studio's visual language (docs/design/lab-concept-v3.html): deep navy glass panels with a
 * soft top highlight, Sora headings, Inter body, JetBrains Mono for numbers, blue #3d8bff primary.
 * Shared by the experiment bench and the open playground so both feel like one product.
 */
export const GLASS =
  "border border-[rgba(140,180,255,.16)] bg-[linear-gradient(180deg,rgba(14,26,56,.78),rgba(8,16,38,.84))] backdrop-blur-[20px] backdrop-saturate-[1.3] shadow-[inset_0_1px_0_rgba(200,220,255,.10),0_24px_60px_-24px_rgba(0,0,0,.8)]";

export const Glass = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { radius?: "md" | "lg" | "xl" }>(function Glass({ className, radius = "lg", ...rest }, ref) {
  return <div ref={ref} className={cx(GLASS, radius === "md" ? "rounded-[14px]" : radius === "lg" ? "rounded-[18px]" : "rounded-[22px]", "text-[#e8f0ff]", className)} {...rest} />;
});

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8fa6d1]", className)}>{children}</div>;
}

/** Segmented control (speed, tabs). */
export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-xl border border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.55)] p-[3px]">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "flex-1 rounded-[9px] font-semibold transition-colors",
            size === "sm" ? "h-8 px-2 text-[13px]" : "h-9 px-2.5 text-[14px]",
            value === o.id ? "bg-[rgba(61,139,255,.3)] text-white shadow-[inset_0_0_0_1px_#6aa8ff]" : "text-[#a9bde4] hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A tool in the bottom dock: icon over label, 74 x 54. */
export const DockButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string; tone?: "default" | "on" | "hot" | "danger"; kbd?: string | undefined }>(function DockButton(
  { icon, label, tone = "default", kbd, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        "relative flex h-[52px] min-w-[46px] shrink-0 select-none flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[11px] font-semibold whitespace-nowrap sm:h-[56px] sm:min-w-[72px] sm:rounded-[14px] sm:px-1.5 sm:text-[13px] transition-[color,background-color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-35",
        tone === "on" && "bg-[rgba(61,139,255,.28)] text-white shadow-[inset_0_0_0_1px_rgba(110,170,255,.55)]",
        tone === "hot" && "bg-[rgba(255,138,61,.18)] text-[#ffd59a] shadow-[inset_0_0_0_1px_rgba(255,160,90,.5)]",
        tone === "danger" && "text-[#ff9b9b] hover:bg-[rgba(255,91,107,.12)]",
        tone === "default" && "text-[#a9bde4] hover:bg-white/[0.05] hover:text-white active:bg-[rgba(61,139,255,.28)]",
        className,
      )}
      aria-keyshortcuts={kbd}
      {...rest}
      title={rest.title ?? (kbd ? `${label} (${kbd})` : undefined)}
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      {label}
      {/* Keyboard hint: a small superscript in the corner, single keys only, hidden on narrow screens. */}
      {kbd && kbd.length <= 2 && <span className="pointer-events-none absolute right-1 top-0.5 hidden rounded px-1 text-[10px] font-semibold leading-4 text-white/40 md:block">{kbd}</span>}
    </button>
  );
});

export function DockSeparator() {
  return <span className="mx-0 h-9 w-px shrink-0 bg-[rgba(140,180,255,.16)] sm:mx-1" aria-hidden />;
}

/** The round tilt gauge from the pour card: a conic arc filled to the tilt angle. */
export function TiltGauge({ deg, max = 120, size = 70 }: { deg: number; max?: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, deg / max));
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(from 180deg, #3de8a8, #39d6ff ${pct * 70}%, #3d8bff ${pct * 100}%, rgba(255,255,255,.08) ${pct * 100}% 100%)` }}
      role="meter"
      aria-label="Tilt"
      aria-valuenow={Math.round(deg)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span className="absolute inset-[7px] rounded-full bg-[#0c1734]" />
      <b className="relative font-heading text-[17px] tabular-nums">{Math.round(deg)}°</b>
    </div>
  );
}

/** A big glass readout ("Temperature 31.6°"). */
export function Readout({ label, value, unit, delta, tone }: { label: string; value: string; unit?: string; delta?: string | null; tone?: "up" | "down" | "ok" }) {
  return (
    <Glass radius="md" className="min-w-[118px] px-3 py-2">
      <div className="text-[12px] font-semibold text-[#8fa6d1]">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <b className="font-heading text-[22px] tabular-nums tracking-tight">
          {value}
          {unit && <span className="ml-0.5 text-[15px] text-[#c8d6f3]">{unit}</span>}
        </b>
        {delta && <span className={cx("text-[12px] font-semibold", tone === "up" ? "text-[#ffb36b]" : tone === "down" ? "text-[#7cc4ff]" : "text-[#3de8a8]")}>{delta}</span>}
      </div>
    </Glass>
  );
}

/** Small square icon button used inside cards. */
export const SquareButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function SquareButton({ className, ...rest }, ref) {
  return <button ref={ref} type="button" className={cx("grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] border border-[rgba(140,180,255,.16)] bg-[rgba(120,160,255,.10)] text-white hover:bg-[rgba(120,160,255,.18)] disabled:opacity-40", className)} {...rest} />;
});

export function PrimaryButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#6aa8ff] bg-[linear-gradient(180deg,#3d8bff,#1d5fe0)] px-3.5 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(61,139,255,.9),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110 disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}

export function GhostButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cx("inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[rgba(140,180,255,.16)] bg-[rgba(120,160,255,.10)] px-3.5 text-[14px] font-semibold text-[#dbe7ff] transition hover:bg-[rgba(120,160,255,.18)] disabled:opacity-40", className)} {...rest} />;
}
