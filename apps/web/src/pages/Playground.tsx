import { GraphSandbox, type GraphBuild } from "@labscape/mathlab";
import { CIRCUIT_EXAMPLES, CircuitSandbox, MOTION_TABS, MotionSandbox, type CircuitBuild, type MotionBuild, type MotionTab } from "@labscape/physics";
import { Button, cx, ErrorState, FullscreenLab, Skeleton, useShell } from "@labscape/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, ArrowRight, Beaker, Cable, Crown, FunctionSquare, History, Infinity as InfinityIcon, Orbit, Sparkles, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { api, ApiError, post } from "../lib/api";

export type Mode = "chemistry" | "circuits" | "motion" | "graphing";
type Usage = { usedToday: number; limit?: number | null };
type Item = { id: string; mode: Mode; title: string | null; startedAt: string; updatedAt: string; hasSnapshot: boolean };
type Started = { id: string; mode: Mode; snapshot: unknown; usage: Usage };

const MODES: Record<Mode, { title: string; blurb: string; icon: LucideIcon; tint: string; to: string }> = {
  chemistry: { title: "Chemistry bench", blurb: "Mix anything on the shelf. The safety engine decides what really happens.", icon: Beaker, tint: "#48F08B", to: "/playground/chemistry" },
  circuits: { title: "Circuit builder", blurb: "Batteries, bulbs, motors, buzzers, dimmers and light sensors: wire them however you like and build a night light or an alarm.", icon: Cable, tint: "#5E9BFF", to: "/playground/circuits" },
  motion: { title: "Motion lab", blurb: "Throw things on the Moon, crash carts together, bounce a mass on a spring, slide a block down a ramp.", icon: Orbit, tint: "#C9B8FF", to: "/playground/motion" },
  graphing: { title: "Graphing", blurb: "Plot up to six functions, turn every letter into a slider and draw the slope of any curve.", icon: FunctionSquare, tint: "#FCC934", to: "/playground/graphing" },
};

/** The same idea seen from two subjects (build plan 4.9: cross-subject bridges). */
const BRIDGES: { id: string; title: string; body: string; graph: GraphBuild; other: { label: string; to: string } }[] = [
  {
    id: "ohm",
    title: "Ohm's law is a straight line",
    body: "Current against voltage for a resistor is y = x / R: a line through the origin whose gradient is 1/R. Build the circuit, then change R on the graph.",
    graph: { fns: [{ src: "x / R", colour: "#7cf3ff" }], params: { R: 2 }, view: { x0: -1, x1: 12, y0: -1, y1: 7 } },
    other: { label: "Build the circuit", to: "/playground/circuits?example=ohm" },
  },
  {
    id: "projectile",
    title: "A thrown ball draws a parabola",
    body: "Height against distance is a quadratic in x. The angle a and speed u set its shape; gravity is 9.81.",
    graph: { fns: [{ src: "x*tan(a) - 9.81*x^2/(2*u^2*cos(a)^2)", colour: "#ffd43b" }], params: { a: 0.8, u: 10 }, view: { x0: -1, x1: 12, y0: -1, y1: 5 } },
    other: { label: "Launch one", to: "/playground/motion?tab=projectile" },
  },
  {
    id: "pendulum",
    title: "A pendulum swings in a sine wave",
    body: "For small swings the angle over time is A sin(2πt / T), with T = 2π√(L/g). Change T and compare it with a real pendulum.",
    graph: { fns: [{ src: "A*sin(2*pi*x/T)", colour: "#a78bfa" }], params: { A: 1, T: 2 }, view: { x0: 0, x1: 8, y0: -2, y1: 2 } },
    other: { label: "Swing a pendulum", to: "/playground/motion?tab=pendulum" },
  },
  {
    id: "growth",
    title: "Reaction rates and exponential decay",
    body: "As a reactant is used up its concentration falls like c = c₀e^(−kx). A bigger k means a faster reaction.",
    graph: { fns: [{ src: "c*exp(-k*x)", colour: "#51cf66" }], params: { c: 1, k: 0.5 }, view: { x0: -0.5, x1: 10, y0: -0.2, y1: 1.4 } },
    other: { label: "Try reactions", to: "/playground/chemistry" },
  },
];

