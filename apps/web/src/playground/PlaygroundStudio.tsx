import type { SimulationResult } from "@labscape/contracts";
import { DockButton, DockSeparator, Glass, GhostButton, Kicker, oklabToHex, PlaygroundScene, PrimaryButton, Readout, Segmented, SquareButton, TiltGauge, type HeldKind, type PlaygroundView } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { dispenseMode, fetchCatalogue, liquidMl, loadDiscoveries, ProblemError, resolveMix, saveDiscoveries, sound, type CatalogueResponse, type DiscoveryDef, type FoundDiscovery, type ShelfItem, type TrayItem } from "@labscape/playground";
import { cx } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, Atom, ChevronLeft, ChevronRight, Droplet, Eraser, FlaskConical, Hand, Maximize2, Minimize2, Minus, MoveDown, Plus, RotateCw, Search, ShieldAlert, ShieldCheck, Snowflake, Sparkles, Star, Thermometer, Trophy, Undo2, Wind, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MicroView } from "./MicroView";
import { PeriodicDrawer } from "./PeriodicDrawer";

type Speed = "drop" | "slow" | "steady" | "fast";
const RATE: Record<Speed, number> = { drop: 0.3, slow: 1.5, steady: 4, fast: 9 };
const TILT: Record<Speed, number> = { drop: 62, slow: 78, steady: 96, fast: 118 };
type Tab = "live" | "molecules" | "notebook" | "facts";
type Filter = "all" | "acid" | "alkali" | "salt" | "metal" | "indicator" | "solid" | "gas" | "element" | "other";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "acid", label: "Acids" },
  { id: "alkali", label: "Bases" },
  { id: "salt", label: "Salts" },
  { id: "metal", label: "Metals" },
  { id: "indicator", label: "Indicators" },
  { id: "solid", label: "Solids" },
  { id: "gas", label: "Gases" },
  { id: "element", label: "Elements" },
  { id: "other", label: "Other" },
];
const CAP_COLOUR: Record<string, string> = { acid: "#ef4444", alkali: "#3d8bff", salt: "#a855f7", indicator: "#ec4899", metal: "#94a3b8", solid: "#f59e0b", element: "#22c55e" };

const EMPTY_VIEW: Omit<PlaygroundView, "held" | "focus" | "plateC" | "stirring" | "swirling" | "levelMl" | "capacityMl" | "smell" | "liquidC" | "iceBath" | "reactionPulse" | "sparkPulse"> = {
  colour: "#cfe6ff",
  opacity: 0.05,
  precipitate: null,
  solid: null,
  gas: 0,
  gasColour: null,
  flame: null,
  light: null,
  smoke: null,
};

