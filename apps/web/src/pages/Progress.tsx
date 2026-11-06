import { CountUp } from "@labscape/motion";
import { Button, Card, Chip, ErrorState, ProgressRing, Skeleton, SUBJECTS, XpBar, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { Beaker, Crown, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
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
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Progress</h1>
        <p className="mt-1 text-white/55">Everything you've earned, and where to go next.</p>
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing value={me.level.xpForNext ? me.level.xpIntoLevel / me.level.xpForNext : 1} size={96} stroke={8} color="#22D3EE">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-white/45">Level</div>
              <div className="font-heading text-3xl font-bold leading-none">{me.level.index + 1}</div>
            </div>
          </ProgressRing>
          <div className="min-w-[220px] flex-1">
            <div className="font-heading text-2xl font-bold">{me.level.name}</div>
            <XpBar value={me.level.xpForNext ? me.level.xpIntoLevel / me.level.xpForNext : 1} className="mt-3" height={12} />
            <div className="tabular mt-1.5 text-sm text-white/50">
              {me.totalXp.toLocaleString()} XP total{me.level.xpForNext ? ` · ${(me.level.xpForNext - me.level.xpIntoLevel).toLocaleString()} to ${Levels[me.level.index + 1]}` : ""}
            </div>
          </div>
        </div>
        <LevelTrack index={me.level.index} />
      </Card>

      {!s ? (
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Big label="XP today" value={s.xpToday} />
            <Big label="XP this week" value={s.xpThisWeek} />
            <Big label="Experiments" value={s.counts.experiments} />
            <Big label="Discoveries" value={s.counts.discoveries} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold">By subject</h2>
              <div className="mt-5 flex justify-around">
                {(["chemistry", "physics", "maths"] as SubjectKey[]).map((k) => {
                  const xp = s.xpBySubject[k] ?? 0;
                  const max = Math.max(1, ...Object.values(s.xpBySubject));
                  return (
                    <div key={k} className="flex flex-col items-center gap-2">
                      <ProgressRing value={xp / max} size={92} stroke={8} color={SUBJECTS[k].color}>
                        <span className="tabular font-heading font-bold">{xp}</span>
                      </ProgressRing>
                      <span className="text-sm text-white/60">{SUBJECTS[k].label}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold">Recent activity</h2>
              {s.recent.length === 0 ? (
                <div className="mt-6 text-center">
                  <p className="text-sm text-white/55">Nothing yet. Your first discovery is a few clicks away.</p>
                  <Link to="/playground/chemistry"><Button size="sm" className="mt-3" icon={<Beaker className="h-4 w-4" />}>Open the Playground</Button></Link>
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-white/[0.05]">
                  {s.recent.map((a, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05]"><Sparkles className="h-4 w-4 text-[#ffd77a]" /></span>
                      <span className="flex-1">
                        <span className="block text-sm">{KIND_LABEL[a.kind] ?? a.kind}</span>
                        <span className="block text-xs text-white/45">{a.refId.replace(/[-_]/g, " ")} · {timeAgo(a.at)}</span>
                      </span>
                      <span className="tabular text-sm font-semibold text-[#ffd77a]">{a.xp > 0 ? `+${a.xp}` : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="relative overflow-hidden p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold">Detailed analytics</h2>
              {!detailed && <Chip tone="gold"><Crown className="h-3 w-3" />Premium</Chip>}
            </div>
            <p className="mt-1 text-sm text-white/55">Procedural accuracy over time, quiz accuracy by topic and a strengths radar. Fills in as experiments and quizzes land.</p>
            <div className={detailed ? "" : "pointer-events-none select-none blur-[3px]"}>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {["Procedural accuracy", "Quiz accuracy", "Avg. time per lab"].map((l, i) => (
                  <div key={l} className="rounded-lg bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.06]">
                    <div className="text-xs text-white/45">{l}</div>
                    <div className="mt-1 font-heading text-2xl font-bold">{i === 1 ? `${s.counts.quizAccuracy}%` : "—"}</div>
                  </div>
                ))}
              </div>
            </div>
            {!detailed && (
              <div className="absolute inset-0 grid place-items-center bg-[#0b1020]/40">
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
      <div className="text-xs text-white/45">{label}</div>
      <div className="mt-1 font-heading text-3xl font-bold"><CountUp value={value} /></div>
    </Card>
  );
}

function LevelTrack({ index }: { index: number }) {
  return (
    <div className="mt-6 grid grid-cols-7 gap-1.5">
      {Levels.map((name, i) => (
        <div key={name} className="text-center">
          <div className="h-1.5 rounded-full" style={{ background: i <= index ? "linear-gradient(90deg,#2f80ff,#22d3ee)" : "rgba(255,255,255,.08)", boxShadow: i === index ? "0 0 10px #22d3ee" : undefined }} />
          <div className={`mt-2 hidden text-[11px] leading-tight md:block ${i === index ? "font-semibold text-white" : "text-white/40"}`}>{name}</div>
        </div>
      ))}
    </div>
  );
}
