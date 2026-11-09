import type { LabEvent } from "@labscape/contracts";
import { SimEvaluator, useSimSession, type GoldenStep, type SimContent, type SimModel, type SimStep, type WorkspaceProps } from "@labscape/physics";
import { Button, Modal } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";

const PREF = "labscape.guideMe.v1";

/** Guide me is on the first time a learner opens a lab; after that it remembers their choice. */
export function useGuidePref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PREF) !== "off";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(PREF, v ? "on" : "off");
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  };
  return [on, set];
}

/**
 * The golden action the learner should do next in this step: the first one that would still change
 * something (the rest are already done). Probes run at the time of the last event, so heating and
 * clocks do not count as a change.
 */
export function nextGoldenAction<S>(content: SimContent, model: SimModel<S>, events: LabEvent[], group: GoldenStep | null): LabEvent | null {
  if (!group) return null;
  const at = events[events.length - 1]?.t ?? 0;
  const base = new SimEvaluator(content, model);
  for (const e of events) base.push(e);
  const before = JSON.stringify(base.state);
  for (const g of group.events) {
    const probe = new SimEvaluator(content, model);
    for (const e of events) probe.push(e);
    probe.push({ ...g, t: at, seq: (events[events.length - 1]?.seq ?? 0) + 1, actor: "user" } as LabEvent);
    if (JSON.stringify(probe.state) !== before) return g;
  }
  return null;
}

/** A terminal's spoken name ("battery B positive terminal") as a short phrase ("the battery's + terminal"). */
function terminalName(el: Element | null): string | null {
  const l = el?.getAttribute("aria-label");
  if (!l) return null;
  const m = /^(\w[\w ]*?) \S+ (positive|negative|end 1|end 2) terminal/.exec(l);
  if (!m) return l.replace(/, selected$/, "");
  const end = m[2] === "positive" ? "+ terminal" : m[2] === "negative" ? "− terminal" : m[2] === "end 1" ? "first terminal" : "second terminal";
  return `the ${m[1]}'s ${end}`;
}

/** One sentence for a wire the learner should draw, from the terminals on screen. */
export function wireSentence(scope: HTMLElement | null, e: LabEvent | null): string | null {
  if (!scope || !e || e.type !== "equipment.connect") return null;
  const p = e.payload as { from: string; to: string };
  const a = terminalName(scope.querySelector(`[data-guide-id="${CSS.escape(p.from)}"]`));
  const b = terminalName(scope.querySelector(`[data-guide-id="${CSS.escape(p.to)}"]`));
  return a && b ? `Drag a wire from ${a} to ${b}.` : null;
}

/**
 * Shrinks a read-only bench to fit its box (down to 60%), so a demo shows the whole bench at once
 * instead of scrolling. It measures once per box size, so the view never jumps while playing.
 */