/** Pill link on white cards: cream at rest, ink on hover. */
const PILL = "rounded-full bg-surface px-4 py-2 text-sm font-medium text-ink-strong ring-1 ring-inset ring-line transition hover:bg-ink-strong hover:text-on-ink";
const SECTION = "mb-4 font-heading text-[26px] font-medium leading-tight tracking-[-0.02em] text-ink-strong";

const fmtWhen = (s: string) => new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function UsageMeter({ usage }: { usage: Usage }) {
  if (usage.limit == null)
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-tint-yellow px-3 py-1.5 text-xs font-semibold text-[#3d2a00]">
        <InfinityIcon className="h-4 w-4" /> Unlimited sessions
      </span>
    );
  const left = Math.max(0, usage.limit - usage.usedToday);
  return (
    <div className="w-60 rounded-[20px] bg-card px-4 py-3" aria-label={`${left} of ${usage.limit} free sessions left today`}>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>Free sessions today</span>
        <span className="font-mono text-ink-strong">
          {usage.usedToday}/{usage.limit}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={cx("h-full rounded-full", left === 0 ? "bg-[#D93025]" : "bg-ink-strong")} style={{ width: `${Math.min(100, (usage.usedToday / usage.limit) * 100)}%` }} />
      </div>
    </div>
  );
}

