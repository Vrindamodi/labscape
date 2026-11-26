import { Reveal } from "@labscape/motion";
import { Button, Callout, Card, Chip, ContextPanelSlot, ErrorState, Skeleton, SubjectChip, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, Clock, Crown, Globe2, Layers, Lightbulb, Play, Target, Wrench } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DifficultyDots, ExperimentCardView } from "../components/ExperimentCardView";
import { CardTitle } from "../components/PageHeader";
import { SubjectArt } from "../components/visuals";
import { api, ApiError } from "../lib/api";
import type { ExperimentDetail as Detail } from "../lib/types";

export default function ExperimentDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["experiment", slug], queryFn: () => api<Detail>(`/v1/library/experiments/${slug}`) });

  if (q.isLoading) return <div className="mx-auto max-w-[1100px] space-y-4"><Skeleton className="h-72 rounded-panel" /><Skeleton className="h-48 rounded-card" /></div>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorState title={notFound ? "Experiment not found" : "Couldn't load this experiment"} onRetry={notFound ? undefined : () => void q.refetch()} />;
  }
  const { card: e, concept, realWorld, materials, safety, stageList, related } = q.data;
  const meta = SUBJECTS[e.subject as SubjectKey];

  return (
    <div className="mx-auto max-w-[1100px]">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-line hover:text-ink-strong">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Reveal>
        {/* Hero: a dark media card, so the subject art (drawn for dark) keeps its glow. */}
        <div
          data-surface="dark"
          className="relative overflow-hidden rounded-panel p-6 text-white sm:p-10"
          style={{ background: `radial-gradient(800px 360px at 100% 0%, ${meta.color}50, transparent 60%), linear-gradient(160deg,#242424,#111111)` }}
        >
          <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 md:block">
            <SubjectArt subject={e.subject} size={220} />
          </div>
          <div className="relative max-w-2xl">
            <div className="flex flex-wrap gap-2">
              <SubjectChip subject={e.subject} size="md" />
              {e.completed && <Chip tone="success"><Check className="h-3 w-3" />Completed</Chip>}
              {e.premium && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
              {e.release === "Later" && <Chip>Coming later</Chip>}
            </div>
            <div className="mt-5 text-sm text-white/60">{e.chapter} · {e.topic}</div>
            <h1 className="mt-2 font-heading text-[38px] font-normal leading-[1.04] tracking-[-0.03em] sm:text-[56px]">{e.title}</h1>
            <p className="mt-3 text-lg text-white/70">{e.summary}</p>
            <div className="mt-6 flex flex-wrap items-center gap-5 text-sm text-white/65">
              <DifficultyDots level={e.difficulty} />
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{e.estimatedMinutes} min</span>
              <span className="flex items-center gap-1.5"><Layers className="h-4 w-4" />{e.stages} stages</span>
              <span className="tabular rounded-full bg-tint-yellow px-2.5 py-0.5 font-semibold text-[#3d2a00]">+{e.xpReward} XP</span>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              {e.locked ? (
                <Link to="/plans"><Button size="lg" variant="premium" icon={<Crown className="h-5 w-5" />}>Unlock with Premium</Button></Link>
              ) : (
                <Link to={`/lab/${e.subject}/${e.slug}`}>
                  <Button size="lg" icon={<Play className="h-5 w-5" />}>{e.playable ? "Start experiment" : "Preview the lab"}</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card className="p-6 sm:p-7">
            <CardTitle icon={<Target className="h-4 w-4 text-link" />}>What you'll do</CardTitle>
            <ul className="mt-4 space-y-2.5">
              {e.objectives.map((o) => (
                <li key={o} className="flex gap-2.5 text-ink"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1E8E3E]" />{o}</li>
              ))}
            </ul>
          </Card>
          <Card className="p-6 sm:p-7">
            <CardTitle icon={<Lightbulb className="h-4 w-4 text-[#9A6B00]" />}>The concept</CardTitle>
            <p className="mt-4 leading-relaxed text-ink">{concept}</p>
            <h3 className="mt-6 flex items-center gap-2 text-sm font-medium text-ink-muted"><Globe2 className="h-4 w-4" />Where you'll see it</h3>
            <div className="mt-2.5 flex flex-wrap gap-2">{realWorld.map((r) => <Chip key={r}>{r}</Chip>)}</div>
          </Card>
          <Card className="p-6 sm:p-7">
            <CardTitle icon={<BookOpen className="h-4 w-4 text-link" />}>Six stages</CardTitle>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2">
              {stageList.map((s, i) => (
                <li key={s} className="flex items-center gap-3 rounded-[18px] bg-surface p-3">
                  <span className="tabular grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-[#1a1a1a]" style={{ background: meta.tint }}>{i + 1}</span>
                  <span className="text-sm text-ink-strong">{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-6">
            <CardTitle icon={<Wrench className="h-4 w-4 text-ink-muted" />}>Equipment</CardTitle>
            <div className="mt-4 flex flex-wrap gap-2">{e.equipment.map((x) => <Chip key={x} tone="blue">{x}</Chip>)}</div>
            {materials.length > 0 && (
              <>
                <h3 className="mt-6 text-sm font-medium text-ink-muted">Materials</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink">{materials.map((m) => <li key={m}>• {m}</li>)}</ul>
              </>
            )}
            {(q.data.elements?.length ?? 0) > 0 && (
              <>
                <h3 className="mt-6 text-sm font-medium text-ink-muted">Elements involved</h3>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {q.data.elements!.map((s) => (
                    <Link key={s} to={`/periodic-table?el=${s}`} className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-sm font-bold text-ink-strong ring-1 ring-inset ring-line transition hover:bg-ink-strong hover:text-on-ink hover:ring-ink-strong" title={`Open ${s} in the periodic table`}>
                      {s}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
          {safety.length > 0 && (
            <Callout tone="danger" title="Safety notes">
              <ul className="space-y-1">{safety.map((s) => <li key={s}>{s}</li>)}</ul>
            </Callout>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 font-heading text-[26px] font-medium tracking-[-0.02em] text-ink-strong">More in {meta.label}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => <ExperimentCardView key={r.id} e={r} compact />)}
          </div>
        </section>
      )}

      <ContextPanelSlot name="info">
        <div className="space-y-2 text-sm">
          {/* Portalled into the shell's light context panel, so it uses the surface tokens. */}
          <div className="font-heading font-medium text-ink-strong">{e.title}</div>
          <p className="text-ink-muted">{concept}</p>
        </div>
      </ContextPanelSlot>
    </div>
  );
}
