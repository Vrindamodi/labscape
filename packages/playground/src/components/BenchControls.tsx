import { AnimatePresence, motion } from "framer-motion";
import type { TrayItem } from "../types";
import { liquidMl } from "../types";
import { Formula, ReagentArt } from "./bits";

type Props = {
  tray: TrayItem[];
  maxItems: number;
  capacityMl: number;
  temperature: number;
  minT: number;
  maxT: number;
  stirring: boolean;
  busy: boolean;
  canMix: boolean;
  focusRef: string | null;
  heaterGlow: boolean;
  mixed: boolean;
  onAmount: (key: string, amount: number) => void;
  onRemove: (key: string) => void;
  onTemperature: (t: number) => void;
  onStirring: (s: boolean) => void;
  onMix: () => void;
  onEmpty: () => void;
};

function step(t: TrayItem) {
  const { unit, max } = t.item.limits;
  if (unit === "drops") return 1;
  if (unit === "mL") return max > 20 ? 1 : 0.5;
  return max <= 0.2 ? 0.01 : max <= 2 ? 0.05 : 0.1;
}

function fmt(v: number, s: number) {
  const d = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
  return v.toFixed(d);
}

export function BenchControls(p: Props) {
  const total = p.tray.reduce((acc, t) => acc + liquidMl(t), 0);
  const heat = (p.temperature - p.minT) / (p.maxT - p.minT);
  return (
    <section className="ls-panel flex flex-col gap-3 p-4" aria-label="Bench controls">
      <div className="flex items-center justify-between">
        <h2 className="ls-eyebrow">Reagent tray</h2>
        <span className="tabular text-[11px] text-white/45">
          {p.tray.length}/{p.maxItems} · {total.toFixed(1)} / {p.capacityMl} mL
        </span>
      </div>

      <div className="ls-tray">
        <AnimatePresence initial={false}>
          {p.tray.length === 0 && (
            <motion.p
              key="empty"
              className="col-span-full py-4 text-center text-[13px] text-white/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Tap reagents on the shelf to add them here, set amounts, then hit{" "}
              <b className="text-accent-cyan">MIX</b>.
            </motion.p>
          )}
          {p.tray.map((t, i) => {
            const s = step(t);
            const focus = p.focusRef === t.item.id;
            return (
              <motion.div
                key={t.key}
                layout
                className={`ls-tray-item ${focus ? "ls-tray-focus" : ""}`}
                initial={{ opacity: 0, scale: 0.8, y: 12 }}
                animate={
                  focus
                    ? { opacity: 1, scale: 1, y: 0, x: [0, -6, 6, -4, 4, 0] }
                    : { opacity: 1, scale: 1, y: 0, x: 0 }
                }
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
                style={{ ["--swatch" as string]: t.item.colour }}
              >
                <div className="flex items-center gap-2">
                  <span className="tabular grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] text-white/60">
                    {i + 1}
                  </span>
                  <ReagentArt item={t.item} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-white/90">
                      {t.item.name}
                    </div>
                    <Formula value={t.item.formula} className="ls-formula text-[11px]" />
                  </div>
                  <button
                    className="ls-icon-btn"
                    onClick={() => p.onRemove(t.key)}
                    disabled={p.busy}
                    aria-label={`Remove ${t.item.name}`}
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="range"
                    className="ls-range flex-1"
                    min={t.item.limits.min}
                    max={t.item.limits.max}
                    step={s}
                    value={t.amount}
                    disabled={p.busy}
                    onChange={(e) => p.onAmount(t.key, Number(e.target.value))}
                    aria-label={`${t.item.name} amount in ${t.item.limits.unit}`}
                  />
                  <span className="tabular w-[62px] text-right text-[12px] text-white/85">
                    {fmt(t.amount, s)} <span className="text-white/45">{t.item.limits.unit}</span>
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <motion.div
          className={`ls-control ${p.heaterGlow ? "ls-control-glow" : ""}`}
          animate={p.heaterGlow ? { y: [0, -4, 0] } : { y: 0 }}
          transition={p.heaterGlow ? { duration: 1.5, repeat: Infinity } : { duration: 0.2 }}
        >
          <div className="flex items-center justify-between">
            <span className="ls-eyebrow">Water bath</span>
            <span
              className="tabular text-[13px]"
              style={{ color: `hsl(${200 - heat * 190} 90% 65%)` }}
            >
              {p.temperature.toFixed(0)} °C
            </span>
          </div>
          <input
            type="range"
            className="ls-range ls-range-heat mt-2 w-full"
            min={p.minT}
            max={p.maxT}
            step={1}
            value={p.temperature}
            disabled={p.busy}
            onChange={(e) => p.onTemperature(Number(e.target.value))}
            aria-label="Water bath temperature in degrees Celsius"
          />
        </motion.div>
        <button
          className={`ls-toggle ${p.stirring ? "ls-toggle-on" : ""}`}
          onClick={() => p.onStirring(!p.stirring)}
          disabled={p.busy}
          aria-pressed={p.stirring}
        >
          <motion.svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            animate={p.stirring ? { rotate: 360 } : { rotate: 0 }}
            transition={
              p.stirring ? { duration: 1.2, repeat: Infinity, ease: "linear" } : { duration: 0.2 }
            }
            aria-hidden
          >
            <path
              d="M12 3a9 9 0 1 1-8.5 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M3 4v5h5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </motion.svg>
          Stir
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button className="ls-btn-ghost" onClick={p.onEmpty} disabled={p.busy}>
          {p.mixed ? "Empty beaker" : "Clear tray"}
        </button>
        <motion.button
          className="ls-mix"
          onClick={p.onMix}
          disabled={!p.canMix}
          whileHover={p.canMix ? { scale: 1.02 } : {}}
          whileTap={p.canMix ? { scale: 0.97 } : {}}
        >
          <span className="ls-mix-shine" aria-hidden />
          <span className="relative flex items-center justify-center gap-2">
            {p.busy ? (
              <>
                <motion.span
                  className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
                />
                MIXING
              </>
            ) : (
              <>
                {p.mixed ? "MIX AGAIN" : "MIX"}
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                  <path
                    d="M5 12h12M13 6l6 6-6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            )}
          </span>
        </motion.button>
      </div>
    </section>
  );
}
