import type { LabEvent } from "@labscape/contracts";
import { useLabSession, Workbench, type ExperimentContent } from "@labscape/lab-engine";
import { MATHS_CONTENT, MATHS_MODELS, MATHS_WORKSPACES } from "@labscape/mathlab";
import { PHYSICS_CONTENT, PHYSICS_MODELS, PHYSICS_WORKSPACES, useSimSession, type SimContent, type SimModel, type WorkspaceProps } from "@labscape/physics";
import { Button, cx, ErrorState, FullscreenLab, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Columns2, Loader2, NotebookPen, Pause, Play, ShieldQuestion, SkipForward, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

type Dev = { stepId: string; code: string; severity: string; message: string; t: number };
type ReplayData = {
  attemptId: string;
  slug: string;
  subject: "chemistry" | "physics" | "maths";
  title: string;
  events: LabEvent[];
  report: { score?: number; deviations?: Dev[] } | null;
  engineVersion: string | null;
};
type Script = { t: number; type: LabEvent["type"]; payload: unknown }[];

/** One clock both panes follow. */
type Clock = { t: number; duration: number; playing: boolean; setPlaying: (p: boolean) => void; seek: (t: number) => void; speed: number; setSpeed: (s: number) => void };

const SPEEDS = [0.5, 1, 2, 4];
const fmt = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, "0")}:${Math.floor((ms / 1000) % 60).toString().padStart(2, "0")}`;

type Sim = { content: SimContent; model: SimModel<unknown>; Workspace: ComponentType<WorkspaceProps> };
function simFor(slug: string): Sim | null {
  const content = PHYSICS_CONTENT[slug] ?? MATHS_CONTENT[slug];
  const model = PHYSICS_MODELS[slug] ?? MATHS_MODELS[slug];
  const Workspace = PHYSICS_WORKSPACES[slug] ?? MATHS_WORKSPACES[slug];
  return content && model && Workspace ? { content, model, Workspace } : null;
}

/**
 * /replay/:attemptId: watch a finished attempt again, from its own event log (build plan 4.7).
 * Mistakes are marked on the timeline; split view runs the ideal run alongside as a ghost.
 */
export default function Replay() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["replay", attemptId], queryFn: () => api<ReplayData>(`/v1/replay/${attemptId}`) });
  const sim = q.data && q.data.subject !== "chemistry" ? simFor(q.data.slug) : null;
  const chem = useQuery({
    queryKey: ["experiment-full", q.data?.slug],
    queryFn: () => api<{ content: ExperimentContent }>(`/v1/experiments/${q.data!.slug}`),
    enabled: !!q.data && q.data.subject === "chemistry",
  });
  const script = useMemo<Script>(() => (q.data?.events ?? []).map((e) => ({ t: e.t, type: e.type, payload: e.payload })), [q.data]);

  return (
    <FullscreenLab>
      <div className="flex h-screen flex-col bg-[#0b0f1a] text-white">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
          <button onClick={() => navigate(-1)} className="grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Replay</div>
            <div className="truncate font-heading font-semibold">{q.data?.title ?? "…"}</div>
          </div>
          {q.data && <HashBadge d={q.data} />}
          {q.data && (
            <Link to={`/notebook/${q.data.attemptId}`} className="hidden items-center gap-1.5 rounded-md bg-white/[0.07] px-3 py-2 text-sm font-semibold sm:flex">
              <NotebookPen className="h-4 w-4" /> Notebook
            </Link>
          )}
        </header>
        <div className="min-h-0 flex-1">
          {q.isError && <ErrorState title="Couldn't load this replay" onRetry={() => void q.refetch()} />}
          {(q.isLoading || chem.isLoading) && <Skeleton className="m-4 h-[70vh] rounded-2xl" />}
          {q.data && sim && <SimReplay d={q.data} sim={sim} script={script} />}
          {q.data && chem.data && <ChemReplay d={q.data} content={chem.data.content} script={script} />}
        </div>
      </div>
    </FullscreenLab>
  );
}

type Verification = { storedHash: string | null; replayHash: string | null; hashMatches: boolean | null; engineVersion: string | null };

/** The server re-runs the log through today's engine; long reactions take a while, so it loads on its own. */
function HashBadge({ d }: { d: ReplayData }) {
  const v = useQuery({ queryKey: ["replay-verify", d.attemptId], queryFn: () => api<Verification>(`/v1/replay/${d.attemptId}/verify`), staleTime: Infinity });
  if (v.isPending)
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1 text-xs font-semibold text-white/60" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…
      </span>
    );
  if (!v.data || v.data.hashMatches === null) return null;
  return v.data.hashMatches ? (
    <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200" aria-live="polite" title={`Replaying your ${d.events.length} actions reproduced the exact lab state the server scored (${v.data.replayHash?.slice(0, 10)}…).`}>
      <BadgeCheck className="h-4 w-4" /> Verified replay
    </span>
  ) : (
    <span className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-200" title={`Recorded with engine ${v.data.engineVersion ?? d.engineVersion ?? "?"}; today's engine reaches a different state.`}>
      <ShieldQuestion className="h-4 w-4" /> Older engine
    </span>
  );
}

