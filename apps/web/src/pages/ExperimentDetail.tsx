import { Reveal } from "@labscape/motion";
import { Button, Callout, Card, Chip, ContextPanelSlot, ErrorState, Skeleton, SubjectChip, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, Clock, Crown, Globe2, Layers, Lightbulb, Play, Target, Wrench } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DifficultyDots, ExperimentCardView } from "../components/ExperimentCardView";
import { SubjectArt } from "../components/visuals";
import { api, ApiError } from "../lib/api";
import type { ExperimentDetail as Detail } from "../lib/types";

export default function ExperimentDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["experiment", slug], queryFn: () => api<Detail>(`/v1/library/experiments/${slug}`) });

  if (q.isLoading) return <div className="mx-auto max-w-[1100px] space-y-4"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-48" /></div>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorState title={notFound ? "Experiment not found" : "Couldn't load this experiment"} onRetry={notFound ? undefined : () => void q.refetch()} />;
  }
  const { card: e, concept, realWorld, materials, safety, stageList, related } = q.data;
  const meta = SUBJECTS[e.subject as SubjectKey];

  return (
    <div className="mx-auto max-w-[1100px]">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-6 sm:p-8" style={{ background: `radial-gradient(800px 360px at 100% 0%, ${meta.color}45, transparent 60%), linear-gradient(160deg,#18233f,#0e1529)` }}>
          <div className="absolute right-4 top-1/2 hidden -translate-y-1/2 md:block">
            <SubjectArt subject={e.subject} size={220} />
          </div>
          <div className="relative max-w-2xl">
            <div className="flex flex-wrap gap-2">
              <SubjectChip subject={e.subject} size="md" />
              {e.completed && <Chip tone="success"><Check className="h-3 w-3" />Completed</Chip>}
              {e.premium && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
              {e.release === "Later" && <Chip>Coming later</Chip>}
            </div>
            <div className="mt-4 text-sm text-white/50">{e.chapter} · {e.topic}</div>
            <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight sm:text-5xl">{e.title}</h1>
            <p className="mt-3 text-lg text-white/65">{e.summary}</p>
            <div className="mt-5 flex flex-wrap items-center gap-5 text-sm text-white/60">
              <DifficultyDots level={e.difficulty} />
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{e.estimatedMinutes} min</span>
              <span className="flex items-center gap-1.5"><Layers className="h-4 w-4" />{e.stages} stages</span>
              <span className="tabular font-semibold text-[#ffd77a]">+{e.xpReward} XP</span>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Target className="h-5 w-5 text-accent-cyan" />What you'll do</h2>
            <ul className="mt-3 space-y-2">
              {e.objectives.map((o) => (
                <li key={o} className="flex gap-2.5 text-white/75"><Check className="mt-0.5 h-4 w-4 shrink-0 text-state-success" />{o}</li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Lightbulb className="h-5 w-5 text-[#ffd77a]" />The concept</h2>
            <p className="mt-3 leading-relaxed text-white/75">{concept}</p>
            <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold text-white/60"><Globe2 className="h-4 w-4" />Where you'll see it</h3>
            <div className="mt-2 flex flex-wrap gap-2">{realWorld.map((r) => <Chip key={r}>{r}</Chip>)}</div>
          </Card>
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><BookOpen className="h-5 w-5 text-[#8cbcff]" />Six stages</h2>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2">
              {stageList.map((s, i) => (
                <li key={s} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.06]">
                  <span className="tabular grid h-7 w-7 place-items-center rounded-full text-xs font-bold" style={{ background: `${meta.color}25`, color: meta.color }}>{i + 1}</span>
                  <span className="text-sm">{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><Wrench className="h-4 w-4 text-white/60" />Equipment</h2>
            <div className="mt-3 flex flex-wrap gap-2">{e.equipment.map((x) => <Chip key={x} tone="blue">{x}</Chip>)}</div>
            {materials.length > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-white/60">Materials</h3>
                <ul className="mt-2 space-y-1 text-sm text-white/70">{materials.map((m) => <li key={m}>• {m}</li>)}</ul>
              </>
            )}
            {(q.data.elements?.length ?? 0) > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-white/60">Elements involved</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.data.elements!.map((s) => (
                    <Link key={s} to={`/periodic-table?el=${s}`} className="grid h-9 w-9 place-items-center rounded-md bg-white/[0.05] text-sm font-extrabold text-white ring-1 ring-inset ring-white/15 hover:bg-accent/20 hover:ring-accent" title={`Open ${s} in the periodic table`}>
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
        <section className="mt-10">
          <h2 className="mb-4 font-heading text-lg font-semibold">More in {meta.label}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => <ExperimentCardView key={r.id} e={r} compact />)}
          </div>
        </section>
      )}

      <ContextPanelSlot name="info">
        <div className="space-y-2 text-sm">
          <div className="font-heading font-semibold">{e.title}</div>
          <p className="text-white/60">{concept}</p>
        </div>
      </ContextPanelSlot>
    </div>
  );
}
