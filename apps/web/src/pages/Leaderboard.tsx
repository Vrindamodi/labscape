import { Avatar, Card, cx, EmptyState, ErrorState, Segmented, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Crown, Minus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Board, BoardRow } from "../lib/types";

type Scope = "weekly" | "global" | "chemistry" | "physics" | "maths";

export default function Leaderboard() {
  const [scope, setScope] = useState<Scope>("weekly");
  const q = useQuery({ queryKey: ["board", scope], queryFn: () => api<Board>(`/v1/leaderboards/${scope}`) });
  const podium = q.data?.rows.slice(0, 3) ?? [];

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader
        eyebrow="You"
        title="Leaderboard"
        sub={
          <>
            {scope === "weekly" && q.data?.resetsAt ? `Resets ${new Date(q.data.resetsAt).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : "All-time XP"}
            {q.data ? ` · ${q.data.participants} scientists` : ""}
          </>
        }
      />
      {/* On phones the scope pills scroll sideways, edge to edge, without a visible scrollbar. */}
      <div className="-mx-4 -mt-2 mb-6 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
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
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-[20px]" />)}</div>
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
              <div className="sticky bottom-2 mt-2 border-t border-line pt-2">
                <Row r={q.data.me} />
              </div>
            )}
          </Card>
          <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
            <Users className="h-3.5 w-3.5" /> Under-18 scientists appear by username only. You can hide yourself in Settings.
          </p>
        </>
      )}
    </div>
  );
}

/** Podium steps use the flat accent tints: gold, blue, peach. */
const PLACE = { 1: { tint: "#FCC934", ring: "#E0A020" }, 2: { tint: "#C9D7F2", ring: "#8D9BB3" }, 3: { tint: "#F9B896", ring: "#A8642C" } } as const;

function Podium({ r, place }: { r: BoardRow; place: 1 | 2 | 3 }) {
  const c = PLACE[place];
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: place * 0.08, type: "spring", stiffness: 220, damping: 26 }} className="flex min-w-0 flex-col items-center">
      {place === 1 && <Crown className="mb-1 h-6 w-6 text-[#B07C00]" />}
      <Avatar name={r.name} size={place === 1 ? 64 : 52} ring={c.ring} />
      <div className={cx("mt-2 max-w-full truncate text-sm font-medium text-ink-strong", r.me && "text-link")}>{r.name}</div>
      <div className="tabular text-xs text-ink-muted">{r.xp.toLocaleString()} XP</div>
      <div
        className="mt-3 grid w-full place-items-center rounded-t-[24px] font-heading text-[28px] font-medium text-[#1a1a1a]"
        style={{ height: place === 1 ? 104 : place === 2 ? 78 : 60, background: c.tint }}
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
      className={cx("flex items-center gap-3 rounded-[18px] px-3 py-2.5", r.me ? "bg-[#E1EBFF]" : "hover:bg-surface")}
    >
      <span className="tabular w-8 text-center font-heading font-medium text-ink-muted">{r.rank}</span>
      <span className="w-5" aria-label={delta === null ? "new" : delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : "no change"}>
        {delta === null ? null : delta > 0 ? (
          <motion.span initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><ChevronUp className="h-4 w-4 text-[#1E8E3E]" /></motion.span>
        ) : delta < 0 ? (
          <motion.span initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><ChevronDown className="h-4 w-4 text-[#C5221F]" /></motion.span>
        ) : (
          <Minus className="h-4 w-4 text-ink/25" />
        )}
      </span>
      <Avatar name={r.name} size={34} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">
        {r.name} {r.me && <span className="text-xs font-normal text-link">(you)</span>}
      </span>
      <span className="tabular text-sm font-semibold text-ink-strong">{r.xp.toLocaleString()} <span className="font-normal text-ink-muted">XP</span></span>
    </motion.li>
  );
}
