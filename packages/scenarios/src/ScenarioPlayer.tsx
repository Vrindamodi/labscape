import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, Hand, Lightbulb, List, MessageCircleQuestion, Pause, Play, ShieldCheck, Siren, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Debrief } from "./Debrief";
import { Hotspots, ToolTray, type Drag } from "./HandsOn";
import { ANIMS, SceneArt } from "./SceneArt";
import type { Chosen, EmergencyAiContext, HintRung, Hotspot, ScenarioResult, SceneView, Started, Tool } from "./types";

/** What the player hands the app's assistant: live scenario context, and ways back into the player. */
export type HelperApi = {
  /** The scenario context as of now (read when a question is sent). */
  getContext: () => EmergencyAiContext | null;
  /** Call after each question is sent: the coach nudges first, and gives the safe move when asked for help again. */
  onAsk: (question: string) => void;
  onClose: () => void;
  /** The assistant isn't available: close it and open the hint ladder instead. */
  fallBackToHints: () => void;
};

export type ScenarioPlayerProps = {
  start: () => Promise<Started>;
  choose: (attemptId: string, choiceId: string, elapsedMs: number) => Promise<Chosen>;
  finish: (attemptId: string) => Promise<ScenarioResult>;
  /** The next rung of the current scene's hint ladder (scored server-side). Without it, or if it fails, generic hints are shown. */
  hint?: (attemptId: string) => Promise<HintRung>;
  /** The scenario's slug, so the assistant can look up the reviewed scenario. */
  slug?: string;
  /** Publishes the live scenario context (the app's LabContext mechanism); null when the player goes away. */
  onContext?: (ctx: EmergencyAiContext | null) => void;
  /** The assistant, shown as a side sheet (desktop) or bottom sheet (phone) next to the scene. */
  renderHelper?: (h: HelperApi) => ReactNode;
  /** The quiz stage (the app mounts its QuizRunner here). */
  renderQuiz: (quizId: string, onDone: () => void) => ReactNode;
  onExit: () => void;
  onResult?: (r: ScenarioResult) => void;
  play?: (sound: "error" | "success" | "badge" | "whoosh" | "notify") => void;
};

