import { useEffect, useMemo, useRef, useState } from "react";
import { configText, configuration, madelungFill, MADELUNG, orbitalBoxes, subshellName, sup, type Subshell } from "./elements";

const WHY: Record<string, string> = {
  d5: "A half-filled d subshell (five unpaired electrons) is extra stable, so one s electron moves into d.",
  d10: "A completely filled d subshell is extra stable, so s electrons move into d.",
  f: "In the early f-block the 5d/6d and 4f/5f levels are almost equal in energy, so one electron sits in d instead of f.",
  p: "Relativistic effects in this very heavy atom lower 7p below 6d.",
  other: "These subshells are so close in energy that electron-electron repulsion decides the order.",
};

function reason(z: number, moved: [string, number][]): string {
  const to = moved.find(([, d]) => d > 0)?.[0] ?? "";
  if (z === 103) return WHY.p!;
  if (to.endsWith("d") && moved.some(([s]) => s.endsWith("f"))) return WHY.f!;
  const c = configuration(z).filling.find((s) => subshellName(s) === to);
  if (c?.electrons === 5) return WHY.d5!;
  if (c?.electrons === 10) return WHY.d10!;
  return WHY.other!;
}

/**
 * Aufbau animation: electrons drop into orbital boxes in Madelung order, singly before pairing
 * (Hund's rule). For the elements that break the rule the final step moves the electrons that
 * really sit elsewhere, highlighted, with the reason.
 */
export function OrbitalFill({ z, reducedMotion = false }: { z: number; reducedMotion?: boolean }) {
  const conf = useMemo(() => configuration(z), [z]);
  const [step, setStep] = useState(reducedMotion ? z : 0);
  const [settled, setSettled] = useState(reducedMotion);
  const timer = useRef<number | null>(null);

  const play = () => {
    if (timer.current) window.clearInterval(timer.current);
    setSettled(false);
    if (reducedMotion) {
      setStep(z);
      setSettled(true);
      return;
    }
    setStep(0);
    const dt = Math.max(22, Math.min(140, 2400 / z));
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s >= z) {
          if (timer.current) window.clearInterval(timer.current);
          window.setTimeout(() => setSettled(true), conf.predicted ? 650 : 0);
          return s;
        }
        return s + 1;
      });
    }, dt);
  };

  useEffect(() => {
    play();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [z]); // eslint-disable-line react-hooks/exhaustive-deps

  const current: Subshell[] = settled ? conf.filling : madelungFill(step);
  const lastIndex = Math.max(...conf.filling.map((s) => MADELUNG.findIndex((m) => m.n === s.n && m.l === s.l)), 0);
  const rows = MADELUNG.slice(0, lastIndex + 1);
  const movedNames = new Set(conf.moved.map(([s]) => s));
  // Show only the outer part for heavy atoms: the core repeats what lighter elements show.
  const firstShown = rows.length > 12 ? rows.length - 12 : 0;

  return (
    <div>
      <div className="flex flex-col-reverse gap-1.5">
        {rows.map((r, idx) => {
          if (idx < firstShown) return null;
          const name = subshellName(r);
          const filled = current.find((s) => s.n === r.n && s.l === r.l)?.electrons ?? 0;
          const boxes = orbitalBoxes(r.l, filled);
          const hot = settled && movedNames.has(name);
          return (
            <div key={name} className="flex items-center gap-2">
              <span className={`w-7 text-right font-mono text-[11px] font-bold ${hot ? "text-[#B45309] dark:text-amber-300" : "text-ink-muted dark:text-white/55"}`}>{name}</span>
              <div className="flex gap-[3px]">
                {boxes.map((b, i) => (
                  <span
                    key={i}
                    className={`grid h-6 w-6 place-items-center rounded-[5px] text-[13px] leading-none ring-1 ring-inset transition-colors duration-300 ${hot ? "bg-amber-400/20 ring-amber-500/60 dark:bg-amber-400/15 dark:ring-amber-300/70" : b ? "bg-accent/15 ring-accent/45" : "ring-ink/15 dark:ring-white/10"}`}
                  >
                    <span className="font-bold text-[#1A4FB8] dark:text-[#cfe3ff]">{b === 2 ? "⇅" : b === 1 ? "↑" : ""}</span>
                  </span>
                ))}
              </div>
              {hot && <span className="text-[10px] font-bold uppercase tracking-wide text-[#B45309] dark:text-amber-300">{conf.moved.find(([s]) => s === name)![1] > 0 ? "gains" : "gives"}</span>}
            </div>
          );
        })}
        {firstShown > 0 && <p className="pl-9 text-[11px] text-ink-muted dark:text-white/40">[{conf.core}] core below</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={play} className="rounded-full px-3 py-1 text-xs font-semibold text-link ring-1 ring-inset ring-accent/40 hover:bg-accent/10">
          Replay filling
        </button>
        <span className="font-mono text-sm text-ink-strong dark:text-white/85">{settled ? configText(conf) : `${step} / ${z} electrons`}</span>
      </div>
      {settled && conf.predicted && (
        <div className="mt-3 rounded-lg bg-[#FDF0CC] p-3 text-xs leading-relaxed text-[#5c3d00] ring-1 ring-inset ring-[#F3D98C] dark:bg-amber-400/[0.08] dark:text-amber-100/90 dark:ring-amber-300/25">
          <b className="text-[#7A5200] dark:text-amber-200">Exception.</b> The Madelung rule predicts{" "}
          <span className="font-mono">{conf.predicted.filter((s) => conf.moved.some(([m]) => m === subshellName(s))).map((s) => `${subshellName(s)}${sup(s.electrons)}`).join(" ")}</span>, but measurements show the electrons above. {reason(z, conf.moved)}
        </div>
      )}
      {conf.isPredicted && <p className="mt-2 text-[11px] text-ink-muted dark:text-white/45">No atom of this element has lived long enough to measure; this configuration is a prediction.</p>}
    </div>
  );
}
