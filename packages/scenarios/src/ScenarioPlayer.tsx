import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, Hand, List, ShieldCheck, Siren } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Debrief } from "./Debrief";
import { Hotspots, ToolTray, type Drag } from "./HandsOn";
import { ANIMS, SceneArt } from "./SceneArt";
import type { Chosen, Hotspot, ScenarioResult, SceneView, Started, Tool } from "./types";

export type ScenarioPlayerProps = {
  start: () => Promise<Started>;
  choose: (attemptId: string, choiceId: string, elapsedMs: number) => Promise<Chosen>;
  finish: (attemptId: string) => Promise<ScenarioResult>;
  /** The quiz stage (the app mounts its QuizRunner here). */
  renderQuiz: (quizId: string, onDone: () => void) => ReactNode;
  onExit: () => void;
  onResult?: (r: ScenarioResult) => void;
  play?: (sound: "error" | "success" | "badge" | "whoosh" | "notify") => void;
};

const RAIL = ["detection", "assessment", "decision", "consequence", "debrief", "quiz"] as const;
type Phase = "intro" | "scene" | "feedback" | "ending" | "debrief" | "quiz";
const LIST_KEY = "ls.emergency.listMode";

function readListMode(): boolean {
  try {
    return window.localStorage.getItem(LIST_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * <ScenarioPlayer> (build plan 4.3): title card with disclaimer, then a hands-on illustrated room through the
 * detection, assessment, decision and consequence stages. The learner drags tools onto the room (or taps tool then
 * target, or uses the keyboard); each (tool, target) maps to a server-scored choice, and its consequence plays out in
 * the scene. The hazard grows while they hesitate. The plain list of options stays available for accessibility.
 * Then the debrief replays the run, and the quiz. No injuries are shown; no ads.
 */
export function ScenarioPlayer({ start, choose, finish, renderQuiz, onExit, onResult, play }: ScenarioPlayerProps) {
  const reduced = !!useReducedMotion();
  const [run, setRun] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [scene, setScene] = useState<SceneView | null>(null);
  const [hazard, setHazard] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [fx, setFx] = useState<{ anim: string; key: number; at: { x: number; y: number } | null } | null>(null);
  const [listMode, setListMode] = useState(readListMode);
  const sceneStart = useRef(0);
  const roomRef = useRef<HTMLDivElement>(null);
  const [roomScale, setRoomScale] = useState(1);

  // Room labels are drawn in SVG units; keep them readable when the room is drawn small (phones).
  useEffect(() => {
    const el = roomRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setRoomScale(Math.min(width / 640, height / 360));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, run]);

  useEffect(() => {
    start()
      .then((s) => {
        setRun(s);
        setScene(s.scene);
        setHazard(s.scene.hazard);
        play?.("error");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't start the scenario."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The hazard grows while the learner hesitates.
  useEffect(() => {
    if (phase !== "scene" || !scene) return;
    sceneStart.current = performance.now();
    const base = scene.hazard;
    const id = window.setInterval(() => setHazard(Math.min(100, base + (scene.growth * (performance.now() - sceneStart.current)) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [phase, scene]);

  const tools: Tool[] = run?.tools ?? [];
  const hotspots: Hotspot[] = run?.hotspots ?? [];
  const handsOn = tools.length > 0 && hotspots.length > 0 && (scene?.actions?.length ?? 0) > 0;
  const showList = listMode || !handsOn;
  const centre = (target: string | null | undefined) => {
    const h = hotspots.find((x) => x.id === target);
    return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null;
  };

  const pick = async (choiceId: string, target?: string) => {
    if (!run || !scene || busy || phase !== "scene") return;
    setBusy(true);
    setMiss(null);
    setTool(null);
    try {
      const c = await choose(run.attemptId, choiceId, Math.round(performance.now() - sceneStart.current));
      // where the consequence plays: the hotspot used, or (from the list) the choice's first target
      const where = target ?? scene.actions?.find((a) => a.choiceId === choiceId)?.target;
      setFx({ anim: c.anim ?? "none", key: Date.now(), at: centre(where) ?? { x: 320, y: 180 } });
      setChosen(c);
      setHazard(c.hazard);
      play?.(c.safe ? "success" : "error");
      setPhase("feedback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const act = (toolId: string, target: string) => {
    if (!scene || phase !== "scene" || busy) return;
    const a = scene.actions?.find((x) => x.tool === toolId && x.target === target);
    if (a) {
      void pick(a.choiceId, target);
      return;
    }
    const t = tools.find((x) => x.id === toolId)?.label ?? toolId;
    const h = hotspots.find((x) => x.id === target)?.label ?? target;
    setMiss(`${t} on the ${h.toLowerCase()}: that won't help right now. Try something else.`);
    play?.("notify");
  };

  const hit = (target: string) => {
    if (!tool) {
      setMiss("Pick something from the tray first, then choose where to use it.");
      return;
    }
    act(tool, target);
  };

  const focusRoom = () => {
    window.setTimeout(() => roomRef.current?.querySelector<SVGGElement>("[data-hotspot]")?.focus(), 0);
  };

  const toggleList = () => {
    setListMode((m) => {
      try {
        window.localStorage.setItem(LIST_KEY, m ? "0" : "1");
      } catch {
        /* a per-viewer nicety */
      }
      return !m;
    });
  };

  const next = async () => {
    if (!run || !chosen) return;
    if (chosen.next) {
      setScene(chosen.next);
      setHazard(chosen.next.hazard);
      setChosen(null);
      setFx(null);
      setPhase("scene");
      play?.("whoosh");
      return;
    }
    setPhase("ending");
    setBusy(true);
    try {
      const r = await finish(run.attemptId);
      setResult(r);
      onResult?.(r);
      if (r.badgeEligible) play?.("badge");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't score the run.");
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-white/80">{error}</p>
          <button onClick={onExit} className="mt-4 rounded-md bg-white/10 px-4 py-2 text-sm text-white">
            Back
          </button>
        </div>
      </div>
    );
  if (!run || !scene) return <div className="grid h-full place-items-center text-white/50">Preparing the scenario…</div>;

  const railIndex = phase === "debrief" ? 4 : phase === "quiz" ? 5 : phase === "ending" ? 3 : RAIL.indexOf(scene.stage);
  const toolLabel = tool ? tools.find((t) => t.id === tool)?.label ?? null : null;
  const caption = fx ? ANIMS[fx.anim]?.caption : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-1.5" aria-label="Scenario stages">
        {RAIL.map((r, i) => (
          <span key={r} className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${i === railIndex ? "bg-red-500/80 text-white" : i < railIndex ? "text-emerald-300" : "text-white/40"}`} aria-current={i === railIndex ? "step" : undefined}>
            {i < railIndex ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
            {r}
          </span>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div key="intro" className="grid min-h-0 flex-1 place-items-center overflow-y-auto bg-black px-6 py-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.35 }}>
            <div className="max-w-xl text-center">
              <motion.div initial={reduced ? false : { scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 14 }} className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-600/90 text-white shadow-[0_0_40px_#e03131]">
                <Siren className="h-7 w-7" />
              </motion.div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-300">Emergency scenario</p>
              <h1 className="mt-2 font-heading text-3xl font-extrabold uppercase tracking-tight text-white sm:text-4xl">{run.title}</h1>
              {handsOn && (
                <p className="mx-auto mt-4 flex max-w-md items-start gap-2 text-left text-sm text-white/75">
                  <Hand className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>You're in the room. Drag a tool from the tray onto the scene (or tap a tool, then tap where to use it). Act fast: the danger grows while you wait.</span>
                </p>
              )}
              <p className="mt-4 rounded-xl bg-white/[0.06] p-3 text-sm leading-relaxed text-white/75 ring-1 ring-inset ring-white/10">{run.disclaimer}</p>
              <button autoFocus onClick={() => setPhase("scene")} className="mt-5 inline-flex h-12 items-center gap-2 rounded-md bg-red-600 px-6 font-semibold text-white">
                Begin <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        )}

        {(phase === "scene" || phase === "feedback" || phase === "ending") && (
          <motion.div
            key="play"
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 sm:p-3 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* the room */}
            <div className="flex min-h-0 shrink-0 flex-col gap-1.5 lg:shrink">
              <div ref={roomRef} className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[#141a28] ring-1 ring-inset ring-white/10 lg:aspect-auto lg:min-h-0 lg:flex-1">
                <SceneArt
                  kind={run.kind}
                  hazard={hazard}
                  props={scene.props}
                  anim={phase === "scene" ? null : fx?.anim}
                  animKey={fx?.key}
                  at={fx?.at}
                  reduced={reduced}
                  tone={phase === "feedback" && chosen ? (chosen.safe ? "good" : "bad") : null}
                  label={`${run.title}: ${scene.narration} Danger ${Math.round(hazard)} out of 100.`}
                >
                  {handsOn && <Hotspots hotspots={hotspots} textScale={Math.min(1.9, Math.max(1, 0.85 / roomScale))} tool={tool} toolLabel={toolLabel} drag={drag} disabled={phase !== "scene" || busy} onHit={hit} />}
                </SceneArt>
                {phase === "feedback" && caption && (
                  <motion.p initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute left-2 right-2 top-2 mx-auto w-fit max-w-[90%] rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs font-semibold text-white sm:text-sm" aria-hidden>
                    {caption}
                  </motion.p>
                )}
              </div>
              <HazardMeter value={hazard} />
            </div>

            {/* the panel */}
            <div className="flex min-h-0 flex-col gap-2 lg:overflow-y-auto lg:pr-1">
              <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">{scene.stage}</p>
                  {phase === "scene" && <Countdown key={scene.id} seconds={scene.timerS} />}
                </div>
                <p className="mt-1 text-[15px] leading-snug text-white">{scene.narration}</p>
                {phase === "scene" && <p className="mt-2 text-sm font-semibold text-amber-200">{scene.prompt || "What do you do?"}</p>}
              </div>

              {phase === "scene" && (
                <>
                  {showList ? (
                    <div className="space-y-1.5" role="group" aria-label="What do you do?">
                      {scene.choices.map((c, i) => (
                        <motion.button key={c.id} onClick={() => void pick(c.id)} disabled={busy} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.06 * i, duration: 0.25 }} className="w-full rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-left text-sm font-medium text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.1] disabled:opacity-50">
                          {c.label}
                        </motion.button>
                      ))}
                    </div>
                  ) : (
                    <ToolTray tools={tools} selected={tool} disabled={busy} onSelect={(t) => { setTool(t); setMiss(null); }} onDrop={act} onDrag={setDrag} drag={drag} focusRoom={focusRoom} />
                  )}
                  <p className="min-h-[1.25rem] text-xs text-white/70" aria-live="polite">
                    {miss ? <span className="text-amber-200">{miss}</span> : !showList && toolLabel ? `${toolLabel} in hand: now tap (or Tab to) where to use it.` : !showList ? "Drag a tool onto the scene, or tap a tool and then a spot." : ""}
                  </p>
                  {handsOn && (
                    <button onClick={toggleList} className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-semibold text-sky-200 underline-offset-2 hover:underline">
                      {listMode ? <Hand className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
                      {listMode ? "Use the hands-on scene" : "Show options as a list"}
                    </button>
                  )}
                </>
              )}

              {phase === "feedback" && chosen && (
                <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.9 }} className={`rounded-2xl p-3.5 ring-1 ring-inset ${chosen.safe ? "bg-emerald-400/10 ring-emerald-300/30" : "bg-red-500/10 ring-red-400/40"}`} aria-live="assertive">
                  <p className={`flex items-center gap-2 font-semibold ${chosen.safe ? "text-emerald-200" : "text-red-200"}`}>
                    {chosen.safe ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    {chosen.quality === "best" ? "Good call" : chosen.quality === "ok" ? "Safe, but not the best" : chosen.quality === "poor" ? "Not the best choice" : "Unsafe"}
                  </p>
                  {caption && <p className="sr-only">{caption}</p>}
                  <p className="mt-1.5 text-sm leading-relaxed text-white/85">{chosen.feedback}</p>
                  {chosen.ending && <p className="mt-2.5 rounded-lg bg-black/25 p-2.5 text-sm text-white/80">{chosen.ending.text}</p>}
                  <button autoFocus onClick={() => void next()} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-md bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/15">
                    {chosen.next ? "Continue" : "See how you did"} <ArrowRight className="h-4 w-4" />
                  </button>
                </motion.div>
              )}
              {phase === "ending" && (
                <div className="rounded-2xl bg-white/[0.04] p-3.5 text-sm text-white/70 ring-1 ring-inset ring-white/10">
                  {result ? (
                    <button autoFocus onClick={() => setPhase("debrief")} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 font-semibold text-white">
                      Debrief <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    "Scoring your run…"
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {phase === "debrief" && result && <Debrief key="debrief" r={result} kind={run.kind} tools={tools} hotspots={hotspots} onQuiz={() => setPhase("quiz")} onExit={onExit} reduced={reduced} />}

        {phase === "quiz" && result && (
          <motion.div key="quiz" className="min-h-0 flex-1 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {renderQuiz(result.quizId, onExit)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HazardMeter({ value }: { value: number }) {
  const colour = value > 70 ? "#e03131" : value > 40 ? "#f59f00" : "#40c057";
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 ring-1 ring-inset ring-white/10" role="meter" aria-label="Danger level" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-white/70">Danger</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full" animate={{ width: `${value}%`, backgroundColor: colour }} transition={{ duration: 0.3 }} />
      </div>
      <span className="w-7 text-right font-mono text-[11px] text-white/70">{Math.round(value)}</span>
    </div>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setLeft(Math.max(0, seconds - (performance.now() - t0) / 1000)), 200);
    return () => window.clearInterval(id);
  }, [seconds]);
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/60" role="timer" aria-label={`${Math.ceil(left)} seconds`}>
      {left === 0 && <span className="text-red-300">Act now: it's getting worse</span>}
      <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
        <circle cx={15} cy={15} r={r} stroke="rgba(255,255,255,.12)" strokeWidth={3} fill="none" />
        <circle cx={15} cy={15} r={r} stroke={left < seconds * 0.3 ? "#e03131" : "#ffd43b"} strokeWidth={3} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform="rotate(-90 15 15)" />
        <text x={15} y={19} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
          {Math.ceil(left)}
        </text>
      </svg>
    </span>
  );
}