/* ------------------------------------------------------------------ chemistry */

function ChemReplay({ d, content, script }: { d: ReplayData; content: ExperimentContent; script: Script }) {
  const session = useLabSession(content, { mode: "demo", script });
  const duration = (script[script.length - 1]?.t ?? 0) + 3000;
  const clock: Clock = {
    t: Math.min(session.t, duration),
    duration,
    playing: !session.paused && session.t < duration,
    setPlaying: (p) => {
      if (p && session.t >= duration) session.seek(0);
      session.setPaused(!p);
    },
    seek: session.seek,
    speed: session.speed,
    setSpeed: session.setSpeed,
  };
  // Stop at the end rather than idling on.
  const { setPaused } = session;
  useEffect(() => {
    if (session.t >= duration) setPaused(true);
  }, [session.t, duration, setPaused]);
  return (
    <ReplayFrame d={d} clock={clock} golden={content.golden.events.length} goldenMs={content.golden.events[content.golden.events.length - 1]?.t ?? 0} ghost={(split) => (split ? <ChemGhost content={content} clock={clock} /> : null)}>
      <Workbench session={session} readOnly />
    </ReplayFrame>
  );
}

function ChemGhost({ content, clock }: { content: ExperimentContent; clock: Clock }) {
  const g = useLabSession(content, { mode: "demo" });
  useGhostSync({ t: g.t, seek: g.seek, setPaused: g.setPaused, setSpeed: g.setSpeed }, clock);
  return <Workbench session={g} readOnly />;
}

/* ------------------------------------------------------------------ physics and maths */

function SimReplay({ d, sim, script }: { d: ReplayData; sim: Sim; script: Script }) {
  const session = useSimSession(sim.content, sim.model, { mode: "demo", script });
  const W = sim.Workspace;
  const clock: Clock = { ...session.demo };
  return (
    <ReplayFrame d={d} clock={clock} golden={sim.content.golden.events.length} goldenMs={sim.content.golden.durationS * 1000} ghost={(split) => (split ? <SimGhost sim={sim} clock={clock} /> : null)}>
      <div className="pointer-events-none h-full overflow-hidden [&_*]:pointer-events-none">
        <W session={session} />
      </div>
    </ReplayFrame>
  );
}

function SimGhost({ sim, clock }: { sim: Sim; clock: Clock }) {
  const g = useSimSession(sim.content, sim.model, { mode: "demo" });
  useGhostSync({ t: g.demo.t, seek: g.demo.seek, setPaused: (p) => g.demo.setPlaying(!p), setSpeed: g.demo.setSpeed }, clock);
  const W = sim.Workspace;
  return (
    <div className="pointer-events-none h-full overflow-hidden [&_*]:pointer-events-none">
      <W session={g} />
    </div>
  );
}

