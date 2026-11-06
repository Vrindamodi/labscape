import type { SimulationOutcome, SimulationResult } from "@labscape/contracts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Equation, Formula, NumberTicker } from "./bits";

export type PanelState =
  | { kind: "idle" }
  | { kind: "pouring" }
  | { kind: "resolving" }
  | { kind: "result"; result: SimulationResult }
  | { kind: "offline"; message: string }
  | { kind: "cooldown"; until: number; message: string };

type Tone = { accent: string; label: string; icon: string };

const TONES: Record<SimulationOutcome, Tone> = {
  reaction: { accent: "#22C55E", label: "Reaction", icon: "✦" },
  no_reaction: { accent: "#38BDF8", label: "No reaction", icon: "≈" },
  needs_conditions: { accent: "#F59E0B", label: "Needs conditions", icon: "△" },
  out_of_range: { accent: "#F59E0B", label: "Out of range", icon: "↕" },
  procedure_mismatch: { accent: "#F59E0B", label: "Procedure mismatch", icon: "⚠" },
  unsupported: { accent: "#F59E0B", label: "Not modelled", icon: "∅" },
  prohibited: { accent: "#EF4444", label: "Safety restriction", icon: "⛨" },
};

const TYPE_COLOURS: Record<string, string> = {
  neutralisation: "#22D3EE",
  gas: "#38BDF8",
  precipitation: "#E879F9",
  displacement: "#FB923C",
  redox: "#8B5CF6",
  catalysis: "#2DD4BF",
  complex: "#2F80FF",
  indicator: "#F472B6",
  hydration: "#60A5FA",
  physical: "#94A3B8",
};

const MEASURE_LABEL: Record<string, string> = {
  pH: "pH",
  temperature: "Temperature",
  deltaT: "ΔT",
  precipitate: "Precipitate",
  volume: "Volume",
};

function measureLabel(key: string) {
  if (key.startsWith("gas:")) return `${key.slice(4)} gas`;
  return MEASURE_LABEL[key] ?? key;
}

type Props = {
  state: PanelState;
  newDiscoveries: Set<string>;
  onOption: (option: string) => void;
  presets: { label: string; onPick: () => void }[];
};

