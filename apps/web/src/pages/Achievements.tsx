import { Stagger, StaggerItem } from "@labscape/motion";
import { Card, Chip, cx, ErrorState, NamedIcon, Segmented, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
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
      <PageHeader
        eyebrow="You"
        title="Achievements"
        sub={q.data ? `${unlocked} of ${q.data.badges.length} badges unlocked` : "Loading your badges…"}
        aside={<Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unlocked", label: "Unlocked" }, { value: "locked", label: "Locked" }]} />}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(q.data?.streaks ?? []).map((s) => (
          <Card key={s.kind} className="flex items-center gap-4 p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface"><StreakFlame days={s.days} size={28} /></span>
            <div>
              <div className="font-heading text-[28px] font-medium leading-none tracking-tight text-ink-strong">
                {s.days}<span className="ml-1 text-sm font-normal text-ink-muted">{s.kind === "weekly_challenge" ? "wk" : "d"}</span>
              </div>
              <div className="mt-1 text-xs capitalize text-ink-muted">{s.kind.replace("_", " ")} streak</div>
            </div>
          </Card>
        ))}
        {q.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[88px] rounded-card" />)}
      </div>
      <p className="mb-10 text-xs text-ink-muted">One free streak freeze per week applies itself, so missing a single day won't reset a streak.</p>

      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-60 rounded-card" />)}</div>
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
    <Card className="relative h-full overflow-hidden p-6 text-center">
      {b.unlocked && <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(260px 150px at 50% 0%, ${t.c1}55, transparent 70%)` }} />}
      <div
        className={cx("relative mx-auto grid h-24 w-24 place-items-center rounded-[30px] transition-all duration-slow", b.unlocked ? "text-[#1b1305]" : "bg-surface text-ink-faint ring-1 ring-inset ring-line")}
        style={b.unlocked ? { background: `radial-gradient(circle at 35% 25%, ${t.c1}, ${t.c2})`, boxShadow: "inset 0 2px 0 rgba(255,255,255,.55)" } : undefined}
      >
        <NamedIcon name={b.icon} className="h-11 w-11" />
        {!b.unlocked && (
          <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-card text-ink-muted ring-1 ring-line">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="relative mt-5 font-heading text-[17px] font-medium text-ink-strong">{b.name}</div>
      <p className="relative mt-1 text-sm text-ink-muted">{b.description}</p>
      <div className="relative mt-4">
        {b.unlocked ? (
          <Chip tone="gold">{t.label} · {b.unlockedAt ? new Date(b.unlockedAt).toLocaleDateString() : ""}</Chip>
        ) : (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(b.progress / b.target) * 100}%` }} />
            </div>
            <div className="tabular mt-1.5 text-xs text-ink-muted">{b.progress} / {b.target}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
