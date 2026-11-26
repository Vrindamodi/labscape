import { sound } from "@labscape/audio";
import { celebrate, useMotion } from "@labscape/motion";
import { Button, NamedIcon, useShell } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onReward, useSession, type RewardEvent } from "../lib/session";
import type { Badge, Summary } from "../lib/types";

type Flight = { id: number; xp: number; from: { x: number; y: number }; to: { x: number; y: number } };
type Takeover = { kind: "level"; index: number; name: string } | { kind: "badge"; id: string; name: string };

const TIER: Record<string, [string, string]> = {
  bronze: ["#f0b27a", "#a8642c"],
  silver: ["#e7edf7", "#8d9bb3"],
  gold: ["#ffe07a", "#e0a020"],
  platinum: ["#b9f3ff", "#7a8cff"],
};

/**
 * Listens to rewards from the session and plays them in order:
 * 1) "+N XP" chips fly from where they were earned to the top-bar counter on a curved path;
 * 2) badge reveal (card flip, shine, confetti); 3) level-up full-screen takeover.
 * All skippable; none blocks input for more than 600 ms; reduced motion shows static versions.
 */
export function RewardOverlay() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [queue, setQueue] = useState<Takeover[]>([]);
  const nextId = useRef(1);
  const { toast, announce } = useShell();
  const { me } = useSession();
  const navigate = useNavigate();
  const meRef = useRef(me);
  meRef.current = me;
  const promptedSave = useRef(false);

  useEffect(
    () =>
      onReward((e: RewardEvent) => {
        const { result } = e;
        if (result.xpAwarded > 0) {
          const counter = document.getElementById("xp-counter")?.getBoundingClientRect();
          const to = counter ? { x: counter.left + 20, y: counter.top + counter.height / 2 } : { x: window.innerWidth - 120, y: 32 };
          const from = e.origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          setFlights((f) => [...f, { id: nextId.current++, xp: result.xpAwarded, from, to }]);
          announce(`${e.label ? `${e.label}: ` : ""}plus ${result.xpAwarded} XP`);
        }
        const badges = result.badgesUnlocked.map((b) => ({ kind: "badge" as const, id: b.id, name: b.name }));
        const level = result.levelUp ? [{ kind: "level" as const, index: result.level.index, name: result.level.name }] : [];
        if (badges.length || level.length) setQueue((q) => [...q, ...badges, ...level]);
        // First award as a guest: offer to save progress (build plan 1.2 step 5).
        if (meRef.current?.guest && !promptedSave.current && result.xpAwarded > 0) {
          promptedSave.current = true;
          window.setTimeout(
            () =>
              toast({
                kind: "reward",
                title: "Save your progress",
                body: "You're earning XP as a guest. Create a free account so you never lose it.",
                durationMs: 9000,
                action: { label: "Create account", onClick: () => navigate("/signup") },
              }),
            1600,
          );
        }
      }),
    [announce, toast, navigate],
  );

  const landed = useCallback((f: Flight) => {
    setFlights((all) => all.filter((x) => x.id !== f.id));
    sound.play("xp");
    sound.haptic("tick");
    const el = document.querySelector("[data-xp-value]");
    el?.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)", color: "#7ef3ff" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.2,0,0,1)" });
    celebrate({ preset: "sparkle", origin: f.to, count: 14, colors: ["#7ef3ff", "#ffffff", "#ffd77a"] });
  }, []);

  const current = queue[0];
  const done = () => setQueue((q) => q.slice(1));

  return (
    <>
      {flights.map((f, i) => (
        <XpChip key={f.id} f={f} delay={i * 0.15} onLanded={() => landed(f)} />
      ))}
      <AnimatePresence mode="wait">
        {current?.kind === "badge" && <BadgeReveal key={`b-${current.id}`} id={current.id} name={current.name} onDone={done} />}
        {current?.kind === "level" && <LevelUp key={`l-${current.index}`} index={current.index} name={current.name} onDone={done} />}
      </AnimatePresence>
    </>
  );
}

