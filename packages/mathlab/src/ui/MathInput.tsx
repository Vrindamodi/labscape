import { useSubmittedText } from "@labscape/physics";
import { Keyboard } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { parse, ParseError, toText } from "../core/expr";

const KEYS = ["x", "^", "(", ")", "+", "−", "×", "÷", "sqrt(", "sin(", "cos(", "π", "1", "2", "3", "←"];

/**
 * Expression input with live parsing: the reading of what you typed appears underneath (so "2x^2"
 * shows as 2x^2, errors point at the problem), plus an on-screen keypad for phones. Stands in for
 * MathLive behind the same props. `value` is the expression already submitted: the box shows it.
 */
export function MathInput({ label, onSubmit, value = null, disabled, placeholder = "e.g. 3x^2 - 3", submitLabel = "Check" }: { label: string; onSubmit: (expr: string) => void; value?: number | string | null; disabled?: boolean; placeholder?: string; submitLabel?: string }) {
  const id = useId();
  const [v, setV] = useSubmittedText(value);
  const [pad, setPad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => {
    if (!v.trim()) return null;
    try {
      return { ok: true as const, text: toText(parse(v)) };
    } catch (e) {
      return { ok: false as const, text: e instanceof ParseError ? e.message : "Can't read that" };
    }
  }, [v]);
  const press = (k: string) => {
    if (k === "←") setV((s) => s.slice(0, -1));
    else setV((s) => s + (k === "−" ? "-" : k === "×" ? "*" : k === "÷" ? "/" : k === "π" ? "pi" : k));
    input.current?.focus();
  };
  const submit = () => parsed?.ok && onSubmit(v);
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-semibold text-white/60">
        {label}
      </label>
      <div className="mt-0.5 flex items-center gap-1.5">
        <input
          ref={input}
          id={id}
          value={v}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          spellCheck={false}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-md bg-black/30 px-2 font-mono text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-white/25 focus:outline-none focus:ring-accent disabled:opacity-40"
          aria-describedby={`${id}-read`}
        />
        <button type="button" onClick={() => setPad((p) => !p)} className="grid h-9 w-9 place-items-center rounded-md text-white/60 ring-1 ring-inset ring-white/10 hover:text-white" aria-label="Maths keypad" aria-pressed={pad}>
          <Keyboard className="h-4 w-4" />
        </button>
        <button type="button" onClick={submit} disabled={disabled || !parsed?.ok} className="h-9 rounded-md bg-white/[0.07] px-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] disabled:opacity-40">
          {submitLabel}
        </button>
      </div>
      <p id={`${id}-read`} className={`mt-1 min-h-[1rem] font-mono text-[11px] ${parsed && !parsed.ok ? "text-amber-300" : "text-white/45"}`} aria-live="polite">
        {parsed ? (parsed.ok ? `reads as: ${parsed.text}` : parsed.text) : ""}
      </p>
      {pad && (
        <div className="mt-1 grid grid-cols-8 gap-1">
          {KEYS.map((k) => (
            <button key={k} type="button" onClick={() => press(k)} className="h-8 rounded bg-white/[0.06] font-mono text-xs text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.12]">
              {k.replace("(", "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
