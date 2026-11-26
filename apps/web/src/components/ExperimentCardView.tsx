import { sound } from "@labscape/audio";
import { Chip, cx, SubjectChip, SUBJECTS, TiltCard, type SubjectKey } from "@labscape/ui";
import { Check, Clock, Crown, Layers, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExperimentCard } from "../lib/types";
import { SubjectArt } from "./visuals";

/** Uses the surface tokens, so it reads on a white card and inside dark media cards alike. */
export function DifficultyDots({ level }: { level: ExperimentCard["difficulty"] }) {
  const n = level === "beginner" ? 1 : level === "intermediate" ? 2 : 3;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted" title={`Difficulty: ${level}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("h-1.5 w-3 rounded-full", i <= n ? "bg-ink/70" : "bg-ink/15")} />
        ))}
      </span>
      <span className="capitalize">{level}</span>
    </span>
  );
}

/** A white card with a dark, subject-lit art well on top (the art is drawn for dark backgrounds). */
export function ExperimentCardView({ e, compact }: { e: ExperimentCard; compact?: boolean }) {
  const s = SUBJECTS[e.subject as SubjectKey];
  return (
    <TiltCard className="h-full rounded-card">
      <Link
        to={`/library/${e.slug}`}
        onMouseEnter={() => sound.play("hover")}
        className="group relative flex h-full flex-col overflow-hidden rounded-card bg-card p-2.5 transition-shadow duration-base hover:shadow-lift dark:border dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(26,34,54,.85),rgba(18,24,41,.9))]"
      >
        <div
          data-surface="dark"
          className={cx("relative overflow-hidden rounded-[18px]", compact ? "h-32" : "h-40")}
          style={{ background: `radial-gradient(120% 100% at 85% 0%, ${s?.color ?? "#2F80FF"}59, transparent 60%), linear-gradient(160deg, #262626, #141414)` }}
        >
          <div className="absolute -right-2 -top-1 opacity-95 transition-transform duration-slow ease-standard group-hover:scale-110">
            <SubjectArt subject={e.subject} size={compact ? 116 : 140} />
          </div>
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <SubjectChip subject={e.subject} />
            {e.featured && <Chip tone="violet"><Sparkles className="h-3 w-3" />Featured</Chip>}
          </div>
          {e.completed && (
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-tint-green px-2.5 py-1 text-xs font-medium text-[#0B4D27]">
              <Check className="h-3 w-3" /> Completed
            </span>
          )}
          {e.locked && (
            <div className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-tint-yellow text-[#3d2a00]" title="Premium">
              <Lock className="h-4 w-4" />
            </div>
          )}
          {e.premium && !e.locked && (
            <div className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-white/15 text-[#ffd77a] backdrop-blur" title="Premium">
              <Crown className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col px-2.5 pb-2 pt-4">
          <div className="text-xs font-medium text-ink-muted">{e.chapter}</div>
          <h3 className="mt-1 font-heading text-[18px] font-medium leading-snug tracking-[-0.01em] text-ink-strong">{e.title}</h3>
          {!compact && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">{e.summary}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-xs text-ink-muted">
            <DifficultyDots level={e.difficulty} />
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{e.estimatedMinutes} min</span>
            <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{e.stages} stages</span>
            <span className="tabular ml-auto rounded-full bg-tint-yellow px-2 py-0.5 font-semibold text-[#3d2a00] dark:bg-transparent dark:px-0 dark:text-[#ffd77a]">+{e.xpReward} XP</span>
          </div>
        </div>
      </Link>
    </TiltCard>
  );
}
