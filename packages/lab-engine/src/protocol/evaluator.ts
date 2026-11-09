import type { LabEvent, ScoreDimension } from "@labscape/contracts";
import { KINDS, lipHeightMm, type EquipmentKind } from "../engine/equipment";
import type { LabState } from "../engine/state";
import { look } from "../engine/state";
import type { Deviation, ExperimentContent, Feedback, Report, Severity, StepProgress, StepSpec } from "./types";

/**
 * Procedural evaluator: a state machine that reads the LabEvent stream against the protocol.
 * Feed it every event together with the engine state after that event, plus periodic ticks.
 * It is pure data in, data out, so the server replays it to the same score.
 */
export const DEFAULT_WEIGHTS: Record<ScoreDimension, number> = {
  equipment: 10,
  sequence: 20,
  quantity: 20,
  technique: 20,
  mixing: 0,
  // The build plan's "conditions" (10) is split across temperature and timing.
  temperature: 5,
  timing: 5,
  measurement: 0,
  observation: 20,
};

const PENALTY: Record<Severity, number> = { minor: 0.25, major: 0.6, order: 0.6, safety: 1 };
const TRANSFERS = new Set(["liquid.pour", "liquid.drop", "liquid.draw", "solid.add"]);
const IDLE_HINT_MS = 20_000;

export class Evaluator {
  readonly steps: StepProgress[];
  readonly deviations: Deviation[] = [];
  hintsShown = 0;
  stopped: Feedback & { kind: "safety-stop" } | null = null;
  private answers: Record<string, number> = {};
  /** For "new:<key>" predicates: the seen-count when the step became active. */
  private baselines: Record<string, number> = {};
  private lastActionAt = 0;
  private idleHinted = new Set<string>();
  private triggered = new Set<string>();

  constructor(readonly content: ExperimentContent) {
    this.steps = content.steps.map((s) => ({
      id: s.id,
      done: false,
      doneAt: null,
      amount: 0,
      additions: 0,
      lastAdditionAt: null,
      unmixedSince: null,
      predicateSince: null,
      failures: 0,
      penalties: {},
    }));
  }

  /** The first unfinished, required step. */
  current(): StepSpec | null {
    for (let i = 0; i < this.steps.length; i++) {
      const p = this.steps[i]!;
      const s = this.content.steps[i]!;
      if (!p.done && !s.optional) return s;
    }
    return null;
  }

  progress(id: string) {
    return this.steps.find((p) => p.id === id)!;
  }

  /** Call after the engine applied `e`; `state` is the bench after it. */
  push(e: LabEvent, state: LabState): Feedback[] {
    const out: Feedback[] = [];
    if (this.stopped) return out;
    if (e.actor === "user") this.lastActionAt = e.t;

    if (e.type === "hint.shown") {
      this.hintsShown++;
      return out;
    }
    if (e.type === "param.set" && String(e.payload.key).startsWith("answer:")) {
      this.answers[String(e.payload.key).slice(7)] = Number(e.payload.value);
      return out;
    }

    const match = this.match(e);
    if (!match && TRANSFERS.has(e.type)) {
      const to = target(e);
      const used = new Set(this.content.bench.items.map((i) => i.id));
      if (to && !used.has(to) && to !== "bench") this.flag(out, this.current()?.id ?? "-", "wrong-equipment", "minor", "That isn't the right piece of equipment for this step.", "equipment", e.t);
      else if (to && to !== "bench") {
        // A real vessel, just not the one this step uses: say which one it should have been.
        const cur = this.current();
        const from = (e.payload as Record<string, unknown>).from;
        if (cur?.to && cur.to !== to && cur.from && cur.from === from && TRANSFERS.has(cur.action)) {
          const name = (id: string) => {
            const it = this.content.bench.items.find((i) => i.id === id);
            return it?.label ?? (it ? KINDS[it.kind as EquipmentKind]?.label : undefined) ?? id;
          };
          this.flag(out, cur.id, "wrong-target", "minor", `This step goes into the ${lower(name(cur.to))}, not the ${lower(name(to))}.`, "equipment", e.t);
        }
      }
    }

    if (match) {
      const { spec, progress } = match;
      // Sequence: every required step before this one must be done (or explicitly listed in requires).
      const blockers = (spec.requires ?? []).filter((r) => !this.progress(r).done);
      if (blockers.length) {
        const rule = spec.onDeviation?.order ?? { severity: "major" as const, consequence: "modelled" as const };
        this.flag(out, spec.id, "order", rule.consequence === "blocked" ? "order" : rule.severity === "minor" ? "minor" : "order", `Step order: finish "${this.title(blockers[0]!)}" first.`, "sequence", e.t, rule);
      }
      if (TRANSFERS.has(e.type)) this.checkTransfer(out, spec, progress, e);
      if (e.type === "mix.swirl" || e.type === "mix.stir" || e.type === "mix.shake") progress.unmixedSince = null;
      if (e.type === "measure.read") this.checkReading(out, spec, e);
      this.tryComplete(out, spec, progress, state, e.t, e);
    } else if (e.type === "mix.swirl" || e.type === "mix.stir" || e.type === "mix.shake") {
      for (const p of this.steps) if (p.unmixedSince !== null && this.specOf(p.id).to === e.payload.target) p.unmixedSince = null;
    }

    this.checkSafety(out, state, e.t);
    return out;
  }

