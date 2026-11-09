import { ChevronDown, Lightbulb, MessageCircle } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Beginner explainers shared by the sandboxes: a collapsible "what am I looking at?" card and a
 * live narration line that says, in plain words, what is happening right now.
 */

export type GuideItem = { term: string; text: ReactNode };

/** Collapsible guide. Remembers per page whether it was closed (per browser). */
export function GuideCard({ id, title = "New here? What am I looking at?", items, children, defaultOpen = true }: { id: string; title?: string; items: GuideItem[]; children?: ReactNode; defaultOpen?: boolean }) {
  const key = `ls-guide:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* storage blocked: still toggles */
      }
      return !o;
    });
  return (
    <section className="rounded-[16px] border border-[rgba(255,214,102,.28)] bg-[rgba(255,214,102,.06)]">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-semibold text-[#ffe3a3]">
        <Lightbulb className="h-4 w-4 shrink-0" />
        <span className="flex-1">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 px-3.5 pb-3 text-[13px] leading-snug text-white/75">
          <dl className="space-y-1.5">
            {items.map((it) => (
              <div key={it.term}>
                <dt className="inline font-semibold text-white">{it.term}: </dt>
                <dd className="inline">{it.text}</dd>
              </div>
            ))}
          </dl>
          {children}
        </div>
      )}
    </section>
  );
}

/** One live sentence about what is happening now. */
export function Narration({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "good" | "warn" }) {
  const c = tone === "good" ? "border-[#3de8a8]/35 bg-[#3de8a8]/10" : tone === "warn" ? "border-[#ffc23d]/40 bg-[#ffc23d]/10" : "border-[#5fd4ff]/30 bg-[#5fd4ff]/[0.08]";
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm text-white/85 ${c}`} role="status" aria-live="polite">
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#7cf3ff]" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small explanatory line under a control. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] leading-snug text-white/50">{children}</p>;
}