type LogLine = { t: number; text: string; tone?: "good" | "warn" | "bad" };
const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms / 1000) % 60)).padStart(2, "0")}`;
const unitLabel = (it: ShelfItem) => (it.limits.unit === "drops" ? "drops" : it.limits.unit);
const fmt = (v: number, unit: string) => (unit === "drops" ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : Math.round(v).toString());

function mergeTray(adds: TrayItem[]): TrayItem[] {
  const m = new Map<string, TrayItem>();
  for (const a of adds) {
    const cur = m.get(a.item.id);
    m.set(a.item.id, cur ? { ...cur, amount: Math.round((cur.amount + a.amount) * 100) / 100 } : { ...a, key: a.item.id });
  }
  return [...m.values()];
}

function matchesFilter(it: ShelfItem, f: Filter) {
  if (f === "all") return true;
  if (f === "gas") return it.form === "gas";
  if (f === "element") return !!it.element;
  if (f === "metal") return it.category === "metal" || (!!it.element && ["alkali", "alkaline-earth", "transition", "post-transition"].includes(it.element.category));
  if (f === "other") return ["solvent", "other", "household"].includes(it.category);
  return it.category === f;
}

/**
 * The open chemistry playground (v3 studio): shelf on the left, the real-time bench in the middle,
 * what's happening on the right, tools in the dock. Every mix goes through the server safety
 * engine; with the engine offline nothing reacts.
 */
export function PlaygroundStudio({ onDiscoveries }: { onDiscoveries?: (ids: string[]) => void }) {
  const navigate = useNavigate();
  const { reduced } = useMotion();
  const [cat, setCat] = useState<CatalogueResponse | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adds, setAdds] = useState<TrayItem[]>([]);
  const tray = useMemo(() => mergeTray(adds), [adds]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [plateC, setPlateC] = useState(22);
  const [stirring, setStirring] = useState(false);
  const [swirling, setSwirling] = useState(false);
  const [ignition, setIgnition] = useState(false);
  const [visual, setVisual] = useState(EMPTY_VIEW);
  /** The liquid's temperature eases toward what the engine says (heating takes time). */
  const [liquidC, setLiquidC] = useState(22);
  const [targetC, setTargetC] = useState(22);
  const [iceBath, setIceBath] = useState(false);
  const [smell, setSmell] = useState<{ text: string; colour: string } | null>(null);
  const [reactionPulse, setReactionPulse] = useState(0);
  const [sparkPulse, setSparkPulse] = useState(0);
  const [drawer, setDrawer] = useState<"shelf" | "table">("shelf");
  const plateRef = useRef(22);
  useEffect(() => {
    if (Math.abs(targetC - liquidC) < 0.05) return;
    const id = window.setInterval(() => setLiquidC((c) => (Math.abs(targetC - c) < 0.08 ? targetC : c + (targetC - c) * 0.07)), 150);
    return () => window.clearInterval(id);
  }, [targetC, liquidC]);
  const [ph, setPh] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const t0 = useRef(Date.now());
  const [tab, setTab] = useState<Tab>("live");
  const [focus, setFocus] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "warn" | "bad" | "good" } | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; message: string; suggestions: string[] } | null>(null);
  const [glowTool, setGlowTool] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, FoundDiscovery>>(() => loadDiscoveries());
  const [missionIdx, setMissionIdx] = useState(0);
  const [celebrate, setCelebrate] = useState<DiscoveryDef | null>(null);
  const timers = useRef<number[]>([]);

  // in hand
  const [held, setHeld] = useState<ShelfItem | null>(null);
  const [speed, setSpeed] = useState<Speed>("steady");
  const [amount, setAmount] = useState(10);
  const [flowing, setFlowing] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const flowRef = useRef({ added: 0, tilt: 0, custom: false });

  const capacity = cat?.conditions.vesselCapacityMl ?? 150;
  const levelMl = tray.reduce((a, t) => a + liquidMl(t), 0);
  const heldMode = held ? dispenseMode(held) : null;

  useEffect(() => {
    fetchCatalogue()
      .then((c) => {
        setCat(c);
        setOnline(c.safetyEngineOnline);
        setPlateC(c.conditions.defaultTemperatureC);
        setTargetC(c.conditions.defaultTemperatureC);
        setLiquidC(c.conditions.defaultTemperatureC);
        const first = c.discoveries.findIndex((d) => !loadDiscoveries()[d.id]);
        setMissionIdx(first < 0 ? 0 : first);
      })
      .catch((e: unknown) => setLoadError(e instanceof ProblemError ? e.problem.detail ?? e.problem.title : "Can't reach LABscape."));
    const ts = timers.current;
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, []);

  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
  const showSmell = (text: string, colour: string) => {
    setSmell({ text, colour });
    later(9000, () => setSmell((x) => (x?.text === text ? null : x)));
  };
  const addLog = useCallback((text: string, tone?: LogLine["tone"]) => setLog((l) => [...l, { t: Date.now() - t0.current, text, ...(tone ? { tone } : {}) }].slice(-60)), []);
  const flash = (text: string, tone: "warn" | "bad" | "good" = "warn") => {
    setNote({ text, tone });
    later(3600, () => setNote((n) => (n?.text === text ? null : n)));
  };

  /* ---------------------------------------------------------------- resolve through the safety engine */

  const baseColour = useCallback((t: TrayItem[]) => {
    // Before any reaction says otherwise, the liquid looks like what was poured in.
    let r = 0, g = 0, b = 0, w = 0, op = 0;
    for (const x of t) {
      const v = liquidMl(x);
      if (v <= 0) continue;
      const hex = x.item.colour.replace("#", "");
      const weight = v * (0.2 + x.item.opacity);
      r += parseInt(hex.slice(0, 2), 16) * weight;
      g += parseInt(hex.slice(2, 4), 16) * weight;
      b += parseInt(hex.slice(4, 6), 16) * weight;
      w += weight;
      op += x.item.opacity * v;
    }
    const tot = t.reduce((a, x) => a + liquidMl(x), 0);
    if (!w) return { colour: "#cfe6ff", opacity: 0.05 };
    const h = (n: number) => Math.round(n / w).toString(16).padStart(2, "0");
    return { colour: `#${h(r)}${h(g)}${h(b)}`, opacity: Math.min(1, op / Math.max(1, tot)) };
  }, []);

  const applyResult = useCallback(
    (r: SimulationResult, next: TrayItem[]) => {
      setOnline(true);
      setResult(r);
      const p = r.presentation;
      const temp = r.measurements.find((m) => m.key === "temperature");
      const phM = r.measurements.find((m) => m.key === "pH");
      setPh(phM ? phM.value : null);
      if (temp) {
        setTargetC(temp.value);
        // Heat from a reaction leaks away: the liquid drifts back to the plate setting.
        if (Math.abs(temp.value - plateRef.current) > 1) later(14000, () => setTargetC(plateRef.current));
      }
      if (r.outcome === "reaction") setReactionPulse((n) => n + 1);
      setGlowTool(p?.neededTool ?? null);
      const base = baseColour(next);
      setVisual((v) => ({ ...v, colour: base.colour, opacity: base.opacity, solid: next.some((x) => x.item.form === "solid") ? { colour: next.find((x) => x.item.form === "solid")!.item.colour, amount: Math.min(1, next.filter((x) => x.item.form === "solid").reduce((a, x) => a + x.amount, 0) / 5) } : null }));
      for (const c of r.cues) {
        later(c.startMs ?? 0, () => {
          switch (c.kind) {
            case "colour":
              setVisual((v) => ({ ...v, colour: oklabToHex(c.to), opacity: Math.max(v.opacity, c.to.alpha ?? 0.45) }));
              break;
            case "precipitate":
              setVisual((v) => ({ ...v, precipitate: { colour: oklabToHex(c.colour), turbidity: c.turbidity, settled: 0 } }));
              later(Math.min(6000, c.settleMs), () => setVisual((v) => (v.precipitate ? { ...v, precipitate: { ...v.precipitate, settled: 1 } } : v)));
              sound.play("drip");
              break;
            case "gas":
              setVisual((v) => ({ ...v, gas: Math.min(1, 0.35 + c.ratePerS / 3), gasColour: c.colour ? oklabToHex(c.colour) : null }));
              sound.play("fizz");
              sound.loop("fizz", true, 0.7);
              later(Math.max(5000, Math.min(16000, c.durationMs)), () => {
                setVisual((v) => ({ ...v, gas: 0, gasColour: null }));
                sound.loop("fizz", false);
              });
              addLog(`${c.gas} gas given off${c.smell ? ` · smell: ${c.smell}` : ""}`);
              if (c.smell && !/no smell/i.test(c.smell)) showSmell(c.smell, c.colour ? oklabToHex(c.colour) : "#c8f7a5");
              break;
            case "dissolve":
              later(Math.min(4000, c.durationMs), () => setVisual((v) => (v.solid ? { ...v, solid: (c.fraction ?? 1) >= 1 ? null : { ...v.solid, amount: v.solid.amount * (1 - (c.fraction ?? 1)) } } : v)));
              break;
            case "flame":
              setVisual((v) => ({ ...v, flame: { colour: oklabToHex(c.colour), intensity: c.intensity } }));
              sound.play("whoosh");
              later(Math.min(6000, c.durationMs), () => setVisual((v) => ({ ...v, flame: null })));
              break;
            case "light":
              setVisual((v) => ({ ...v, light: { colour: oklabToHex(c.colour), intensity: c.intensity } }));
              later(Math.min(5000, c.durationMs), () => setVisual((v) => ({ ...v, light: null })));
              break;
            case "smoke":
              setVisual((v) => ({ ...v, smoke: { colour: oklabToHex(c.colour), density: c.density } }));
              later(Math.min(8000, c.durationMs), () => setVisual((v) => ({ ...v, smoke: null })));
              break;
            case "deposit":
              setVisual((v) => ({ ...v, solid: { colour: oklabToHex(c.colour), amount: Math.max(0.3, v.solid?.amount ?? 0.3) } }));
              break;
            case "temperature":
              setTargetC((t) => (temp ? temp.value : t + c.deltaC));
              if (Math.abs(c.deltaC) >= 2) sound.play(c.deltaC > 0 ? "sizzle" : "freeze");
              break;
            case "sound":
              if (c.soundId === "squeaky-pop" || c.soundId === "pop") sound.play("pop");
              else if (c.soundId === "bang") sound.play("bang");
              else if (c.soundId === "crackle") sound.play("crackle");
              break;
            case "odour":
              addLog(`Smell: ${c.description} (waft, never sniff)`);
              showSmell(c.description, "#d9f99d");
              break;
            default:
              break;
          }
        });
      }
      if (p && r.outcome !== "no_reaction") addLog(p.title, r.outcome === "reaction" ? "good" : "warn");
      // Discoveries.
      const fresh = (p?.discoveryIds ?? []).filter((id) => !found[id]);
      if (fresh.length) {
        const nextFound = { ...found };
        fresh.forEach((id) => (nextFound[id] = { at: Date.now(), equationLatex: p?.reactions[0]?.equationLatex ?? "" }));
        setFound(nextFound);
        saveDiscoveries(nextFound);
        onDiscoveries?.(fresh);
        const d = cat?.discoveries.find((x) => x.id === fresh[0]);
        if (d) {
          setCelebrate(d);
          sound.play("discover");
          later(4200, () => setCelebrate(null));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseColour, found, cat, onDiscoveries, addLog],
  );

  const resolve = useCallback(
    async (next: TrayItem[], cond: { temp: number; stir: boolean; ign: boolean }, revert: () => void) => {
      if (!next.length) return;
      setBusy(true);
      try {
        const r = await resolveMix(next, cond.temp, cond.stir, cond.ign);
        if (r.outcome === "prohibited") {
          revert();
          sound.play("deny");
          setBlocked({ title: r.presentation?.title ?? "Not allowed", message: r.presentation?.message ?? "That combination is not allowed.", suggestions: r.presentation?.suggestions ?? [] });
          addLog("Blocked by the safety engine", "bad");
          return;
        }
        if (r.outcome === "out_of_range") {
          revert();
          sound.play("warn");
          flash(r.presentation?.message ?? "That is outside the safe range.");
          return;
        }
        applyResult(r, next);
        if (r.outcome === "needs_conditions" || r.outcome === "unsupported") flash(r.presentation?.message ?? "Nothing happens yet.", "warn");
      } catch (e) {
        revert();
        if (e instanceof ProblemError && e.status === 429) flash(e.problem.detail ?? "Slow down: too many blocked mixes. Try again shortly.", "bad");
        else {
          setOnline(false);
          flash("The safety engine is offline, so nothing can react right now.", "bad");
        }
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyResult, addLog],
  );

  const commit = (item: ShelfItem, amt: number, how: string) => {
    const a = Math.round(amt * 100) / 100;
    if (a < item.limits.min - 1e-6) return flash(`Add at least ${item.limits.min} ${unitLabel(item)} of ${item.name}.`);
    if (online === false) return flash("The safety engine is offline, so nothing can be mixed.", "bad");
    const add: TrayItem = { key: crypto.randomUUID(), item, amount: a };
    const prev = adds;
    const nextAdds = [...adds, add];
    setAdds(nextAdds);
    addLog(`Added ${fmt(a, item.limits.unit)} ${unitLabel(item)} ${item.name}${item.concentrationM ? ` (${item.concentrationM} M)` : ""} · ${how}`);
    void resolve(mergeTray(nextAdds), { temp: plateC, stir: stirring, ign: ignition }, () => setAdds(prev));
  };

  const reResolve = (cond: { temp: number; stir: boolean; ign: boolean }) => tray.length && void resolve(tray, cond, () => {});

  /* ---------------------------------------------------------------- dispensing */

  const room = held ? (held.limits.unit === "mL" && held.form !== "gas" ? Math.max(0, capacity - levelMl) : Infinity) : 0;
  const already = held ? tray.find((t) => t.item.id === held.id)?.amount ?? 0 : 0;
  const maxAdd = held ? Math.max(0, Math.min(room, held.limits.max - already)) : 0;

  const pick = (it: ShelfItem) => {
    if (held?.id === it.id) return putDown();
    setHeld(it);
    setFlowing(false);
    setTilt(0);
    const mode = dispenseMode(it);
    setAmount(mode === "dropper" ? 3 : mode === "spatula" ? Math.min(1, it.limits.max) : Math.min(10, it.limits.max));
    sound.play("clink");
  };
  const putDown = () => {
    stopFlow(false);
    setHeld(null);
    setTilt(0);
  };

  // Liquid pour loop: flow at the chosen speed (or the dragged tilt), stop at the target.
  useEffect(() => {
    if (!flowing || !held || heldMode !== "pour") return;
    let last = performance.now();
    const f = flowRef.current;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const rate = f.custom ? Math.max(0, Math.pow(Math.max(0, (f.tilt - 55) / 70), 1.6) * 12) : RATE[speed];
      f.added = Math.min(f.added + rate * dt, amount, maxAdd);
      setInFlight(f.added);
      if (f.added >= Math.min(amount, maxAdd) - 1e-6) stopFlow(true);
    }, 50);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowing, held, heldMode, speed, amount, maxAdd]);

  const startFlow = (custom = false) => {
    if (!held || maxAdd <= 0) return flash(maxAdd <= 0 && held ? (room <= 0 ? "The beaker is full." : `That is the most ${held.name} allowed.`) : "Pick something up first.");
    flowRef.current = { added: 0, tilt: custom ? tilt : TILT[speed], custom };
    setInFlight(0);
    if (heldMode === "pour") {
      setTilt(TILT[speed]);
      setFlowing(true);
      sound.loop("pour", true, 0.6);
      return;
    }
    // Drops, scoops and gas run for a moment, then the whole amount goes in.
    setFlowing(true);
    setTilt(heldMode === "dropper" ? 18 : heldMode === "spatula" ? 28 : 0);
    if (heldMode === "dropper") sound.play("drop");
    const dur = heldMode === "dropper" ? Math.min(2400, 450 * amount) : heldMode === "spatula" ? 1100 : 1500;
    const it = held;
    const amt = Math.min(amount, maxAdd);
    later(dur, () => {
      setFlowing(false);
      setTilt(0);
      commit(it, amt, heldMode === "dropper" ? "dropwise" : heldMode === "spatula" ? "spatula" : "bubbled in");
    });
  };
  function stopFlow(finish: boolean) {
    if (!flowing) return;
    setFlowing(false);
    sound.loop("pour", false);
    if (heldMode !== "pour" || !held) return;
    setTilt(0);
    const added = flowRef.current.added;
    flowRef.current.added = 0;
    setInFlight(0);
    if (added > 0.05) commit(held, added, flowRef.current.custom ? "hand pour" : `${speed} pour`);
    if (finish) sound.play("clink", 0.4);
  }

  // Drag on the bench to tilt the bottle yourself.
  const pad = useRef<{ y: number; base: number } | null>(null);
  const onPadDown = (e: ReactPointerEvent) => {
    if (!held || heldMode !== "pour") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pad.current = { y: e.clientY, base: TILT[speed] };
    setTilt(TILT[speed]);
    startFlow(false);
  };
  const onPadMove = (e: ReactPointerEvent) => {
    const p = pad.current;
    if (!p) return;
    const dy = e.clientY - p.y;
    if (Math.abs(dy) < 6) return;
    const t = Math.max(0, Math.min(135, p.base + dy * 0.45));
    flowRef.current.custom = true;
    flowRef.current.tilt = t;
    setTilt(t);
  };
  const onPadUp = () => {
    if (!pad.current) return;
    pad.current = null;
    stopFlow(true);
  };

  /* ---------------------------------------------------------------- tools */

  const heatTo = (c: number) => {
    const t = Math.max(cat?.conditions.minTemperatureC ?? 5, Math.min(cat?.conditions.maxTemperatureC ?? 90, c));
    setPlateC(t);
    plateRef.current = t;
    setTargetC(t);
    if (t >= 22) setIceBath(false);
    sound.play(t > 22 ? "sizzle" : t < 22 ? "freeze" : "click");
    addLog(t > 22 ? `Hot plate set to ${t} °C` : t < 22 ? `Into an ice bath (${t} °C)` : "Hot plate off");
    reResolve({ temp: t, stir: stirring, ign: ignition });
  };
  const undo = () => {
    if (!adds.length) return;
    const next = adds.slice(0, -1);
    setAdds(next);
    addLog("Undid the last addition");
    if (!next.length) return empty(true);
    setVisual(EMPTY_VIEW);
    void resolve(mergeTray(next), { temp: plateC, stir: stirring, ign: ignition }, () => {});
  };
  const empty = (silent = false) => {
    setAdds([]);
    setResult(null);
    setPh(null);
    setVisual(EMPTY_VIEW);
    setIgnition(false);
    setTargetC(plateC);
    setSmell(null);
    if (!silent) addLog("Emptied and rinsed the beaker");
    sound.play("pour");
  };

  /* ---------------------------------------------------------------- render */

  const view: PlaygroundView = {
    ...visual,
    levelMl: levelMl + (heldMode === "pour" ? inFlight : 0),
    capacityMl: capacity,
    plateC,
    liquidC,
    iceBath,
    smell: smell ? { colour: smell.colour } : null,
    reactionPulse,
    sparkPulse,
    stirring,
    swirling,
    focus,
    held: held
      ? {
          kind: (heldMode === "pour" ? "bottle" : heldMode) as HeldKind,
          colour: held.colour,
          capColour: CAP_COLOUR[held.category] ?? "#3d8bff",
          tiltDeg: tilt,
          flowing,
          label: held.formula,
        }
      : null,
  };
  const mission = cat?.discoveries[missionIdx] ?? null;
  const foundCount = cat ? cat.discoveries.filter((d) => found[d.id]).length : 0;

  if (loadError)
    return (
      <div className="grid h-screen place-items-center bg-[#0b1530] p-6 text-white">
        <Glass className="max-w-md p-7 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-[#ff5b6b]" />
          <h1 className="mt-3 font-heading text-xl font-bold">Can't reach the safety engine</h1>
          <p className="mt-2 text-sm text-[#c8d6f3]">{loadError} The playground stays closed rather than guess what chemicals do.</p>
          <GhostButton className="mt-4" onClick={() => navigate("/playground")}>
            Back to the playground
          </GhostButton>
        </Glass>
      </div>
    );

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0b1530] font-sans text-[#e8f0ff]">
      <div className="absolute inset-0">
        <PlaygroundScene view={view} reducedMotion={reduced} />
      </div>
      {held && heldMode === "pour" && (
        <div className="absolute inset-0 z-[1] cursor-ns-resize" onPointerDown={onPadDown} onPointerMove={onPadMove} onPointerUp={onPadUp} onPointerCancel={onPadUp} aria-hidden />
      )}

      {/* top bar */}
      <Glass className="absolute left-4 right-4 top-3 z-20 flex h-14 items-center gap-3 px-3">
        <button onClick={() => navigate("/playground")} className="grid h-10 w-10 place-items-center rounded-xl text-[#a9bde4] hover:bg-white/[0.06] hover:text-white" aria-label="Back to the playground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="font-heading text-[16px] font-bold leading-tight">Open Playground</div>
          <div className="text-[12px] text-[#8fa6d1]">Chemistry · {cat?.substances.length ?? "…"} substances</div>
        </div>
        <span className="flex-1" />
        <span className={cx("hidden items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold sm:flex", online === false ? "bg-[rgba(255,91,107,.14)] text-[#ff9b9b]" : "bg-[rgba(61,232,168,.12)] text-[#3de8a8]")} role="status">
          {online === false ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {online === false ? "Safety engine offline" : busy ? "Checking…" : "Safety engine on"}
        </span>
        <button onClick={() => setFocus((f) => !f)} className="flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-[#dbe7ff] hover:bg-white/[0.06]" aria-pressed={focus}>
          {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {focus ? "Exit focus" : "Focus"}
        </button>
      </Glass>

      {/* mission */}
      {mission && !focus && (
        <Glass className="absolute left-1/2 top-[84px] z-10 flex w-[min(380px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 px-3.5 py-2.5 lg:left-[330px] lg:translate-x-0">
          <div className="relative grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#ffc23d 0 ${(foundCount / Math.max(1, cat!.discoveries.length)) * 100}%, rgba(255,255,255,.1) 0)` }}>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#0b1730] font-heading text-[12px] font-bold text-[#ffc23d]">
              {foundCount}/{cat!.discoveries.length}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <Kicker>
              Mission {missionIdx + 1} of {cat!.discoveries.length} {found[mission.id] && <span className="text-[#3de8a8]">· done</span>}
            </Kicker>
            <div className="truncate font-heading text-[14px] font-bold">{found[mission.id] ? mission.name : mission.clue}</div>
          </div>
          <div className="flex flex-col">
            <button aria-label="Previous mission" onClick={() => setMissionIdx((i) => (i - 1 + cat!.discoveries.length) % cat!.discoveries.length)} className="rounded p-0.5 text-[#8fa6d1] hover:text-white">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button aria-label="Next mission" onClick={() => setMissionIdx((i) => (i + 1) % cat!.discoveries.length)} className="rounded p-0.5 text-[#8fa6d1] hover:text-white">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </Glass>
      )}

      {!focus && drawer === "shelf" && <Shelf cat={cat} held={held} onPick={pick} glow={glowTool === "catalyst" ? "mno2-powder" : glowTool === "acid" ? "h2so4" : null} onTable={() => setDrawer("table")} />}
      {!focus && drawer === "table" && cat && (
        <PeriodicDrawer
          elements={cat.substances.filter((x) => x.element)}
          onClose={() => setDrawer("shelf")}
          onHold={(it) => {
            setDrawer("shelf");
            pick(it);
          }}
        />
      )}

      {/* a smell, made visible */}
      <AnimatePresence>
        {smell && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute left-1/2 top-[230px] z-10 -translate-x-1/2 xl:left-[calc(50%+60px)]" role="status">
            <Glass radius="md" className="max-w-xs px-3.5 py-2.5">
              <Kicker>Smell</Kicker>
              <div className="text-[13.5px] font-semibold">{smell.text}</div>
              <div className="mt-0.5 text-[11.5px] text-[#ffd59a]">Waft it towards you with your hand. Never sniff a beaker directly.</div>
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>

      {/* readouts */}
      {levelMl > 0 && (
        <div className="pointer-events-none absolute bottom-[100px] left-1/2 z-10 flex -translate-x-1/2 gap-2 lg:left-[340px] lg:translate-x-0">
          <Readout label="Temperature" value={liquidC.toFixed(1)} unit="°" delta={Math.abs(liquidC - 22) >= 0.5 ? `${liquidC > 22 ? "▲" : "▼"} ${Math.abs(liquidC - 22).toFixed(1)}` : null} tone={liquidC > 22 ? "up" : "down"} />
          {ph !== null && <Readout label="pH" value={ph.toFixed(2)} delta={ph < 6.5 ? "acidic" : ph > 7.5 ? "alkaline" : "neutral"} tone={ph < 6.5 ? "up" : ph > 7.5 ? "down" : "ok"} />}
          <Readout label="Volume" value={fmt(levelMl + inFlight, "mL")} unit="mL" />
        </div>
      )}

      {/* the card beside what is in hand */}
      <AnimatePresence>
        {held && (
          <motion.div key={held.id} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className={cx("absolute z-20 w-[268px]", focus ? "right-4 top-[84px]" : "left-4 top-[164px] lg:left-[330px]")}>
            <HoldCard
              item={held}
              mode={heldMode!}
              speed={speed}
              setSpeed={setSpeed}
              amount={amount}
              setAmount={setAmount}
              max={maxAdd}
              tilt={tilt}
              flowing={flowing}
              inFlight={inFlight}
              onGo={() => (flowing ? stopFlow(true) : startFlow())}
              onDropwise={() => {
                setSpeed("drop");
                if (!flowing) startFlow();
              }}
              onPutDown={putDown}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!focus && <SidePanel tab={tab} setTab={setTab} result={result} log={log} tray={tray} online={online} busy={busy} />}

      {focus && result?.presentation && result.outcome === "reaction" && (
        <Glass className="absolute left-4 top-[84px] z-10 w-[min(420px,calc(100%-32px))] p-4">
          <Kicker>Reaction · {result.presentation.reactions[0]?.type ?? "change"}</Kicker>
          <h2 className="mt-1 font-heading text-[26px] font-bold leading-tight tracking-tight">{result.presentation.title}</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#c8d6f3]">{result.presentation.message}</p>
          {result.equationLatex && <div className="mt-3 overflow-x-auto rounded-xl bg-[rgba(4,10,28,.5)] p-2.5 text-[15px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(result.equationLatex, { throwOnError: false }) }} />}
          {result.presentation.facts[0] && <p className="mt-3 rounded-xl border border-[rgba(167,123,255,.35)] bg-[linear-gradient(135deg,rgba(167,123,255,.22),rgba(57,214,255,.10))] p-3 text-[13px]">💡 {result.presentation.facts[0]}</p>}
        </Glass>
      )}

      {focus && result?.presentation?.reactions[0]?.participants && (
        <div className="pointer-events-none absolute right-8 top-[110px] z-10 hidden md:block">
          <MicroView reactants={result.presentation.reactions[0].participants.reactants} products={result.presentation.reactions[0].participants.products} size={320} />
        </div>
      )}

      {/* dock */}
      <div className="absolute bottom-3 left-1/2 z-20 max-w-[calc(100%-24px)] -translate-x-1/2 overflow-x-auto">
        <Glass radius="xl" className="flex items-center gap-1 p-2" role="toolbar" aria-label="Bench tools">
          <DockButton
            icon={<RotateCw />}
            label="Stir"
            tone={stirring ? "on" : "default"}
            disabled={!tray.length}
            onClick={() => {
              const s = !stirring;
              setStirring(s);
              addLog(s ? "Stirrer on" : "Stirrer off");
              sound.loop("stir", s, 0.5);
              reResolve({ temp: plateC, stir: s, ign: ignition });
            }}
          />
          <DockButton icon={<Wind />} label="Swirl" tone={swirling ? "on" : "default"} disabled={!tray.length} onPointerDown={() => setSwirling(true)} onPointerUp={() => setSwirling(false)} onPointerLeave={() => setSwirling(false)} title="Hold to swirl" />
          <DockSeparator />
          <HeatButton plateC={plateC} glow={glowTool === "heater"} onHeat={heatTo} />
          <DockButton
            icon={<Zap />}
            label="Spark"
            tone={ignition ? "hot" : "default"}
            disabled={!tray.length}
            onClick={() => {
              setIgnition(true);
              setSparkPulse((n) => n + 1);
              sound.play("spark");
              addLog("Held a lit splint to the mouth");
              reResolve({ temp: plateC, stir: stirring, ign: true });
            }}
          />
          <DockButton
            icon={<Snowflake />}
            label="Ice bath"
            tone={iceBath ? "on" : "default"}
            onClick={() => {
              if (iceBath) return heatTo(22);
              heatTo(5);
              setIceBath(true);
            }}
          />
          <DockSeparator />
          <DockButton icon={<Undo2 />} label="Undo" disabled={!adds.length || busy} onClick={undo} />
          <DockButton icon={<Eraser />} label="Empty" tone="danger" disabled={!adds.length} onClick={() => empty()} />
        </Glass>
      </div>

      {/* hints */}
      {!held && !tray.length && !focus && (
        <div className="pointer-events-none absolute left-1/2 top-[172px] z-10 -translate-x-1/2 xl:left-[calc(50%+40px)]">
          <Glass radius="md" className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold">
            <Hand className="h-4 w-4 text-[#39d6ff]" /> Pick a chemical from the shelf to hold it over the beaker
          </Glass>
        </div>
      )}
      {held && heldMode === "pour" && !flowing && (
        <div className="pointer-events-none absolute left-1/2 top-[172px] z-10 -translate-x-1/2 xl:left-[calc(50%+40px)]">
          <Glass radius="md" className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold">
            <MoveDown className="h-4 w-4 text-[#39d6ff]" /> Press and hold on the bench to pour · drag down to tilt more
          </Glass>
        </div>
      )}
      <AnimatePresence>
        {note && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[150px] z-30 -translate-x-1/2" role="status">
            <Glass radius="md" className={cx("max-w-md px-3.5 py-2 text-[13px] font-semibold", note.tone === "bad" ? "text-[#ff9b9b]" : note.tone === "good" ? "text-[#3de8a8]" : "text-[#ffd59a]")}>
              {note.text}
            </Glass>
          </motion.div>
        )}
        {celebrate && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[84px] z-30 -translate-x-1/2" role="status">
            <Glass radius="xl" className="flex items-center gap-3.5 py-3 pl-3 pr-5">
              <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[linear-gradient(135deg,#ffd56b,#ff9a3d)] text-[#3a2200] shadow-[0_0_30px_-4px_#ffb03d]">
                <Trophy className="h-6 w-6" />
              </span>
              <div>
                <Kicker>Discovery</Kicker>
                <b className="font-heading text-[18px]">{celebrate.name}</b>
              </div>
              <span className="flex gap-0.5 text-[#ffc23d]">
                {[0, 1, 2].map((i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </span>
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>

      {online === false && (
        <div className="absolute inset-x-0 top-[76px] z-30 mx-auto w-fit" role="alert">
          <Glass radius="md" className="flex items-center gap-2 border-[rgba(255,91,107,.5)] px-3.5 py-2 text-[13px] font-semibold text-[#ff9b9b]">
            <ShieldAlert className="h-4 w-4" /> Safety engine offline: no reactions are shown until it is back.
          </Glass>
        </div>
      )}

      <AnimatePresence>
        {blocked && (
          <motion.div className="absolute inset-0 z-40 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Glass radius="xl" className="w-[min(440px,100%)] border-[rgba(255,91,107,.45)] p-6" role="alertdialog" aria-label={blocked.title}>
              <ShieldAlert className="h-8 w-8 text-[#ff5b6b]" />
              <h2 className="mt-2 font-heading text-[22px] font-bold">{blocked.title}</h2>
              <p className="mt-2 text-[14px] text-[#c8d6f3]">{blocked.message}</p>
              {blocked.suggestions.length > 0 && (
                <ul className="mt-3 space-y-1 text-[13px] text-[#a9bde4]">
                  {blocked.suggestions.map((s) => (
                    <li key={s}>• {s}</li>
                  ))}
                </ul>
              )}
              <PrimaryButton className="mt-5 w-full" onClick={() => setBlocked(null)}>
                Got it
              </PrimaryButton>
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ shelf */

function Shelf({ cat, held, onPick, glow, onTable }: { cat: CatalogueResponse | null; held: ShelfItem | null; onPick: (it: ShelfItem) => void; glow: string | null; onTable: () => void }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (cat?.substances ?? []).filter((it) => matchesFilter(it, f) && (!s || it.name.toLowerCase().includes(s) || it.formula.toLowerCase().includes(s) || it.element?.symbol.toLowerCase() === s));
  }, [cat, q, f]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="absolute left-4 top-[84px] z-20 flex h-11 items-center gap-2 rounded-2xl px-3 text-[13px] font-semibold lg:hidden" style={{ background: "rgba(14,26,56,.85)" }}>
        <FlaskConical className="h-4 w-4" /> Chemicals
      </button>
      <Glass className={cx("absolute bottom-[96px] left-4 top-[84px] z-20 w-[300px] flex-col p-3.5 lg:flex", open ? "flex" : "hidden")} aria-label="Chemicals shelf">
        <div className="flex items-center justify-between gap-2">
          <b className="font-heading text-[16px]">Chemicals</b>
          <span className="flex-1" />
          <button onClick={onTable} className="flex h-8 items-center gap-1.5 rounded-[10px] border border-[rgba(140,180,255,.16)] bg-[rgba(120,160,255,.10)] px-2.5 text-[12px] font-semibold text-[#dbe7ff] hover:bg-[rgba(120,160,255,.18)]">
            <Atom className="h-4 w-4" /> Periodic table
          </button>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-[#8fa6d1] hover:text-white lg:hidden" aria-label="Close shelf">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-3 flex h-[38px] items-center gap-2 rounded-[11px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.55)] px-3 text-[13px] text-[#8fa6d1]">
          <Search className="h-4 w-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cat?.substances.length ?? ""} chemicals & elements`} className="min-w-0 flex-1 bg-transparent text-white placeholder:text-[#8fa6d1] focus:outline-none" aria-label="Search chemicals" />
        </label>
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter">
          {FILTERS.map((x) => (
            <button key={x.id} role="radio" aria-checked={f === x.id} onClick={() => setF(x.id)} className={cx("h-7 rounded-[9px] border px-2.5 text-[12px] font-semibold", f === x.id ? "border-[rgba(110,170,255,.5)] bg-[rgba(61,139,255,.25)] text-white" : "border-[rgba(140,180,255,.12)] bg-[rgba(120,160,255,.08)] text-[#a9bde4] hover:text-white")}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="ls-scroll mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto pr-1">
          {list.map((it) => (
            <button
              key={it.id}
              onClick={() => onPick(it)}
              aria-pressed={held?.id === it.id}
              className={cx(
                "relative h-[150px] overflow-hidden rounded-[14px] border text-left transition",
                held?.id === it.id ? "border-[#6aa8ff] shadow-[0_0_0_1px_#6aa8ff,0_0_26px_-8px_#3d8bff]" : glow === it.id ? "animate-pulse border-[#ffc23d]" : "border-[rgba(140,180,255,.12)] hover:border-[rgba(140,180,255,.35)]",
              )}
              style={{ background: `radial-gradient(90% 70% at 50% 38%, ${it.colour}33, transparent 70%), rgba(4,10,28,.5)` }}
            >
              {held?.id === it.id ? (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-[#3d8bff] px-1.5 py-0.5 text-[11px] font-bold text-white">
                  <Hand className="h-3 w-3" /> In hand
                </span>
              ) : (
                <span className="absolute left-2 top-2 rounded-md bg-[rgba(61,139,255,.18)] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase text-[#9fd8ff]">{it.element ? it.element.symbol : it.category.slice(0, 5)}</span>
              )}
              {it.hazards.length > 0 && (
                <span className="absolute right-2 top-2 flex gap-1" title={it.hazards.join(", ")}>
                  {it.hazards.slice(0, 2).map((h) => (
                    <i key={h} className="h-3.5 w-3.5 rotate-45 rounded-[2px] border-[1.6px] border-[#ff5b6b] bg-white" />
                  ))}
                </span>
              )}
              <div className="absolute left-1/2 top-7 -translate-x-1/2 drop-shadow-[0_10px_12px_rgba(0,0,0,.55)]">
                <ShelfArt item={it} />
              </div>
              <div className="absolute inset-x-2.5 bottom-2">
                <b className="block truncate text-[13px] font-semibold text-white">{it.name}</b>
                <span className="font-mono text-[11.5px] text-[#8fa6d1]">
                  {it.formula}
                  {it.concentrationM ? ` · ${it.concentrationM} M` : it.solidForm ? ` · ${it.solidForm}` : ""}
                </span>
              </div>
            </button>
          ))}
          {cat && !list.length && <p className="col-span-2 py-6 text-center text-[13px] text-[#8fa6d1]">Nothing matches.</p>}
          {!cat && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[150px] animate-pulse rounded-[14px] bg-white/[0.04]" />)}
        </div>
      </Glass>
    </>
  );
}

function ShelfArt({ item }: { item: ShelfItem }) {
  const mode = dispenseMode(item);
  if (mode === "gas")
    return (
      <svg viewBox="0 0 60 80" className="h-[72px] w-[54px]" aria-hidden>
        <rect x="18" y="16" width="24" height="60" rx="10" fill={item.colour} stroke="#cbd5e1" strokeWidth="2" />
        <rect x="25" y="6" width="10" height="12" rx="2" fill="#94a3b8" />
      </svg>
    );
  if (mode === "spatula")
    return (
      <svg viewBox="0 0 80 70" className="h-[64px] w-[74px]" aria-hidden>
        {item.element && ["transition", "post-transition", "alkali", "alkaline-earth"].includes(item.element.category) ? (
          <path d="M14 56 L28 22 L54 18 L68 50 L44 62 Z" fill={item.colour} stroke="#e2e8f0" strokeWidth="1.5" />
        ) : (
          <path d="M8 62 Q40 10 72 62 Z" fill={item.colour} stroke="#e2e8f0" strokeOpacity=".5" />
        )}
        <path d="M30 30 L40 26" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 60 84" className="h-[76px] w-[56px]" aria-hidden>
      <path d="M12 30 Q12 22 22 18 V8 H38 V18 Q48 22 48 30 V74 Q48 80 42 80 H18 Q12 80 12 74 Z" fill="#dbe8ff" fillOpacity=".18" stroke="#cfe0ff" strokeOpacity=".7" strokeWidth="2" />
      <path d="M14 40 H46 V74 Q46 78 42 78 H18 Q14 78 14 74 Z" fill={item.colour} fillOpacity={0.45 + item.opacity * 0.5} />
      <rect x="20" y="2" width="20" height="9" rx="2" fill={CAP_COLOUR[item.category] ?? "#3d8bff"} />
      <rect x="15" y="46" width="30" height="16" rx="2" fill="#f8fafc" fillOpacity=".92" />
      <text x="30" y="57" textAnchor="middle" fontSize="8" fontWeight="700" fill="#0f172a" fontFamily="Inter, sans-serif">
        {item.formula.length > 7 ? item.formula.slice(0, 7) : item.formula}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ in-hand card */

function HoldCard(p: { item: ShelfItem; mode: ReturnType<typeof dispenseMode>; speed: Speed; setSpeed: (s: Speed) => void; amount: number; setAmount: (n: number) => void; max: number; tilt: number; flowing: boolean; inFlight: number; onGo: () => void; onDropwise: () => void; onPutDown: () => void }) {
  const it = p.item;
  const unit = unitLabel(it);
  const step = it.limits.unit === "drops" ? 1 : it.limits.unit === "g" ? (it.limits.max <= 2 ? 0.1 : 0.5) : 1;
  const chips = it.limits.unit === "drops" ? [1, 3, 5, 10] : it.limits.unit === "g" ? [0.1, 0.5, 1, 2, 5] : [1, 5, 10, 25, 50];
  const verb = p.mode === "pour" ? "Pouring" : p.mode === "dropper" ? "Dropping" : p.mode === "spatula" ? "Adding" : "Bubbling";
  const rate = p.mode === "pour" && p.flowing ? (p.tilt > 0 ? RATE[p.speed] : 0) : 0;
  return (
    <Glass className="space-y-2.5 p-3">
      <div className="flex items-center gap-2">
        <span className="h-[14px] w-[14px] shrink-0 rounded-[4px]" style={{ background: it.colour }} />
        <b className="min-w-0 flex-1 truncate font-heading text-[14px]">
          {p.flowing ? verb : "Holding"} {it.formula}
        </b>
        <button onClick={p.onPutDown} className="rounded p-0.5 text-[#8fa6d1] hover:text-white" aria-label="Put down">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="text-[12px] text-[#8fa6d1]">
        {it.name}
        {it.hazards.length > 0 && <span className="ml-1 text-[#ff9b9b]">· {it.hazards.join(", ")}</span>}
      </div>
      {p.mode === "pour" && (
        <>
          <div className="flex items-center gap-3">
            <TiltGauge deg={p.tilt} max={135} />
            <div>
              <Kicker>Flow</Kicker>
              <div className="font-heading text-[20px] font-bold tabular-nums">
                {rate.toFixed(1)} <span className="text-[13px] text-[#8fa6d1]">mL/s</span>
              </div>
              <div className="text-[12px] font-semibold text-[#3de8a8]">{p.flowing ? `${p.inFlight.toFixed(1)} mL so far` : "Ready"}</div>
            </div>
          </div>
          <Segmented<Speed>
            value={p.speed}
            label="Pour speed"
            size="sm"
            onChange={p.setSpeed}
            options={[
              { id: "drop", label: "Drop" },
              { id: "slow", label: "Slow" },
              { id: "steady", label: "Steady" },
              { id: "fast", label: "Fast" },
            ]}
          />
        </>
      )}
      <div className="flex items-center gap-1.5">
        <SquareButton aria-label="Less" onClick={() => p.setAmount(Math.max(it.limits.min, +(p.amount - step).toFixed(2)))}>
          <Minus className="h-4 w-4" />
        </SquareButton>
        <div className="flex h-[38px] min-w-0 flex-1 items-center justify-between rounded-[11px] border border-[rgba(140,180,255,.2)] bg-[rgba(2,8,24,.65)] px-3">
          <b className="font-heading text-[17px] tabular-nums">{fmt(p.amount, it.limits.unit)}</b>
          <small className="text-[11.5px] text-[#8fa6d1]">
            / {fmt(Math.min(p.max, it.limits.max), it.limits.unit)} {unit}
          </small>
        </div>
        <SquareButton aria-label="More" onClick={() => p.setAmount(Math.min(Math.max(it.limits.min, p.max), +(p.amount + step).toFixed(2)))}>
          <Plus className="h-4 w-4" />
        </SquareButton>
      </div>
      <div className="flex gap-1">
        {chips.filter((v) => v >= it.limits.min && v <= it.limits.max).map((v) => (
          <button key={v} onClick={() => p.setAmount(Math.min(v, Math.max(it.limits.min, p.max)))} className={cx("h-[26px] flex-1 rounded-lg font-mono text-[12px] font-semibold", p.amount === v ? "bg-[rgba(61,139,255,.3)] text-white" : "bg-[rgba(120,160,255,.08)] text-[#a9bde4] hover:text-white")}>
            {v}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PrimaryButton className={p.mode === "pour" ? "" : "col-span-2"} onClick={p.onGo} disabled={p.max <= 0 && !p.flowing}>
          {p.flowing ? (
            "Stop"
          ) : (
            <>
              {p.mode === "dropper" ? <Droplet className="h-4 w-4" /> : p.mode === "gas" ? <Sparkles className="h-4 w-4" /> : <MoveDown className="h-4 w-4" />}
              {p.mode === "pour" ? "Pour" : p.mode === "dropper" ? "Add drops" : p.mode === "spatula" ? "Tip in" : "Bubble in"} {fmt(Math.min(p.amount, p.max), it.limits.unit)}
            </>
          )}
        </PrimaryButton>
        {p.mode === "pour" && (
          <GhostButton onClick={p.onDropwise} disabled={p.flowing || p.max <= 0}>
            <Droplet className="h-4 w-4" /> Dropwise
          </GhostButton>
        )}
      </div>
      <GhostButton className="w-full" onClick={p.onPutDown}>
        <Hand className="h-4 w-4" /> Put down
      </GhostButton>
    </Glass>
  );
}

function HeatButton({ plateC, glow, onHeat }: { plateC: number; glow: boolean; onHeat: (c: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? plateC;
  const commit = () => {
    if (draft !== null && draft !== plateC) onHeat(draft);
    setDraft(null);
  };
  return (
    <div className="relative">
      <DockButton icon={<Thermometer />} label={plateC > 22 ? `${plateC} °C` : "Heat"} tone={plateC > 22 ? "hot" : glow ? "on" : "default"} className={glow ? "animate-pulse" : ""} onClick={() => setOpen((o) => !o)} aria-expanded={open} />
      {open && (
        <Glass radius="md" className="absolute bottom-[64px] left-1/2 w-56 -translate-x-1/2 p-3">
          <Kicker>Hot plate</Kicker>
          <div className="mt-1 font-heading text-[20px] font-bold tabular-nums">{shown} °C</div>
          <input type="range" min={22} max={90} step={1} value={Math.max(22, shown)} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} className="mt-2 w-full accent-[#ff8a3d]" aria-label="Hot plate temperature" />
          <div className="mt-2 flex gap-1">
            {[22, 40, 60, 80].map((t) => (
              <button key={t} onClick={() => onHeat(t)} className={cx("h-7 flex-1 rounded-lg font-mono text-[12px] font-semibold", plateC === t ? "bg-[rgba(255,138,61,.3)] text-white" : "bg-white/[0.06] text-[#a9bde4]")}>
                {t === 22 ? "Off" : t}
              </button>
            ))}
          </div>
        </Glass>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ right panel */

function SidePanel({ tab, setTab, result, log, tray, online, busy }: { tab: Tab; setTab: (t: Tab) => void; result: SimulationResult | null; log: LogLine[]; tray: TrayItem[]; online: boolean | null; busy: boolean }) {
  const p = result?.presentation;
  const reacting = result?.outcome === "reaction";
  return (
    <Glass className="absolute bottom-[96px] right-4 top-[84px] z-10 hidden w-[356px] flex-col p-3.5 xl:flex" aria-label="What's happening">
      <Segmented<Tab>
        value={tab}
        label="Panel"
        onChange={setTab}
        options={[
          { id: "live", label: "Live" },
          { id: "molecules", label: "Molecules" },
          { id: "notebook", label: "Notebook" },
          { id: "facts", label: "Facts" },
        ]}
      />
      <div className="ls-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
        {tab === "live" && (
          <div className="space-y-3">
            {!tray.length ? (
              <div className="rounded-[14px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)] p-3 text-[13px] text-[#c8d6f3]">
                <b className="font-heading text-[15px] text-white">An empty beaker</b>
                <p className="mt-1">Pick something from the shelf and pour it in. Then add a second chemical and watch what the safety engine says happens.</p>
              </div>
            ) : (
              <div className={cx("rounded-[14px] border p-3", reacting ? "border-[rgba(61,232,168,.35)] bg-[linear-gradient(120deg,rgba(61,232,168,.16),rgba(61,139,255,.08))]" : "border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)]")}>
                <div className="flex items-center gap-2 font-heading text-[16px] font-bold">
                  {reacting && <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-[#3de8a8] text-[#053]">✓</span>}
                  {busy ? "Working it out…" : p?.title ?? (online === false ? "Engine offline" : "Mixed")}
                </div>
                {p?.message && <p className="mt-1.5 text-[13px] leading-relaxed text-[#c8d6f3]">{p.message}</p>}
                {p?.observations && p.observations.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[12.5px] text-[#dbe7ff]">
                    {p.observations.map((o) => (
                      <li key={o}>• {o}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {p && p.compounds.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {p.compounds.slice(0, 4).map((c) => (
                  <div key={c.formula} className="flex items-center gap-2 rounded-xl border border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.5)] p-2">
                    <span className="h-[26px] w-[26px] shrink-0 rounded-full" style={{ background: c.colour ?? "radial-gradient(circle at 35% 35%, #fff, #9fb4de)" }} />
                    <span className="min-w-0">
                      <b className="block truncate font-mono text-[13px]">{c.formula}</b>
                      <small className="text-[11.5px] text-[#8fa6d1]">{c.state === "aq" ? "dissolved" : c.state === "s" ? "solid" : c.state === "g" ? "gas" : "liquid"}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {result?.equationLatex && <div className="overflow-x-auto rounded-xl border border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.5)] px-3 py-2.5 text-[14px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(result.equationLatex, { throwOnError: false }) }} />}
            {p && p.suggestions.length > 0 && (
              <div>
                <Kicker>Try next</Kicker>
                <ul className="mt-1.5 space-y-1.5">
                  {p.suggestions.slice(0, 3).map((s, i) => (
                    <li key={s} className="flex gap-2.5 rounded-xl border border-[rgba(255,194,61,.35)] bg-[rgba(255,194,61,.06)] p-2.5 text-[13px] text-[#dbe7ff]">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#ffc23d] font-heading text-[12px] font-bold text-[#2a1d00]">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Kicker>In the beaker</Kicker>
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {tray.map((t) => (
                  <li key={t.item.id} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.item.colour }} />
                    <span className="flex-1 truncate">{t.item.name}</span>
                    <span className="font-mono text-[12px] text-[#8fa6d1]">
                      {fmt(t.amount, t.item.limits.unit)} {unitLabel(t.item)}
                    </span>
                  </li>
                ))}
                {!tray.length && <li className="text-[#8fa6d1]">Nothing yet.</li>}
              </ul>
            </div>
          </div>
        )}
        {tab === "molecules" && (
          <div className="space-y-3">
            {(p?.reactions ?? []).length === 0 && <p className="text-[13px] text-[#8fa6d1]">When something reacts, the particles involved appear here.</p>}
            {(p?.reactions ?? []).map((r) => (
              <div key={r.id} className="rounded-[14px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)] p-3">
                <Kicker>{r.type}</Kicker>
                <b className="font-heading text-[15px]">{r.name}</b>
                {r.participants && (
                  <div className="mt-2 flex justify-center">
                    <MicroView reactants={r.participants.reactants} products={r.participants.products} size={250} label={false} />
                  </div>
                )}
                {r.participants && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[13px]">
                    {r.participants.reactants.map((x, i) => (
                      <span key={`r${i}`} className="rounded-lg bg-[rgba(255,122,182,.15)] px-2 py-1">
                        {x.coef > 1 ? x.coef : ""}
                        {x.formula}
                        {x.charge && <sup>{x.charge}</sup>}
                      </span>
                    ))}
                    <span className="text-[#39d6ff]">→</span>
                    {r.participants.products.map((x, i) => (
                      <span key={`p${i}`} className="rounded-lg bg-[rgba(57,214,255,.15)] px-2 py-1">
                        {x.coef > 1 ? x.coef : ""}
                        {x.formula}
                        {x.charge && <sup>{x.charge}</sup>}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 overflow-x-auto text-[14px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(r.equationLatex, { throwOnError: false }) }} />
              </div>
            ))}
          </div>
        )}
        {tab === "notebook" && (
          <div>
            <Kicker>Notebook · auto-logged</Kicker>
            <ul className="mt-1.5">
              {log.map((l, i) => (
                <li key={i} className="grid grid-cols-[48px_1fr] gap-2 border-b border-dashed border-[rgba(140,180,255,.12)] py-1.5 text-[13px]">
                  <span className="font-mono text-[12px] text-[#39d6ff]">{clock(l.t)}</span>
                  <span className={l.tone === "bad" ? "text-[#ff9b9b]" : l.tone === "good" ? "text-[#3de8a8]" : ""}>{l.text}</span>
                </li>
              ))}
              {!log.length && <li className="text-[13px] text-[#8fa6d1]">Everything you do is written down here as you go.</li>}
            </ul>
          </div>
        )}
        {tab === "facts" && (
          <div className="space-y-2">
            {(p?.facts ?? []).map((f) => (
              <p key={f} className="rounded-[14px] border border-[rgba(167,123,255,.35)] bg-[linear-gradient(135deg,rgba(167,123,255,.22),rgba(57,214,255,.10))] p-3 text-[13px] leading-relaxed">
                💡 {f}
              </p>
            ))}
            {!(p?.facts ?? []).length && <p className="text-[13px] text-[#8fa6d1]">Facts about what you mix show up here.</p>}
          </div>
        )}
      </div>
    </Glass>
  );
}