  /** Time-based checks: predicates that must hold for a while, missing mixing, idle hints. */
  tick(state: LabState, t: number): Feedback[] {
    const out: Feedback[] = [];
    if (this.stopped) return out;
    for (let i = 0; i < this.steps.length; i++) {
      const p = this.steps[i]!;
      const s = this.content.steps[i]!;
      if (p.done) continue;
      if (p.unmixedSince !== null && s.mixing?.withinMs && t - p.unmixedSince > s.mixing.withinMs) {
        p.unmixedSince = null;
        this.flag(out, s.id, "no-mixing", "minor", `Swirl after each addition (${s.mixing.kind.replace("_", " ")}).`, "mixing", t);
      }
      if ((s.requires ?? []).some((r) => !this.progress(r).done)) continue;
      if (p.additions > 0 || s.complete?.predicate || s.stopWhen) this.tryComplete(out, s, p, state, t, null);
    }
    const cur = this.current();
    if (cur && t - this.lastActionAt > IDLE_HINT_MS && !this.idleHinted.has(cur.id)) {
      this.idleHinted.add(cur.id);
      out.push({ kind: "hint-suggest", stepId: cur.id, reason: "idle", t });
    }
    this.checkSafety(out, state, t);
    return out;
  }

  /** Hint text for the current step at a rung (1 nudge, 2 specific, 3 show me). */
  hint(stepId: string, rung: 1 | 2 | 3) {
    const spec = this.specOf(stepId);
    for (const id of spec.hints ?? []) {
      const h = this.content.hints[id];
      if (h?.rung === rung) return { id, ...h };
    }
    return null;
  }

  report(): Report {
    const weights = { ...DEFAULT_WEIGHTS, ...(this.content.scoring ?? {}) } as Record<ScoreDimension, number>;
    const byDimension = {} as Record<ScoreDimension, number | null>;
    let total = 0;
    let weightSum = 0;
    for (const dim of Object.keys(weights) as ScoreDimension[]) {
      const w = weights[dim];
      if (!w) {
        byDimension[dim] = null;
        continue;
      }
      let score: number | null;
      if (dim === "observation") {
        const prompts = this.content.observations.prompts;
        score = prompts.length ? prompts.filter((q) => this.answers[q.id] === q.answer).length / prompts.length : null;
      } else {
        const relevant = this.content.steps.map((s, i) => ({ s, p: this.steps[i]! })).filter(({ s }) => (s.scoring?.[dim] ?? defaultDim(s, dim)) > 0);
        if (!relevant.length) score = dim === "sequence" || dim === "equipment" ? 1 - this.dimPenalty(dim) * 0.5 : null;
        else {
          const done = relevant.filter(({ p }) => p.done);
          const base = done.length / relevant.length;
          // Each deviation costs the same whatever the number of steps: minor 12.5 %, major 30 % of the dimension.
          score = Math.max(0, base - this.dimPenalty(dim) * 0.5);
        }
      }
      byDimension[dim] = score === null ? null : round2(Math.max(0, Math.min(1, score)));
      if (score !== null) {
        total += w * Math.max(0, Math.min(1, score));
        weightSum += w;
      }
    }
    // Each hint slightly lowers the independence part of the score (max 10 %).
    let pct = weightSum ? (total / weightSum) * 100 : 0;
    pct *= 1 - Math.min(0.1, this.hintsShown * 0.02);
    if (this.stopped) pct = Math.min(pct, 40);
    const required = this.content.steps.filter((s) => !s.optional);
    const completed = !this.stopped && required.every((s) => this.progress(s.id).done);
    const score = Math.round(pct);
    return {
      score,
      stars: !completed ? 0 : score >= 90 ? 3 : score >= 70 ? 2 : 1,
      byDimension,
      deviations: [...this.deviations],
      steps: this.content.steps.map((s) => ({ id: s.id, title: s.title, done: this.progress(s.id).done })),
      hintsUsed: this.hintsShown,
      completed,
      stoppedForSafety: !!this.stopped,
    };
  }

