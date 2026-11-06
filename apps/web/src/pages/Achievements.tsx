import { Stagger, StaggerItem } from "@labscape/motion";
import { Card, Chip, cx, ErrorState, NamedIcon, Segmented, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import type { Badge, Summary } from "../lib/types";
import { StreakFlame } from "../shell/brand";

const TIER: Record<Badge["tier"], { c1: string; c2: string; label: string }> = {
  bronze: { c1: "#f0b27a", c2: "#a8642c", label: "Bronze" },
  silver: { c1: "#e7edf7", c2: "#8d9bb3", label: "Silver" },
  gold: { c1: "#ffe07a", c2: "#e0a020", label: "Gold" },
  platinum: { c1: "#b9f3ff", c2: "#7a8cff", label: "Platinum" },
};

export default function Achievements() {
  const q = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/v1/rewards/summary") });
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const badges = (q.data?.badges ?? []).filter((b) => (filter === "all" ? true : filter === "unlocked" ? b.unlocked : !b.unlocked));
  const unlocked = q.data?.badges.filter((b) => b.unlocked).length ?? 0;

  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Achievements</h1>
          <p className="mt-1 text-white/55">{q.data ? `${unlocked} of ${q.data.badges.length} badges unlocked` : "Loading your badges…"}</p>
        </div>
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unlocked", label: "Unlocked" }, { value: "locked", label: "Locked" }]} />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(q.data?.streaks ?? []).map((s) => (
          <Card key={s.kind} className="flex items-center gap-4 p-4">
            <StreakFlame days={s.days} size={34} />
            <div>
              <div className="font-heading text-2xl font-bold">{s.days}<span className="ml-1 text-sm font-medium text-white/45">{s.kind === "weekly_challenge" ? "wk" : "d"}</span></div>
              <div className="text-xs capitalize text-white/50">{s.kind.replace("_", " ")} streak</div>
            </div>
          </Card>
        ))}
        {q.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <p className="-mt-5 mb-8 text-xs text-white/40">One free streak freeze per week applies itself, so missing a single day won't reset a streak.</p>

      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
      ) : (
        <Stagger key={filter} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {badges.map((b, i) => (
            <StaggerItem key={b.id} index={i}>
              <BadgeTile b={b} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  const t = TIER[b.tier];
  return (
    <Card className={cx("relative h-full overflow-hidden p-5 text-center", !b.unlocked && "opacity-80")} glow={b.unlocked ? t.c1 : undefined}>
      {b.unlocked && <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(260px 160px at 50% 0%, ${t.c1}22, transparent 70%)` }} />}
      <div
        className={cx("relative mx-auto grid h-24 w-24 place-items-center rounded-[28px] transition-all duration-slow", b.unlocked ? "text-[#1b1305]" : "text-white/25")}
        style={
          b.unlocked
            ? { background: `radial-gradient(circle at 35% 25%, ${t.c1}, ${t.c2})`, boxShadow: `0 0 40px -8px ${t.c1}, inset 0 2px 0 rgba(255,255,255,.55)` }
            : { background: "rgba(255,255,255,.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }
        }
      >
        <NamedIcon name={b.icon} className="h-11 w-11" />
        {!b.unlocked && (
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-[#1a2236] text-white/50 ring-2 ring-[#121829]">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="relative mt-4 font-heading font-semibold">{b.name}</div>
      <p className="relative mt-1 text-sm text-white/55">{b.description}</p>
      <div className="relative mt-4">
        {b.unlocked ? (
          <Chip tone="gold">{t.label} · {b.unlockedAt ? new Date(b.unlockedAt).toLocaleDateString() : ""}</Chip>
        ) : (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent-cyan" style={{ width: `${(b.progress / b.target) * 100}%` }} />
            </div>
            <div className="tabular mt-1.5 text-xs text-white/45">{b.progress} / {b.target}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
