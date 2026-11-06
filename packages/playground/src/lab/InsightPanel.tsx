import type { ObservationCue, SimulationOutcome, SimulationResult } from "@labscape/contracts";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Equation, Formula, NumberTicker } from "../components/bits";
import { MoleculeView } from "./MoleculeView";

export type InsightState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "result"; result: SimulationResult }
  | { kind: "offline"; message: string }
  | { kind: "cooldown"; until: number; message: string };

const TONES: Record<SimulationOutcome, { colour: string; label: string; emoji: string }> = {
  reaction: { colour: "#16a34a", label: "Reaction!", emoji: "✨" },
  no_reaction: { colour: "#0284c7", label: "No reaction", emoji: "💧" },
  needs_conditions: { colour: "#d97706", label: "Needs a nudge", emoji: "🔥" },
  out_of_range: { colour: "#d97706", label: "Too much", emoji: "⚖️" },
  procedure_mismatch: { colour: "#d97706", label: "Check conditions", emoji: "🌡️" },
  unsupported: { colour: "#b45309", label: "Not modelled", emoji: "🧩" },
  prohibited: { colour: "#dc2626", label: "Not allowed", emoji: "⛔" },
};

const STATE_LABEL: Record<string, string> = { s: "solid", l: "liquid", g: "gas", aq: "dissolved" };

const MEASURE_LABEL: Record<string, string> = {
  pH: "pH",
  temperature: "Temperature",
  deltaT: "Temp change",
  precipitate: "Solid formed",
  volume: "Liquid",
};

type Props = {
  state: InsightState;
  newDiscoveries: Set<string>;
  presets: { label: string; emoji: string; onPick: () => void }[];
  onOption: (o: string) => void;
};

