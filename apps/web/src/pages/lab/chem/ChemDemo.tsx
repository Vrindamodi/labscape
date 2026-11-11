import { GhostButton, Glass, Kicker, PrimaryButton, useLabSession, Workbench, type BenchFrame, type DemoBeat, type ExperimentContent } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { cx } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Crosshair, Eye, FastForward, FlaskConical, Lightbulb, Pause, Play, RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The chemistry demo: a short "The idea" card, then the golden run played on the 3D bench with a
 * concept panel that explains every beat (what is happening, the science, the safety reason).
 *
 * Steady playback:
 * - real time at the chosen speed (1.5x by default), no speed bursts;
 * - one calm camera move per beat that fits everything the beat uses (never a closer zoom);
 * - each caption stays until the next one, and the clock waits at a beat boundary until the
 *   current caption has had time to be read;
 * - a long wait with nothing to do (crystals forming, ten minutes for a coat) is shown as a
 *   time-lapse with a "⏩ 10 minutes later" chip, at one steady speed.
 * Once the learner orbits or zooms, the camera is theirs until they press Re-centre.
 */
const SPEEDS = [0.5, 1, 1.5, 2] as const;
const DEFAULT_SPEED = 1.5;
/** Waits longer than this (simulation ms) with nothing happening become a time-lapse. */
const LAPSE_MIN_MS = 8000;
/** How long a time-lapse takes on screen. */
const LAPSE_WALL_MS = 3500;

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