export function OutcomePanel({ state, newDiscoveries, onOption, presets }: Props) {
  return (
    <section
      className="ls-panel ls-scroll flex h-full min-h-0 flex-col overflow-y-auto"
      aria-live="polite"
      aria-label="Observations"
    >
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="ls-eyebrow">Observation panel</h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">Live</span>
      </header>
      <div className="flex-1 px-5 pb-5">
        <AnimatePresence mode="wait">
          {state.kind === "idle" && <Idle key="idle" presets={presets} />}
          {state.kind === "pouring" && <Pouring key="pouring" />}
          {state.kind === "resolving" && <Resolving key="resolving" />}
          {state.kind === "offline" && <Offline key="offline" message={state.message} />}
          {state.kind === "cooldown" && (
            <Cooldown key="cooldown" until={state.until} message={state.message} />
          )}
          {state.kind === "result" && (
            <ResultView
              key={state.result.requestId}
              result={state.result}
              newDiscoveries={newDiscoveries}
              onOption={onOption}
            />
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

const enter = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.24 },
};

function Idle({ presets }: { presets: Props["presets"] }) {
  return (
    <motion.div {...enter}>
      <h3 className="font-heading text-[22px] font-semibold leading-tight text-white">
        Mix anything. See what's real.
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
        Every combination goes through the safety engine first. You'll see real reactions, honest
        “no reaction” results, and a clear message when something isn't modelled or isn't allowed.
      </p>
      <ol className="mt-4 space-y-2 text-[13px] text-white/70">
        {[
          "Pick reagents from the shelf",
          "Set amounts and the water bath",
          "Hit MIX and watch closely",
        ].map((s, i) => (
          <motion.li
            key={s}
            className="flex items-center gap-3"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
          >
            <span className="tabular grid h-6 w-6 place-items-center rounded-full border border-accent-cyan/40 text-[11px] text-accent-cyan">
              {i + 1}
            </span>
            {s}
          </motion.li>
        ))}
      </ol>
      <div className="mt-6">
        <div className="ls-eyebrow mb-2">Try one of these</div>
        <div className="grid gap-2">
          {presets.map((p, i) => (
            <motion.button
              key={p.label}
              className="ls-preset"
              onClick={p.onPick}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
              whileHover={{ x: 4 }}
            >
              <span>{p.label}</span>
              <span aria-hidden>→</span>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function Pouring() {
  return (
    <motion.div {...enter} className="pt-6 text-center">
      <div className="ls-eyebrow">Pouring</div>
      <p className="mt-2 text-sm text-white/55">Adding reagents to the beaker…</p>
    </motion.div>
  );
}

const STEPS = ["Schema check", "Catalogue + quantity limits", "Safety rules", "Reaction model"];

function Resolving() {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setDone((d) => Math.min(STEPS.length, d + 1)), 110);
    return () => window.clearInterval(id);
  }, []);
  return (
    <motion.div {...enter} className="pt-2">
      <div className="ls-scan relative overflow-hidden rounded-xl border border-accent-cyan/25 bg-accent-cyan/5 p-4">
        <div className="ls-eyebrow text-accent-cyan">Safety engine</div>
        <p className="mt-1 font-heading text-lg text-white">Validating your mix…</p>
        <ul className="mt-3 space-y-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-[13px]">
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[9px] transition-colors ${
                  i < done ? "bg-state-success text-black" : "bg-white/10 text-white/40"
                }`}
              >
                {i < done ? "✓" : ""}
              </span>
              <span className={i < done ? "text-white/85" : "text-white/40"}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function Offline({ message }: { message: string }) {
  return (
    <motion.div {...enter}>
      <OutcomeHeader
        accent="#94A3B8"
        label="Simulation unavailable"
        icon="⏻"
        title="Safety engine offline"
      />
      <p className="mt-3 text-[13.5px] leading-relaxed text-white/70">{message}</p>
      <p className="mt-3 text-[12.5px] text-white/45">
        LABscape never shows a reaction without a server result, so nothing in the beaker has
        changed.
      </p>
    </motion.div>
  );
}

function Cooldown({ until, message }: { until: number; message: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <motion.div {...enter}>
      <OutcomeHeader accent="#EF4444" label="Cooldown" icon="⏳" title="Take a short break" />
      <p className="mt-3 text-[13.5px] leading-relaxed text-white/70">{message}</p>
      <div className="mt-4 rounded-xl border border-state-danger/30 bg-state-danger/10 p-4 text-center">
        <div className="tabular font-heading text-4xl text-white">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/50">
          until mixing unlocks
        </div>
      </div>
    </motion.div>
  );
}

function OutcomeHeader({
  accent,
  label,
  icon,
  title,
}: {
  accent: string;
  label: string;
  icon: string;
  title: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div>
      <motion.div
        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{
          background: `${accent}22`,
          color: accent,
          boxShadow: `inset 0 0 0 1px ${accent}55`,
        }}
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
      >
        <span aria-hidden>{icon}</span>
        {label}
      </motion.div>
      <h3 className="mt-3 font-heading text-[22px] font-semibold leading-tight text-white">
        {title}
      </h3>
    </div>
  );
}

function ResultView({
  result,
  newDiscoveries,
  onOption,
}: {
  result: SimulationResult;
  newDiscoveries: Set<string>;
  onOption: (o: string) => void;
}) {
  const tone = TONES[result.outcome];
  const p = result.presentation;
  const reactions = p?.reactions ?? [];
  const isReaction = result.outcome === "reaction";
  const hatched = result.outcome === "unsupported";

  return (
    <motion.div {...enter}>
      <div className={hatched ? "ls-hatched -mx-2 rounded-xl px-2 pb-1 pt-2" : ""}>
        <OutcomeHeader
          accent={tone.accent}
          label={tone.label}
          icon={tone.icon}
          title={p?.title ?? tone.label}
        />
      </div>
      {p?.message && (
        <motion.p
          className="mt-2 text-[14px] leading-relaxed text-white/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          {p.message}
        </motion.p>
      )}

      {reactions.length > 0 && (
        <div className="mt-4 space-y-2">
          {reactions.map((r, i) => {
            const fresh = r.discoveryId !== undefined && newDiscoveries.has(r.discoveryId);
            const c = TYPE_COLOURS[r.type] ?? "#94A3B8";
            return (
              <motion.div
                key={r.id + i}
                className="ls-reaction-card"
                style={{ ["--type" as string]: c }}
                initial={{ opacity: 0, y: 10, rotateX: -20 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 260, damping: 24 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-white/90">{r.name}</span>
                  <span className="flex items-center gap-1.5">
                    {fresh && (
                      <motion.span
                        className="rounded-full bg-ai-magenta/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ai-magenta"
                        animate={{ scale: [1, 1.12, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      >
                        New
                      </motion.span>
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{ color: c, background: `${c}1f` }}
                    >
                      {r.type}
                    </span>
                  </span>
                </div>
                <div className="ls-equation mt-2">
                  <Equation latex={r.equationLatex} />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {(p?.observations.length ?? 0) > 0 && (
        <div className="mt-4">
          <div className="ls-eyebrow mb-2">{isReaction ? "What you'd see" : "Why"}</div>
          <ul className="space-y-1.5">
            {p?.observations.map((o, i) => (
              <motion.li
                key={i}
                className="flex gap-2 text-[13px] leading-snug text-white/75"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.05 }}
              >
                <span
                  className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: tone.accent }}
                />
                {o}
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {result.measurements.length > 0 && (isReaction || result.outcome === "no_reaction") && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {result.measurements.map((m) => (
            <div key={m.key} className="ls-readout">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">
                {measureLabel(m.key)}
              </div>
              <div className="mt-0.5 text-[17px] text-white">
                <NumberTicker
                  value={m.value}
                  decimals={
                    m.key === "pH" || m.key === "deltaT" ? 2 : m.key === "precipitate" ? 3 : 1
                  }
                  durationMs={900}
                />
                <span className="ml-1 text-[11px] text-white/45">
                  {m.unit === "pH" ? "" : m.unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isReaction && result.species.length > 0 && (
        <div className="mt-4">
          <div className="ls-eyebrow mb-2">Products</div>
          <div className="flex flex-wrap gap-1.5">
            {result.species.map((s) => (
              <span key={s.id} className="ls-chip ls-chip-static">
                <Formula value={s.formula} />
                <span className="text-white/40">({s.phase})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {(p?.suggestions.length ?? 0) > 0 && (
        <div className="mt-5 grid gap-2">
          {p?.suggestions.map((s) => (
            <button
              key={s}
              className="ls-preset"
              onClick={() => onOption(s)}
              style={{ borderColor: `${tone.accent}44` }}
            >
              <span>{s}</span>
              <span aria-hidden>→</span>
            </button>
          ))}
        </div>
      )}

      {(isReaction || result.outcome === "no_reaction") && (
        <p className="mt-5 flex items-center gap-2 text-[11px] text-white/40">
          <span className="rounded border border-white/15 px-1.5 py-0.5 uppercase tracking-wider">
            {result.fidelity}
          </span>
          School-level model · amounts and rates are approximate
        </p>
      )}
    </motion.div>
  );
}