export function InsightPanel({ state, newDiscoveries, presets, onOption }: Props) {
  return (
    <section
      className="lab-card lab-scroll flex h-full min-h-0 flex-col overflow-y-auto"
      aria-live="polite"
      aria-label="What's happening"
    >
      <AnimatePresence mode="wait">
        {state.kind === "idle" && <Idle key="idle" presets={presets} />}
        {state.kind === "working" && (
          <motion.div
            key="working"
            className="p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="lab-eyebrow">Safety engine</div>
            <div className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-slate-700">
              <motion.span
                className="inline-block h-3 w-3 rounded-full bg-cyan-400"
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 0.7, repeat: Infinity }}
              />
              Checking what happens…
            </div>
          </motion.div>
        )}
        {state.kind === "offline" && (
          <Box
            key="offline"
            colour="#64748b"
            label="Simulation unavailable"
            emoji="⏻"
            title="Safety engine offline"
          >
            <p className="lab-text">{state.message}</p>
            <p className="lab-sub">
              LABscape never shows a reaction without the safety engine's answer.
            </p>
          </Box>
        )}
        {state.kind === "cooldown" && (
          <Cooldown key="cooldown" until={state.until} message={state.message} />
        )}
        {state.kind === "result" && (
          <ResultView
            key={state.result.requestId}
            r={state.result}
            fresh={newDiscoveries}
            onOption={onOption}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function Box({
  colour,
  label,
  emoji,
  title,
  children,
}: {
  colour: string;
  label: string;
  emoji: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="p-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      <motion.span
        className="lab-pill"
        style={{ background: `${colour}1a`, color: colour, borderColor: `${colour}55` }}
        initial={{ scale: 0.5 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
      >
        {emoji} {label}
      </motion.span>
      <h3 className="mt-2 font-heading text-[21px] font-bold leading-tight text-slate-800">
        {title}
      </h3>
      <div className="mt-2 space-y-3">{children}</div>
    </motion.div>
  );
}

function Idle({ presets }: { presets: Props["presets"] }) {
  return (
    <motion.div
      className="p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="lab-eyebrow">Welcome to the lab</div>
      <h3 className="mt-1 font-heading text-[22px] font-bold leading-tight text-slate-800">
        Pick something up and start pouring!
      </h3>
      <ol className="mt-3 space-y-2 text-[13.5px] text-slate-600">
        <li>
          <b>1.</b> Choose an element from the periodic table, or a chemical bottle.
        </li>
        <li>
          <b>2.</b> Drag the bottle up to tilt and pour, squeeze a dropper, tip a spatula or open a
          gas valve.
        </li>
        <li>
          <b>3.</b> Add more things, stir, heat with the Bunsen burner or strike a spark - and
          watch.
        </li>
      </ol>
      <div className="lab-eyebrow mt-5 mb-2">Try a famous experiment</div>
      <div className="grid gap-2">
        {presets.map((p, i) => (
          <motion.button
            key={p.label}
            className="lab-preset"
            onClick={p.onPick}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i }}
            whileHover={{ x: 4 }}
          >
            <span className="text-lg">{p.emoji}</span>
            <span className="flex-1">{p.label}</span>
            <span aria-hidden>→</span>
          </motion.button>
        ))}
      </div>
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
    <Box colour="#dc2626" label="Cooldown" emoji="⏳" title="Take a short break">
      <p className="lab-text">{message}</p>
      <div className="tabular rounded-xl bg-red-50 p-4 text-center font-heading text-3xl text-red-700">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </div>
    </Box>
  );
}

function smells(cues: ObservationCue[]) {
  const out: { gas: string; text: string }[] = [];
  for (const c of cues) {
    if (c.kind === "gas" && c.smell) out.push({ gas: c.gas, text: c.smell });
    if (c.kind === "smoke" && c.label) out.push({ gas: "", text: c.label });
    if (c.kind === "odour") out.push({ gas: "", text: c.description });
  }
  return out.filter((v, i, a) => a.findIndex((x) => x.text === v.text) === i);
}

function ResultView({
  r,
  fresh,
  onOption,
}: {
  r: SimulationResult;
  fresh: Set<string>;
  onOption: (o: string) => void;
}) {
  const tone = TONES[r.outcome];
  const p = r.presentation;
  const reactions = p?.reactions ?? [];
  const animated = reactions.find(
    (x) => x.participants && x.type !== "indicator" && x.type !== "physical",
  );
  const smellList = useMemo(() => smells(r.cues), [r.cues]);
  const compounds = p?.compounds ?? [];

  return (
    <Box colour={tone.colour} label={tone.label} emoji={tone.emoji} title={p?.title ?? tone.label}>
      {p?.message && <p className="lab-text">{p.message}</p>}

      {compounds.length > 0 && (
        <div>
          <div className="lab-eyebrow mb-1.5">What formed</div>
          <div className="grid grid-cols-2 gap-2">
            {compounds.map((c, i) => (
              <motion.div
                key={c.formula}
                className="lab-compound"
                initial={{ opacity: 0, scale: 0.8, rotateY: 90 }}
                animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 260, damping: 20 }}
              >
                <span
                  className="lab-compound-swatch"
                  style={{ background: c.colour ?? (c.state === "g" ? "#e0f2fe" : "#e2e8f0") }}
                >
                  {c.state === "g" ? "💨" : c.state === "aq" ? "💧" : c.state === "l" ? "💧" : "◆"}
                </span>
                <div className="min-w-0">
                  <Formula
                    value={c.formula}
                    className="block truncate font-mono text-[13px] font-bold text-slate-800"
                  />
                  <div className="truncate text-[11.5px] text-slate-600">{c.name}</div>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-400">
                    {STATE_LABEL[c.state] ?? c.state}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {animated?.participants && (
        <MoleculeView
          reactants={animated.participants.reactants}
          products={animated.participants.products}
          title={animated.name}
        />
      )}

      {reactions.length > 0 && (
        <div className="space-y-1.5">
          <div className="lab-eyebrow">Equations</div>
          {reactions.map((x, i) => (
            <div key={x.id + i} className="lab-equation">
              <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-slate-700">
                {x.name}
                {x.discoveryId && fresh.has(x.discoveryId) && <span className="lab-new">NEW</span>}
              </div>
              <Equation latex={x.equationLatex} />
            </div>
          ))}
        </div>
      )}

      {(smellList.length > 0 || (p?.observations.length ?? 0) > 0) && (
        <div>
          <div className="lab-eyebrow mb-1.5">
            What you see{smellList.length ? " and smell" : ""}
          </div>
          <ul className="space-y-1.5">
            {p?.observations.map((o, i) => (
              <motion.li
                key={i}
                className="lab-obs"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              >
                <span>{o.startsWith("☢") ? "" : "👀"}</span>
                {o}
              </motion.li>
            ))}
            {smellList.map((s, i) => (
              <motion.li
                key={`s${i}`}
                className="lab-obs lab-obs-smell"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <span>👃</span>
                {s.gas ? <b className="mr-1">{s.gas}:</b> : null}
                {s.text}
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {r.measurements.length > 0 && (r.outcome === "reaction" || r.outcome === "no_reaction") && (
        <div className="grid grid-cols-3 gap-1.5">
          {r.measurements.map((m) => (
            <div key={m.key} className="lab-readout">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-400">
                {m.key.startsWith("gas:")
                  ? `${m.key.slice(4)} gas`
                  : (MEASURE_LABEL[m.key] ?? m.key)}
              </div>
              <div className="text-[15px] font-semibold text-slate-800">
                <NumberTicker
                  value={m.value}
                  decimals={
                    m.key === "pH" || m.key === "deltaT" ? 1 : m.key === "precipitate" ? 2 : 0
                  }
                  durationMs={800}
                />
                <span className="ml-0.5 text-[10px] text-slate-400">
                  {m.unit === "pH" ? "" : m.unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {(p?.facts.length ?? 0) > 0 && <Facts facts={p?.facts ?? []} />}

      {(p?.suggestions.length ?? 0) > 0 && (
        <div className="grid gap-1.5">
          {p?.suggestions.map((s) => (
            <button key={s} className="lab-preset" onClick={() => onOption(s)}>
              <span className="flex-1">{s}</span>→
            </button>
          ))}
        </div>
      )}

      {(r.outcome === "reaction" || r.outcome === "no_reaction") && (
        <p className="lab-sub">School-level model - amounts, colours and rates are approximate.</p>
      )}
    </Box>
  );
}

function Facts({ facts }: { facts: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (facts.length < 2) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % facts.length), 7000);
    return () => window.clearInterval(id);
  }, [facts.length]);
  const fact = facts[i % facts.length] ?? "";
  return (
    <div className="lab-fact">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-violet-700">💡 Did you know?</span>
        {facts.length > 1 && (
          <button
            className="lab-mini lab-mini-ghost"
            onClick={() => setI((x) => (x + 1) % facts.length)}
          >
            Next ({(i % facts.length) + 1}/{facts.length})
          </button>
        )}
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={fact}
          className="mt-1 text-[13px] leading-snug text-slate-700"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
        >
          {fact}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
