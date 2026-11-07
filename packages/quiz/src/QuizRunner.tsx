import { AnimatePresence, motion, Reorder, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GripVertical, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { DIAGRAMS } from "./diagrams";

/* ------------------------------------------------------------------ types (contract 6, as served) */

type Opt = { id: string; text: string };
export type ServedQuestion = {
  id: string;
  type: "multiple_choice" | "true_false" | "match" | "identify_equipment" | "label_diagram" | "predict_outcome" | "arrange_steps" | "numerical" | "fill_blank";
  prompt: string;
  conceptIds: string[];
  options?: Opt[];
  multi?: boolean;
  left?: Opt[];
  right?: Opt[];
  labels?: Opt[];
  targets?: { id: string; x: number; y: number }[];
  diagram?: string;
  steps?: Opt[];
  unit?: string;
  blanks?: number;
  equipmentKind?: string;
};
export type QuizSpec = { id: string; title: string; passPct: number; experimentId?: string; questions: ServedQuestion[] };
export type Started = { quizAttemptId: string; spec: QuizSpec };
export type QuizAnswer = Record<string, unknown> & { questionId: string; type: string };
export type QuizResult = {
  quizId: string;
  attemptId: string;
  scorePct: number;
  passed: boolean;
  perQuestion: { questionId: string; credit: number; correct: boolean; explanation: string; note?: string | null; yourAnswer?: unknown; rightAnswer?: unknown }[];
  xpAwarded: number;
  revisionConceptIds: string[];
  conceptLabels: Record<string, string>;
  mastery: Record<string, number>;
  reward?: unknown;
};

export type QuizRunnerProps = {
  /** Starts a sitting (POST /v1/quizzes/{id}/start). */
  start: () => Promise<Started>;
  /** Submits answers (POST /v1/quizzes/attempts/{id}/submit). */
  submit: (attemptId: string, body: { idempotencyKey: string; answers: QuizAnswer[] }) => Promise<QuizResult>;
  onComplete?: (r: QuizResult) => void;
  onPractice?: () => void;
  /** Renders equipment for "identify the equipment" questions (e.g. the 3D viewer). */
  renderEquipment?: (kind: string) => ReactNode;
  continueLabel?: string;
};

/* ------------------------------------------------------------------ runner */

/**
 * <QuizRunner> (build plan 4.5): one question at a time with every question type, keyboard
 * operable throughout. Grading happens on the server; the client never sees answers until the
 * results.
 */
export function QuizRunner({ start, submit, onComplete, onPractice, renderEquipment, continueLabel = "Continue" }: QuizRunnerProps) {
  const reduced = useReducedMotion();
  const [sitting, setSitting] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [key] = useState(() => `quiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let live = true;
    start()
      .then((s) => live && setSitting(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn't start the quiz."));
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="grid h-full place-items-center p-6 text-center text-white/70">{error}</div>;
  if (!sitting) return <div className="grid h-full place-items-center text-white/50">Drawing your questions…</div>;
  const qs = sitting.spec.questions;
  if (result) return <Results spec={sitting.spec} result={result} onContinue={() => onComplete?.(result)} onPractice={onPractice} continueLabel={continueLabel} />;

  const q = qs[i]!;
  const answered = (x: ServedQuestion) => isAnswered(x, answers[x.id]);
  const all = qs.every(answered);
  const set = (a: QuizAnswer) => setAnswers((s) => ({ ...s, [a.questionId]: a }));
  const finish = async () => {
    setBusy(true);
    try {
      const r = await submit(sitting.quizAttemptId, { idempotencyKey: key, answers: qs.map((x) => answers[x.id]).filter((x): x is QuizAnswer => !!x) });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 truncate font-heading text-lg font-semibold text-white">{sitting.spec.title}</h2>
        <ol className="flex gap-1.5" aria-label="Questions">
          {qs.map((x, n) => (
            <li key={x.id}>
              <button onClick={() => setI(n)} aria-current={n === i} aria-label={`Question ${n + 1}${answered(x) ? ", answered" : ""}`} className={`h-2.5 rounded-full transition-all ${n === i ? "w-7 bg-accent" : answered(x) ? "w-2.5 bg-emerald-400" : "w-2.5 bg-white/20"}`} />
            </li>
          ))}
        </ol>
      </div>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.section key={q.id} initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40 }} transition={{ duration: reduced ? 0.1 : 0.32 }} aria-label={`Question ${i + 1} of ${qs.length}`} className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-inset ring-white/[0.08]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-cyan">
              Question {i + 1} of {qs.length} · {TYPE_LABEL[q.type]}
            </div>
            {q.type !== "fill_blank" && <p className="mt-2 text-lg font-medium leading-snug text-white">{q.prompt}</p>}
            {q.equipmentKind && renderEquipment && <div className="mt-3 h-56 overflow-hidden rounded-xl bg-[#0a1226] ring-1 ring-inset ring-white/10">{renderEquipment(q.equipmentKind)}</div>}
            <div className="mt-4">
              <Question q={q} value={answers[q.id]} onChange={set} />
            </div>
          </motion.section>
        </AnimatePresence>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-white/70 hover:bg-white/[0.06] disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <span className="flex-1 text-center text-xs text-white/45">{qs.filter(answered).length} of {qs.length} answered</span>
        {i < qs.length - 1 ? (
          <button onClick={() => setI((n) => n + 1)} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-white/[0.08] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.12]">
            Next <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={() => void finish()} disabled={!all || busy} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_#2f80ff] disabled:opacity-40">
            <Check className="h-4 w-4" /> {busy ? "Marking…" : "Submit answers"}
          </button>
        )}
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<ServedQuestion["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  match: "Match",
  identify_equipment: "Identify the equipment",
  label_diagram: "Label the diagram",
  predict_outcome: "Predict the outcome",
  arrange_steps: "Put in order",
  numerical: "Calculate",
  fill_blank: "Fill the blank",
};

function isAnswered(q: ServedQuestion, a: QuizAnswer | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case "multiple_choice":
    case "identify_equipment":
    case "predict_outcome":
      return ((a.optionIds as string[]) ?? []).length > 0;
    case "true_false":
      return typeof a.value === "boolean";
    case "match":
      return ((a.pairs as unknown[]) ?? []).length === (q.left ?? []).length;
    case "label_diagram":
      return ((a.placements as unknown[]) ?? []).length === (q.labels ?? []).length;
    case "arrange_steps":
      return true;
    case "numerical":
      return typeof a.value === "number" && Number.isFinite(a.value);
    case "fill_blank":
      return ((a.values as string[]) ?? []).filter((v) => v.trim()).length === (q.blanks ?? 1);
  }
}

/* ------------------------------------------------------------------ renderers */

function Question({ q, value, onChange }: { q: ServedQuestion; value: QuizAnswer | undefined; onChange: (a: QuizAnswer) => void }) {
  const base = { questionId: q.id, type: q.type };
  switch (q.type) {
    case "multiple_choice":
    case "identify_equipment":
    case "predict_outcome": {
      const picked = (value?.optionIds as string[]) ?? [];
      const toggle = (id: string) => onChange({ ...base, optionIds: q.multi ? (picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]) : [id] });
      return (
        <div className="grid gap-2" role={q.multi ? "group" : "radiogroup"}>
          {q.multi && <p className="text-xs text-white/50">Choose all that apply.</p>}
          {q.options!.map((o, n) => (
            <motion.button key={o.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * 0.04 }} role={q.multi ? "checkbox" : "radio"} aria-checked={picked.includes(o.id)} onClick={() => toggle(o.id)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm ring-1 ring-inset transition ${picked.includes(o.id) ? "bg-accent/25 text-white ring-accent" : "bg-white/[0.04] text-white/80 ring-white/10 hover:bg-white/[0.07]"}`}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-${q.multi ? "md" : "full"} text-xs font-bold ring-1 ring-inset ${picked.includes(o.id) ? "bg-accent text-white ring-accent" : "text-white/60 ring-white/20"}`}>{"ABCDEFGH"[n]}</span>
              {o.text}
            </motion.button>
          ))}
        </div>
      );
    }
    case "true_false":
      return (
        <div className="grid grid-cols-2 gap-3" role="radiogroup">
          {[true, false].map((v) => (
            <button key={String(v)} role="radio" aria-checked={value?.value === v} onClick={() => onChange({ ...base, value: v })} className={`rounded-xl py-5 text-lg font-bold ring-1 ring-inset transition ${value?.value === v ? "bg-accent/25 text-white ring-accent" : "bg-white/[0.04] text-white/75 ring-white/10 hover:bg-white/[0.07]"}`}>
              {v ? "True" : "False"}
            </button>
          ))}
        </div>
      );
    case "match":
      return <Pairing items={q.left!} choices={q.right!} pairs={(value?.pairs as [string, string][]) ?? []} onChange={(pairs) => onChange({ ...base, pairs })} placeholder="Choose a match" />;
    case "label_diagram": {
      const placements = (value?.placements as [string, string][]) ?? [];
      const Art = DIAGRAMS[q.diagram ?? ""];
      // For each target, which label sits there?
      const at = (t: string) => placements.find(([, tid]) => tid === t)?.[0] ?? "";
      const place = (t: string, label: string) => onChange({ ...base, placements: [...placements.filter(([l, tid]) => tid !== t && l !== label), ...(label ? [[label, t] as [string, string]] : [])] });
      return (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <svg viewBox="0 0 100 100" className="w-full rounded-xl bg-[#0b1430] p-2" role="img" aria-label="Diagram with numbered points">
            {Art && <Art />}
            {q.targets!.map((t, n) => (
              <g key={t.id}>
                <circle cx={t.x} cy={t.y} r={3.6} fill={at(t.id) ? "#2f80ff" : "#ffd43b"} stroke="#0b1430" strokeWidth={0.8} />
                <text x={t.x} y={t.y + 1.4} fontSize={4} textAnchor="middle" fontWeight={800} fill="#0b1430">
                  {n + 1}
                </text>
              </g>
            ))}
          </svg>
          <div className="space-y-2">
            {q.targets!.map((t, n) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-white/80">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ffd43b] text-xs font-black text-[#0b1430]">{n + 1}</span>
                <select value={at(t.id)} onChange={(e) => place(t.id, e.target.value)} className="h-9 flex-1 rounded-md bg-black/30 px-2 text-sm text-white ring-1 ring-inset ring-white/15">
                  <option value="">Choose a label</option>
                  {q.labels!.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.text}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "arrange_steps":
      return <Arrange steps={q.steps!} order={(value?.order as string[]) ?? q.steps!.map((s) => s.id)} onChange={(order) => onChange({ ...base, order })} init={!value} onInit={(order) => onChange({ ...base, order })} />;
    case "numerical":
      return <Numerical q={q} value={value} onChange={(v) => onChange({ ...base, value: v, unit: q.unit ?? "" })} />;
    case "fill_blank":
      return <Blanks q={q} values={(value?.values as string[]) ?? []} onChange={(values) => onChange({ ...base, values })} />;
  }
}

function Pairing({ items, choices, pairs, onChange, placeholder }: { items: Opt[]; choices: Opt[]; pairs: [string, string][]; onChange: (p: [string, string][]) => void; placeholder: string }) {
  const of = (l: string) => pairs.find(([x]) => x === l)?.[1] ?? "";
  const set = (l: string, r: string) => onChange([...pairs.filter(([x, y]) => x !== l && y !== r), ...(r ? [[l, r] as [string, string]] : [])]);
  return (
    <div className="space-y-2">
      {items.map((l) => (
        <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white">{l.text}</span>
          <motion.span className="hidden h-0.5 w-8 bg-accent sm:block" animate={{ scaleX: of(l.id) ? 1 : 0.2, opacity: of(l.id) ? 1 : 0.3 }} />
          <select value={of(l.id)} onChange={(e) => set(l.id, e.target.value)} aria-label={`Match for ${l.text}`} className="h-10 rounded-md bg-black/30 px-2 text-sm text-white ring-1 ring-inset ring-white/15">
            <option value="">{placeholder}</option>
            {choices.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function Arrange({ steps, order, onChange, init, onInit }: { steps: Opt[]; order: string[]; onChange: (o: string[]) => void; init: boolean; onInit: (o: string[]) => void }) {
  useEffect(() => {
    if (init) onInit(order); // the served (shuffled) order counts as an answer once seen
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  return (
    <Reorder.Group axis="y" values={order} onReorder={onChange} className="space-y-2">
      {order.map((id, n) => (
        <Reorder.Item key={id} value={id} className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm text-white ring-1 ring-inset ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 34 }}>
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-white/40" aria-hidden />
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold">{n + 1}</span>
          <span className="flex-1">{byId[id]?.text}</span>
          <button onClick={() => move(n, n - 1)} disabled={n === 0} className="grid h-7 w-7 place-items-center rounded text-white/60 hover:bg-white/10 disabled:opacity-20" aria-label={`Move "${byId[id]?.text}" up`}>
            <ArrowUp className="h-4 w-4" />
          </button>
          <button onClick={() => move(n, n + 1)} disabled={n === order.length - 1} className="grid h-7 w-7 place-items-center rounded text-white/60 hover:bg-white/10 disabled:opacity-20" aria-label={`Move "${byId[id]?.text}" down`}>
            <ArrowDown className="h-4 w-4" />
          </button>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

function Numerical({ q, value, onChange }: { q: ServedQuestion; value: QuizAnswer | undefined; onChange: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(typeof value?.value === "number" ? String(value.value) : "");
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
        placeholder="Your answer"
        className="h-12 w-48 rounded-lg bg-black/30 px-3 font-mono text-lg text-white ring-1 ring-inset ring-white/15 focus:outline-none focus:ring-accent"
      />
      {q.unit && <span className="text-lg text-white/70">{q.unit}</span>}
    </div>
  );
}

function Blanks({ q, values, onChange }: { q: ServedQuestion; values: string[]; onChange: (v: string[]) => void }) {
  const parts = q.prompt.split("___");
  return (
    <p className="text-lg leading-loose text-white">
      {parts.map((p, n) => (
        <span key={n}>
          {p}
          {n < parts.length - 1 && (
            <input
              value={values[n] ?? ""}
              onChange={(e) => {
                const next = [...values];
                next[n] = e.target.value;
                onChange(next);
              }}
              aria-label={`Blank ${n + 1}`}
              className="mx-1 inline-block h-9 w-32 rounded-md bg-black/30 px-2 text-center font-mono text-base text-white ring-1 ring-inset ring-accent/50 focus:outline-none focus:ring-accent"
            />
          )}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ results */

function describe(q: ServedQuestion, a: unknown): string {
  if (a === null || a === undefined) return "No answer";
  const o = a as Record<string, unknown>;
  const opt = (list: Opt[] | undefined, id: string) => list?.find((x) => x.id === id)?.text ?? id;
  switch (q.type) {
    case "multiple_choice":
    case "identify_equipment":
    case "predict_outcome": {
      const ids = Array.isArray(a) ? (a as string[]) : ((o.optionIds as string[]) ?? []);
      return ids.map((id) => opt(q.options, id)).join(", ") || "No answer";
    }
    case "true_false":
      return String(typeof a === "boolean" ? a : o.value) === "true" ? "True" : "False";
    case "match":
    case "label_diagram": {
      const pairs = Array.isArray(a) ? (a as [string, string][]) : ((o.pairs ?? o.placements) as [string, string][]) ?? [];
      return pairs.map(([l, r]) => (q.type === "match" ? `${opt(q.left, l)} → ${opt(q.right, r)}` : `${opt(q.labels, l)} → point ${(q.targets ?? []).findIndex((t) => t.id === r) + 1}`)).join("; ");
    }
    case "arrange_steps": {
      const ids = Array.isArray(a) ? (a as string[]) : ((o.order as string[]) ?? []);
      return ids.map((id, n) => `${n + 1}. ${opt(q.steps, id)}`).join("  ");
    }
    case "numerical":
      return typeof a === "number" ? `${a} ${q.unit ?? ""}` : `${String(o.value)} ${q.unit ?? ""}`;
    case "fill_blank":
      return Array.isArray(a) ? (a as string[][]).map((alts) => alts[0]).join(", ") : ((o.values as string[]) ?? []).join(", ");
  }
}

function Results({ spec, result, onContinue, onPractice, continueLabel }: { spec: QuizSpec; result: QuizResult; onContinue: () => void; onPractice: (() => void) | undefined; continueLabel: string }) {
  const reduced = useReducedMotion();
  const byId = useMemo(() => Object.fromEntries(spec.questions.map((q) => [q.id, q])), [spec]);
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6">
      <div className="flex flex-wrap items-center gap-6">
        <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label={`Score ${result.scorePct}%`}>
          <circle cx={60} cy={60} r={r} stroke="rgba(255,255,255,.1)" strokeWidth={10} fill="none" />
          <motion.circle cx={60} cy={60} r={r} stroke={result.passed ? "#20c997" : "#ffa94d"} strokeWidth={10} fill="none" strokeLinecap="round" transform="rotate(-90 60 60)" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - result.scorePct / 100) }} transition={{ duration: reduced ? 0 : 1 }} />
          <text x={60} y={66} textAnchor="middle" fontSize={26} fontWeight={800} fill="#fff">
            {result.scorePct}%
          </text>
        </svg>
        <div>
          <h2 className="font-heading text-2xl font-bold text-white">{result.passed ? "Passed!" : "Keep practising"}</h2>
          <p className="text-sm text-white/60">
            {result.perQuestion.filter((x) => x.correct).length} of {result.perQuestion.length} fully right · pass mark {spec.passPct}%
          </p>
          {result.xpAwarded > 0 && (
            <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-[#ffd77a]">
              <Sparkles className="h-4 w-4" /> +{result.xpAwarded} XP
            </p>
          )}
        </div>
      </div>

      {result.revisionConceptIds.length > 0 && (
        <div className="mt-5 rounded-xl bg-amber-400/[0.07] p-4 ring-1 ring-inset ring-amber-300/20">
          <p className="text-sm font-semibold text-amber-100">Worth revising</p>
          <div className="mt-2 space-y-2">
            {result.revisionConceptIds.map((cid) => (
              <div key={cid} className="flex items-center gap-3 text-sm">
                <span className="w-44 truncate text-white/80">{result.conceptLabels[cid] ?? cid}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full rounded-full bg-amber-300" initial={{ width: 0 }} animate={{ width: `${Math.round((result.mastery[cid] ?? 0.25) * 100)}%` }} />
                </div>
                <span className="w-10 text-right text-xs text-white/50">{Math.round((result.mastery[cid] ?? 0.25) * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/45">Bars show how sure we are that you know each idea.</p>
        </div>
      )}

      <ol className="mt-5 space-y-3">
        {result.perQuestion.map((p, n) => {
          const q = byId[p.questionId];
          if (!q) return null;
          return (
            <motion.li key={p.questionId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : n * 0.05 }} className={`rounded-xl p-4 ring-1 ring-inset ${p.correct ? "bg-emerald-400/[0.06] ring-emerald-300/25" : p.credit > 0 ? "bg-amber-400/[0.06] ring-amber-300/25" : "bg-red-400/[0.06] ring-red-300/25"}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${p.correct ? "bg-emerald-400 text-[#06210f]" : p.credit > 0 ? "bg-amber-300 text-[#2a1600]" : "bg-red-400 text-white"}`}>{p.correct ? <Check className="h-4 w-4" /> : p.credit > 0 ? <span className="text-[10px] font-bold">½</span> : <X className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{q.type === "fill_blank" ? q.prompt.replaceAll("___", "____") : q.prompt}</p>
                  {!p.correct && (
                    <p className="mt-1 text-xs text-white/60">
                      Your answer: <span className="text-white/80">{describe(q, p.yourAnswer)}</span>
                      <br />
                      Answer: <span className="text-emerald-200">{describe(q, p.rightAnswer)}</span>
                    </p>
                  )}
                  {p.note && <p className="mt-1 text-xs text-amber-200">{p.note}</p>}
                  <p className="mt-1.5 text-xs leading-relaxed text-white/70">{p.explanation}</p>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={onContinue} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-5 text-sm font-semibold text-white">
          {continueLabel} <ArrowRight className="h-4 w-4" />
        </button>
        {onPractice && result.revisionConceptIds.length > 0 && (
          <button onClick={onPractice} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-white/[0.07] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/10">
            <RotateCcw className="h-4 w-4" /> Practise these
          </button>
        )}
      </div>
    </div>
  );
}
