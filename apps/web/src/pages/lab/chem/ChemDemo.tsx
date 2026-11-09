import { GhostButton, Glass, Kicker, PrimaryButton, useLabSession, Workbench, type BenchFrame, type DemoBeat, type ExperimentContent } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { cx } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Eye, FlaskConical, Lightbulb, Pause, Play, RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The chemistry demo: a short "The idea" card, then the golden run played on the 3D bench with
 * the camera framed on each action and a concept panel that explains every beat (what is
 * happening, the science, the safety reason).
 *
 * Pace: "1x" plays the recorded run twice as fast as real time, and waits between actions are
 * fast-forwarded once the current beat has had time to be read.
 */
const PACE = 2;

type GoldenEvent = ExperimentContent["golden"]["events"][number];

const isAnswer = (e: GoldenEvent) => e.type === "param.set" && String(e.payload.key ?? "").startsWith("answer:");

/** The bench items an event acts on (for the camera). */
function itemsOf(e: GoldenEvent): string[] {
  const p = e.payload as Record<string, unknown>;
  const key = typeof p.key === "string" && p.key.includes(":") ? p.key.split(":")[1] : undefined;
  return [p.from, p.to, p.into, p.equipmentId, p.target, p.instrument, key].filter((x): x is string => typeof x === "string");
}

function words(b: DemoBeat | undefined) {
  if (!b) return 0;
  return `${b.text} ${b.why ?? ""} ${b.safety ?? ""}`.split(/\s+/).filter(Boolean).length;
}

function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The first two sentences of a paragraph (fallback for experiments without an "idea" card). */
function firstSentences(text: string, n: number) {
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return parts.slice(0, n).join(" ").trim();
}