function XpChip({ f, delay, onLanded }: { f: Flight; delay: number; onLanded: () => void }) {
  const { d, reduced } = useMotion();
  const midX = (f.from.x + f.to.x) / 2;
  const midY = Math.min(f.from.y, f.to.y) - 120;
  if (reduced) {
    return (
      <motion.div
        className="pointer-events-none fixed z-[95] rounded-full bg-[#ffc23d] px-3 py-1 font-heading text-sm font-bold text-[#2a1600]"
        style={{ left: f.to.x - 30, top: f.to.y + 24 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.2 }}
        onAnimationComplete={onLanded}
      >
        +{f.xp} XP
      </motion.div>
    );
  }
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[95]"
      initial={{ x: f.from.x, y: f.from.y, scale: 0.6, opacity: 0 }}
      animate={{ x: [f.from.x, f.from.x, midX, f.to.x], y: [f.from.y, f.from.y - 30, midY, f.to.y], scale: [0.6, 1.15, 1, 0.5], opacity: [0, 1, 1, 0.9] }}
      transition={{ duration: d(700) + 0.35, delay, times: [0, 0.25, 0.6, 1], ease: [0.2, 0, 0, 1] }}
      onAnimationComplete={onLanded}
    >
      <div className="-translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[linear-gradient(135deg,#fff1b8,#ffc23d_45%,#ff8a3d)] px-3.5 py-1.5 font-heading text-sm font-bold text-[#2a1600] shadow-[0_0_24px_rgba(255,194,61,.8),inset_0_1px_0_rgba(255,255,255,.7)]">
        +{f.xp} XP
      </div>
    </motion.div>
  );
}

