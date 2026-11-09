import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Check, Lightbulb, Play, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { ANIMS, SceneArt } from "./SceneArt";
import { ToolIcon } from "./ToolIcon";
import type { Hotspot, Kind, ScenarioResult, Step, Tool } from "./types";

const QUALITY: Record<Step["quality"], { label: string; cls: string; ring: string }> = {
  best: { label: "Right", cls: "bg-emerald-400/20 text-emerald-200", ring: "#51cf66" },
  ok: { label: "Safe, not best", cls: "bg-sky-400/20 text-sky-200", ring: "#4dabf7" },
  poor: { label: "Could be better", cls: "bg-amber-400/20 text-amber-200", ring: "#fcc419" },
  unsafe: { label: "Unsafe", cls: "bg-red-500/25 text-red-200", ring: "#ff6b6b" },
};

/**
 * The debrief: score, a step-by-step replay of what the learner did (with a still of the room at that moment and the
 * tool they used), what was right, and the safer alternative where it wasn't. Then the breakdown and key points.
 */
export function Debrief({ r, kind, tools, hotspots, onQuiz, onExit, reduced }: { r: ScenarioResult; kind: Kind; tools: Tool[]; hotspots: Hotspot[]; onQuiz: () => void; onExit: () => void; reduced: boolean }) {
  const rad = 46;
  const c = 2 * Math.PI * rad;
  const steps = r.steps ?? [];
  const [replay, setReplay] = useState(0);
  return (
    <motion.div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center gap-5">
          <svg width={112} height={112} viewBox="0 0 112 112" role="img" aria-label={`Safety score ${r.score}`}>
            <circle cx={56} cy={56} r={rad} stroke="rgba(255,255,255,.1)" strokeWidth={10} fill="none" />
            <motion.circle cx={56} cy={56} r={rad} stroke={r.score >= 80 ? "#20c997" : r.score >= 50 ? "#f59f00" : "#e03131"} strokeWidth={10} fill="none" strokeLinecap="round" transform="rotate(-90 56 56)" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - r.score / 100) }} transition={{ duration: reduced ? 0 : 1.2 }} />
            <text x={56} y={63} textAnchor="middle" fontSize={26} fontWeight={800} fill="#fff">
              {r.score}
            </text>
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Safety score</p>
            <h2 className="font-heading text-2xl font-bold text-white">{r.ending.outcome === "safe" ? "Everyone is safe" : "That could have gone badly"}</h2>
            <p className="mt-1 text-sm text-white/70">{r.ending.text}</p>
            {(r.hintsUsed ?? 0) > 0 && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-amber-200">
                <Lightbulb className="h-4 w-4" /> {r.hintsUsed} hint{r.hintsUsed === 1 ? "" : "s"} used: −{r.hintPenalty ?? 0} points
              </p>
            )}
            {r.badgeEligible && (
              <motion.p initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.8 }} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-sm font-semibold text-emerald-200">
                <ShieldCheck className="h-4 w-4" /> Safety award: 80+
              </motion.p>
            )}
          </div>
        </div>

        {steps.length > 0 ? (
          <section aria-labelledby="replay-h" className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 id="replay-h" className="font-semibold text-white">
                Replay: what you did
              </h3>
              {!reduced && (
                <button onClick={() => setReplay((k) => k + 1)} className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/10">
                  <Play className="h-3.5 w-3.5" /> Play again
                </button>
              )}
            </div>
            <ol className="space-y-2.5">
              {steps.map((s, i) => (
                <StepCard key={`${i}-${replay}`} i={i} s={s} kind={kind} tools={tools} hotspots={hotspots} reduced={reduced} />
              ))}
            </ol>
          </section>
        ) : (
          r.mistakes.length > 0 && (
            <div className="rounded-2xl bg-red-500/[0.06] p-4 ring-1 ring-inset ring-red-400/20">
              <h3 className="flex items-center gap-2 font-semibold text-red-100">
                <X className="h-4 w-4" /> What to do differently
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {r.mistakes.map((m, i) => (
                  <li key={i}>
                    <span className="text-white/50">{m.stage}: </span>
                    <span className="text-white/80">"{m.choice}"</span>
                    <p className="text-white/65">{m.feedback}</p>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}

        <div className="space-y-2 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.08]">
          {r.breakdown.map((d, i) => (
            <div key={d.id} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 text-white/75 sm:w-48">{d.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${d.score}%` }} transition={{ delay: reduced ? 0 : 0.3 + i * 0.12, duration: reduced ? 0 : 0.6 }} />
              </div>
              <span className="w-9 text-right font-mono text-xs text-white/60">{d.score}</span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-emerald-400/[0.06] p-4 ring-1 ring-inset ring-emerald-300/20">
          <h3 className="flex items-center gap-2 font-semibold text-emerald-100">
            <BookOpen className="h-4 w-4" /> Remember
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
            {r.learn.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-white/45">Based on: {r.sources.join("; ")}.</p>
        </div>
        <p className="rounded-xl bg-white/[0.04] p-3 text-xs text-white/55">{r.disclaimer}</p>
        <div className="flex flex-wrap gap-2 pb-4">
          <button onClick={onQuiz} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-5 text-sm font-semibold text-white">
            Take the safety quiz <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={onExit} className="inline-flex h-11 items-center rounded-md bg-white/[0.07] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/10">
            Back to scenarios
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function StepCard({ i, s, kind, tools, hotspots, reduced }: { i: number; s: Step; kind: Kind; tools: Tool[]; hotspots: Hotspot[]; reduced: boolean }) {
  const q = QUALITY[s.quality] ?? QUALITY.poor;
  const spot = hotspots.find((h) => h.id === s.target);
  const tool = tools.find((t) => t.id === s.tool);
  const caption = ANIMS[s.anim]?.caption;
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : 0.25 * i, duration: 0.35 }}
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/[0.08] sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-[#141a28] ring-1 ring-inset ring-white/10">
        <SceneArt kind={kind} hazard={s.hazard} props={s.props} anim={s.anim} still label={`Step ${i + 1}: ${s.label}${caption ? `. ${caption}` : ""}`}>
          {spot && (
            <g>
              <rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={10} fill="none" stroke={q.ring} strokeWidth={4} />
              {tool && <ToolIcon id={tool.id} size={64} x={Math.min(640 - 66, spot.x + spot.w / 2 - 32)} y={Math.max(2, spot.y - 40)} />}
            </g>
          )}
        </SceneArt>
        <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-xs font-bold text-white">{i + 1}</span>
      </div>
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{s.stage}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${q.cls}`}>{q.label}</span>
          {(s.hints ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] font-bold text-amber-200">
              <Lightbulb className="h-3 w-3" /> You used {s.hints} hint{s.hints === 1 ? "" : "s"} here
            </span>
          )}
        </div>
        <p className="mt-1 font-medium text-white">{s.label}</p>
        {tool && spot && (
          <p className="text-xs text-white/50">
            {tool.label} on the {spot.label.toLowerCase()}
          </p>
        )}
        {caption && <p className="mt-0.5 text-xs italic text-white/50">{caption}</p>}
        <p className="mt-1 text-white/70">{s.feedback}</p>
        {s.better && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-emerald-400/10 px-2.5 py-1.5 text-emerald-100">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Safer: </span>
              {s.better}
            </span>
          </p>
        )}
      </div>
    </motion.li>
  );
}
