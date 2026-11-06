import { CountUp, Reveal, Stagger, StaggerItem, useMotion } from "@labscape/motion";
import { AdSlot, Avatar, Button, Card, Chip, cx, ErrorState, NamedIcon, ProgressRing, Skeleton, SUBJECTS, SubjectChip, TiltCard, XpBar, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Atom, Beaker, Bell, ChevronLeft, ChevronRight, Clock, FunctionSquare, Lock, Search, ShieldAlert, Sparkles, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Board, Challenge, ExperimentCard, LibraryPage, Summary } from "../lib/types";
import { ChallengeRow } from "../shell/AppShell";
import { StreakFlame } from "../shell/brand";
import { SubjectArt } from "../components/visuals";
import { DifficultyDots } from "../components/ExperimentCardView";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { me } = useSession();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/v1/rewards/summary") });
  const challenges = useQuery({ queryKey: ["challenges"], queryFn: () => api<Challenge[]>("/v1/challenges/today") });
  const library = useQuery({ queryKey: ["library", "all"], queryFn: () => api<LibraryPage>("/v1/library/experiments") });
  const board = useQuery({ queryKey: ["board", "weekly"], queryFn: () => api<Board>("/v1/leaderboards/weekly") });
  if (!me) return null;

  const lvl = me.level;
  const login = me.streaks.find((s) => s.kind === "login")?.days ?? 0;
  const interests = me.profile.interests.length ? me.profile.interests : ["chemistry", "physics", "maths"];
  const subjectOrder = [...interests, ...(["chemistry", "physics", "maths"] as const).filter((s) => !interests.includes(s))] as SubjectKey[];

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      {/* Welcome */}
      <Reveal className="order-1">
        <Card className="overflow-hidden p-0">
          <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-7" style={{ background: "radial-gradient(700px 260px at 0% 0%, rgba(47,128,255,.25), transparent 60%), radial-gradient(500px 240px at 100% 100%, rgba(139,92,246,.18), transparent 60%)" }}>
            <Avatar name={me.displayName} spec={me.profile.avatar} size={72} ring={me.plan !== "free" ? "#ffc23d" : "#2f80ff"} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white/55">{greeting()},</div>
              <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
                {me.guest ? "Scientist" : me.displayName.split(" ")[0]} <span className="inline-block origin-[70%_70%] animate-[ls-float_3s_ease-in-out_infinite]">👋</span>
              </h1>
              <div className="mt-3 flex max-w-md items-center gap-3">
                <span className="text-xs font-semibold text-accent-cyan">Lv {lvl.index + 1}</span>
                <XpBar value={lvl.xpForNext ? lvl.xpIntoLevel / lvl.xpForNext : 1} className="flex-1" />
                <span className="tabular text-xs text-white/50">{lvl.xpForNext ? `${lvl.xpIntoLevel}/${lvl.xpForNext}` : "MAX"}</span>
              </div>
              <div className="mt-1 text-xs text-white/45">{lvl.name}{lvl.xpForNext ? ` · ${(lvl.xpForNext - lvl.xpIntoLevel).toLocaleString()} XP to next rank` : ""}</div>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:w-[360px]">
              <Stat label="Total XP" value={<CountUp value={me.totalXp} />} icon={<Sparkles className="h-4 w-4 text-[#ffd77a]" />} />
              <Stat label="Day streak" value={<CountUp value={login} />} icon={<StreakFlame days={login} size={16} />} />
              <Stat label="Unread" value={<CountUp value={me.unreadNotifications} />} icon={<Bell className="h-4 w-4 text-accent-cyan" />} />
            </div>
          </div>
          {me.guest && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-[#ffc23d]/[0.06] px-6 py-3 text-sm">
              <span className="text-white/70">You're playing as a guest. Create a free account to keep your progress on every device.</span>
              <Link to="/signup"><Button size="sm" variant="premium">Save progress</Button></Link>
            </div>
          )}
        </Card>
      </Reveal>

      {/* Explore subjects */}
      <section className="order-4 md:order-3" aria-labelledby="subjects-h">
        <SectionHead id="subjects-h" title="Explore subjects" />
        <Stagger className="grid gap-4 md:grid-cols-3">
          {subjectOrder.map((s, i) => {
            const meta = SUBJECTS[s];
            const total = library.data?.facets.subjects[s] ?? 0;
            const done = library.data?.items.filter((e) => e.subject === s && e.completed).length ?? 0;
            return (
              <StaggerItem key={s} index={i}>
                <TiltCard className="rounded-xl">
                  <Link
                    to={`/library?subject=${s}`}
                    className="group relative flex h-48 flex-col justify-end overflow-hidden rounded-xl border border-white/[0.08] p-5"
                    style={{ background: `radial-gradient(120% 100% at 100% 0%, ${meta.color}40, transparent 55%), linear-gradient(160deg, #1a2440, #111a30)`, boxShadow: `0 30px 70px -40px ${meta.color}` }}
                  >
                    <div className="absolute right-2 top-1 transition-transform duration-slow ease-standard group-hover:-translate-y-1 group-hover:scale-110">
                      <SubjectArt subject={s} size={130} />
                    </div>
                    <div className="relative">
                      <div className="font-heading text-2xl font-bold">{meta.label}</div>
                      <div className="mt-1 flex items-center gap-3 text-sm text-white/60">
                        {library.isLoading ? <Skeleton className="h-4 w-28" /> : <span>{total} experiments · {done} done</span>}
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <motion.div className="h-full rounded-full" style={{ background: meta.color }} initial={{ width: 0 }} animate={{ width: total ? `${(done / total) * 100}%` : "0%" }} transition={{ duration: 0.8 }} />
                      </div>
                    </div>
                    <ArrowRight className="absolute bottom-5 right-5 h-5 w-5 text-white/40 transition group-hover:translate-x-1 group-hover:text-white" />
                  </Link>
                </TiltCard>
              </StaggerItem>
            );
          })}
        </Stagger>
      </section>

      <div className="order-5 md:order-4">
        <AdSlot placement="dashboard.between_sections" />
      </div>

      {/* Featured + daily challenges */}
      <div className="order-3 grid gap-6 md:order-5 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="featured-h" className="order-2 lg:order-1">
          <SectionHead id="featured-h" title="Featured experiments" to="/library?featured=true" />
          {library.isError ? (
            <Card><ErrorState onRetry={() => void library.refetch()} /></Card>
          ) : library.isLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : (
            <FeaturedCarousel items={library.data?.items.filter((e) => e.featured) ?? []} />
          )}
        </section>
        <section aria-labelledby="challenges-h" className="order-1 lg:order-2">
          <SectionHead id="challenges-h" title="Daily challenges" aside={<Chip tone="gold">+75 XP each</Chip>} />
          <Card className="space-y-2.5 p-4">
            {challenges.isError ? (
              <ErrorState onRetry={() => void challenges.refetch()} />
            ) : challenges.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px]" />)
            ) : challenges.data?.length ? (
              challenges.data.map((c) => <ChallengeRow key={c.id} c={c} />)
            ) : (
              <p className="py-6 text-center text-sm text-white/50">New challenges arrive at midnight.</p>
            )}
            <p className="pt-1 text-center text-xs text-white/40">Fresh challenges every day at midnight, picked for your weakest topics.</p>
          </Card>
        </section>
      </div>

      {/* Progress + achievements */}
      <div className="order-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="progress-h">
          <SectionHead id="progress-h" title="Your progress" to="/progress" />
          <Card className="p-5">
            {summary.isLoading ? (
              <Skeleton className="h-40" />
            ) : summary.isError || !summary.data ? (
              <ErrorState onRetry={() => void summary.refetch()} />
            ) : summary.data.recent.length === 0 ? (
              <EmptyProgress />
            ) : (
              <ProgressGlance s={summary.data} />
            )}
          </Card>
        </section>
        <section aria-labelledby="ach-h">
          <SectionHead id="ach-h" title="Achievements" to="/achievements" />
          <Card className="p-5">
            {summary.isLoading ? <Skeleton className="h-40" /> : summary.data && <BadgeStrip s={summary.data} />}
            <div className="mt-5 border-t border-white/[0.06] pt-4">
              {board.isLoading ? (
                <Skeleton className="h-12" />
              ) : board.data?.me ? (
                <Link to="/leaderboard" className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-white/[0.04]">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/15 text-accent-cyan"><Trophy className="h-5 w-5" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">Weekly rank #{board.data.me.rank}</span>
                    <span className="block text-xs text-white/50">of {board.data.participants} scientists · resets Monday</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-white/40" />
                </Link>
              ) : (
                <p className="text-sm text-white/50">Earn XP this week to join the leaderboard.</p>
              )}
            </div>
          </Card>
        </section>
      </div>

      {/* Quick access */}
      <section className="order-7" aria-labelledby="quick-h">
        <SectionHead id="quick-h" title="Quick access" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["/playground/chemistry", "Playground", Beaker, "#E879F9", "Mix anything"],
              ["/emergency", "Emergency", ShieldAlert, "#EF4444", "Lab safety drills"],
              ["/assistant", "AI Assistant", Sparkles, "#8B5CF6", "Ask anything"],
              ["/periodic-table", "Periodic table", Atom, "#22D3EE", "118 elements"],
              ["/formulas", "Formulas", FunctionSquare, "#FB923C", "Every equation"],
              ["/library", "Search", Search, "#2F80FF", "Find a lab"],
            ] as const
          ).map(([to, label, Icon, c, sub]) => (
            <Link key={to} to={to} className="group rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]">
              <span className="grid h-10 w-10 place-items-center rounded-lg transition group-hover:scale-110" style={{ background: `${c}22`, color: c }}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="mt-3 text-sm font-semibold">{label}</div>
              <div className="text-xs text-white/45">{sub}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-black/20 p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">{icon}{label}</div>
      <div className="mt-1 font-heading text-xl font-bold">{value}</div>
    </div>
  );
}