export function ChemDemo({ content, onTry }: { content: ExperimentContent; onTry: () => void }) {
  const { reduced } = useMotion();
  const session = useLabSession(content, { mode: "demo", startPaused: true });
  const [started, setStarted] = useState(false);
  const [base, setBase] = useState(1);
  const { setSpeed, setPaused, seek } = session;
  const t = session.t;

  const visual = useMemo(() => content.golden.events.filter((e) => !isAnswer(e)), [content]);
  const end = (visual[visual.length - 1]?.t ?? content.golden.durationS * 1000) + 2500;
  const beats = content.golden.captions;
  let beatIdx = -1;
  for (let i = 0; i < beats.length; i++) if (beats[i]!.t <= t) beatIdx = i;
  const beat = beatIdx >= 0 ? beats[beatIdx] : undefined;
  const done = started && t >= end;

  // How long the current beat has been on screen (wall clock), so it can be read before a skip.
  const shownAt = useRef(performance.now());
  useEffect(() => {
    shownAt.current = performance.now();
  }, [beatIdx]);

  const slow = !!beat?.slow && t - beat.t < 6000;
  const nextEvent = visual.find((e) => e.t > t)?.t ?? end;
  const prevEvent = [...visual].reverse().find((e) => e.t <= t)?.t ?? 0;
  const nextBeat = beats.find((b) => b.t > t)?.t ?? Infinity;
  const gap = Math.min(nextEvent, nextBeat) - t;
  const dwell = Math.min(7000, Math.max(2500, words(beat) * 200)) / base;
  const read = performance.now() - shownAt.current >= dwell;
  // Fast-forward empty stretches (gas collecting, a ten-minute wait) once the beat has been read.
  let boost = 1;
  if (!slow && read && gap > 2500 && t - prevEvent > 1500) boost = Math.min(64, 2 ** Math.floor(Math.log2(Math.max(1, gap / 1500))));
  const speed = base * PACE * (slow ? 0.5 : boost);
  useEffect(() => setSpeed(speed), [speed, setSpeed]);
  useEffect(() => {
    if (done) setPaused(true);
  }, [done, setPaused]);

  // Camera: the whole bench before the start, then a close-up on the action just done or coming next.
  const lastFrame = useRef<BenchFrame>({ key: "all", ids: content.bench.items.map((i) => i.id) });
  const frame = useMemo<BenchFrame>(() => {
    if (!started) return (lastFrame.current = { key: "all", ids: content.bench.items.map((i) => i.id) });
    let idx = -1;
    for (let i = 0; i < visual.length; i++) if (visual[i]!.t <= t && t - visual[i]!.t < 2500) idx = i;
    if (idx < 0) idx = visual.findIndex((e) => e.t > t);
    const e = idx >= 0 ? visual[idx] : undefined;
    const direct = e ? itemsOf(e).filter((id) => session.state.items[id] && session.state.items[id]!.socket !== "worn") : [];
    // Keep what an item is snapped into in shot too (a thermometer is read in its beaker).
    const ids = direct.flatMap((id) => {
      const host = session.state.items[id]!.socket?.split(":")[1];
      return host && session.state.items[host] ? [id, host] : [id];
    });
    if (ids.length) lastFrame.current = { key: `e${idx}`, ids: [...new Set(ids)] };
    return lastFrame.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, t, visual, content]);

  const start = () => {
    setStarted(true);
    seek(0);
    setPaused(false);
  };
  const replay = () => {
    seek(0);
    setPaused(false);
  };
  const idea = content.idea ?? { text: firstSentences(content.observations.why, 2), analogy: "" };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1">
        {/* bench */}
        <div className="relative min-h-[220px] p-2 sm:p-3">
          <Workbench
            session={session}
            readOnly
            frame={frame}
            overlay={
              <>
                {slow && started && !done && (
                  <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-[#ffc23d] px-3 py-1 text-xs font-bold text-[#2a1600]">
                    <Eye className="h-3.5 w-3.5" />
                    Watch closely
                  </div>
                )}
                {boost > 1 && started && !done && (
                  <div className="absolute right-3 top-3 z-10 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white/80" aria-hidden>
                    Fast-forward ▸▸
                  </div>
                )}
                {/* "The idea" before the demo starts */}
                <AnimatePresence>
                  {!started && (
                    <motion.div key="idea" exit={{ opacity: 0 }} className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-[rgba(3,7,18,.62)] p-3 backdrop-blur-[3px] sm:p-6">
                      <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-[min(540px,100%)]">
                        <Glass className="p-5 sm:p-6">
                          <Kicker className="flex items-center gap-1.5 text-[#ffd77a]">
                            <Lightbulb className="h-4 w-4" />
                            The idea
                          </Kicker>
                          <h2 className="mt-1 font-heading text-[22px] font-bold leading-tight sm:text-[26px]">{content.title}</h2>
                          <p className="mt-2 text-[15px] leading-relaxed text-[#dbe7ff]">{idea.text}</p>
                          {idea.analogy && (
                            <div className="mt-3 rounded-[14px] border border-[rgba(167,123,255,.35)] bg-[linear-gradient(135deg,rgba(167,123,255,.18),rgba(57,214,255,.08))] p-3 text-[14px] leading-snug text-[#ece4ff]">
                              <b className="mr-1 text-white">Picture it:</b>
                              {idea.analogy}
                            </div>
                          )}
                          <div className="mt-5 flex flex-wrap gap-2">
                            <PrimaryButton onClick={start} className="h-11 px-5 text-[15px]">
                              <Play className="h-4 w-4" /> Start the demo
                            </PrimaryButton>
                            <GhostButton onClick={onTry} className="h-11">
                              Skip, I&apos;ll try it <ArrowRight className="h-4 w-4" />
                            </GhostButton>
                          </div>
                          <p className="mt-3 text-[12px] text-[#8fa6d1]">
                            About {Math.max(10, Math.round(estimateWallMs(content) / 1000))} seconds. Each step is explained as it happens.
                          </p>
                        </Glass>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {done && (
                  <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
                    <Glass radius="xl" className="flex flex-wrap items-center justify-center gap-2 p-2 pl-4">
                      <span className="flex items-center gap-1.5 text-[14px] font-semibold text-[#3de8a8]">
                        <Check className="h-4 w-4" /> That&apos;s the whole method
                      </span>
                      <GhostButton onClick={replay}>
                        <RotateCcw className="h-4 w-4" /> Watch again
                      </GhostButton>
                      <PrimaryButton onClick={onTry} className="ls-breathe">
                        Try it yourself <ArrowRight className="h-4 w-4" />
                      </PrimaryButton>
                    </Glass>
                  </div>
                )}
              </>
            }
          />
        </div>

        {/* concept panel */}
        <aside className={cx("min-h-0 overflow-y-auto px-2 pb-2 max-lg:max-h-[36vh] sm:px-3 lg:py-3 lg:pl-0", !started && "max-lg:hidden")} aria-label="What is happening and why">
          <Glass className="flex min-h-full flex-col gap-3 p-4">
            {beat && started ? (
              <AnimatePresence mode="wait">
                <motion.div key={beatIdx} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} aria-live="polite" className="space-y-3">
                  <div>
                    <Kicker>
                      What&apos;s happening · {beatIdx + 1} of {beats.length}
                    </Kicker>
                    <p className="mt-1 font-heading text-[18px] font-semibold leading-snug">{beat.text}</p>
                  </div>
                  {beat.why && (
                    <div className="rounded-[14px] border border-[rgba(110,170,255,.35)] bg-[rgba(61,139,255,.12)] p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9fd8ff]">
                        <FlaskConical className="h-3.5 w-3.5" /> The science
                      </div>
                      <p className="mt-1 text-[14px] leading-snug text-[#e3edff]">{beat.why}</p>
                    </div>
                  )}
                  {beat.safety && (
                    <div className="rounded-[14px] border border-[rgba(255,194,61,.4)] bg-[rgba(255,194,61,.10)] p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ffd77a]">
                        <ShieldAlert className="h-3.5 w-3.5" /> Why it&apos;s done this way
                      </div>
                      <p className="mt-1 text-[14px] leading-snug text-[#fff1cf]">{beat.safety}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div>
                <Kicker>In this demo</Kicker>
                <p className="mt-1 text-[14px] text-[#c8d6f3]">Watch the method once, with the reasons. Then it&apos;s your turn on the same bench.</p>
              </div>
            )}
            {beats.length > 1 && (
              <ol className="mt-auto space-y-1 border-t border-[rgba(140,180,255,.12)] pt-3" aria-label="Demo steps">
                {beats.map((b, i) => (
                  <li key={b.t}>
                    <button
                      onClick={() => {
                        if (!started) setStarted(true);
                        seek(b.t);
                        setPaused(false);
                      }}
                      className={cx("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition", started && i === beatIdx ? "bg-[rgba(61,139,255,.18)] text-white" : started && i < beatIdx ? "text-[#8fa6d1]" : "text-[#a9bde4] hover:bg-white/[0.04]")}
                    >
                      <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold", started && i < beatIdx ? "bg-[#3de8a8] text-[#06210f]" : started && i === beatIdx ? "bg-[#3d8bff] text-white" : "bg-white/10 text-white/60")}>
                        {started && i < beatIdx ? <Check className="h-2.5 w-2.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">{b.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Glass>
        </aside>
      </div>

      {/* controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/[0.07] px-3 py-2 sm:px-4">
        <button onClick={replay} disabled={!started} className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" aria-label="Replay from the start">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => (started ? (done ? replay() : setPaused(!session.paused)) : start())}
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14]"
          aria-label={!started || session.paused || done ? "Play" : "Pause"}
        >
          {!started || session.paused || done ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={end}
          value={Math.min(t, end)}
          onChange={(e) => {
            if (!started) setStarted(true);
            seek(Number(e.target.value));
          }}
          className="min-w-[120px] flex-1 accent-[#2f80ff]"
          aria-label="Scrub the demo"
        />
        <span className="tabular w-[76px] text-center text-xs text-white/55">
          {fmtTime(t)} / {fmtTime(end)}
        </span>
        <div className="flex rounded-lg bg-black/25 p-0.5" role="radiogroup" aria-label="Demo speed">
          {[0.5, 1, 2].map((s) => (
            <button key={s} role="radio" aria-checked={base === s} onClick={() => setBase(s)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold", base === s ? "bg-accent text-white" : "text-white/55")}>
              {s}×
            </button>
          ))}
        </div>
        <PrimaryButton onClick={onTry} className="ml-auto h-9">
          Try it yourself <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </div>
  );
}

/** Rough wall-clock length of the demo at 1x (actions at PACE, long waits fast-forwarded). */
function estimateWallMs(content: ExperimentContent) {
  const ev = content.golden.events.filter((e) => !isAnswer(e));
  let total = 0;
  let prev = 0;
  for (const e of ev) {
    const gap = e.t - prev;
    total += gap > 4000 ? 4000 + Math.log2(gap / 4000) * 1500 : gap;
    prev = e.t;
  }
  return (total + 2500) / PACE;
}
