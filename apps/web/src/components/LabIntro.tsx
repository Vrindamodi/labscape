import { sound } from "@labscape/audio";
import { celebrate, useMotion } from "@labscape/motion";
import { Button, cx } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, Hand, RotateCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Onboarding step 6: a scripted mini experiment with coach marks.
 * Pour water, add 3 drops of dye, swirl, read the observation panel, ask the AI one question.
 * A dark overlay with a spotlight cut-out morphs between targets; a ghost hand demonstrates
 * each move twice. Reduced motion: the spotlight jumps and there is no hand.
 */

type Phase = "pour" | "drops" | "swirl" | "observe" | "ask" | "done";
const ORDER: Phase[] = ["pour", "drops", "swirl", "observe", "ask", "done"];

const COPY: Record<Phase, { title: string; body: string }> = {
  pour: { title: "Pour the water", body: "Press and hold the bottle to tip it. Fill the beaker to the 100 mL line." },
  drops: { title: "Add 3 drops of dye", body: "Tap the dropper three times. Watch where each drop goes." },
  swirl: { title: "Swirl the beaker", body: "Drag the beaker in a little circle, or hold the swirl button." },
  observe: { title: "Read your observations", body: "Every experiment ends here: what you saw, and why it happened." },
  ask: { title: "Ask the assistant one question", body: "Pick a question. The AI assistant explains in your level's words." },
  done: { title: "", body: "" },
};

const QUESTIONS = [
  {
    q: "Why did the dye spread out?",
    a: "Water molecules are always moving and bumping into the dye particles. Those random bumps push the dye from where there's a lot of it to where there's less, until it's even. That's diffusion.",
  },
  {
    q: "Why does swirling make it faster?",
    a: "Swirling carries whole chunks of dyed water around the beaker (convection), so the dye doesn't have to rely only on slow molecule-by-molecule diffusion.",
  },
  {
    q: "Would hot water change anything?",
    a: "Yes. Hotter molecules move faster, so the dye spreads quicker. Try it later in the Playground with the burner on.",
  },
];