/** /playground: pick a mode, reopen past builds, follow a bridge between subjects. */
export default function Playground() {
  const q = useQuery({ queryKey: ["playground-sessions"], queryFn: () => api<{ sessions: Item[]; usage: Usage }>("/v1/playground/sessions") });
  if (q.isError) return <ErrorState title="Couldn't open the playground" onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-[1100px] space-y-7">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Labs
          </span>
        }
        title="Playground"
        sub="No steps, no scores. Build, break and try things the experiments don't let you."
        aside={q.data && <UsageMeter usage={q.data.usage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(MODES) as Mode[]).map((m) => {
          const M = MODES[m];
          return (
            <Link key={m} to={M.to} className="group rounded-card bg-card p-6 transition hover:shadow-lift">
              <span className="grid h-12 w-12 place-items-center rounded-full text-[#1a1a1a]" style={{ background: M.tint }}>
                <M.icon className="h-6 w-6" />
              </span>
              <h2 className="mt-4 flex items-center gap-2 font-heading text-xl font-medium text-ink-strong">
                {M.title} <ArrowRight className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{M.blurb}</p>
            </Link>
          );
        })}
      </div>

      <section>
        <h2 className={SECTION}>Bridges between subjects</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {BRIDGES.map((b) => (
            <div key={b.id} className="rounded-card bg-card p-6">
              <h3 className="font-heading text-lg font-medium text-ink-strong">{b.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{b.body}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/playground/graphing?bridge=${b.id}`} className={PILL}>
                  See the graph
                </Link>
                <Link to={b.other.to} className={PILL}>
                  {b.other.label}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className={cx(SECTION, "flex items-center gap-2.5")}>
          <History className="h-5 w-5 text-ink-muted" /> Recent sessions
        </h2>
        {q.isLoading && <Skeleton className="h-24 rounded-card" />}
        {q.data && q.data.sessions.length === 0 && <p className="rounded-card bg-card p-6 text-center text-sm text-ink-muted">Your builds will appear here so you can pick up where you left off.</p>}
        <ul className="space-y-2">
          {(q.data?.sessions ?? []).map((s) => {
            const M = MODES[s.mode];
            const resumable = s.mode !== "chemistry" && s.hasSnapshot;
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-[20px] bg-card px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#1a1a1a]" style={{ background: M.tint }}>
                  <M.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-strong">{s.title ?? M.title}</span>
                  <span className="text-xs text-ink-muted">{fmtWhen(s.updatedAt)}</span>
                </span>
                {resumable && (
                  <Link to={`${M.to}?resume=${s.id}`} className={PILL}>
                    Reopen
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * Opens (or resumes) a server session for a playground mode. The query is keyed on the navigation,
 * so StrictMode's double effect and re-renders share one POST.
 */
export function usePlaygroundSession(mode: Mode) {
  const [params] = useSearchParams();
  const location = useLocation();
  const resume = params.get("resume");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["playground-start", mode, resume, location.key],
    queryFn: async () => {
      const s = await post<Started>("/v1/playground/sessions", { mode, ...(resume ? { resume } : {}) });
      void qc.invalidateQueries({ queryKey: ["playground-sessions"] });
      return s;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const limited = q.error instanceof ApiError && q.error.status === 402;
  return { session: q.data ?? null, loading: q.isPending, limited, error: q.isError && !limited ? q.error : null, retry: () => void q.refetch() };
}

export function LimitReached({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-2xl bg-white/[0.04] p-8 text-center ring-1 ring-inset ring-white/[0.08]">
        <Crown className="mx-auto h-10 w-10 text-amber-300" />
        <h1 className="mt-3 font-heading text-2xl font-bold text-white">That's today's free sessions</h1>
        <p className="mt-2 text-sm text-white/65">You can reopen anything you built earlier today. Premium makes playground sessions unlimited, or come back tomorrow for more.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back to the playground
          </Button>
          <Link to="/plans">
            <Button variant="premium">See Premium</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/** /playground/:mode for the circuit, motion and graphing sandboxes, with autosave. */
export function PlaygroundRun() {
  const { mode = "" } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setAutosaveState } = useShell();
  const m = (["circuits", "motion", "graphing"] as const).find((x) => x === mode);
  const { session, loading, limited, error, retry } = usePlaygroundSession(m ?? "circuits");
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  useEffect(() => setTitle(""), [session?.id]);

  const save = useMutation({
    mutationFn: (body: { snapshot?: unknown; title?: string }) => api(`/v1/playground/sessions/${session!.id}`, { method: "PUT", json: body }),
    onMutate: () => setAutosaveState("saving"),
    onSuccess: () => {
      setAutosaveState("saved", Date.now());
      void qc.invalidateQueries({ queryKey: ["playground-sessions"] });
    },
    onError: () => setAutosaveState("error"),
  });
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<unknown>(null);
  const { mutate } = save;
  const onChange = useCallback(
    (snapshot: unknown) => {
      latest.current = snapshot;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => mutate({ snapshot }), 1200);
    },
    [mutate],
  );
  // Flush on leave.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (latest.current && session) void api(`/v1/playground/sessions/${session.id}`, { method: "PUT", json: { snapshot: latest.current } }).catch(() => {});
    },
    [session],
  );

  if (!m) return <ErrorState title="No such playground" onRetry={() => navigate("/playground")} />;
  const M = MODES[m];
  const bridge = BRIDGES.find((b) => b.id === params.get("bridge"));
  const example = CIRCUIT_EXAMPLES[params.get("example") ?? ""];
  const tab = MOTION_TABS.find((t) => t === params.get("tab")) as MotionTab | undefined;
  let body: ReactNode = null;
  if (session) {
    const snap = session.snapshot as Record<string, unknown> | null;
    if (m === "circuits") body = <CircuitSandbox key={session.id} initial={(snap as CircuitBuild | null) ?? (example ? structuredClone(example.build) : null)} onChange={onChange} />;
    else if (m === "motion") body = <MotionSandbox key={session.id} initial={(snap as MotionBuild | null) ?? (tab ? { tab } : null)} onChange={onChange} />;
    else body = <GraphSandbox key={session.id} initial={(snap as GraphBuild | null) ?? bridge?.graph ?? null} onChange={onChange} renderTex={(tex) => katex.renderToString(tex, { throwOnError: false })} />;
  }

  return (
    <FullscreenLab>
      <div className="flex h-screen flex-col bg-[#0b0f1a] text-white">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
          <button onClick={() => navigate("/playground")} className="grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Back to the playground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <M.icon className="h-5 w-5" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && session && save.mutate({ title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder={bridge?.title ?? M.title}
            aria-label="Name this build"
            maxLength={80}
            className="min-w-0 flex-1 bg-transparent font-heading font-semibold placeholder:text-white/80 focus:outline-none"
          />
          {session?.usage.limit != null && <span className="hidden text-xs text-white/45 sm:block">{((n) => `${n} free session${n === 1 ? "" : "s"} left today`)(Math.max(0, session.usage.limit - session.usage.usedToday))}</span>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {loading && <Skeleton className="h-[70vh] rounded-2xl" />}
          {limited && <LimitReached onBack={() => navigate("/playground")} />}
          {error && <ErrorState title="Couldn't start the playground" onRetry={retry} />}
          {bridge && session && !session.snapshot && <p className="mb-3 rounded-lg bg-white/[0.04] px-4 py-2 text-sm text-white/70">{bridge.body}</p>}
          {body}
        </div>
      </div>
    </FullscreenLab>
  );
}