function SectionHead({ id, title, to, aside }: { id: string; title: string; to?: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 id={id} className="font-heading text-lg font-semibold">{title}</h2>
      {to ? (
        <Link to={to} className="flex items-center gap-1 text-sm font-medium text-white/50 hover:text-white">
          See all <ArrowRight className="h-4 w-4" />
        </Link>
      ) : (
        aside
      )}
    </div>
  );
}

/** Crossfade with a slow 1.05 zoom, 6 s per slide, pauses on hover or focus. */
function FeaturedCarousel({ items }: { items: ExperimentCard[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const { reduced, d } = useMotion();
  useEffect(() => {
    if (paused || reduced || items.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % items.length), 6000);
    return () => window.clearInterval(t);
  }, [paused, reduced, items.length]);
  const e = items[i];
  if (!e) return <Card className="p-8 text-center text-white/50">No featured experiments yet.</Card>;
  const meta = SUBJECTS[e.subject as SubjectKey];
  return (
    <div
      className="relative h-[300px] overflow-hidden rounded-xl border border-white/[0.08]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={e.id}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: d(400) }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ scale: 1 }}
            animate={{ scale: reduced ? 1 : 1.05 }}
            transition={{ duration: 6, ease: "linear" }}
            style={{ background: `radial-gradient(700px 320px at 85% 20%, ${meta?.color}55, transparent 60%), radial-gradient(500px 300px at 0% 100%, rgba(47,128,255,.25), transparent 60%), linear-gradient(160deg,#18233f,#0e1529)` }}
          >
            <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 sm:block">
              <SubjectArt subject={e.subject} size={200} />
            </div>
          </motion.div>
          <div className="relative flex h-full flex-col justify-end p-6 sm:max-w-[60%]">
            <div className="flex gap-2"><SubjectChip subject={e.subject} /><Chip tone="violet"><Sparkles className="h-3 w-3" />Editor's pick</Chip></div>
            <h3 className="mt-3 font-heading text-2xl font-bold leading-tight sm:text-3xl">{e.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm text-white/65">{e.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/55">
              <DifficultyDots level={e.difficulty} />
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{e.estimatedMinutes} min</span>
              {e.locked && <span className="flex items-center gap-1 text-[#ffd77a]"><Lock className="h-3.5 w-3.5" />Premium</span>}
              <Link to={`/library/${e.slug}`} className="ml-auto"><Button size="sm" iconRight={<ArrowRight className="h-4 w-4" />}>View</Button></Link>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="absolute right-4 top-4 flex gap-1.5">
        <button aria-label="Previous" onClick={() => setI((n) => (n - 1 + items.length) % items.length)} className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white/70 backdrop-blur hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
        <button aria-label="Next" onClick={() => setI((n) => (n + 1) % items.length)} className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white/70 backdrop-blur hover:text-white"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
        {items.map((x, n) => (
          <button key={x.id} aria-label={`Slide ${n + 1}`} onClick={() => setI(n)} className={cx("h-1.5 rounded-full transition-all", n === i ? "w-6 bg-white" : "w-1.5 bg-white/30")} />
        ))}
      </div>
    </div>
  );
}

function ProgressGlance({ s }: { s: Summary }) {
  const subjects: SubjectKey[] = ["chemistry", "physics", "maths"];
  const max = Math.max(1, ...subjects.map((k) => s.xpBySubject[k] ?? 0));
  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
      <div className="flex gap-4">
        {subjects.map((k) => (
          <div key={k} className="flex flex-col items-center gap-2">
            <ProgressRing value={(s.xpBySubject[k] ?? 0) / max} size={64} stroke={6} color={SUBJECTS[k].color}>
              <span className="tabular text-xs font-bold">{s.xpBySubject[k] ?? 0}</span>
            </ProgressRing>
            <span className="text-xs text-white/55">{SUBJECTS[k].label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="XP today" value={s.xpToday} />
        <MiniStat label="XP this week" value={s.xpThisWeek} />
        <MiniStat label="Discoveries" value={s.counts.discoveries} />
        <MiniStat label="Challenges done" value={s.counts.challenges} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="text-xs text-white/45">{label}</div>
      <div className="font-heading text-xl font-bold"><CountUp value={value} /></div>
    </div>
  );
}

function EmptyProgress() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden>
        <path d="M10 70 L35 50 L55 58 L80 30 L110 20" fill="none" stroke="#2f80ff" strokeWidth="3" strokeDasharray="4 6" strokeLinecap="round" />
        <circle cx="110" cy="20" r="6" fill="#22d3ee" />
      </svg>
      <div className="font-heading font-semibold">Ready to run your first experiment?</div>
      <p className="text-sm text-white/55">Your charts fill in as you earn XP. The Playground is open right now.</p>
      <Link to="/playground/chemistry"><Button size="sm" icon={<Beaker className="h-4 w-4" />}>Open the Playground</Button></Link>
    </div>
  );
}

function BadgeStrip({ s }: { s: Summary }) {
  const unlocked = s.badges.filter((b) => b.unlocked);
  const next = s.badges.filter((b) => !b.unlocked).sort((a, b) => b.progress / b.target - a.progress / a.target).slice(0, 4 - Math.min(unlocked.length, 2));
  const show = [...unlocked.slice(0, 2), ...next];
  return (
    <div className="grid grid-cols-4 gap-3">
      {show.map((b) => (
        <Link key={b.id} to="/achievements" className="group flex flex-col items-center gap-2 text-center" title={b.description}>
          <span
            className={cx("grid h-14 w-14 place-items-center rounded-2xl transition group-hover:scale-105", b.unlocked ? "text-[#1b1305]" : "bg-white/[0.05] text-white/30 ring-1 ring-inset ring-white/10")}
            style={b.unlocked ? { background: "radial-gradient(circle at 35% 25%, #ffe07a, #e0a020)", boxShadow: "0 0 24px -6px #ffc23d" } : undefined}
          >
            <NamedIcon name={b.icon} className="h-6 w-6" />
          </span>
          <span className={cx("line-clamp-2 text-[11px] leading-tight", b.unlocked ? "text-white/80" : "text-white/40")}>{b.name}</span>
          {!b.unlocked && b.target > 1 && <span className="tabular -mt-1 text-[10px] text-white/35">{b.progress}/{b.target}</span>}
        </Link>
      ))}
    </div>
  );
}