  /* ---------------------------------------------------------------- internals */

  private match(e: LabEvent): { spec: StepSpec; progress: StepProgress } | null {
    // Prefer the earliest unfinished step this event fits; finished steps can absorb repeats.
    let fallback: { spec: StepSpec; progress: StepProgress } | null = null;
    for (let i = 0; i < this.content.steps.length; i++) {
      const spec = this.content.steps[i]!;
      const progress = this.steps[i]!;
      if (!fits(spec, e)) continue;
      if (!progress.done) return { spec, progress };
      fallback ??= { spec, progress };
    }
    return fallback && fallback.spec.complete?.predicate ? null : fallback;
  }

  private checkTransfer(out: Feedback[], spec: StepSpec, p: StepProgress, e: LabEvent) {
    const amount = e.type === "solid.add" ? e.payload.massG : (e.payload as { volumeMl: number }).volumeMl;
    const before = p.amount;
    p.amount += amount;
    p.additions += 1;
    p.lastAdditionAt = e.t;
    if (spec.mixing?.during === "each_addition") p.unmixedSince = e.t;
    const tech = spec.technique;
    const isPour = e.type === "liquid.pour";
    const peak = isPour ? e.payload.peakRateMlPerS : e.type === "liquid.drop" ? (e.payload.volumeMl / Math.max(e.payload.drops, 1)) * 2 : 0;
    if (!tech) return;
    if ((tech.kind === "pour" || tech.kind === "slow_pour") && isPour && tech.maxRateMlPerS && peak > tech.maxRateMlPerS) {
      const sev: Severity = peak > tech.maxRateMlPerS * 1.25 ? "major" : "minor";
      this.flag(out, spec.id, "rate", sev, `Pour slower: ${peak.toFixed(1)} mL/s is above the ${tech.maxRateMlPerS} mL/s this step allows.`, "technique", e.t);
      out.push({ kind: "hint-suggest", stepId: spec.id, reason: "rate", t: e.t });
    }
    if (tech.kind === "portions" && amount > tech.portionMl * 1.6) {
      this.flag(out, spec.id, "portion-too-big", "minor", `Add about ${tech.portionMl} mL at a time.`, "technique", e.t);
    }
    if (tech.kind === "dropwise" && spec.quantity) {
      const near = spec.quantity.target - (tech.appliesWithinMlOfEndpoint ?? Infinity);
      if (before + amount > near && (isPour || (e.type === "liquid.drop" && amount / Math.max(e.payload.drops, 1) > tech.dropVolumeMl * 1.5))) {
        const rule = spec.onDeviation?.["not-dropwise"];
        this.flag(out, spec.id, "not-dropwise", rule?.severity === "minor" ? "minor" : "major", "Near the end point add one drop at a time, swirling after each.", "technique", e.t, rule);
        out.push({ kind: "hint-suggest", stepId: spec.id, reason: "rate", t: e.t });
      }
    }
    if (spec.quantity && p.amount > spec.quantity.target + spec.quantity.plusMinus * 4 && before <= spec.quantity.target + spec.quantity.plusMinus * 4) {
      const rule = spec.onDeviation?.overshoot;
      this.flag(out, spec.id, "overshoot", rule?.severity === "minor" ? "minor" : "major", `Too much: about ${p.amount.toFixed(2)} ${spec.quantity.unit} added, ${spec.quantity.target} ${spec.quantity.unit} needed.`, "quantity", e.t, rule);
    }
  }

