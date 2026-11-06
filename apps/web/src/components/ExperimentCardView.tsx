import { sound } from "@labscape/audio";
import { Chip, cx, SubjectChip, SUBJECTS, TiltCard, type SubjectKey } from "@labscape/ui";
import { Check, Clock, Crown, Layers, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExperimentCard } from "../lib/types";
import { SubjectArt } from "./visuals";

export function DifficultyDots({ level }: { level: ExperimentCard["difficulty"] }) {
  const n = level === "beginner" ? 1 : level === "intermediate" ? 2 : 3;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/55" title={`Difficulty: ${level}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("h-1.5 w-3 rounded-full", i <= n ? "bg-white/70" : "bg-white/15")} />
        ))}
      </span>
      <span className="capitalize">{level}</span>
    </span>
  );
}

export function ExperimentCardView({ e, compact }: { e: ExperimentCard; compact?: boolean }) {
  const s = SUBJECTS[e.subject as SubjectKey];
  return (
    <TiltCard className="h-full rounded-xl">
      <Link
        to={`/library/${e.slug}`}
        onMouseEnter={() => sound.play("hover")}
        className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(26,34,54,.85),rgba(18,24,41,.9))] transition-colors duration-base hover:border-white/20"
        style={{ boxShadow: `0 24px 60px -36px ${s?.color ?? "#000"}` }}
      >
        <div className="relative h-32 overflow-hidden" style={{ background: `radial-gradient(120% 90% at 80% 0%, ${s?.color}33, transparent 60%), linear-gradient(160deg, ${s?.color}14, transparent)` }}>
          <div className="absolute -right-3 -top-2 opacity-90 transition-transform duration-slow ease-standard group-hover:scale-110">
            <SubjectArt subject={e.subject} size={compact ? 110 : 132} />
          </div>
          <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
            <SubjectChip subject={e.subject} />
            {e.featured && <Chip tone="violet"><Sparkles className="h-3 w-3" />Featured</Chip>}
          </div>
          {e.completed && (
            <span className="absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full bg-state-success/20 px-2 py-0.5 text-xs font-semibold text-[#7ee2a2] ring-1 ring-state-success/40">
              <Check className="h-3 w-3" /> Completed
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="text-xs font-medium text-white/45">{e.chapter}</div>
          <h3 className="mt-1 font-heading text-lg font-semibold leading-snug text-white">{e.title}</h3>
          {!compact && <p className="mt-1.5 line-clamp-2 text-sm text-white/60">{e.summary}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-xs text-white/55">
            <DifficultyDots level={e.difficulty} />
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{e.estimatedMinutes} min</span>
            <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{e.stages} stages</span>
            <span className="tabular ml-auto font-semibold text-[#ffd77a]">+{e.xpReward} XP</span>
          </div>
        </div>
        {e.locked && (
          <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-[#ffd77a] ring-1 ring-[#ffc23d]/50 backdrop-blur" title="Premium">
            <Lock className="h-4 w-4" />
          </div>
        )}
        {e.premium && !e.locked && (
          <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-[#ffd77a] backdrop-blur" title="Premium">
            <Crown className="h-4 w-4" />
          </div>
        )}
      </Link>
    </TiltCard>
  );
}
