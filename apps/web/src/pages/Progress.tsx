import { CountUp } from "@labscape/motion";
import { Button, Card, Chip, ErrorState, ProgressRing, Skeleton, SUBJECTS, XpBar, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { Beaker, Crown, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { CardTitle, PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { EntitlementsView, Summary } from "../lib/types";
import { timeAgo } from "../shell/AppShell";
import { Levels } from "./levels";

const KIND_LABEL: Record<string, string> = {
  "experiment.completed": "Completed an experiment",
  "quiz.completed": "Finished a quiz",
  "challenge.completed": "Daily challenge",
  "scenario.completed": "Emergency scenario",
  "concept.discovered": "New concept",
  "chapter.completed": "Chapter complete",
  "playground.discovery": "Playground discovery",
  "molecular_view.opened": "Molecular view",
  "onboarding.completed": "Joined LABscape",
};

export default function Progress() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/v1/rewards/summary") });
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => api<EntitlementsView>("/v1/entitlements") });
  if (!me) return null;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const s = q.data;
  const detailed = ent.data?.values["analytics.detailed"] === true;

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <PageHeader eyebrow="You" title="Progress" sub="Everything you've earned, and where to go next." className="mb-2" />

      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing value={me.level.xpForNext ? me.level.xpIntoLevel / me.level.xpForNext : 1} size={104} stroke={8} color="#2F80FF">
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">Level</div>
              <div className="font-heading text-[34px] font-medium leading-none text-ink-strong">{me.level.index + 1}</div>
            </div>
          </ProgressRing>
          <div className="min-w-[220px] flex-1">
            <div className="font-heading text-[30px] font-normal tracking-[-0.02em] text-ink-strong">{me.level.name}</div>
            <XpBar value={me.level.xpForNext ? me.level.xpIntoLevel / me.level.xpForNext : 1} className="mt-3" height={12} />
            <div className="tabular mt-2 text-sm text-ink-muted">
              {me.totalXp.toLocaleString()} XP total{me.level.xpForNext ? ` · ${(me.level.xpForNext - me.level.xpIntoLevel).toLocaleString()} to ${Levels[me.level.index + 1]}` : ""}
            </div>
          </div>
        </div>
        <LevelTrack index={me.level.index} />
      </Card>

      {!s ? (
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Big label="XP today" value={s.xpToday} />
            <Big label="XP this week" value={s.xpThisWeek} />
            <Big label="Experiments" value={s.counts.experiments} />
            <Big label="Discoveries" value={s.counts.discoveries} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-6 sm:p-7">
              <CardTitle>By subject</CardTitle>
              <div className="mt-6 flex justify-around">
                {(["chemistry", "physics", "maths"] as SubjectKey[]).map((k) => {
                  const xp = s.xpBySubject[k] ?? 0;
                  const max = Math.max(1, ...Object.values(s.xpBySubject));
                  return (
                    <div key={k} className="flex flex-col items-center gap-2">
                      <ProgressRing value={xp / max} size={92} stroke={8} color={SUBJECTS[k].ink}>
                        <span className="tabular font-heading text-lg font-medium text-ink-strong">{xp}</span>
                      </ProgressRing>
                      <span className="text-sm text-ink-muted">{SUBJECTS[k].label}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-6 sm:p-7">
              <CardTitle>Recent activity</CardTitle>
              {s.recent.length === 0 ? (
                <div className="mt-6 text-center">
                  <p className="text-sm text-ink-muted">Nothing yet. Your first discovery is a few clicks away.</p>
                  <Link to="/playground/chemistry"><Button size="sm" className="mt-3" icon={<Beaker className="h-4 w-4" />}>Open the Playground</Button></Link>
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {s.recent.map((a, i) => (
                    <li key={i} className="flex items-center gap-3 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tint-yellow/40 text-[#7A5200]"><Sparkles className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink-strong">{KIND_LABEL[a.kind] ?? a.kind}</span>
                        <span className="block truncate text-xs text-ink-muted">{a.refId.replace(/[-_]/g, " ")} · {timeAgo(a.at)}</span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-ink-strong">{a.xp > 0 ? `+${a.xp}` : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="relative overflow-hidden p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Detailed analytics</CardTitle>
              {!detailed && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
            </div>
            <p className="mt-2 text-sm text-ink-muted">Procedural accuracy over time, quiz accuracy by topic and a strengths radar. Fills in as experiments and quizzes land.</p>
            <div className={detailed ? "" : "pointer-events-none select-none blur-[3px]"}>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {["Procedural accuracy", "Quiz accuracy", "Avg. time per lab"].map((l, i) => (
                  <div key={l} className="rounded-[20px] bg-surface p-4">
                    <div className="text-xs text-ink-muted">{l}</div>
                    <div className="mt-1 font-heading text-2xl font-medium text-ink-strong">{i === 1 ? `${s.counts.quizAccuracy}%` : "—"}</div>
                  </div>
                ))}
              </div>
            </div>
            {!detailed && (
              <div className="absolute inset-0 grid place-items-center bg-card/40">
                <Link to="/plans"><Button variant="premium" icon={<Lock className="h-4 w-4" />}>Unlock detailed analytics</Button></Link>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Big({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 font-heading text-[32px] font-medium leading-tight tracking-tight text-ink-strong"><CountUp value={value} /></div>
    </Card>
  );
}

function LevelTrack({ index }: { index: number }) {
  return (
    <div className="mt-8 grid grid-cols-7 gap-1.5">
      {Levels.map((name, i) => (
        <div key={name} className="text-center">
          <div className={`h-1.5 rounded-full ${i <= index ? "bg-accent" : "bg-ink/10"}`} />
          <div className={`mt-2 hidden text-[11px] leading-tight md:block ${i === index ? "font-semibold text-ink-strong" : "text-ink-muted"}`}>{name}</div>
        </div>
      ))}
    </div>
  );
}