/** "40 seconds", "2 minutes", "10 minutes". */
function fmtGap(ms: number) {
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s / 5) * 5 || Math.round(s)} seconds`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
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
  const [userPaused, setUserPaused] = useState(false);
  const [base, setBase] = useState<number>(DEFAULT_SPEED);
  const [manualCam, setManualCam] = useState(false);
  const [recentre, setRecentre] = useState(0);
  const { setSpeed, setPaused, seek } = session;
  const t = session.t;

  const visual = useMemo(() => content.golden.events.filter((e) => !isAnswer(e)), [content]);
  const beats = content.golden.captions;
  // Ends after the last action and after the last caption: some captions narrate what happens
  // while you wait (the slow reactions in metal displacement), long after the last action.
  const end = Math.max((visual[visual.length - 1]?.t ?? content.golden.durationS * 1000) + 2500, (beats[beats.length - 1]?.t ?? 0) + 3000);
  let beatIdx = -1;
  for (let i = 0; i < beats.length; i++) if (beats[i]!.t <= t) beatIdx = i;
  const beat = beatIdx >= 0 ? beats[beatIdx] : undefined;
  const done = started && t >= end;

  // Wall clock, so a caption can be read before the next one replaces it.
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!started || userPaused || done) return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [started, userPaused, done]);
  const shownAt = useRef(performance.now());
  useEffect(() => {
    shownAt.current = performance.now();
  }, [beatIdx, started]);

  const dwell = Math.min(8000, Math.max(3000, words(beat) * 230)) / base;
  const read = now - shownAt.current >= dwell;
  const nextBeatT = beats[beatIdx + 1]?.t ?? Infinity;
  const prevEvent = [...visual].reverse().find((e) => e.t <= t)?.t ?? 0;
  const nextEvent = visual.find((e) => e.t > t)?.t ?? end;
  const nextStop = Math.min(nextEvent, nextBeatT, end);

  // Time-lapse over long empty waits, at one steady speed, once the caption has been read.
  const lapse = useRef<{ until: number; speed: number; gap: number; to: number } | null>(null);
  /** The stop the last time-lapse ran towards: the few seconds left before it play normally. */
  const lapsedTo = useRef<number | null>(null);
  if (lapse.current && (t >= lapse.current.until || !started)) lapse.current = null;
  if (!lapse.current && started && !done && !userPaused && read && lapsedTo.current !== nextStop && nextStop - t > LAPSE_MIN_MS && t - prevEvent >= 1500) {
    const gap = nextStop - t;
    const lapseSpeed = Math.min(200, Math.max(3, gap / LAPSE_WALL_MS));
    // It slows down as it nears the next action (one clock tick never overshoots it).
    lapse.current = { until: nextStop - 1500, speed: lapseSpeed, gap, to: nextStop };
    lapsedTo.current = nextStop;
  }
  const lapsing = lapse.current;

  // Hold just before the next beat until the current caption has been read.
  const hold = started && !done && !lapsing && !read && nextBeatT !== Infinity && t >= nextBeatT - 300;
  const slow = !!beat?.slow && t - beat.t < 6000;
  const speed = lapsing ? Math.max(base, Math.min(lapsing.speed, Math.round((lapsing.until - t) / 100))) : base * (slow ? 0.6 : 1);
  useEffect(() => setSpeed(speed), [speed, setSpeed]);
  useEffect(() => {
    setPaused(!started || userPaused || hold || done);
  }, [started, userPaused, hold, done, setPaused]);

  // Camera: the whole bench before the start, then one calm move per beat that fits everything the
  // beat uses (and what each item stands in, e.g. a thermometer's beaker).
  const allIds = useMemo(() => content.bench.items.map((i) => i.id), [content]);
  const lastFrame = useRef<BenchFrame>({ key: "all", ids: allIds });
  // Items of the previous beat stay in frame too, so the vessel you were just watching (e.g. the
  // cylinder that is about to foam) never drifts out of view while the next beat lights a splint.
  const prevBeatIds = useRef<{ beat: number; ids: string[] }>({ beat: -1, ids: [] });
  const beatIds = useRef<{ beat: number; ids: string[] }>({ beat: -1, ids: [] });
  const frame = useMemo<BenchFrame>(() => {
    if (!started) return (lastFrame.current = { key: `all-${recentre}`, ids: allIds });
    const from = beat?.t ?? 0;
    const to = nextBeatT;
    const inBeat = visual.filter((e) => e.t >= from && e.t < to);
    const ids = new Set<string>();
    for (const e of inBeat.length ? inBeat : visual.filter((e) => e.t >= from).slice(0, 1)) {
      for (const id of itemsOf(e)) {
        const it = session.state.items[id];
        if (!it || it.socket === "worn") continue;
        ids.add(id);
        const host = it.socket?.split(":")[1];
        if (host && session.state.items[host]) ids.add(host);
      }
    }
    const tall = inBeat.some((e) => e.type === "liquid.pour" && session.state.items[String(e.payload.to)]?.kind === "burette_50");
    if (beatIds.current.beat !== beatIdx) {
      prevBeatIds.current = beatIds.current;
      beatIds.current = { beat: beatIdx, ids: [...ids] };
    }
    if (prevBeatIds.current.beat === beatIdx - 1) for (const id of prevBeatIds.current.ids) if (session.state.items[id] && session.state.items[id]!.socket !== "worn") ids.add(id);
    if (ids.size) lastFrame.current = { key: `b${beatIdx}-${recentre}`, ids: [...ids], tall };
    else lastFrame.current = { ...lastFrame.current, key: `${lastFrame.current.key.split("-")[0]}-${recentre}` };
    return lastFrame.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, beatIdx, visual, allIds, recentre]);

  const start = () => {
    setStarted(true);
    setUserPaused(false);
    lapse.current = null;
    lapsedTo.current = null;
    seek(0);
  };
  const replay = () => {
    lapse.current = null;
    lapsedTo.current = null;
    seek(0);
    shownAt.current = performance.now();
    setUserPaused(false);
  };
  const jump = (to: number) => {
    if (!started) setStarted(true);
    lapse.current = null;
    lapsedTo.current = null;
    seek(to);
    shownAt.current = performance.now();
  };
  const idea = content.idea ?? { text: firstSentences(content.observations.why, 2), analogy: "" };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] min-[700px]:grid-cols-[minmax(0,1fr)_320px] min-[700px]:grid-rows-1 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        {/* bench */}
        <div className="relative min-h-[240px] p-2 sm:p-3">
          <Workbench
            session={session}
            readOnly
            frame={manualCam ? null : frame}
            onUserCamera={() => setManualCam(true)}
            overlay={
              <>
                {/* small status chips in the top-left corner, clear of the apparatus in the middle */}
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
                  {lapsing && started && !done && (
                    <div className="flex items-center gap-1.5 rounded-full bg-[rgba(8,16,38,.9)] px-3 py-1.5 text-[14px] font-semibold text-white ring-1 ring-[#39d6ff]/50" role="status">
                      <FastForward className="h-4 w-4 fill-current text-[#39d6ff]" aria-hidden /> {fmtGap(lapsing.gap)} later
                    </div>
                  )}
                  {slow && started && !done && !lapsing && (
                    <div className="flex items-center gap-1.5 rounded-full bg-[#ffc23d] px-3 py-1.5 text-[14px] font-bold text-[#2a1600]">
                      <Eye className="h-4 w-4" />
                      Watch closely
                    </div>
                  )}
                </div>
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
                          <p className="mt-2 text-[16px] leading-relaxed text-[#dbe7ff]">{idea.text}</p>
                          {idea.analogy && (
                            <div className="mt-3 rounded-[14px] border border-[rgba(167,123,255,.35)] bg-[linear-gradient(135deg,rgba(167,123,255,.18),rgba(57,214,255,.08))] p-3 text-[15px] leading-snug text-[#ece4ff]">
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
                          <p className="mt-3 text-[14px] text-[#a9bde4]">
                            About {Math.max(1, Math.round(estimateWallMs(content, DEFAULT_SPEED) / 60000))} minute{Math.round(estimateWallMs(content, DEFAULT_SPEED) / 60000) > 1 ? "s" : ""}. Each step is explained as it happens; drag to look around.
                          </p>
                        </Glass>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {done && (
                  <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
                    <Glass radius="xl" className="flex flex-wrap items-center justify-center gap-2 p-2 pl-4">
                      <span className="flex items-center gap-1.5 text-[15px] font-semibold text-[#3de8a8]">
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
        <aside className={cx("min-h-0 overflow-y-auto px-2 pb-2 max-[699px]:max-h-[38vh] sm:px-3 min-[700px]:py-3 min-[700px]:pl-0", !started && "max-[699px]:hidden")} aria-label="What is happening and why">
          <Glass className="flex min-h-full flex-col gap-3 p-4">
            {beat && started ? (
              <AnimatePresence mode="wait">
                <motion.div key={beatIdx} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} aria-live="polite" className="space-y-3">
                  <div>
                    <Kicker>
                      What&apos;s happening · {beatIdx + 1} of {beats.length}
                    </Kicker>
                    <p className="mt-1 font-heading text-[19px] font-semibold leading-snug">{beat.text}</p>
                  </div>
                  {beat.why && (
                    <div className="rounded-[14px] border border-[rgba(110,170,255,.35)] bg-[rgba(61,139,255,.12)] p-3">
                      <div className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.06em] text-[#9fd8ff]">
                        <FlaskConical className="h-4 w-4" /> The science
                      </div>
                      <p className="mt-1 text-[15px] leading-snug text-[#e3edff]">{beat.why}</p>
                    </div>
                  )}
                  {beat.safety && (
                    <div className="rounded-[14px] border border-[rgba(255,194,61,.4)] bg-[rgba(255,194,61,.10)] p-3">
                      <div className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.06em] text-[#ffd77a]">
                        <ShieldAlert className="h-4 w-4" /> Why it&apos;s done this way
                      </div>
                      <p className="mt-1 text-[15px] leading-snug text-[#fff1cf]">{beat.safety}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div>
                <Kicker>In this demo</Kicker>
                <p className="mt-1 text-[15px] text-[#c8d6f3]">Watch the method once, with the reasons. Then it&apos;s your turn on the same bench.</p>
              </div>
            )}
            {beats.length > 1 && (
              <ol className="mt-auto space-y-1 border-t border-[rgba(140,180,255,.12)] pt-3" aria-label="Demo steps">
                {beats.map((b, i) => (
                  <li key={b.t}>
                    <button
                      onClick={() => jump(b.t)}
                      className={cx("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] leading-snug transition", started && i === beatIdx ? "bg-[rgba(61,139,255,.18)] text-white" : started && i < beatIdx ? "text-[#8fa6d1]" : "text-[#a9bde4] hover:bg-white/[0.04]")}
                    >
                      <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", started && i < beatIdx ? "bg-[#3de8a8] text-[#06210f]" : started && i === beatIdx ? "bg-[#3d8bff] text-white" : "bg-white/10 text-white/60")}>
                        {started && i < beatIdx ? <Check className="h-3 w-3" /> : i + 1}
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
        <button onClick={replay} disabled={!started} className="grid h-10 w-10 place-items-center rounded-lg text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" aria-label="Replay from the start" title="Replay from the start">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => (started ? (done ? replay() : setUserPaused(!userPaused)) : start())}
          className="grid h-10 w-10 place-items-center rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14]"
          aria-label={!started || userPaused || done ? "Play" : "Pause"}
        >
          {!started || userPaused || done ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <input type="range" min={0} max={end} value={Math.min(t, end)} onChange={(e) => jump(Number(e.target.value))} className="min-w-[120px] flex-1 accent-[#2f80ff]" aria-label="Scrub the demo" />
        <span className="w-[84px] text-center text-[14px] tabular-nums text-white/65">
          {fmtTime(Math.min(t, end))} / {fmtTime(end)}
        </span>
        <div className="flex rounded-lg bg-black/25 p-0.5" role="radiogroup" aria-label="Demo speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={base === s} onClick={() => setBase(s)} className={cx("rounded-md px-2.5 py-1 text-[13px] font-semibold", base === s ? "bg-accent text-white" : "text-white/60 hover:text-white")}>
              {s}×
            </button>
          ))}
        </div>
        {manualCam && (
          <button
            onClick={() => {
              setManualCam(false);
              setRecentre((n) => n + 1);
            }}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-[14px] font-semibold text-white hover:bg-white/[0.14]"
            title="Let the camera follow the demo again"
          >
            <Crosshair className="h-4 w-4" /> Re-centre
          </button>
        )}
        <PrimaryButton onClick={onTry} className="ml-auto h-10">
          Try it yourself <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </div>
  );
}

/** Rough wall-clock length of the demo (long waits become ~3.5 s time-lapses, plus reading time). */
function estimateWallMs(content: ExperimentContent, speed: number) {
  const ev = content.golden.events.filter((e) => !isAnswer(e));
  let total = 0;
  let prev = 0;
  for (const e of ev) {
    const gap = e.t - prev;
    total += gap > LAPSE_MIN_MS ? 4000 * speed + LAPSE_WALL_MS * speed : gap;
    prev = e.t;
  }
  const reading = content.golden.captions.reduce((a, b) => a + Math.min(8000, Math.max(3000, words(b) * 230)), 0);
  return Math.max((total + 2500) / speed, reading);
}
