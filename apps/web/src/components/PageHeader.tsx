import { cx } from "@labscape/ui";
import type { ReactNode } from "react";

/** Page title block for the light pages: small eyebrow, large light-weight title, muted subtitle. */
export function PageHeader({
  eyebrow,
  title,
  sub,
  aside,
  center,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("mb-8 flex flex-wrap gap-4", center ? "flex-col items-center text-center" : "items-end justify-between", className)}>
      <div className={cx("min-w-0", center && "max-w-2xl")}>
        {eyebrow && <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</div>}
        <h1 className="font-heading text-[38px] font-normal leading-[1.05] tracking-[-0.03em] text-ink-strong sm:text-[52px]">{title}</h1>
        {sub && <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Card heading used inside the light pages. */
export function CardTitle({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <h2 className={cx("flex items-center gap-2.5 font-heading text-xl font-medium tracking-[-0.01em] text-ink-strong", className)}>
      {icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface">{icon}</span>}
      {children}
    </h2>
  );
}
