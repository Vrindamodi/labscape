import { Avatar, Card, cx, EmptyState, ErrorState, Segmented, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Crown, Minus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import type { Board, BoardRow } from "../lib/types";

type Scope = "weekly" | "global" | "chemistry" | "physics" | "maths";

export default function Leaderboard() {
  const [scope, setScope] = useState<Scope>("weekly");
  const q = useQuery({ queryKey: ["board", scope], queryFn: () => api<Board>(`/v1/leaderboards/${scope}`) });
  const podium = q.data?.rows.slice(0, 3) ?? [];

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-white/55">
            {scope === "weekly" && q.data?.resetsAt ? `Resets ${new Date(q.data.resetsAt).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : "All-time XP"}
            {q.data ? ` · ${q.data.participants} scientists` : ""}
          </p>
        </div>
        <Segmented
          label="Leaderboard scope"
          value={scope}
          onChange={setScope}
          size="sm"
          options={[
            { value: "weekly", label: "This week" },
            { value: "global", label: "All time" },
            { value: "chemistry", label: "Chemistry" },
            { value: "physics", label: "Physics" },
            { value: "maths", label: "Maths" },
          ]}
        />
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !q.data?.rows.length ? (
        <Card><EmptyState icon={<Trophy className="h-6 w-6" />} title="No scores yet" body="Earn XP to be the first on this board." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 items-end gap-3">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? <Podium key={r.userId} r={r} place={i === 1 ? 1 : i === 0 ? 2 : 3} /> : <div key={i} />,
            )}
          </div>
          <Card className="p-2">
            <LayoutGroup>
              <ol>
                <AnimatePresence initial={false}>
                  {q.data.rows.map((r) => <Row key={r.userId} r={r} />)}
                </AnimatePresence>
              </ol>
            </LayoutGroup>
            {q.data.me && q.data.me.rank > 50 && (
              <div className="sticky bottom-2 mt-2 border-t border-white/[0.06] pt-2">
                <Row r={q.data.me} />
              </div>
            )}
          </Card>
          <p className="mt-4 flex items-center gap-2 text-xs text-white/40">
            <Users className="h-3.5 w-3.5" /> Under-18 scientists appear by username only. You can hide yourself in Settings.
          </p>
        </>
      )}
    </div>
  );
}

function Podium({ r, place }: { r: BoardRow; place: 1 | 2 | 3 }) {
  const colors = { 1: ["#ffe07a", "#e0a020"], 2: ["#e7edf7", "#8d9bb3"], 3: ["#f0b27a", "#a8642c"] }[place];
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: place * 0.08, type: "spring", stiffness: 220, damping: 26 }} className="flex flex-col items-center">
      {place === 1 && <Crown className="mb-1 h-6 w-6 text-[#ffd77a] drop-shadow-[0_0_10px_#ffc23d]" />}
      <Avatar name={r.name} size={place === 1 ? 64 : 52} ring={colors[0]} />
      <div className={cx("mt-2 max-w-full truncate text-sm font-semibold", r.me && "text-accent-cyan")}>{r.name}</div>
      <div className="tabular text-xs text-white/50">{r.xp.toLocaleString()} XP</div>
      <div
        className="mt-3 grid w-full place-items-center rounded-t-xl font-heading text-2xl font-bold text-[#1b1305]"
        style={{ height: place === 1 ? 96 : place === 2 ? 72 : 56, background: `linear-gradient(180deg, ${colors[0]}, ${colors[1]})`, boxShadow: `0 0 40px -10px ${colors[0]}` }}
      >
        {place}
      </div>
    </motion.div>
  );
}

function Row({ r }: { r: BoardRow }) {
  const delta = r.prevRank === null ? null : r.prevRank - r.rank;
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
      className={cx("flex items-center gap-3 rounded-lg px-3 py-2.5", r.me && "bg-accent/15 shadow-[inset_0_0_0_1px_rgba(110,170,255,.45),0_0_30px_-12px_#2f80ff]")}
    >
      <span className="tabular w-8 text-center font-heading font-bold text-white/70">{r.rank}</span>
      <span className="w-5" aria-label={delta === null ? "new" : delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : "no change"}>
        {delta === null ? null : delta > 0 ? (
          <motion.span initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><ChevronUp className="h-4 w-4 text-state-success" /></motion.span>
        ) : delta < 0 ? (
          <motion.span initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><ChevronDown className="h-4 w-4 text-state-danger" /></motion.span>
        ) : (
          <Minus className="h-4 w-4 text-white/20" />
        )}
      </span>
      <Avatar name={r.name} size={34} />
      <span className={cx("flex-1 truncate text-sm font-medium", r.me && "text-white")}>
        {r.name} {r.me && <span className="text-xs text-accent-cyan">(you)</span>}
      </span>
      <span className="tabular text-sm font-semibold">{r.xp.toLocaleString()} <span className="text-white/40">XP</span></span>
    </motion.li>
  );
}