function BadgeReveal({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const { reduced } = useMotion();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/v1/rewards/summary") });
  const badge: Badge | null = summary.data?.badges.find((b) => b.id === id) ?? null;
  const [c1, c2] = TIER[badge?.tier ?? "gold"] ?? ["#ffe07a", "#e0a020"];
  useEffect(() => {
    sound.play("badge");
    sound.haptic("success");
    const t = window.setTimeout(() => celebrate({ preset: "confetti", count: 80 }), reduced ? 0 : 650);
    return () => window.clearTimeout(t);
  }, [reduced]);
  return (
    <motion.div data-surface="dark" className="fixed inset-0 z-[96] grid place-items-center p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-[#03060f]/75 backdrop-blur-sm" onClick={onDone} />
      <div className="relative flex flex-col items-center text-center" style={{ perspective: 900 }}>
        <motion.div
          initial={reduced ? { opacity: 0 } : { rotateY: 180, scale: 0.6 }}
          animate={reduced ? { opacity: 1 } : { rotateY: 0, scale: [0.6, 1.1, 1] }}
          transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
          className="relative grid h-40 w-40 place-items-center overflow-hidden rounded-[36px]"
          style={{ background: `radial-gradient(circle at 35% 25%, ${c1}, ${c2})`, boxShadow: `0 0 80px -6px ${c1}, inset 0 2px 0 rgba(255,255,255,.6)` }}
        >
          <NamedIcon name={badge?.icon ?? "sparkles"} className="h-20 w-20 text-[#1b1305]/85 drop-shadow" />
          {!reduced && (
            <motion.span
              className="absolute inset-y-0 w-16 -skew-x-12 bg-white/50 blur-md"
              initial={{ x: -140 }}
              animate={{ x: 180 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            />
          )}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.45 }}>
          <div className="mt-6 text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: c1 }}>
            Badge unlocked
          </div>
          <div className="mt-1 font-heading text-3xl font-bold">{name}</div>
          {badge && <p className="mx-auto mt-2 max-w-xs text-sm text-white/65">{badge.description}</p>}
          <Button className="mt-6" onClick={onDone} autoFocus data-badge={id}>
            Awesome
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}

function LevelUp({ index, name, onDone }: { index: number; name: string; onDone: () => void }) {
  const { reduced } = useMotion();
  const [typed, setTyped] = useState(reduced ? name : "");
  const [canSkip, setCanSkip] = useState(false);
  useEffect(() => {
    sound.play("levelUp");
    sound.haptic("success");
    const skip = window.setTimeout(() => setCanSkip(true), 600);
    const burst = window.setTimeout(() => celebrate({ preset: "confetti", count: 140 }), reduced ? 0 : 1300);
    let i = 0;
    const type = reduced ? 0 : window.setInterval(() => setTyped(name.slice(0, ++i)), 55);
    const auto = window.setTimeout(onDone, 6500);
    return () => {
      [skip, burst, auto].forEach((t) => window.clearTimeout(t));
      window.clearInterval(type);
    };
  }, [name, onDone, reduced]);

  const dots = Array.from({ length: 36 }, (_, i) => i);
  return (
    <motion.div
      data-surface="dark"
      className="fixed inset-0 z-[97] grid place-items-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => canSkip && onDone()}
      role="dialog"
      aria-label={`Level up: ${name}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(47,128,255,.35),rgba(3,6,15,.95)_60%)] backdrop-blur-md" />
      {!reduced && (
        <motion.div
          className="absolute h-[900px] w-[900px] rounded-full opacity-60"
          style={{ background: "conic-gradient(from 0deg, transparent, rgba(126,243,255,.25) 4%, transparent 8%, transparent 12%, rgba(139,92,246,.25) 16%, transparent 20%, transparent 25%, rgba(126,243,255,.25) 29%, transparent 33%, transparent 37%, rgba(255,194,61,.22) 41%, transparent 45%, transparent 50%, rgba(126,243,255,.25) 54%, transparent 58%, transparent 62%, rgba(139,92,246,.25) 66%, transparent 70%, transparent 75%, rgba(255,194,61,.22) 79%, transparent 83%, transparent 87%, rgba(126,243,255,.25) 91%, transparent 95%)" }}
          initial={{ scale: 0.2, rotate: 0 }}
          animate={{ scale: 1, rotate: 40 }}
          transition={{ duration: 2.5, ease: [0.05, 0.7, 0.1, 1] }}
        />
      )}
      <div className="relative flex flex-col items-center text-center">
        <div className="relative h-48 w-48">
          {/* emblem assembles from particles */}
          {!reduced &&
            dots.map((i) => {
              const a = (i / dots.length) * Math.PI * 2;
              return (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-[#7ef3ff]"
                  initial={{ x: Math.cos(a) * 400, y: Math.sin(a) * 400, opacity: 0 }}
                  animate={{ x: Math.cos(a) * 84, y: Math.sin(a) * 84, opacity: [0, 1, 0] }}
                  transition={{ duration: 0.9, delay: (i % 6) * 0.04, ease: [0.2, 0, 0, 1] }}
                />
              );
            })}
          <svg viewBox="0 0 200 200" className="absolute inset-0">
            <defs>
              <linearGradient id="lv" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7ef3ff" />
                <stop offset=".5" stopColor="#2f80ff" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="8" />
            <motion.circle
              cx="100"
              cy="100"
              r="84"
              fill="none"
              stroke="url(#lv)"
              strokeWidth="8"
              strokeLinecap="round"
              transform="rotate(-90 100 100)"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: reduced ? 0 : 0.8, duration: reduced ? 0 : 0.7, ease: [0.2, 0, 0, 1] }}
              style={{ filter: "drop-shadow(0 0 12px #2f80ff)" }}
            />
          </svg>
          <motion.div
            className="absolute inset-0 grid place-items-center"
            initial={{ scale: reduced ? 1 : 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.9, type: "spring", stiffness: 320, damping: 14 }}
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Level</div>
              <div className="font-heading text-7xl font-bold leading-none">{index + 1}</div>
            </div>
          </motion.div>
        </div>
        <div className="mt-8 text-xs font-semibold uppercase tracking-[0.35em] text-accent-cyan">Level up</div>
        <div className="mt-2 h-12 font-heading text-4xl font-bold" aria-live="polite">
          {typed}
          {typed.length < name.length && <span className="ml-0.5 inline-block h-9 w-[3px] animate-pulse bg-white align-middle" />}
        </div>
        <p className="mt-2 text-sm text-white/55">New rank unlocked. Keep experimenting.</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: canSkip ? 1 : 0 }}>
          <Button className="mt-6" onClick={onDone}>
            Continue
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