export function LabIntro({ onFinish }: { onFinish: () => void | Promise<void> }) {
  const { reduced } = useMotion();
  const [phase, setPhase] = useState<Phase>("pour");
  const [level, setLevel] = useState(0); // mL of water
  const [pouring, setPouring] = useState(false);
  const [drops, setDrops] = useState<number[]>([]);
  const [mix, setMix] = useState(0); // 0 = streaks, 1 = uniform
  const [swirlAngle, setSwirlAngle] = useState(0);
  const [asked, setAsked] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [finishing, setFinishing] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const targets = {
    pour: useRef<HTMLDivElement>(null),
    drops: useRef<HTMLDivElement>(null),
    swirl: useRef<HTMLDivElement>(null),
    observe: useRef<HTMLDivElement>(null),
    ask: useRef<HTMLDivElement>(null),
  };
  const [hole, setHole] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const measure = useCallback(() => {
    if (phase === "done") return;
    const el = targets[phase].current;
    const box = stage.current?.getBoundingClientRect();
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    setHole({ x: r.left - box.left - 10, y: r.top - box.top - 10, w: r.width + 20, h: r.height + 20 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useLayoutEffect(() => {
    measure();
    const t = window.setTimeout(measure, 450);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const advance = useCallback((p: Phase) => {
    sound.play("success");
    window.setTimeout(() => setPhase(ORDER[ORDER.indexOf(p) + 1] ?? "done"), 500);
  }, []);

  // pouring: interval-driven so it keeps running even if the tab throttles RAF
  useEffect(() => {
    if (!pouring || phase !== "pour") return;
    const id = window.setInterval(() => {
      setLevel((l) => {
        const n = Math.min(110, l + 2.2);
        if (l < 100 && n >= 100) {
          setPouring(false);
          advance("pour");
        }
        return n;
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [pouring, phase, advance]);

  const addDrop = () => {
    if (phase !== "drops" || drops.length >= 3) return;
    sound.play("click");
    sound.haptic("tick");
    const n = [...drops, Date.now()];
    setDrops(n);
    if (n.length === 3) advance("drops");
  };

  const swirlBy = (amount: number) => {
    if (phase !== "swirl") return;
    setSwirlAngle((a) => a + amount * 8);
    setMix((m) => {
      const n = Math.min(1, m + amount * 0.012);
      if (m < 1 && n >= 1) advance("swirl");
      return n;
    });
  };

  // hold-to-swirl button
  const [holdSwirl, setHoldSwirl] = useState(false);
  useEffect(() => {
    if (!holdSwirl) return;
    const id = window.setInterval(() => swirlBy(3), 40);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdSwirl, phase]);

  // drag in circles on the beaker
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const onBeakerMove = (e: React.PointerEvent) => {
    if (phase !== "swirl" || e.buttons !== 1) return;
    const p = { x: e.clientX, y: e.clientY };
    if (lastPt.current) swirlBy(Math.min(6, Math.hypot(p.x - lastPt.current.x, p.y - lastPt.current.y) / 6));
    lastPt.current = p;
  };

  useEffect(() => {
    if (asked === null) return;
    const full = QUESTIONS[asked]?.a ?? "";
    if (reduced) {
      setTyped(full);
      return;
    }
    let i = 0;
    setTyped("");
    const id = window.setInterval(() => {
      i += 2;
      setTyped(full.slice(0, i));
      if (i >= full.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [asked, reduced]);

  const fillPct = Math.min(level, 110) / 140;
  const dyed = drops.length > 0;
  const tint = `rgba(${Math.round(70 + 70 * (1 - mix))}, ${Math.round(110 - 40 * mix)}, 255, ${0.25 + drops.length * 0.15})`;

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Your first experiment</div>
        <h1 className="mt-2 font-heading text-[34px] font-normal leading-tight tracking-[-0.02em] text-ink-strong sm:text-[48px]">Welcome to the lab bench</h1>
      </div>
      {/* The bench is a lab visual drawn for dark: it stays a dark card on the light onboarding page. */}
      <div ref={stage} data-surface="dark" className="relative grid gap-4 overflow-hidden rounded-panel bg-[linear-gradient(180deg,#121a30,#0c1224)] p-4 text-white sm:p-6 lg:grid-cols-[1fr_300px]">
        {/* bench */}
        <div className="relative h-[380px] overflow-hidden rounded-xl bg-[radial-gradient(500px_260px_at_50%_100%,rgba(47,128,255,.18),transparent),linear-gradient(180deg,#16213d,#0f172e)] sm:h-[420px]">
          <div className="absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,#1d2a4a,#141d36)] shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" />

          {/* water bottle */}
          <div
            ref={targets.pour}
            className="absolute bottom-16 left-[8%] h-[200px] w-[110px] cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={() => phase === "pour" && setPouring(true)}
            onPointerUp={() => setPouring(false)}
            onPointerLeave={() => setPouring(false)}
            onKeyDown={(e) => e.key === " " && phase === "pour" && setPouring(true)}
            onKeyUp={() => setPouring(false)}
            role="button"
            tabIndex={0}
            aria-label="Water bottle: press and hold to pour"
          >
            <motion.svg
              viewBox="0 0 110 200"
              className="h-full w-full"
              animate={{ rotate: pouring ? 62 : 0, x: pouring ? 70 : 0, y: pouring ? -60 : 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              style={{ transformOrigin: "55px 120px" }}
            >
              <rect x="40" y="6" width="30" height="20" rx="4" fill="#2f80ff" />
              <path d="M30 40 Q30 26 44 26 H66 Q80 26 80 40 V180 Q80 192 68 192 H42 Q30 192 30 180 Z" fill="rgba(160,200,255,.12)" stroke="rgba(220,235,255,.7)" strokeWidth="2" />
              <path d="M32 70 H78 V180 Q78 190 68 190 H42 Q32 190 32 180 Z" fill="rgba(120,180,255,.45)" />
              <rect x="38" y="104" width="34" height="34" rx="4" fill="#f8fbff" />
              <text x="55" y="126" textAnchor="middle" fontFamily="Inter" fontWeight="800" fontSize="12" fill="#0f172a">H₂O</text>
              <rect x="35" y="44" width="5" height="130" rx="2.5" fill="#fff" opacity=".45" />
            </motion.svg>
          </div>
          {/* stream */}
          <AnimatePresence>
            {pouring && (
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                exit={{ scaleY: 0, opacity: 0 }}
                className="absolute left-[calc(8%+150px)] top-[96px] w-[6px] origin-top rounded-full bg-gradient-to-b from-[#bfe0ff] to-[#7fb6ff]"
                style={{ height: 150 - fillPct * 120, boxShadow: "0 0 10px rgba(127,182,255,.8)" }}
              />
            )}
          </AnimatePresence>

          {/* beaker */}
          <div
            ref={targets.swirl}
            className="absolute bottom-16 left-1/2 h-[220px] w-[180px] -translate-x-1/2 touch-none"
            onPointerDown={(e) => {
              lastPt.current = { x: e.clientX, y: e.clientY };
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={onBeakerMove}
            onPointerUp={() => (lastPt.current = null)}
          >
            <motion.svg viewBox="0 0 180 220" className="h-full w-full" animate={{ rotate: phase === "swirl" ? Math.sin(swirlAngle / 30) * 4 : 0 }}>
              <defs>
                <clipPath id="li-clip">
                  <path d="M24 20 V196 Q24 212 40 212 H140 Q156 212 156 196 V20 Z" />
                </clipPath>
                <radialGradient id="li-dye" cx=".5" cy=".3" r=".6">
                  <stop offset="0" stopColor="#8b5cf6" stopOpacity=".95" />
                  <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                </radialGradient>
              </defs>
              <g clipPath="url(#li-clip)">
                <motion.rect x="0" width="180" initial={false} animate={{ y: 212 - fillPct * 230, height: fillPct * 230 + 10 }} transition={{ duration: 0.1 }} fill={dyed ? tint : "rgba(120,180,255,.35)"} />
                {/* dye streaks before mixing */}
                {drops.map((t, i) => (
                  <motion.ellipse
                    key={t}
                    cx={70 + i * 22}
                    initial={{ cy: 20, rx: 4, ry: 4, opacity: 1 }}
                    animate={{ cy: 212 - fillPct * 230 + 40 + i * 10, rx: 30 + mix * 60, ry: 40 + mix * 70, opacity: 1 - mix }}
                    transition={{ duration: reduced ? 0 : 1.6, ease: [0.2, 0, 0, 1] }}
                    fill="url(#li-dye)"
                  />
                ))}
                {level > 0 && <motion.ellipse cx="90" initial={false} animate={{ cy: 212 - fillPct * 230 }} rx="66" ry="5" fill="rgba(255,255,255,.35)" />}
              </g>
              <path d="M18 14 H162 M24 14 V196 Q24 212 40 212 H140 Q156 212 156 196 V14" fill="none" stroke="rgba(220,235,255,.8)" strokeWidth="3" strokeLinecap="round" />
              {[40, 80, 120, 160].map((y, i) => (
                <g key={y}>
                  <line x1="132" x2="150" y1={212 - y} y2={212 - y} stroke="rgba(220,235,255,.5)" strokeWidth="1.5" />
                  <text x="128" y={215 - y} textAnchor="end" fontSize="9" fill="rgba(220,235,255,.6)" fontFamily="JetBrains Mono">{(i + 1) * 25}</text>
                </g>
              ))}
              <rect x="32" y="30" width="7" height="160" rx="3.5" fill="#fff" opacity=".2" />
            </motion.svg>
            <div className="tabular absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-white/60">{Math.round(Math.min(level, 110))} mL</div>
          </div>

          {/* dropper */}
          <div ref={targets.drops} className="absolute right-[8%] top-10 flex flex-col items-center gap-2">
            <motion.button
              onClick={addDrop}
              whileTap={{ scale: 0.92, y: 6 }}
              className="relative h-[150px] w-[60px] touch-none"
              aria-label={`Dye dropper: tap to add a drop (${drops.length} of 3)`}
            >
              <svg viewBox="0 0 60 150" className="h-full w-full">
                <rect x="18" y="4" width="24" height="36" rx="10" fill="#e879f9" />
                <path d="M24 40 H36 V120 L30 146 L24 120 Z" fill="rgba(200,220,255,.18)" stroke="rgba(230,240,255,.8)" strokeWidth="1.5" />
                <path d="M25 90 H35 V120 L30 140 L25 120 Z" fill="#8b5cf6" />
              </svg>
            </motion.button>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className={cx("h-2.5 w-2.5 rounded-full transition", i < drops.length ? "bg-ai-violet shadow-[0_0_8px_#8b5cf6]" : "bg-white/15")} />
              ))}
            </div>
          </div>
          {phase === "swirl" && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Button
                size="sm"
                variant="secondary"
                icon={<RotateCw className="h-4 w-4" />}
                onPointerDown={() => setHoldSwirl(true)}
                onPointerUp={() => setHoldSwirl(false)}
                onPointerLeave={() => setHoldSwirl(false)}
              >
                Hold to swirl
              </Button>
            </div>
          )}
        </div>

        {/* side: observation + assistant */}
        <div className="flex flex-col gap-3">
          <div ref={targets.observe} className={cx("rounded-xl border p-4 transition", ORDER.indexOf(phase) >= 3 ? "border-accent-cyan/40 bg-accent-cyan/[0.07]" : "border-white/10 bg-white/[0.03] opacity-50")}>
            <div className="flex items-center gap-2 text-sm font-semibold text-accent-cyan">
              <Eye className="h-4 w-4" /> Observations
            </div>
            {ORDER.indexOf(phase) >= 3 ? (
              <ul className="mt-2 space-y-1.5 text-sm text-white/75">
                <li>• Each drop sank and spread out in purple streaks.</li>
                <li>• Swirling mixed it to one even colour.</li>
                <li className="text-white/55">Concept: <b className="text-white">diffusion</b> and <b className="text-white">convection</b>.</li>
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/45">Finish the steps to see what happened.</p>
            )}
            {phase === "observe" && (
              <Button size="sm" className="mt-3" onClick={() => advance("observe")}>
                Got it
              </Button>
            )}
          </div>
          <div ref={targets.ask} className={cx("rounded-xl border p-4 transition", ORDER.indexOf(phase) >= 4 ? "border-ai-violet/40 bg-ai-violet/[0.08]" : "border-white/10 bg-white/[0.03] opacity-50")}>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#c4b1ff]">
              <span className="ls-orb h-5 w-5 rounded-full" /> AI assistant
            </div>
            <div className="mt-2 space-y-1.5">
              {QUESTIONS.map((q, i) => (
                <button
                  key={q.q}
                  disabled={phase !== "ask" && asked === null}
                  onClick={() => {
                    setAsked(i);
                    sound.play("open");
                    if (phase === "ask") window.setTimeout(() => advance("ask"), reduced ? 300 : 2600);
                  }}
                  className={cx("block w-full rounded-md px-3 py-2 text-left text-sm transition", asked === i ? "bg-ai-violet/30 text-white" : "bg-white/[0.05] text-white/75 hover:bg-white/[0.09] disabled:opacity-50")}
                >
                  {q.q}
                </button>
              ))}
            </div>
            {asked !== null && <p className="mt-3 text-sm leading-relaxed text-white/80">{typed}</p>}
          </div>
          {phase === "done" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Button
                block
                size="lg"
                loading={finishing}
                icon={<Sparkles className="h-5 w-5" />}
                onClick={async () => {
                  setFinishing(true);
                  celebrate({ preset: "confetti", count: 60 });
                  await onFinish();
                }}
              >
                Enter LABscape
              </Button>
            </motion.div>
          )}
        </div>

        {/* coach-mark overlay with a morphing spotlight */}
        {phase !== "done" && (
          <>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <mask id="li-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <motion.rect
                    rx="16"
                    fill="black"
                    initial={false}
                    animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }}
                  />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(3,6,15,.62)" mask="url(#li-mask)" />
              <motion.rect
                rx="16"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                initial={false}
                animate={{ x: hole.x, y: hole.y, width: hole.w, height: hole.h }}
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }}
                style={{ filter: "drop-shadow(0 0 8px #22d3ee)" }}
              />
            </svg>
            <motion.div
              key={`tip-${phase}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-accent-cyan/40 bg-[#0f1830]/95 p-3 shadow-xl"
              style={{
                left: Math.max(8, Math.min(hole.x, (stage.current?.clientWidth ?? 600) - 276)),
                top: hole.y + hole.h + 10 > (stage.current?.clientHeight ?? 500) - 90 ? Math.max(8, hole.y - 96) : hole.y + hole.h + 10,
              }}
              role="status"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-accent-cyan">
                <span className="tabular grid h-5 w-5 place-items-center rounded-full bg-accent-cyan text-[11px] font-bold text-[#06101f]">{ORDER.indexOf(phase) + 1}</span>
                {COPY[phase].title}
              </div>
              <p className="mt-1 text-xs text-white/70">{COPY[phase].body}</p>
            </motion.div>
            {!reduced && (phase === "pour" || phase === "drops") && <GhostHand key={`hand-${phase}`} x={hole.x + hole.w / 2} y={hole.y + hole.h * 0.55} press={phase === "pour"} />}
          </>
        )}
      </div>
    </div>
  );
}

/** Demonstrates the move twice, then fades out. */
function GhostHand({ x, y, press }: { x: number; y: number; press: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 text-white drop-shadow-[0_0_10px_rgba(255,255,255,.6)]"
      initial={{ left: x + 60, top: y + 60, opacity: 0 }}
      animate={{
        left: [x + 60, x, x, x + 60, x, x, x + 60],
        top: [y + 60, y, y, y + 60, y, y, y + 60],
        opacity: [0, 1, 1, 1, 1, 1, 0],
        scale: [1, 1, press ? 0.85 : 0.8, 1, 1, press ? 0.85 : 0.8, 1],
      }}
      transition={{ duration: 2.4, times: [0, 0.15, 0.4, 0.5, 0.65, 0.9, 1], delay: 0.6 }}
    >
      <Hand className="h-9 w-9 -rotate-12 fill-white/20" />
    </motion.div>
  );
}