/** Keeps the ghost (ideal run) on the learner's clock: same play state and speed, re-seeks on drift. */
function useGhostSync(g: { t: number; seek: (t: number) => void; setPaused: (p: boolean) => void; setSpeed: (s: number) => void }, clock: Clock) {
  const { seek, setPaused, setSpeed } = g;
  useEffect(() => setPaused(!clock.playing), [clock.playing, setPaused]);
  useEffect(() => setSpeed(clock.speed), [clock.speed, setSpeed]);
  const drift = Math.abs(g.t - clock.t) > 1200;
  useEffect(() => {
    if (drift) seek(clock.t);
  }, [drift]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------------------------------------------ shared frame */

function ReplayFrame({ d, clock, golden, goldenMs, ghost, children }: { d: ReplayData; clock: Clock; golden: number; goldenMs: number; ghost: (split: boolean) => ReactNode; children: ReactNode }) {
  const [split, setSplit] = useState(false);
  const devs = useMemo(() => [...(d.report?.deviations ?? [])].sort((a, b) => a.t - b.t), [d.report]);
  const nextDev = devs.find((x) => x.t > clock.t + 300);
  const lastT = d.events[d.events.length - 1]?.t ?? 0;
  const pct = (t: number) => `${Math.min(100, (t / Math.max(1, clock.duration)) * 100)}%`;

  // Keyboard: space plays, arrows step 5 s, n jumps to the next mistake.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,button")) return;
      if (e.key === " ") {
        e.preventDefault();
        clock.setPlaying(!clock.playing);
      } else if (e.key === "ArrowRight") clock.seek(Math.min(clock.duration, clock.t + 5000));
      else if (e.key === "ArrowLeft") clock.seek(Math.max(0, clock.t - 5000));
      else if (e.key === "n" && nextDev) clock.seek(Math.max(0, nextDev.t - 1500));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)_auto]">
      <div className={cx("grid min-h-0 min-w-0 gap-2 p-3", split && "grid-rows-2 md:grid-cols-2 md:grid-rows-1")}>
        <Pane label="Your run" tone="#2f80ff">
          {children}
        </Pane>
        {split && (
          <Pane label="Ideal run" tone="#a78bfa">
            {ghost(true)}
          </Pane>
        )}
      </div>

      <aside className="row-span-2 hidden min-h-0 flex-col gap-3 overflow-y-auto border-l border-white/[0.07] bg-[#0d1426]/70 p-4 lg:flex" aria-label="Differences from the ideal run">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Compared with the ideal run</h2>
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white/[0.04] p-2">
            <dt className="text-white/45">Actions</dt>
            <dd className="mt-0.5 font-mono text-sm text-white">
              {d.events.length} <span className="text-white/40">/ {golden}</span>
            </dd>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-2">
            <dt className="text-white/45">Time</dt>
            <dd className="mt-0.5 font-mono text-sm text-white">
              {fmt(lastT)} <span className="text-white/40">/ {fmt(goldenMs)}</span>
            </dd>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-2">
            <dt className="text-white/45">Score</dt>
            <dd className="mt-0.5 font-mono text-sm text-white">{d.report?.score ?? "–"}%</dd>
          </div>
        </dl>
        {devs.length === 0 ? (
          <p className="rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-100">No procedure mistakes in this run.</p>
        ) : (
          <ol className="space-y-1.5">
            {devs.map((x, i) => (
              <li key={i}>
                <button onClick={() => clock.seek(Math.max(0, x.t - 1500))} className="w-full rounded-lg bg-white/[0.04] p-2.5 text-left text-sm hover:bg-white/[0.08]">
                  <span className="flex items-center gap-2 text-xs">
                    <TriangleAlert className={cx("h-3.5 w-3.5", x.severity === "minor" ? "text-amber-300" : "text-red-400")} />
                    <span className="font-mono text-white/55">{fmt(x.t)}</span>
                    <span className="uppercase tracking-wide text-white/40">{x.severity}</span>
                  </span>
                  <span className="mt-1 block text-white/85">{x.message}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] bg-[#0d1426]/80 px-4 py-3">
        <Button size="sm" variant="secondary" icon={clock.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => clock.setPlaying(!clock.playing)}>
          {clock.playing ? "Pause" : "Play"}
        </Button>
        <div className="relative min-w-[200px] flex-1 py-2">
          <input type="range" min={0} max={clock.duration} value={clock.t} onChange={(e) => clock.seek(Number(e.target.value))} className="relative z-10 w-full accent-[#2f80ff]" aria-label="Replay position" aria-valuetext={fmt(clock.t)} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5" aria-hidden>
            {d.events.map((e, i) => (
              <span key={i} className="absolute top-0 h-1.5 w-px bg-white/30" style={{ left: pct(e.t) }} />
            ))}
            {devs.map((x, i) => (
              <span key={`d${i}`} className={cx("absolute -top-0.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-[#0d1426]", x.severity === "minor" ? "bg-amber-300" : "bg-red-500")} style={{ left: pct(x.t) }} />
            ))}
          </div>
        </div>
        <span className="font-mono text-xs tabular-nums text-white/60">
          {fmt(clock.t)} / {fmt(clock.duration)}
        </span>
        <div className="flex rounded-lg bg-black/25 p-0.5" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={clock.speed === s} onClick={() => clock.setSpeed(s)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold", clock.speed === s ? "bg-accent text-white" : "text-white/55")}>
              {s}×
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" icon={<SkipForward className="h-4 w-4" />} disabled={!nextDev} onClick={() => nextDev && clock.seek(Math.max(0, nextDev.t - 1500))}>
          Next mistake
        </Button>
        <Button size="sm" variant={split ? "primary" : "secondary"} icon={<Columns2 className="h-4 w-4" />} onClick={() => setSplit((s) => !s)} aria-pressed={split}>
          Ideal run
        </Button>
      </div>
    </div>
  );
}

function Pane({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div className="relative min-h-[200px] min-w-0 overflow-hidden rounded-xl ring-1 ring-inset ring-white/[0.08]">
      <span className="absolute left-3 top-3 z-20 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white" style={{ background: `${tone}cc` }}>
        {label}
      </span>
      <div className="h-full">{children}</div>
    </div>
  );
}