export function FitBench({ children, className = "" }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // Styles are written straight to the element (not through React) so a re-render never undoes a measure.
  useLayoutEffect(() => {
    const o = outer.current;
    const el = inner.current;
    if (!o || !el) return;
    let last = "";
    const measure = () => {
      const W = o.clientWidth;
      const H = o.clientHeight;
      const key = `${W}x${H}`;
      if (key === last || !W || !H) return;
      last = key;
      // Lay out at full size first; anything that would scroll tells us how much more room it wants.
      Object.assign(el.style, { transform: "none", width: `${W}px`, height: `${H}px` });
      let extra = Math.max(0, el.scrollHeight - H);
      for (const c of el.querySelectorAll<HTMLElement>("div, section, aside")) {
        const over = c.scrollHeight - c.clientHeight;
        if (over > 4 && /(auto|scroll)/.test(getComputedStyle(c).overflowY)) extra = Math.max(extra, over);
      }
      const s = Math.max(0.6, Math.min(1, H / (H + extra)));
      Object.assign(el.style, { width: `${W / s}px`, height: `${H / s}px`, transform: s < 1 ? `scale(${s})` : "none", transformOrigin: "0 0" });
    };
    const t = window.setTimeout(measure, 80);
    const ro = new ResizeObserver(() => measure());
    ro.observe(o);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={outer} className={`relative h-full min-h-0 overflow-hidden ${className}`}>
      <div ref={inner} className="absolute left-0 top-0 h-full w-full overflow-hidden">
        {children}
      </div>
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };

const INTERACTIVE = 'input:not([disabled]), select:not([disabled]), button:not([disabled]), [role="slider"]:not([aria-disabled="true"]), [role="button"]:not([aria-disabled="true"]), [role="switch"]';

/** Screen box of a guide target. Pulses animate (scale), so measure their resting shape instead. */
function boxOf(el: Element): DOMRect {
  if (el instanceof SVGGElement && el.firstElementChild instanceof SVGGraphicsElement) {
    const child = el.firstElementChild;
    const bb = child.getBBox();
    const m = el.getScreenCTM();
    if (m) {
      const p1 = new DOMPoint(bb.x, bb.y).matrixTransform(m);
      const p2 = new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(m);
      return new DOMRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    }
  }
  return el.getBoundingClientRect();
}

/** The exact thing to use next: a pulsing handle on the bench, else the first control in the glowing panel. */
export function findGuideTarget(scope: HTMLElement, next: LabEvent | null): { main: Element; then: Element | null } | null {
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  // A wire: start at its first terminal, and show where it goes.
  if (next?.type === "equipment.connect") {
    const p = next.payload as { from: string; to: string };
    const a = scope.querySelector(`[data-guide-id="${CSS.escape(p.from)}"]`);
    const b = scope.querySelector(`[data-guide-id="${CSS.escape(p.to)}"]`);
    if (a && visible(a)) return { main: a, then: b && visible(b) ? b : null };
  }
  const pulse = [...scope.querySelectorAll('[data-guide="target"]')].find(visible);
  if (pulse) return { main: pulse, then: null };
  // A setting: the slider that sets that key.
  if (next?.type === "param.set") {
    const p = next.payload as { key: string; value: unknown };
    for (const id of [`param:${p.key}=${String(p.value)}`, `param:${p.key}`]) {
      const el = scope.querySelector(`[data-guide-id="${CSS.escape(id)}"]`);
      if (el && visible(el) && !(el as HTMLInputElement).disabled) return { main: el, then: null };
    }
  }
  const panel = [...scope.querySelectorAll('[data-guide="panel"]')].find(visible);
  if (!panel) return null;
  const controls = [...panel.querySelectorAll(INTERACTIVE)].filter(visible);
  // An empty box to fill comes first (a reading, an answer), then the first button.
  const empty = controls.find((c) => c instanceof HTMLInputElement && c.type !== "range" && c.type !== "checkbox" && c.value === "");
  return { main: empty ?? controls[0] ?? panel, then: null };
}

/**
 * Guide me: a ring and a bouncing arrow on the control to use next. It follows the target as the
 * bench scrolls or animates, and brings it into view once per step.
 */
export function GuideArrow({ rootRef, scopeRef, active, stepKey, reduced, next }: { rootRef: RefObject<HTMLElement>; scopeRef: RefObject<HTMLElement>; active: boolean; stepKey: string | null; reduced: boolean; next: LabEvent | null }) {
  const [box, setBox] = useState<Box | null>(null);
  const [then, setThen] = useState<Box | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!active) {
      setBox(null);
      setThen(null);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 120) return;
      last = now;
      const root = rootRef.current;
      const scope = scopeRef.current;
      if (!root || !scope) return;
      const found = findGuideTarget(scope, nextRef.current);
      if (!found) return setBox((b) => (b ? null : b));
      const target = found.main;
      const R = root.getBoundingClientRect();
      const T = boxOf(target);
      const U = found.then ? boxOf(found.then) : null;
      const nu = U ? { x: U.left - R.left, y: U.top - R.top, w: U.width, h: U.height } : null;
      setThen((b) => (nu && b && Math.abs(b.x - nu.x) < 1.5 && Math.abs(b.y - nu.y) < 1.5 ? b : nu));
      if (scrolledFor.current !== stepKey) {
        scrolledFor.current = stepKey;
        const off = T.bottom < R.top + 40 || T.top > R.bottom - 40;
        if (off) target.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
      }
      // Hidden by scrolling: say nothing rather than point at the wrong place.
      if (T.bottom < R.top + 8 || T.top > R.bottom - 8 || T.right < R.left || T.left > R.right) return setBox((b) => (b ? null : b));
      const next = { x: T.left - R.left, y: T.top - R.top, w: T.width, h: T.height };
      setBox((b) => (b && Math.abs(b.x - next.x) < 1.5 && Math.abs(b.y - next.y) < 1.5 && Math.abs(b.w - next.w) < 1.5 && Math.abs(b.h - next.h) < 1.5 ? b : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, rootRef, scopeRef, stepKey, reduced]);

  const pad = 6;
  // Point from the left where there is room (labels above a box stay readable), else from above or below.
  const side: "left" | "above" | "below" = !box ? "above" : box.x > 56 ? "left" : box.y > 70 ? "above" : "below";
  const arrowAt = !box ? { left: 0, top: 0 } : side === "left" ? { left: box.x - pad - 44, top: box.y + box.h / 2 - 20 } : side === "above" ? { left: box.x + box.w / 2 - 18, top: box.y - pad - 46 } : { left: box.x + box.w / 2 - 18, top: box.y + box.h + pad + 6 };
  const bob = side === "left" ? { x: [0, 7, 0] } : side === "above" ? { y: [0, 7, 0] } : { y: [0, -7, 0] };
  return (
    <AnimatePresence>
      {box && (
        <motion.div key="guide" className="pointer-events-none absolute inset-0 z-20 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} aria-hidden>
          <motion.div
            initial={false}
            className="absolute rounded-xl ring-[3px] ring-[#ffd77a] shadow-[0_0_0_6px_rgba(255,215,122,.18),0_0_30px_rgba(255,215,122,.35)]"
            animate={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
          />
          {then && (
            <>
              <svg className="absolute inset-0 h-full w-full overflow-visible">
                <line x1={box.x + box.w / 2} y1={box.y + box.h / 2} x2={then.x + then.w / 2} y2={then.y + then.h / 2} stroke="#ffd77a" strokeWidth={2.5} strokeDasharray="7 6" strokeLinecap="round" opacity={0.85} className={reduced ? "" : "ls-guide-dash"} />
              </svg>
              <motion.div initial={false} className="absolute rounded-full border-2 border-dashed border-[#ffd77a]/90" animate={{ left: then.x - pad, top: then.y - pad, width: then.w + pad * 2, height: then.h + pad * 2 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }} />
              <style>{"@keyframes lsGuideDash{to{stroke-dashoffset:-26}}.ls-guide-dash{animation:lsGuideDash .9s linear infinite}"}</style>
            </>
          )}
          <motion.div initial={false} className="absolute" animate={arrowAt} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}>
            <motion.svg viewBox="0 0 36 40" className="h-10 w-9 drop-shadow-[0_4px_8px_rgba(0,0,0,.6)]" animate={reduced ? {} : bob} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} style={{ rotate: side === "left" ? -90 : side === "above" ? 0 : 180 }}>
              <path d="M12 2 H24 V20 H33 L18 38 L3 20 H12 Z" fill="#ffd77a" stroke="#3a2a00" strokeWidth="2" strokeLinejoin="round" />
            </motion.svg>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Show me: plays just this step's slice of the demo (with the demo's ghost hand) in a dialog,
 * then stops. It runs its own demo session, so the learner's attempt is untouched.
 */
export function StepReplay({ content, model, Workspace, step, group, onClose }: { content: SimContent; model: SimModel<unknown>; Workspace: ComponentType<WorkspaceProps>; step: SimStep; group: GoldenStep; onClose: () => void }) {
  const session = useSimSession(content, model, { mode: "demo", autoplay: false, speed: 1 });
  const d = session.demo;
  const from = Math.max(0, group.start - 1600);
  const to = Math.min(d.duration, group.end + 1400);
  const startRef = useRef(d);
  startRef.current = d;
  const play = () => {
    startRef.current.seek(from);
    startRef.current.setPlaying(true);
  };
  useEffect(() => {
    const t = window.setTimeout(play, 250);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (d.playing && d.t >= to) d.setPlaying(false);
  }, [d, to]);
  const caps = content.golden.captions.filter((c) => c.t <= Math.max(d.t, from));
  const caption = caps[caps.length - 1] ?? null;
  const done = !d.playing && d.t >= to - 50;
  const pct = Math.max(0, Math.min(1, (d.t - from) / Math.max(1, to - from)));
  return (
    <Modal open onClose={onClose} title={`Show me: ${step.title}`} width={980}>
      <div className="flex max-h-[min(82vh,760px)] flex-col">
        <div className="h-[min(56vh,540px)] p-3">
          <FitBench className="pointer-events-none [&_*]:pointer-events-none">
            <Workspace session={session} />
          </FitBench>
        </div>
        <div className="min-h-[64px] border-t border-white/[0.07] bg-black/40 px-4 py-2.5" aria-live="polite">
          <p className="text-[15px] font-semibold text-white">{caption?.text ?? step.instruction}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] px-4 py-3">
          <Button size="sm" variant="secondary" icon={done ? <RotateCcw className="h-4 w-4" /> : d.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => (done ? play() : d.setPlaying(!d.playing))}>
            {done ? "Watch again" : d.playing ? "Pause" : "Play"}
          </Button>
          <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Replay progress">
            <div className="h-full rounded-full bg-[#ffd77a] transition-[width] duration-150" style={{ width: `${pct * 100}%` }} />
          </div>
          <Button size="sm" onClick={onClose}>
            My turn
          </Button>
        </div>
      </div>
    </Modal>
  );
}