const RAIL = ["detection", "assessment", "decision", "consequence", "debrief", "quiz"] as const;
type Phase = "intro" | "scene" | "feedback" | "ending" | "debrief" | "quiz";
const LIST_KEY = "ls.emergency.listMode";
/** Seconds without doing anything before a hint is offered. */
const IDLE_OFFER_S = 8;
/** Mirrors the server coach's idea of a request for help (EmergencyCoach.HELP). */
const ASKS_FOR_HELP = /(don'?t|dont|do not) know|\bidk\b|stuck|help|what (do|should|shall|can|now)|first step|next|hint|safest|confus|no idea|clue/i;

/** Used when the server's hint ladder can't be reached: still useful, never the answer, never scored. */
const GENERIC_HINTS = [
  "Read what's happening again. What is the most dangerous thing in the room right now, and who could get hurt?",
  "Move over (or tap) each spot in the room to see what it is. The danger is usually where the story points.",
  "Still stuck? Show the options as a list (below the tools) and pick the one that keeps people safest.",
];

type ShownHint = HintRung & { offline?: boolean };

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
 * the scene. The hazard grows while they hesitate. Stuck? A three-rung hint ladder (nudge, where to look, what to do)
 * and an assistant that coaches; both pause the clock, because this is training. The plain list of options stays
 * available for accessibility. Then the debrief replays the run, and the quiz. No injuries are shown; no ads.
 */
export function ScenarioPlayer({ start, choose, finish, hint, slug, onContext, renderHelper, renderQuiz, onExit, onResult, play }: ScenarioPlayerProps) {
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
  // help: the hint ladder for this scene, and the assistant
  const [hints, setHints] = useState<ShownHint[]>([]);
  const [hintOpen, setHintOpen] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [penalty, setPenalty] = useState(0);
  const [offer, setOffer] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGlow, setAiGlow] = useState<string | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const [roomScale, setRoomScale] = useState(1);

  // The scene clock: time spent with a hint or the assistant open doesn't count.
  const clock = useRef({ start: 0, pausedAt: null as number | null, paused: 0 });
  const elapsed = () => {
    const c = clock.current;
    return Math.max(0, (c.pausedAt ?? performance.now()) - c.start - c.paused);
  };
  const paused = phase === "scene" && (hintOpen || aiOpen);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastAct = useRef(0);
  const asked = useRef<Record<string, number>>({});
  const done = useRef<EmergencyAiContext["done"]>([]);

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

  // A new scene: fresh clock and hint ladder. Then the hazard grows while the learner hesitates (not while paused).
  useEffect(() => {
    if (phase !== "scene" || !scene) return;
    const now = performance.now();
    clock.current = { start: now, pausedAt: pausedRef.current ? now : null, paused: 0 };
    lastAct.current = now;
    const base = scene.hazard;
    const id = window.setInterval(() => setHazard(Math.min(100, base + (scene.growth * elapsed()) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [phase, scene]);

  useEffect(() => {
    setHints([]);
    setHintOpen(false);
    setOffer(false);
    setAiGlow(null);
  }, [scene?.id]);

  useEffect(() => {
    const c = clock.current;
    const now = performance.now();
    if (paused && c.pausedAt == null) c.pausedAt = now;
    else if (!paused && c.pausedAt != null) {
      c.paused += now - c.pausedAt;
      c.pausedAt = null;
      lastAct.current = now;
    }
  }, [paused]);

  // Offer a hint after a while with nothing done (once a scene).
  useEffect(() => {
    if (phase !== "scene" || !scene) return;
    let offered = false;
    const id = window.setInterval(() => {
      if (offered || pausedRef.current) return;
      if (performance.now() - lastAct.current > IDLE_OFFER_S * 1000) {
        offered = true;
        setOffer(true);
        play?.("notify");
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [phase, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  const tools: Tool[] = run?.tools ?? [];
  const hotspots: Hotspot[] = run?.hotspots ?? [];
  const handsOn = tools.length > 0 && hotspots.length > 0 && (scene?.actions?.length ?? 0) > 0;
  const showList = listMode || !handsOn;
  const centre = (target: string | null | undefined) => {
    const h = hotspots.find((x) => x.id === target);
    return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null;
  };

  // The assistant's "Show me where" (and any other highlight) pulses that spot in the room.
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!(run?.hotspots ?? []).some((h) => h.id === id)) return;
      setAiGlow(id);
      window.clearTimeout(t);
      t = window.setTimeout(() => setAiGlow(null), 6000);
    };
    window.addEventListener("labscape:highlight", on);
    return () => {
      window.removeEventListener("labscape:highlight", on);
      window.clearTimeout(t);
    };
  }, [run]);

  useEffect(() => {
    if (!aiOpen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setAiOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [aiOpen]);

  const touch = () => {
    lastAct.current = performance.now();
  };

  // What the assistant sees (read at send time, so always current).
  const context = (): EmergencyAiContext | null =>
    run && scene
      ? {
          surface: "emergency",
          attemptId: run.attemptId,
          userLevel: "school",
          scenarioSlug: slug ?? "",
          scenarioTitle: run.title,
          sceneId: scene.id,
          stage: scene.stage,
          narration: scene.narration,
          prompt: scene.prompt ?? "",
          hazard: Math.round(hazard),
          askedBefore: asked.current[scene.id] ?? 0,
          hintRung: hints.length,
          tools: tools.map((t) => t.label),
          places: hotspots.map((h) => h.label),
          done: [...done.current],
          completedStepIds: done.current.map((d) => d.scene),
          hintsShown: hints.map((h) => `${scene.id}:${h.rung}`),
          highlightableIds: hotspots.map((h) => h.id),
          bench: [],
          recentEvents: [],
          readings: [],
          deviations: [],
        }
      : null;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    onContext?.(contextRef.current());
  }, [run, scene?.id, phase, hints.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onContext?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (choiceId: string, target?: string) => {
    if (!run || !scene || busy || phase !== "scene") return;
    setBusy(true);
    setMiss(null);
    setTool(null);
    setHintOpen(false);
    setOffer(false);
    try {
      const c = await choose(run.attemptId, choiceId, Math.round(elapsed()));
      // where the consequence plays: the hotspot used, or (from the list) the choice's first target
      const where = target ?? scene.actions?.find((a) => a.choiceId === choiceId)?.target;
      done.current.push({ scene: scene.id, did: scene.choices.find((x) => x.id === choiceId)?.label ?? choiceId, quality: c.quality });
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
    touch();
    const a = scene.actions?.find((x) => x.tool === toolId && x.target === target);
    if (a) {
      void pick(a.choiceId, target);
      return;
    }
    const t = tools.find((x) => x.id === toolId)?.label ?? toolId;
    const h = hotspots.find((x) => x.id === target)?.label ?? target;
    setMiss(`${t} on the ${h.toLowerCase()}: that won't help right now. Try something else${hints.length < 3 ? ", or take a hint" : ""}.`);
    play?.("notify");
  };

  const hit = (target: string) => {
    touch();
    if (!tool) {
      setMiss("Pick something from the tray first, then choose where to use it.");
      return;
    }
    act(tool, target);
  };

  const takeHint = async () => {
    if (!run || !scene || phase !== "scene") return;
    setOffer(false);
    setAiOpen(false);
    setHintOpen(true);
    const have = hints.length;
    const max = hints[0]?.rungs ?? 3;
    if (have >= max || hintBusy) return;
    setHintBusy(true);
    try {
      if (!hint) throw new Error("no hints endpoint");
      const h = await hint(run.attemptId);
      if (h.scene !== scene.id) throw new Error("scene moved on");
      setHints((list) => [...list.filter((x) => x.rung < h.rung), h]);
      setPenalty(h.penalty);
    } catch {
      const text = GENERIC_HINTS[Math.min(have, GENERIC_HINTS.length - 1)]!;
      setHints((list) => [...list, { scene: scene.id, rung: have + 1, rungs: GENERIC_HINTS.length, text, cost: 0, sceneRungs: have + 1, penalty, offline: true }]);
    } finally {
      setHintBusy(false);
    }
  };

  const top = hints[hints.length - 1];
  const glowSpot = phase === "scene" ? (aiGlow ?? (top && top.rung >= 2 ? top.target ?? null : null)) : null;
  const glowTool = phase === "scene" && top && top.rung >= 3 ? top.tool ?? null : null;
  const canShowMe = !!(handsOn && !showList && top?.tool && top.target && top.rung >= 3);

  const showMe = () => {
    if (!top?.tool || !top.target) return;
    setHintOpen(false);
    setTool(top.tool);
    act(top.tool, top.target);
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
    setAiOpen(false);
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
  const helperOpen = aiOpen && !!renderHelper && (phase === "scene" || phase === "feedback");
  const helper: HelperApi = {
    getContext: () => contextRef.current(),
    onAsk: (question) => {
      // only requests for help count towards "asked before" (a "why not water?" isn't one)
      if (!ASKS_FOR_HELP.test(question)) return;
      const id = scene.id;
      asked.current[id] = (asked.current[id] ?? 0) + 1;
    },
    onClose: () => setAiOpen(false),
    fallBackToHints: () => void takeHint(),
  };

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
                <p className="mx-auto mt-4 flex max-w-md items-start gap-2 text-left text-[15px] text-white/75">
                  <Hand className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>You're in the room. Drag a tool from the tray onto the scene (or tap a tool, then tap where to use it). Act fast: the danger grows while you wait.</span>
                </p>
              )}
              <p className="mx-auto mt-2 flex max-w-md items-start gap-2 text-left text-[15px] text-white/75">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <span>Not sure what to do? Tap Hint (each hint costs 5 points){renderHelper ? " or Ask for help to talk it through with the safety coach" : ""}. The clock pauses while you get help.</span>
              </p>
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
            className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 sm:p-3 lg:grid lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${
              helperOpen ? "max-lg:pb-[58vh] lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,1fr)_minmax(320px,380px)]" : "lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]"
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* the room */}
            <div className="flex min-h-0 shrink-0 flex-col gap-1.5 lg:shrink">
              <div
                ref={roomRef}
                onPointerDown={touch}
                className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[#141a28] ring-1 ring-inset ring-white/10 lg:aspect-auto lg:min-h-0 lg:flex-1"
              >
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
                  {handsOn && (
                    <Hotspots
                      hotspots={hotspots}
                      textScale={Math.min(1.9, Math.max(1, 0.85 / roomScale))}
                      tool={tool}
                      toolLabel={toolLabel}
                      drag={drag}
                      disabled={phase !== "scene" || busy}
                      onHit={hit}
                      glow={glowSpot}
                      reduced={reduced}
                    />
                  )}
                </SceneArt>
                {phase === "feedback" && caption && (
                  <motion.p initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute left-2 right-2 top-2 mx-auto w-fit max-w-[90%] rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs font-semibold text-white sm:text-sm" aria-hidden>
                    {caption}
                  </motion.p>
                )}
                {paused && (
                  <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-amber-200">
                    <Pause className="h-3.5 w-3.5" /> Paused while you get help
                  </span>
                )}
              </div>
              <HazardMeter value={hazard} />
            </div>

            {/* the panel */}
            <div className="flex min-h-0 flex-col gap-2 lg:overflow-y-auto lg:pr-1">
              <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">{scene.stage}</p>
                  {phase === "scene" && <Countdown key={scene.id} seconds={scene.timerS} elapsed={elapsed} paused={paused} />}
                </div>
                <p className="mt-1 text-[15px] leading-snug text-white">{scene.narration}</p>
                {phase === "scene" && <p className="mt-2 text-[15px] font-semibold text-amber-200">{scene.prompt || "What do you do?"}</p>}
                {phase === "scene" && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      onClick={() => (hintOpen ? setHintOpen(false) : void takeHint())}
                      aria-expanded={hintOpen}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset transition ${hintOpen || offer ? "bg-amber-300/20 text-amber-100 ring-amber-300/60" : "bg-white/[0.06] text-white ring-white/15 hover:bg-white/[0.1]"}`}
                    >
                      <Lightbulb className="h-4 w-4 text-amber-300" /> {hints.length ? `Hint ${Math.min(hints.length, 3)}/3` : "I'm stuck: hint"}
                    </button>
                    {renderHelper && (
                      <button
                        onClick={() => {
                          setOffer(false);
                          setHintOpen(false);
                          setAiOpen((o) => !o);
                        }}
                        aria-expanded={aiOpen}
                        className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset transition ${aiOpen ? "bg-violet-400/25 text-white ring-violet-300/60" : "bg-white/[0.06] text-white ring-white/15 hover:bg-white/[0.1]"}`}
                      >
                        <MessageCircleQuestion className="h-4 w-4 text-violet-300" /> Ask for help
                      </button>
                    )}
                  </div>
                )}
                {phase === "scene" && offer && !hintOpen && !aiOpen && (
                  <motion.p initial={reduced ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2 rounded-lg bg-amber-300/10 px-2.5 py-1.5 text-sm text-amber-100 ring-1 ring-inset ring-amber-300/30" role="status">
                    <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" />
                    <span className="flex-1">Not sure what to do? A hint costs 5 points, and the clock stops while you read it.</span>
                    <button onClick={() => setOffer(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-amber-100/70 hover:bg-white/10" aria-label="No thanks">
                      <X className="h-4 w-4" />
                    </button>
                  </motion.p>
                )}
              </div>

              {phase === "scene" && hintOpen && (
                <HintCard
                  hints={hints}
                  busy={hintBusy}
                  penalty={penalty}
                  reduced={reduced}
                  canShowMe={canShowMe}
                  onMore={() => void takeHint()}
                  onShowMe={showMe}
                  onClose={() => setHintOpen(false)}
                  onAsk={renderHelper ? () => { setHintOpen(false); setAiOpen(true); } : undefined}
                />
              )}

              {phase === "scene" && (
                <>
                  {showList ? (
                    <div className="space-y-1.5" role="group" aria-label="What do you do?">
                      {scene.choices.map((c, i) => (
                        <motion.button key={c.id} onClick={() => void pick(c.id)} disabled={busy} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.06 * i, duration: 0.25 }} className="w-full rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-left text-[15px] font-medium text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.1] disabled:opacity-50">
                          {c.label}
                        </motion.button>
                      ))}
                    </div>
                  ) : (
                    <ToolTray
                      tools={tools}
                      selected={tool}
                      disabled={busy}
                      glow={glowTool}
                      onSelect={(t) => {
                        touch();
                        setTool(t);
                        setMiss(null);
                      }}
                      onDrop={act}
                      onDrag={(d) => {
                        if (d) touch();
                        setDrag(d);
                      }}
                      drag={drag}
                      focusRoom={focusRoom}
                    />
                  )}
                  <p className="min-h-[1.25rem] text-sm text-white/70" aria-live="polite">
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
                  <p className="mt-1.5 text-[15px] leading-relaxed text-white/85">{chosen.feedback}</p>
                  {chosen.ending && <p className="mt-2.5 rounded-lg bg-black/25 p-2.5 text-[15px] text-white/80">{chosen.ending.text}</p>}
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

            {/* the assistant: a column beside the scene on desktop, a bottom sheet on phones (the room stays in view above it) */}
            {helperOpen && (
              <motion.aside
                role="dialog"
                aria-label="Safety coach"
                className="fixed inset-x-0 bottom-0 z-40 flex h-[56vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1426] p-3 shadow-[0_-12px_40px_rgba(0,0,0,.5)] lg:static lg:z-auto lg:h-auto lg:min-h-0 lg:rounded-2xl lg:border lg:shadow-none"
                initial={reduced ? { opacity: 0 } : { y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 360, damping: 34 }}
              >
                <div className="flex min-h-0 flex-1 flex-col">{renderHelper(helper)}</div>
              </motion.aside>
            )}
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

/** The hint ladder: each rung says more (what matters, where to look, what to do). */
function HintCard({
  hints,
  busy,
  penalty,
  reduced,
  canShowMe,
  onMore,
  onShowMe,
  onClose,
  onAsk,
}: {
  hints: ShownHint[];
  busy: boolean;
  penalty: number;
  reduced: boolean;
  canShowMe: boolean;
  onMore: () => void;
  onShowMe: () => void;
  onClose: () => void;
  onAsk: (() => void) | undefined;
}) {
  const top = hints[hints.length - 1];
  const max = top?.rungs ?? 3;
  const offline = hints.some((h) => h.offline);
  const TITLES = ["What matters here", "Where to look", "What to do"];
  return (
    <motion.section initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-amber-300/[0.08] p-3 ring-1 ring-inset ring-amber-300/35" aria-label="Hint" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-200">
          <Lightbulb className="h-3.5 w-3.5" /> Hint {top ? `${top.rung} of ${max}` : ""}
        </p>
        <span className="text-xs text-amber-100/70">{offline ? "Not scored" : penalty > 0 ? `Hints so far: −${penalty} points` : ""}</span>
      </div>
      {!top && busy && <p className="mt-1.5 text-[15px] text-white/70">Thinking of a hint…</p>}
      <ol className="mt-1.5 space-y-1.5">
        {hints.map((h) => (
          <li key={h.rung} className={h === top ? "text-[15px] leading-snug text-white" : "text-sm leading-snug text-white/55"}>
            <span className="font-semibold text-amber-200">{TITLES[h.rung - 1] ?? `Hint ${h.rung}`}: </span>
            {h.text}
          </li>
        ))}
      </ol>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {canShowMe && (
          <button onClick={onShowMe} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-amber-300 px-3 text-sm font-bold text-[#1b1300]">
            <Play className="h-4 w-4" /> Show me
          </button>
        )}
        {top && top.rung < max && (
          <button onClick={onMore} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 disabled:opacity-50">
            Another hint{offline || penalty >= 40 ? "" : " (−5)"}
          </button>
        )}
        {offline && onAsk && (
          <button onClick={onAsk} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/15">
            <MessageCircleQuestion className="h-4 w-4 text-violet-300" /> Ask for help
          </button>
        )}
        <button onClick={onClose} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-white/80 hover:bg-white/[0.06]">
          Got it
        </button>
      </div>
    </motion.section>
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

function Countdown({ seconds, elapsed, paused }: { seconds: number; elapsed: () => number; paused: boolean }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, seconds - elapsed() / 1000)), 200);
    return () => window.clearInterval(id);
  }, [seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/60" role="timer" aria-label={paused ? `Paused at ${Math.ceil(left)} seconds` : `${Math.ceil(left)} seconds`}>
      {paused ? <span className="text-amber-200">Paused</span> : left === 0 && <span className="text-red-300">Act now: it's getting worse</span>}
      <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
        <circle cx={15} cy={15} r={r} stroke="rgba(255,255,255,.12)" strokeWidth={3} fill="none" />
        <circle cx={15} cy={15} r={r} stroke={paused ? "#ffd43b80" : left < seconds * 0.3 ? "#e03131" : "#ffd43b"} strokeWidth={3} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform="rotate(-90 15 15)" />
        <text x={15} y={19} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
          {Math.ceil(left)}
        </text>
      </svg>
    </span>
  );
}