  private checkReading(out: Feedback[], spec: StepSpec, e: LabEvent) {
    if (e.type !== "measure.read") return;
    const { reading, trueValue } = e.payload;
    const readTo = spec.measurement?.readTo ?? 0.05;
    if (trueValue !== undefined && Math.abs(reading.value - trueValue) > readTo * 1.01) {
      this.flag(out, spec.id, "reading", "minor", `Reading off by ${Math.abs(reading.value - trueValue).toFixed(2)} ${reading.unit}. Read the bottom of the meniscus at eye level.`, "measurement", e.t);
    }
  }

  private tryComplete(out: Feedback[], spec: StepSpec, p: StepProgress, state: LabState, t: number, e: LabEvent | null) {
    if (p.done) return;
    const pred = spec.complete?.predicate ?? spec.stopWhen?.cue;
    let ok: boolean;
    if (pred?.startsWith("new:")) {
      // Only phenomena seen after this step became active count (e.g. each flame test, each clean).
      if ((spec.requires ?? []).some((r) => !this.progress(r).done)) return;
      const key = pred.slice(4);
      this.baselines[spec.id] ??= state.seen[key] ?? 0;
      if ((state.seen[key] ?? 0) <= this.baselines[spec.id]!) return;
      ok = true;
    } else if (pred) {
      const holds = predicate(pred, state);
      if (!holds) {
        p.predicateSince = null;
        return;
      }
      p.predicateSince ??= t;
      ok = t - p.predicateSince >= (spec.stopWhen?.forMs ?? 0);
    } else if (spec.quantity && !spec.complete?.onEvent) {
      ok = p.amount >= spec.quantity.target - spec.quantity.plusMinus;
    } else {
      ok = e !== null;
    }
    if (!ok) return;
    p.done = true;
    p.doneAt = t;
    if (spec.quantity && Math.abs(p.amount - spec.quantity.target) > spec.quantity.plusMinus && !this.deviations.some((d) => d.stepId === spec.id && d.code === "overshoot")) {
      const off = Math.abs(p.amount - spec.quantity.target);
      const sev: Severity = off <= spec.quantity.target * 0.03 + spec.quantity.plusMinus ? "minor" : "major";
      this.flag(out, spec.id, "quantity", sev, `Volume off target: ${p.amount.toFixed(2)} ${spec.quantity.unit} instead of ${spec.quantity.target} ± ${spec.quantity.plusMinus}.`, "quantity", t);
    }
    out.push({ kind: "step-complete", stepId: spec.id, t });
  }

  private checkSafety(out: Feedback[], state: LabState, t: number) {
    for (const rule of this.content.safety) {
      if (this.triggered.has(rule.code) || !predicate(rule.when, state)) continue;
      this.triggered.add(rule.code);
      const stop = { kind: "safety-stop" as const, rule, t };
      this.stopped = stop;
      this.flag(out, this.current()?.id ?? "-", rule.code, "safety", rule.message, "technique", t);
      out.push(stop);
    }
  }

  private flag(out: Feedback[], stepId: string, code: string, severity: Severity, message: string, dimension: ScoreDimension, t: number, rule?: { severity: string; consequence: string }) {
    // The same mistake on the same step is only counted once.
    if (this.deviations.some((d) => d.stepId === stepId && d.code === code)) return;
    const d: Deviation = { stepId, code, severity, message, dimension, t, tag: dimension === "observation" ? "conceptual" : "procedural" };
    this.deviations.push(d);
    const p = this.steps.find((x) => x.id === stepId);
    if (p) {
      p.failures++;
      p.penalties[dimension] = (p.penalties[dimension] ?? 0) + PENALTY[severity];
      if (p.failures === 2) out.push({ kind: "hint-suggest", stepId, reason: "fails", t });
    }
    out.push(rule ? { kind: "deviation", deviation: d, rule: rule as never } : { kind: "deviation", deviation: d });
  }

  private dimPenalty(dim: ScoreDimension) {
    return this.deviations.filter((d) => d.dimension === dim).reduce((a, d) => a + PENALTY[d.severity], 0);
  }

  private specOf(id: string) {
    return this.content.steps.find((s) => s.id === id)!;
  }

  private title(id: string) {
    return this.specOf(id).title;
  }
}

function fits(spec: StepSpec, e: LabEvent): boolean {
  if (spec.action !== e.type && !(spec.alsoActions ?? []).includes(e.type)) return false;
  const p = e.payload as Record<string, unknown>;
  // Which item the event acts on: param keys end in ":<id>"; heat/cool name their target.
  const subject = e.type === "param.set" ? String(p.key).split(":")[1] : e.type === "heat.set" || e.type === "cool.set" ? p.target : undefined;
  const from = p.from ?? p.instrument ?? p.equipmentId ?? subject;
  const to = p.to ?? p.into ?? (subject === undefined ? p.target : undefined);
  if (spec.from && from !== spec.from) return false;
  if (spec.to && to !== spec.to) return false;
  if (e.type === "param.set" && String(p.key).startsWith("answer:")) return false;
  return true;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function target(e: LabEvent): string | undefined {
  const p = e.payload as Record<string, unknown>;
  return (p.to ?? p.into) as string | undefined;
}

function defaultDim(s: StepSpec, dim: ScoreDimension): number {
  if (dim === "sequence") return 1;
  if (dim === "quantity") return s.quantity ? 1 : 0;
  if (dim === "technique") return s.technique ? 1 : 0;
  if (dim === "mixing") return s.mixing ? 1 : 0;
  if (dim === "measurement") return s.measurement ? 1 : 0;
  if (dim === "equipment") return 1;
  return 0;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

/**
 * Named predicates over the bench state, used by step completion and safety rules.
 * Forms: "seen:<key>", "pink-persists:<id>", "ph-above:<id>:<v>", "ph-below:<id>:<v>",
 * "precipitate:<id>:<formula>", "gas-collected:<id>:<gas>:<mL>", "deposit:<id>",
 * "temp-above:<id>:<C>", "volume-at-least:<id>:<mL>", "spill-hazard", "burette-clear:<id>",
 * "count:<n>:<seen key>", "time-at-least:<ms>", "volume-at-most:<id>:<mL>", "burner-on:<id>",
 * "burner-off:<id>", and "<a>&<b>" for several at once.
 */
export function predicate(expr: string, s: LabState): boolean {
  // "<p1>&<p2>": every part must hold (e.g. three tubes have all been coated).
  if (expr.includes("&")) return expr.split("&").every((part) => predicate(part, s));
  const [name, a, b, c] = expr.split(":");
  const it = a ? s.items[a] : undefined;
  switch (name) {
    case "seen":
      return (s.seen[[a, b, c].filter(Boolean).join(":")] ?? 0) > 0;
    case "count": {
      // count:<n>:<seen key> - the phenomenon has been seen at least n times (keys may contain colons)
      const key = expr.split(":").slice(2).join(":");
      return (s.seen[key] ?? 0) >= Number(a);
    }
    case "time-at-least":
      return s.t >= Number(a);
    case "pink-persists": {
      const l = it ? look(it) : null;
      // The mixed bulk is alkaline enough for pink, and no unmixed patch is still fading in.
      const unmixed = it?.liquid?.plume?.volumeMl ?? 0;
      return !!l && l.ph >= 8.4 && unmixed < 0.05 * Math.max(l.volumeMl, 1);
    }
    case "ph-above":
      return !!it?.liquid && it.liquid.ph > Number(b);
    case "ph-below":
      return !!it?.liquid && it.liquid.ph < Number(b);
    case "precipitate":
      return (it?.liquid?.solids[b as keyof NonNullable<typeof it.liquid>["solids"]] ?? 0) > 1e-5;
    case "gas-collected":
      return (it?.gasMl?.[b ?? ""] ?? 0) >= Number(c);
    case "deposit":
      return (it?.depositMol ?? 0) > 1e-4;
    case "temp-above":
      return !!it?.liquid && it.liquid.tempC > Number(b);
    case "volume-at-least":
      return !!it?.liquid && it.liquid.volumeMl >= Number(b) - 1e-6;
    case "volume-at-most":
      return !!it?.liquid && it.liquid.volumeMl > 0 && it.liquid.volumeMl <= Number(b) + 1e-6;
    case "burner-on":
      return !!it?.gasOn;
    case "burner-off":
      return !!it && it.kind === "bunsen" && !it.gasOn;
    case "burette-clear":
      return !!it && it.kind === "burette_50" && !it.tipBubble && (it.liquid?.volumeMl ?? 0) > 0;
    case "spill-hazard":
      return s.spills.some((x) => x.reagentHazard);
    case "lip":
      return !!it && lipHeightMm(it.kind) > 0;
    default:
      return false;
  }
}
