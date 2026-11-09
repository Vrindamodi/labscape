import type { SimulationResult } from "@labscape/contracts";
import { DockButton, DockSeparator, Glass, GhostButton, Kicker, oklabToHex, PlaygroundScene, PrimaryButton, Segmented, SquareButton, TiltGauge, type HeldKind, type PlaygroundView, type SceneCaption, type SceneInsets } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { dispenseMode, fetchCatalogue, liquidMl, loadDiscoveries, ProblemError, resolveMix, saveDiscoveries, sound, type CatalogueResponse, type DiscoveryDef, type FoundDiscovery, type ShelfItem, type TrayItem } from "@labscape/playground";
import { cx } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ArrowLeft, Atom, ChevronLeft, ChevronRight, Droplet, Eraser, FlaskConical, Hand, Info, Maximize2, Minimize2, Minus, MoveDown, Plus, RotateCw, Search, ShieldAlert, ShieldCheck, Snowflake, Sparkles, Star, Thermometer, Trophy, Undo2, Wind, X, Zap } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MicroView } from "./MicroView";
import { PeriodicDrawer } from "./PeriodicDrawer";
import { capitalise, colourDistance, colourName } from "./colourName";

type Speed = "drop" | "slow" | "steady" | "fast";
const RATE: Record<Speed, number> = { drop: 0.3, slow: 1.5, steady: 4, fast: 9 };
const TILT: Record<Speed, number> = { drop: 62, slow: 78, steady: 96, fast: 118 };
type Tab = "live" | "molecules" | "notebook" | "facts";
type Filter = "all" | "household" | "acid" | "alkali" | "salt" | "metal" | "indicator" | "solid" | "gas" | "element" | "other";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "household", label: "Household" },
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
const CAP_COLOUR: Record<string, string> = { household: "#14b8a6", acid: "#ef4444", alkali: "#3d8bff", salt: "#a855f7", indicator: "#ec4899", metal: "#94a3b8", solid: "#f59e0b", element: "#22c55e" };

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
  condense: null,
  blast: null,
  colourBurst: null,
  skate: null,
  layer: null,
  mirror: null,
  crystals: null,
  bubble: "fine",
};

/** Bubble rate from the engine (4..140 per second) mapped to a visible 0.2..1 on a log scale. */
const gasLevel = (ratePerS: number) => Math.max(0.2, Math.min(1, 0.2 + (Math.log10(Math.max(4, ratePerS) / 4) / Math.log10(35)) * 0.8));
const SOUND_CAPTION: Record<string, string> = { pop: "Squeaky pop!", "squeaky-pop": "Squeaky pop!", bang: "BANG! The gases explode", crackle: "Crackling", sizzle: "Sizzling and hissing", hiss: "Hissing", whoosh: "Whoosh!" };

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
  if (f === "household") return it.category === "household" || ["sugar", "ethanol", "vegetable-oil", "h2o2", "nacl", "nahco3"].includes(it.id);
  if (f === "other") return ["solvent", "other"].includes(it.category);
  return it.category === f;
}

/** Height kept free under the beaker for captions, so they never sit on the glass. */
const CAPTION_BAND = 64;

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

function Swatch({ colour }: { colour: string }) {
  return <span className="h-4 w-4 shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)]" style={{ background: colour }} />;
}

type Need = "heat" | "catalyst" | "acid" | "alkali" | "spark";

/** What a mix still needs, from the engine's neededTool plus what its message mentions. */
function needsOf(r: SimulationResult | null): Need[] {
  if (!r || (r.outcome !== "needs_conditions" && r.outcome !== "unsupported")) return [];
  const p = r.presentation;
  const text = `${p?.message ?? ""} ${(p?.suggestions ?? []).join(" ")}`.toLowerCase();
  const out = new Set<Need>();
  const tool = p?.neededTool;
  if (tool === "heater" || (r.outcome === "needs_conditions" && /\b(heat|warm)/.test(text))) out.add("heat");
  // with focusRef the engine names the exact shelf item, so the message text is not guessed from
  if (tool === "acid" || (!p?.focusRef && r.outcome === "needs_conditions" && /sulfuric acid|acid catalyst/.test(text))) out.add("acid");
  if (tool === "catalyst") out.add("catalyst");
  if (tool === "alkali") out.add("alkali");
  if (tool === "spark") out.add("spark");
  return [...out];
}

/**
 * Friendly, actionable copy for a mix that is waiting for something ("Needs heat - try Heat") or
 * that the engine has no checked model for. Never shows the engine's internal wording.
 */
function friendlyOutcome(r: SimulationResult | null, nameOf: (id: string) => string | undefined = () => undefined): { title: string; line: string; detail: string | null; heatC?: number } | null {
  if (!r) return null;
  const needs = needsOf(r);
  const msg = r.presentation?.message ?? "";
  if (needs.length) {
    const concentrated = /concentrated/i.test(msg);
    const focus = r.presentation?.focusRef ? nameOf(r.presentation.focusRef) : undefined;
    const words: Record<Need, string> = { heat: "heat", catalyst: "a catalyst", acid: concentrated ? "a catalyst" : "an acid", alkali: "an alkali", spark: "a flame" };
    // the temperature the engine asks for ("warm ... to about 70 °C"), else a gentle 60 °C
    const asked = Number(/(?:about|to|at)\s*(\d{2,3})\s*°C/i.exec(msg)?.[1] ?? NaN);
    const heatC = Number.isFinite(asked) ? Math.min(90, Math.max(30, Math.round(asked / 5) * 5)) : 60;
    const acts: Record<Need, string> = {
      heat: `Heat (about ${heatC} °C)`,
      catalyst: focus ? `add a few drops of ${focus.charAt(0).toLowerCase()}${focus.slice(1)}` : "add a pinch of manganese(IV) oxide",
      alkali: focus ? `add ${focus.charAt(0).toLowerCase()}${focus.slice(1)}` : "add some sodium hydroxide solution",
      acid: concentrated ? "add a few drops of concentrated sulfuric acid" : "add a few drops of dilute sulfuric acid",
      spark: "Spark",
    };
    const title = `Needs ${[...new Set(needs.map((n) => words[n]))].join(" and ")}`;
    // Tools first ("try Heat and add ..."), then what to add.
    const order = [...needs].sort((a, b) => Number(b === "heat" || b === "spark") - Number(a === "heat" || a === "spark"));
    const lead = order[0] === "heat" || order[0] === "spark" ? "try " : "";
    const line = `${title} - ${lead}${order.map((n) => acts[n]).join(" and ")}`;
    return { title, line, detail: msg || null, ...(needs.includes("heat") ? { heatC } : {}) };
  }
  if (r.outcome === "unsupported")
    return {
      title: "Nothing to show for this mix yet",
      line: "LABscape has no checked model for this combination, so it won't guess what happens.",
      detail: "Try one of the missions, or empty the beaker and start a new mix.",
    };
  return null;
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
  const shelfName = (id: string) => cat?.substances.find((x) => x.id === id)?.name;
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
  const [blocked, setBlocked] = useState<{ title: string; message: string; suggestions: string[]; tried: string[] } | null>(null);
  const [hazard, setHazard] = useState<{ gas: string; name: string; level: "toxic" | "corrosive" | "flammable"; warning: string } | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
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
  /** Captions beside the beaker connect the words in the Live panel with what is on screen. */
  const [captions, setCaptions] = useState<SceneCaption[]>([]);
  const capSeq = useRef(0);
  const caption = (text: string, opts: Omit<SceneCaption, "id" | "text"> = {}, ms = 6500) => {
    const id = `cap${++capSeq.current}`;
    setCaptions((cs) => [...cs.filter((c) => c.text !== text), { id, text, ...opts }].slice(-4));
    later(ms, () => setCaptions((cs) => cs.filter((c) => c.id !== id)));
  };
  /** A white screen flash for explosions and burning magnesium (never with reduced motion). */
  const [screenFlash, setScreenFlash] = useState(0);
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

  /** One-shot effects already shown for the current mixture: stirring or heating again must not replay a pop. */
  const played = useRef(new Set<string>());
  const applyResult = useCallback(
    (r: SimulationResult, next: TrayItem[], firstTime: boolean) => {
      if (firstTime) played.current.clear();
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
      setNeeds(needsOf(r));
      const base = baseColour(next);
      const solidItems = next.filter((x) => x.item.form === "solid");
      const liquid = next.reduce((a, x) => a + liquidMl(x), 0);
      const nameOf = (formula: string) => p?.compounds.find((x) => x.formula === formula)?.name ?? formula;
      setVisual((v) => ({
        ...v,
        colour: base.colour,
        opacity: base.opacity,
        solid: solidItems.length ? { colour: solidItems[0]!.item.colour, amount: Math.min(1, solidItems.reduce((a, x) => a + x.amount, 0) / 5), ...(v.solid?.coat ? { coat: v.solid.coat } : {}) } : null,
        layer: null,
        mirror: null,
      }));
      let lastColour = base.colour;
      for (const c of r.cues) {
        const sig = JSON.stringify({ ...c, startMs: 0 });
        const seen = played.current.has(sig);
        played.current.add(sig);
        if (seen && c.kind !== "layers") continue;
        later(c.startMs ?? 0, () => {
          switch (c.kind) {
            case "colour": {
              const to = oklabToHex(c.to);
              const from = c.target === "vessel" ? lastColour : oklabToHex(c.from);
              const clear = (c.to.alpha ?? 1) < 0.12;
              setVisual((v) => ({ ...v, colour: to, opacity: Math.max(clear ? 0.05 : v.opacity, c.to.alpha ?? 0.45), ...(colourDistance(from, to) > 2500 && liquid > 1 ? { colourBurst: { pulse: (v.colourBurst?.pulse ?? 0) + 1, colour: to } } : {}) }));
              if (colourDistance(from, to) > 2500 && r.outcome === "reaction") caption(`Colour change: ${colourName(from)} → ${clear ? "colourless" : colourName(to)}`, { from, colour: to });
              lastColour = to;
              break;
            }
            case "precipitate": {
              const col = oklabToHex(c.colour);
              const crystals = c.form === "crystals";
              setVisual((v) => ({ ...v, precipitate: { colour: col, turbidity: c.turbidity, settled: 0, form: c.form ?? "powder" } }));
              later(Math.min(6000, c.settleMs), () => setVisual((v) => (v.precipitate ? { ...v, precipitate: { ...v.precipitate, settled: 1 } } : v)));
              sound.play(crystals ? "tinkle" : "drip");
              caption(`${capitalise(colourName(col))} ${crystals ? "crystals" : "precipitate"}: ${nameOf(c.id).toLowerCase()}`, { colour: col });
              later(Math.min(6000, c.settleMs), () => caption(`The ${colourName(col)} solid settles to the bottom`, { colour: col }, 4500));
              break;
            }
            case "gas": {
              const level = gasLevel(c.ratePerS);
              const gasCol = c.colour ? oklabToHex(c.colour) : null;
              setVisual((v) => ({ ...v, gas: level, gasColour: gasCol, bubble: c.bubble }));
              sound.play("fizz", level);
              sound.loop("fizz", true, 0.3 + level * 0.9);
              later(Math.max(5000, Math.min(16000, c.durationMs)), () => {
                setVisual((v) => ({ ...v, gas: 0, gasColour: null }));
                sound.loop("fizz", false);
              });
              caption(`${level > 0.75 ? "Vigorous fizzing" : level > 0.4 ? "Fizzing" : "A few bubbles"}: ${nameOf(c.gas).toLowerCase()}${gasCol ? ` (${colourName(gasCol)} gas)` : ""}`, gasCol ? { colour: gasCol } : {});
              if (c.smell && !/no smell/i.test(c.smell)) caption(`Smell: ${c.smell.toLowerCase()}`, { tone: c.hazard === "toxic" ? "bad" : "info" });
              addLog(`${c.gas} gas given off${c.smell ? ` · smell: ${c.smell}` : ""}`);
              if (c.smell && !/no smell/i.test(c.smell)) showSmell(c.smell, c.colour ? oklabToHex(c.colour) : "#c8f7a5");
              if (c.hazard && c.warning) {
                const name = p?.compounds.find((x) => x.formula === c.gas)?.name ?? c.gas;
                setHazard({ gas: c.gas, name, level: c.hazard, warning: c.warning });
                addLog(`${c.hazard === "toxic" ? "☠ Toxic" : c.hazard === "flammable" ? "🔥 Flammable" : "⚠ Corrosive"}: ${name}. ${c.warning}`, c.hazard === "toxic" ? "bad" : "warn");
                if (c.hazard !== "flammable") sound.play("warn");
                later(Math.max(9000, Math.min(16000, c.durationMs + 3000)), () => setHazard((h) => (h?.gas === c.gas ? null : h)));
              }
              break;
            }
            case "dissolve":
              if (c.target.startsWith("precipitate:")) {
                later(Math.min(4000, c.durationMs), () => setVisual((v) => (v.precipitate && (c.fraction ?? 1) >= 0.99 ? { ...v, precipitate: null } : v)));
                caption(`The ${nameOf(c.target.slice("precipitate:".length)).toLowerCase()} precipitate dissolves`);
              } else later(Math.min(4000, c.durationMs), () => setVisual((v) => (v.solid ? { ...v, solid: (c.fraction ?? 1) >= 1 ? null : { ...v.solid, amount: v.solid.amount * (1 - (c.fraction ?? 1)) } } : v)));
              break;
            case "flame": {
              const col = oklabToHex(c.colour);
              setVisual((v) => ({ ...v, flame: { colour: col, intensity: c.intensity } }));
              sound.play("whoosh");
              later(Math.min(6000, c.durationMs), () => setVisual((v) => ({ ...v, flame: null })));
              caption(`${capitalise(colourName(col))} flame`, { colour: col });
              break;
            }
            case "light": {
              const col = oklabToHex(c.colour);
              setVisual((v) => ({ ...v, light: { colour: col, intensity: c.intensity } }));
              later(Math.min(5000, Math.max(700, c.durationMs)), () => setVisual((v) => ({ ...v, light: null })));
              if (c.intensity >= 0.9 && c.durationMs >= 1500) {
                caption("Blinding white light - don't look straight at it", { colour: col, tone: "warn" });
                if (!reduced) setScreenFlash((n) => n + 1);
              } else caption(c.durationMs >= 1500 ? `Glowing ${colourName(col)}` : "A bright flash", { colour: col });
              break;
            }
            case "smoke": {
              const col = oklabToHex(c.colour);
              setVisual((v) => ({ ...v, smoke: { colour: col, density: c.density } }));
              later(Math.min(8000, c.durationMs), () => setVisual((v) => ({ ...v, smoke: null })));
              caption(c.label ?? `${capitalise(colourName(col))} smoke`, { colour: col });
              break;
            }
            case "deposit": {
              const col = oklabToHex(c.colour);
              if (c.form === "mirror") {
                setVisual((v) => ({ ...v, mirror: { colour: "#e8ecf2", pulse: (v.mirror?.pulse ?? 0) + 1 } }));
                caption("A shiny silver mirror coats the inside of the glass", { colour: "#e8ecf2" }, 8000);
                break;
              }
              const form = c.form ?? "coating";
              setVisual((v) => {
                const same = v.solid?.coat?.colour === col;
                const coat = same ? v.solid!.coat! : { colour: col, form, durationMs: c.durationMs, pulse: (v.solid?.coat?.pulse ?? 0) + 1 };
                return { ...v, solid: { colour: v.solid?.colour ?? "#9aa0a6", amount: Math.max(0.3, v.solid?.amount ?? 0.3), coat } };
              });
              const metal = p?.compounds.find((x) => x.state === "s" && /^[A-Z][a-z]?$/.test(x.formula))?.name?.toLowerCase() ?? "metal";
              caption(form === "crystals" ? `Sparkling ${metal} crystals growing on the metal` : `A ${colourName(col)} coating of ${metal} grows on the metal`, { colour: col });
              break;
            }
            case "temperature":
              setTargetC((t) => (temp ? temp.value : t + c.deltaC));
              if (Math.abs(c.deltaC) >= 2) sound.play(c.deltaC > 0 ? "sizzle" : "freeze");
              if (Math.abs(c.deltaC) >= 1) caption(c.deltaC > 0 ? `Getting warmer: +${c.deltaC.toFixed(1)} °C` : `Getting colder: ${c.deltaC.toFixed(1)} °C`, { colour: c.deltaC > 0 ? "#ff8a3d" : "#7cc4ff" });
              break;
            case "sound": {
              const id = c.soundId;
              if (id === "squeaky-pop" || id === "pop") {
                sound.play("squeakyPop");
                setVisual((v) => ({ ...v, blast: { pulse: (v.blast?.pulse ?? 0) + 1, colour: "#cfe6ff", strength: 0.6 } }));
              } else if (id === "bang") {
                sound.play("bang");
                setVisual((v) => ({ ...v, blast: { pulse: (v.blast?.pulse ?? 0) + 1, colour: "#fff2c4", strength: 1 } }));
                if (!reduced) setScreenFlash((n) => n + 1);
              } else if (id === "crackle" || id === "sizzle" || id === "hiss" || id === "whoosh") sound.play(id);
              if (SOUND_CAPTION[id]) caption(SOUND_CAPTION[id], id === "bang" ? { tone: "warn" } : {});
              break;
            }
            case "condense":
              setVisual((v) => ({ ...v, condense: { colour: oklabToHex(c.colour), amount: Math.max(v.condense?.amount ?? 0, c.amount), pulse: v.condense && liquid > 1 ? v.condense.pulse : (v.condense?.pulse ?? 0) + 1 } }));
              caption(liquid > 1 ? "Steam condensing into water droplets on the glass" : "Water droplets forming on the glass", { colour: "#bfe4ff" });
              break;
            case "skate":
              setVisual((v) => ({ ...v, skate: { pulse: (v.skate?.pulse ?? 0) + 1, colour: oklabToHex(c.colour), durationMs: c.durationMs } }));
              caption("The metal melts into a ball and skates across the surface", { colour: oklabToHex(c.colour) });
              break;
            case "layers":
              setVisual((v) => ({ ...v, layer: { colour: oklabToHex(c.colour), volumeMl: c.volumeMl, position: c.position ?? "top" } }));
              caption(c.label ?? (c.position === "bottom" ? "The denser liquid sinks to the bottom as a separate layer" : "The lighter liquid floats on top as a separate layer"), { colour: oklabToHex(c.colour) });
              break;
            case "crystals": {
              const col = oklabToHex(c.colour);
              setVisual((v) => ({ ...v, crystals: { colour: col, amount: c.amount, durationMs: c.durationMs, pulse: v.crystals?.colour === col ? v.crystals.pulse : (v.crystals?.pulse ?? 0) + 1 } }));
              sound.play("tinkle");
              caption(c.label ?? "Crystals growing", { colour: col }, 8000);
              break;
            }
            case "odour":
              addLog(`Smell: ${c.description} (waft, never sniff)`);
              showSmell(c.description, "#d9f99d");
              caption(`Smell: ${c.description}`);
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
    async (next: TrayItem[], cond: { temp: number; stir: boolean; ign: boolean }, revert: () => void, fresh = true) => {
      if (!next.length) return;
      setBusy(true);
      try {
        const r = await resolveMix(next, cond.temp, cond.stir, cond.ign);
        if (r.outcome === "prohibited") {
          revert();
          sound.play("deny");
          setBlocked({ title: r.presentation?.title ?? "Not allowed", message: r.presentation?.message ?? "That combination is not allowed.", suggestions: r.presentation?.suggestions ?? [], tried: next.map((x) => x.item.name) });
          addLog("Blocked by the safety engine", "bad");
          return;
        }
        if (r.outcome === "out_of_range") {
          revert();
          sound.play("warn");
          flash(r.presentation?.message ?? "That is outside the safe range.");
          return;
        }
        applyResult(r, next, fresh);
        if (r.outcome === "needs_conditions" || r.outcome === "unsupported") flash(friendlyOutcome(r, shelfName)?.line ?? "Nothing happens yet.", "warn");
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

  const reResolve = (cond: { temp: number; stir: boolean; ign: boolean }) => tray.length && void resolve(tray, cond, () => {}, false);

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
    setHazard(null);
    setCaptions([]);
    setNeeds([]);
    sound.loop("fizz", false);
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
    thermometer: levelMl > 0 ? { targetC } : null,
    captions,
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

  /* ---------------------------------------------------------------- layout: keep the bench in the free space */
  const wide = useMedia("(min-width: 1024px)");
  const short = useMedia("(max-height: 760px)");
  const [shelfOpen, setShelfOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState<SceneInsets>({ left: 16, right: 16, top: 76, bottom: 92 });
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const R = root.getBoundingClientRect();
    const box = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    // On narrow screens the shelf and info panel are overlays the student opens on purpose: they do not move the camera.
    const l = wide ? box(leftRef.current) : null;
    const r = wide ? box(rightRef.current) : null;
    const d = box(dockRef.current);
    const sh = wide ? null : box(sheetRef.current);
    const floor = Math.min(d ? d.top : R.bottom - 84, sh ? sh.top : Infinity);
    const next: SceneInsets = {
      left: l ? Math.round(l.right - R.left) + 12 : 12,
      right: r ? Math.round(R.right - r.left) + 12 : 12,
      top: wide ? 80 : 128,
      bottom: Math.round(R.bottom - floor) + 8,
    };
    setInsets((b) => (b.left === next.left && b.right === next.right && b.top === next.top && b.bottom === next.bottom ? b : next));
  }, [wide]);
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    [rootRef, leftRef, rightRef, dockRef, sheetRef].forEach((r) => r.current && ro.observe(r.current));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, held, focus, drawer, shelfOpen, infoOpen]);
  useEffect(() => {
    if (wide) {
      setShelfOpen(false);
      setInfoOpen(false);
    }
  }, [wide]);

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

  const friendly = friendlyOutcome(result, shelfName);
  const freeStyle = { left: insets.left, right: insets.right };
  const holdCard = held && (
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
      compact={!wide || short}
    />
  );
  const panelMotion = reduced ? {} : { initial: { opacity: 0, x: -16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 }, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div ref={rootRef} className="relative h-screen w-full overflow-hidden bg-[#0b1530] font-sans text-[#e8f0ff]">
      <div className="absolute inset-0">
        <PlaygroundScene view={view} reducedMotion={reduced} insets={{ ...insets, bottom: insets.bottom + CAPTION_BAND }} />
      </div>
      <AnimatePresence>
        {screenFlash > 0 && !reduced && (
          <motion.div
            key={screenFlash}
            className="pointer-events-none absolute inset-0 z-[2]"
            style={{ background: "radial-gradient(circle at 50% 55%, rgba(255,255,255,.85), rgba(255,250,230,.35) 45%, transparent 75%)" }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            aria-hidden
          />
        )}
      </AnimatePresence>
      {held && heldMode === "pour" && (
        <div className="absolute inset-0 z-[1] cursor-ns-resize" onPointerDown={onPadDown} onPointerMove={onPadMove} onPointerUp={onPadUp} onPointerCancel={onPadUp} aria-hidden />
      )}

      {/* top bar */}
      <Glass className="absolute left-2 right-2 top-3 z-20 flex h-14 items-center gap-2 px-2 sm:left-4 sm:right-4 sm:gap-3 sm:px-3">
        <button onClick={() => navigate("/playground")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#a9bde4] hover:bg-white/[0.06] hover:text-white" aria-label="Back to the playground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 shrink">
          <div className="truncate font-heading text-[16px] font-bold leading-tight sm:text-[18px]">Open Playground</div>
          <div className="truncate text-[13px] text-[#8fa6d1]">Chemistry · {cat?.substances.length ?? "…"} substances</div>
        </div>
        {mission && !focus && (
          <div className="ml-2 hidden min-w-0 max-w-[380px] flex-1 items-center gap-2.5 rounded-xl bg-white/[0.04] py-1 pl-1.5 pr-1 xl:flex">
            <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#ffc23d 0 ${(foundCount / Math.max(1, cat!.discoveries.length)) * 100}%, rgba(255,255,255,.1) 0)` }}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0b1730] font-heading text-[11px] font-bold text-[#ffc23d]">{foundCount}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-[#8fa6d1]">
                Mission {missionIdx + 1}/{cat!.discoveries.length} {found[mission.id] && <span className="text-[#3de8a8]">· done</span>}
              </div>
              <div className="truncate text-[14px] font-semibold" title={mission.clue}>{found[mission.id] ? mission.name : mission.clue}</div>
            </div>
            <button aria-label="Previous mission" onClick={() => setMissionIdx((i) => (i - 1 + cat!.discoveries.length) % cat!.discoveries.length)} className="rounded p-1 text-[#8fa6d1] hover:text-white">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button aria-label="Next mission" onClick={() => setMissionIdx((i) => (i + 1) % cat!.discoveries.length)} className="rounded p-1 text-[#8fa6d1] hover:text-white">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        <span className="flex-1" />
        {levelMl > 0 && (
          <div className="hidden items-center gap-1.5 md:flex" aria-label="Readings">
            <TopStat label="Temp" value={`${liquidC.toFixed(1)}°C`} tone={liquidC > 24 ? "hot" : liquidC < 20 ? "cold" : "plain"} />
            {ph !== null && <TopStat label="pH" value={ph.toFixed(2)} tone={ph < 6.5 ? "hot" : ph > 7.5 ? "cold" : "ok"} hint={ph < 6.5 ? "acidic" : ph > 7.5 ? "alkaline" : "neutral"} />}
            <TopStat label="Vol" value={`${fmt(levelMl + inFlight, "mL")} mL`} tone="plain" />
          </div>
        )}
        <span className={cx("hidden items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold 2xl:flex", online === false ? "bg-[rgba(255,91,107,.14)] text-[#ff9b9b]" : "bg-[rgba(61,232,168,.12)] text-[#3de8a8]")} role="status">
          {online === false ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {online === false ? "Safety engine offline" : busy ? "Checking…" : "Safety engine on"}
        </span>
        {!wide && !focus && (
          <button onClick={() => setInfoOpen((o) => !o)} className={cx("flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[14px] font-semibold", infoOpen ? "bg-[rgba(61,139,255,.28)] text-white" : "text-[#dbe7ff] hover:bg-white/[0.06]")} aria-pressed={infoOpen}>
            <Info className="h-4 w-4" /> <span className="max-sm:sr-only">What's happening</span>
            {result?.outcome === "reaction" && !infoOpen && <span className="h-2 w-2 rounded-full bg-[#3de8a8]" aria-hidden />}
          </button>
        )}
        <button onClick={() => setFocus((f) => !f)} className="flex h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[14px] font-semibold text-[#dbe7ff] hover:bg-white/[0.06]" aria-pressed={focus}>
          {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} <span className="max-sm:sr-only">{focus ? "Exit focus" : "Focus"}</span>
        </button>
      </Glass>

      {/* left column: what is in hand on top, the shelf (or periodic table) below. Never over the bench. */}
      {!wide && !focus && drawer === "shelf" && !shelfOpen && (
        <button onClick={() => setShelfOpen(true)} className="absolute left-2 top-[80px] z-20 flex h-11 items-center gap-2 rounded-2xl border border-[rgba(140,180,255,.16)] px-3 text-[14px] font-semibold sm:left-4" style={{ background: "rgba(14,26,56,.88)" }}>
          <FlaskConical className="h-4 w-4" /> Chemicals
        </button>
      )}
      {(wide || shelfOpen) && (
        <div ref={leftRef} className={cx("absolute z-20 flex flex-col gap-2", wide ? "bottom-[96px] left-4 top-[84px] w-[272px] xl:w-[304px]" : "inset-x-2 bottom-[92px] top-[76px]")}>
          <AnimatePresence initial={false}>
            {wide && holdCard && (
              <motion.div key="hold" className="shrink-0 overflow-hidden" initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
                {holdCard}
              </motion.div>
            )}
          </AnimatePresence>
          {!focus && drawer === "shelf" && (
            <Shelf
              cat={cat}
              held={held}
              onPick={(it) => {
                pick(it);
                if (!wide) setShelfOpen(false);
              }}
              glow={result?.presentation?.focusRef && (needs.includes("catalyst") || needs.includes("acid") || needs.includes("alkali")) ? result.presentation.focusRef : needs.includes("catalyst") ? "mno2-powder" : needs.includes("acid") ? "h2so4" : null}
              onTable={() => setDrawer("table")}
              onClose={wide ? null : () => setShelfOpen(false)}
              collapsible={wide && short && !!held && !needs.includes("catalyst") && !needs.includes("acid") && !needs.includes("alkali")}
            />
          )}
        </div>
      )}
        {!focus && drawer === "table" && cat && (
          <PeriodicDrawer
            elements={cat.substances.filter((x) => x.element)}
            onClose={() => setDrawer("shelf")}
            onHold={(it) => {
              setDrawer("shelf");
              setShelfOpen(false);
              pick(it);
            }}
          />
        )}
      {/* phone and small tablet: the card in hand sits just above the dock */}
      <AnimatePresence>
        {!wide && holdCard && !shelfOpen && (
          <motion.div ref={sheetRef} key="hold-sheet" className="absolute inset-x-2 bottom-[88px] z-20 mx-auto max-w-[460px]" initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            {holdCard}
          </motion.div>
        )}
      </AnimatePresence>

      {/* hazards and smells: top right of the free bench area (never over the side panels) */}
      <div className="pointer-events-none absolute top-[84px] z-20 flex justify-end" style={{ left: insets.left, right: insets.right }}>
        <div className="flex w-[min(300px,100%)] flex-col gap-2">
          <AnimatePresence>
            {hazard && (
              <motion.div key={hazard.gas} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} role="alert">
                <div className={cx("rounded-2xl border-2 p-3 shadow-[0_10px_40px_-10px_rgba(0,0,0,.7)] backdrop-blur-md", hazard.level === "toxic" ? "border-[#ff4d5e] bg-[rgba(70,8,18,.9)]" : hazard.level === "flammable" ? "border-[#ff9a2e] bg-[rgba(70,30,6,.9)]" : "border-[#ffc23d] bg-[rgba(60,44,6,.9)]")}>
                  <div className="flex items-center gap-2.5">
                    <HazardDiamond level={hazard.level} />
                    <div className="min-w-0">
                      <div className={cx("text-[13px] font-extrabold uppercase tracking-[0.08em]", hazard.level === "toxic" ? "text-[#ff8a96]" : "text-[#ffc46b]")}>
                        {hazard.level === "toxic" ? "Toxic gas" : hazard.level === "flammable" ? "Flammable gas" : "Corrosive fumes"}
                      </div>
                      <div className="font-heading text-[16px] font-bold leading-tight">{hazard.name} given off</div>
                    </div>
                  </div>
                  <p className="mt-2 text-[14px] leading-snug text-[#ffe1e4]">{hazard.warning}</p>
                </div>
              </motion.div>
            )}
            {smell && (
              <motion.div key="smell" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} role="status">
                <Glass radius="md" className="px-3.5 py-2.5">
                  <Kicker>Smell</Kicker>
                  <div className="text-[15px] font-semibold">{smell.text}</div>
                  <div className="mt-0.5 text-[13px] text-[#ffd59a]">Waft it towards you with your hand. Never sniff a beaker directly.</div>
                </Glass>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {!focus && (wide || infoOpen) && (
          <motion.div
            key="side"
            ref={rightRef}
            className={cx("absolute z-10 flex", wide ? "bottom-[96px] right-4 top-[84px] w-[300px] xl:w-[344px]" : "inset-x-2 top-[76px] z-30 max-h-[calc(100%-168px)]")}
            {...(reduced ? {} : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 16 }, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } })}
          >
            <SidePanel tab={tab} setTab={setTab} result={result} friendly={friendly} onHeat={heatTo} plateC={plateC} log={log} tray={tray} online={online} busy={busy} onClose={wide ? null : () => setInfoOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {focus && result?.presentation && result.outcome === "reaction" && (
          <motion.div key="focus-card" className="absolute left-4 top-[84px] z-10 w-[min(420px,calc(100%-32px))]" {...panelMotion}>
            <Glass className="p-4">
              <Kicker>Reaction · {result.presentation.reactions[0]?.type ?? "change"}</Kicker>
              <h2 className="mt-1 font-heading text-[22px] font-bold leading-tight tracking-tight">{result.presentation.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#c8d6f3]">{result.presentation.message}</p>
              {result.equationLatex && <div className="mt-3 overflow-x-auto rounded-xl bg-[rgba(4,10,28,.5)] p-2.5 text-[15px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(result.equationLatex, { throwOnError: false }) }} />}
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>

      {focus && result?.presentation?.reactions[0]?.participants && (
        <div className="pointer-events-none absolute right-8 top-[110px] z-10 hidden lg:block">
          <MicroView reactants={result.presentation.reactions[0].participants.reactants} products={result.presentation.reactions[0].participants.products} size={300} />
        </div>
      )}

      {/* dock */}
      <div ref={dockRef} className="absolute bottom-3 left-1/2 z-20 max-w-[calc(100%-16px)] -translate-x-1/2 overflow-x-auto [scrollbar-width:none]">
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
          <HeatButton plateC={plateC} glow={needs.includes("heat")} onHeat={heatTo} />
          <DockButton
            icon={<Zap />}
            label="Spark"
            tone={ignition ? "hot" : needs.includes("spark") ? "on" : "default"}
            className={needs.includes("spark") && !ignition ? "animate-pulse" : ""}
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
              caption("Frost forms on the cold glass as the liquid cools", { colour: "#eaf6ff" });
            }}
          />
          <DockSeparator />
          <DockButton icon={<Undo2 />} label="Undo" disabled={!adds.length || busy} onClick={undo} />
          <DockButton icon={<Eraser />} label="Empty" tone="danger" disabled={!adds.length} onClick={() => empty()} />
        </Glass>
      </div>

      {/* captions: what you are looking at, in words, in the free strip under the beaker */}
      <div className="pointer-events-none absolute z-10 flex flex-col-reverse items-center gap-1.5 px-2" style={{ ...freeStyle, bottom: insets.bottom + 4 }} role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {captions.slice(wide ? -3 : -2).reverse().map((c) => (
            <motion.div
              key={c.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35 } }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className={cx(
                "flex max-w-[min(440px,100%)] items-center gap-2 rounded-xl border px-3 py-1.5 text-[14px] font-semibold leading-snug shadow-[0_6px_20px_-8px_rgba(0,0,0,.7)] backdrop-blur-md",
                c.tone === "bad" ? "border-[#ff4d5e] bg-[rgba(70,8,18,.9)]" : c.tone === "warn" ? "border-[#ffc23d] bg-[rgba(60,40,6,.9)]" : "border-[rgba(140,180,255,.3)] bg-[rgba(10,20,46,.86)]",
              )}
            >
              {c.from && <Swatch colour={c.from} />}
              {c.from && <span className="text-[#8fa6d1]">→</span>}
              {c.colour && <Swatch colour={c.colour} />}
              <span className="min-w-0">{c.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* hints, notes and discoveries: centred over the free bench area */}
      <div className="pointer-events-none absolute top-[84px] z-30 flex flex-col items-center gap-2 px-2 max-lg:top-[132px]" style={freeStyle}>
        <AnimatePresence>
          {!held && !tray.length && !focus && !shelfOpen && (
            <motion.div key="hint" initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <Glass radius="md" className="flex items-center gap-2 px-3 py-2 text-[14px] font-semibold">
                <Hand className="h-4 w-4 shrink-0 text-[#39d6ff]" /> Pick a chemical from the shelf to hold it over the beaker
              </Glass>
            </motion.div>
          )}
          {note && (
            <motion.div key={`note-${note.text}`} initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} role="status">
              <Glass radius="md" className={cx("max-w-md px-3.5 py-2 text-[14px] font-semibold leading-snug", note.tone === "bad" ? "text-[#ff9b9b]" : note.tone === "good" ? "text-[#3de8a8]" : "text-[#ffd59a]")}>
                {note.text}
              </Glass>
            </motion.div>
          )}
          {celebrate && (
            <motion.div key="celebrate" initial={reduced ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 22 }} role="status">
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
      </div>

      {online === false && (
        <div className="absolute inset-x-0 top-[76px] z-30 mx-auto w-fit" role="alert">
          <Glass radius="md" className="flex items-center gap-2 border-[rgba(255,91,107,.5)] px-3.5 py-2 text-[13px] font-semibold text-[#ff9b9b]">
            <ShieldAlert className="h-4 w-4" /> Safety engine offline: no reactions are shown until it is back.
          </Glass>
        </div>
      )}

      <AnimatePresence>
        {blocked && (
          <motion.div
            className="absolute inset-0 z-40 grid place-items-center overflow-y-auto p-4 backdrop-blur-sm"
            style={{ background: "radial-gradient(ellipse at center, rgba(120,0,20,.55), rgba(10,0,4,.82))" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={reduced ? false : { scale: 0.9, x: 0 }}
              animate={reduced ? {} : { scale: 1, x: [0, -14, 12, -8, 5, 0] }}
              transition={{ duration: 0.55 }}
              className="w-[min(460px,100%)] rounded-[26px] border-2 border-[#ff4d5e] bg-[rgba(30,6,14,.94)] p-6 text-center shadow-[0_0_80px_-10px_rgba(255,60,80,.6)]"
              role="alertdialog"
              aria-label="Not allowed"
            >
              <NoEntrySign />
              <div className="mt-3 text-[12px] font-extrabold uppercase tracking-[0.2em] text-[#ff6b7a]">Not allowed</div>
              <h2 className="mt-1 font-heading text-[24px] font-bold">{blocked.title}</h2>
              {blocked.tried.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {blocked.tried.map((t, i) => (
                    <span key={t} className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      {i > 0 && <span className="text-[#ff6b7a]">+</span>}
                      <span className="rounded-lg bg-white/[0.08] px-2 py-1">{t}</span>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-left text-[14px] text-[#f1d6da]">{blocked.message}</p>
              <p className="mt-2 text-left text-[12.5px] text-[#c7a3aa]">Nothing was added to the beaker. Mixes like this are blocked outright, and repeated attempts pause the playground for a while.</p>
              {blocked.suggestions.length > 0 && (
                <div className="mt-3 text-left">
                  <Kicker>Try instead</Kicker>
                  <ul className="mt-1 space-y-1 text-[13px] text-[#e3c2c8]">
                    {blocked.suggestions.map((s) => (
                      <li key={s}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <PrimaryButton className="mt-5 w-full" onClick={() => setBlocked(null)}>
                Understood
              </PrimaryButton>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ small pieces */

function TopStat({ label, value, tone, hint }: { label: string; value: string; tone: "hot" | "cold" | "ok" | "plain"; hint?: string }) {
  const c = tone === "hot" ? "text-[#ffb36b]" : tone === "cold" ? "text-[#7cc4ff]" : tone === "ok" ? "text-[#3de8a8]" : "text-white";
  return (
    <div className="flex h-10 flex-col justify-center rounded-xl bg-white/[0.05] px-2.5" title={hint}>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#8fa6d1]">{label}</span>
      <span className={cx("font-heading text-[14px] font-bold tabular-nums leading-tight", c)}>{value}</span>
    </div>
  );
}

/** GHS-style hazard pictogram: a red-bordered diamond with a skull, flame or corrosion mark. */
function HazardDiamond({ level }: { level: "toxic" | "corrosive" | "flammable" }) {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11 shrink-0" aria-label={`${level} hazard symbol`}>
      <rect x="9" y="9" width="30" height="30" rx="2" transform="rotate(45 24 24)" fill="#fff" stroke="#e11d2e" strokeWidth="4" />
      {level === "toxic" && (
        <g fill="#111">
          <ellipse cx="24" cy="21" rx="7" ry="6.5" />
          <rect x="20" y="25" width="8" height="5" rx="1.2" />
          <circle cx="21.2" cy="20.5" r="2" fill="#fff" />
          <circle cx="26.8" cy="20.5" r="2" fill="#fff" />
          <path d="M14 30 L34 35 M34 30 L14 35" stroke="#111" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      {level === "flammable" && <path d="M24 13c2 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 3-8 0 3 1 4 2 4 0-4 0-7 2-10z" fill="#111" />}
      {level === "corrosive" && (
        <g fill="#111">
          <path d="M15 19h8l-2 3h-6z M27 19h8l-2 3h-6z" />
          <path d="M18 24v3 M30 24v4" stroke="#111" strokeWidth="2" />
          <rect x="13" y="31" width="22" height="3" rx="1" />
        </g>
      )}
    </svg>
  );
}

/** A big animated prohibition sign. */
function NoEntrySign() {
  const { reduced } = useMotion();
  return (
    <motion.svg viewBox="0 0 120 120" className="mx-auto h-24 w-24" initial={reduced ? false : { scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} aria-hidden>
      <circle cx="60" cy="60" r="52" fill="rgba(255,60,80,.12)" />
      <circle cx="60" cy="60" r="44" fill="none" stroke="#ff3d55" strokeWidth="11" />
      <line x1="29" y1="91" x2="91" y2="29" stroke="#ff3d55" strokeWidth="11" strokeLinecap="round" />
      <FlaskConical x={42} y={42} width={36} height={36} color="#ffd7dc" strokeWidth={1.8} />
    </motion.svg>
  );
}

/* ------------------------------------------------------------------ shelf */

function Shelf({ cat, held, onPick, glow, onTable, onClose, collapsible = false }: { cat: CatalogueResponse | null; held: ShelfItem | null; onPick: (it: ShelfItem) => void; glow: string | null; onTable: () => void; onClose: (() => void) | null; collapsible?: boolean }) {
  // On short screens the card in hand needs the room: the shelf folds to its header until asked.
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => setUnfolded(false), [held?.id]);
  const folded = collapsible && !unfolded;
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (cat?.substances ?? []).filter((it) => matchesFilter(it, f) && (!s || it.name.toLowerCase().includes(s) || it.formula.toLowerCase().includes(s) || it.element?.symbol.toLowerCase() === s || (s.length >= 4 && it.description.toLowerCase().includes(s))));
  }, [cat, q, f]);
  return (
    <Glass className={cx("flex flex-col p-3", folded ? "shrink-0" : "min-h-[180px] flex-1")} aria-label="Chemicals shelf">
      <div className="flex items-center gap-2">
        <b className="font-heading text-[18px]">Chemicals</b>
        <span className="flex-1" />
        <button onClick={onTable} className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[rgba(140,180,255,.16)] bg-[rgba(120,160,255,.10)] px-2.5 text-[13px] font-semibold text-[#dbe7ff] hover:bg-[rgba(120,160,255,.18)]" aria-label="Periodic table">
          <Atom className="h-4 w-4" /> <span className={folded ? "sr-only" : ""}>Periodic table</span>
        </button>
        {collapsible && (
          <button onClick={() => setUnfolded((u) => !u)} className="h-9 rounded-[10px] px-2.5 text-[13px] font-semibold text-[#9fd8ff] hover:bg-white/[0.06]" aria-expanded={!folded}>
            {folded ? "Show" : "Hide"}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[10px] text-[#8fa6d1] hover:bg-white/[0.06] hover:text-white" aria-label="Close shelf">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      {!folded && (
      <>
      <label className="mt-2.5 flex h-10 shrink-0 items-center gap-2 rounded-[11px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.55)] px-3 text-[14px] text-[#8fa6d1]">
        <Search className="h-4 w-4 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cat?.substances.length ?? ""} chemicals`} className="min-w-0 flex-1 bg-transparent text-white placeholder:text-[#8fa6d1] focus:outline-none" aria-label="Search chemicals" />
      </label>
      {/* one scrolling row of filters, so the cards below always start on a full row */}
      <div className="relative mt-2 shrink-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Filter">
          {FILTERS.map((x) => (
            <button key={x.id} role="radio" aria-checked={f === x.id} onClick={() => setF(x.id)} className={cx("h-8 shrink-0 rounded-[9px] border px-2.5 text-[13px] font-semibold transition-colors", f === x.id ? "border-[rgba(110,170,255,.5)] bg-[rgba(61,139,255,.25)] text-white" : "border-[rgba(140,180,255,.12)] bg-[rgba(120,160,255,.08)] text-[#a9bde4] hover:text-white")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ls-scroll mt-2 grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-2 overflow-y-auto pr-1 pt-0.5">
        {list.map((it) => {
          const inHand = held?.id === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onPick(it)}
              aria-pressed={inHand}
              title={it.description}
              className={cx(
                "flex flex-col overflow-hidden rounded-[14px] border text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px",
                inHand ? "border-[#6aa8ff] shadow-[0_0_0_1px_#6aa8ff,0_0_26px_-8px_#3d8bff]" : glow === it.id ? "animate-pulse border-[#ffc23d] shadow-[0_0_0_1px_#ffc23d]" : "border-[rgba(140,180,255,.12)] hover:border-[rgba(140,180,255,.35)]",
              )}
              style={{ background: `radial-gradient(90% 70% at 50% 30%, ${it.colour}33, transparent 70%), rgba(4,10,28,.5)` }}
            >
              {/* fixed picture area: tag and hazards on top, the drawing centred below them */}
              <div className="relative h-[86px] shrink-0">
                {inHand ? (
                  <span className="absolute left-1.5 top-1.5 z-[1] flex items-center gap-1 rounded-md bg-[#3d8bff] px-1.5 py-0.5 text-[12px] font-bold text-white">
                    <Hand className="h-3 w-3" /> In hand
                  </span>
                ) : (
                  <span className="absolute left-1.5 top-1.5 z-[1] rounded-md bg-[rgba(61,139,255,.2)] px-1.5 py-0.5 text-[12px] font-semibold capitalize text-[#bfe3ff]">{it.element ? it.element.symbol : it.category === "alkali" ? "base" : it.category}</span>
                )}
                {it.hazards.length > 0 && !inHand && (
                  <span className="absolute right-1.5 top-2 z-[1] flex gap-1" title={it.hazards.join(", ")}>
                    {it.hazards.slice(0, 2).map((h) => (
                      <i key={h} className="h-3.5 w-3.5 rotate-45 rounded-[2px] border-[1.6px] border-[#ff5b6b] bg-white" />
                    ))}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 top-6 flex items-end justify-center pb-0.5 drop-shadow-[0_8px_10px_rgba(0,0,0,.55)]">
                  <ShelfArt item={it} />
                </div>
              </div>
              <div className="min-w-0 border-t border-[rgba(140,180,255,.08)] px-2 pb-2 pt-1.5">
                <b className="line-clamp-2 block text-[14px] font-semibold leading-tight text-white">{it.name}</b>
                <span className="mt-0.5 block truncate text-[13px] text-[#9db2da]">
                  {it.formula}
                  {it.concentrationM ? ` · ${it.concentrationM} M` : it.solidForm ? ` · ${it.solidForm}` : ""}
                </span>
              </div>
            </button>
          );
        })}
        {cat && !list.length && <p className="col-span-2 py-6 text-center text-[14px] text-[#8fa6d1]">Nothing matches.</p>}
        {!cat && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[146px] animate-pulse rounded-[14px] bg-white/[0.04]" />)}
      </div>
      </>
      )}
    </Glass>
  );
}

function ShelfArt({ item }: { item: ShelfItem }) {
  const mode = dispenseMode(item);
  if (mode === "gas")
    return (
      <svg viewBox="0 0 60 80" className="h-[58px] w-[44px]" aria-hidden>
        <rect x="18" y="16" width="24" height="60" rx="10" fill={item.colour} stroke="#cbd5e1" strokeWidth="2" />
        <rect x="25" y="6" width="10" height="12" rx="2" fill="#94a3b8" />
      </svg>
    );
  if (mode === "spatula")
    return (
      <svg viewBox="0 0 80 70" className="h-[50px] w-[58px]" aria-hidden>
        {item.element && ["transition", "post-transition", "alkali", "alkaline-earth"].includes(item.element.category) ? (
          <path d="M14 56 L28 22 L54 18 L68 50 L44 62 Z" fill={item.colour} stroke="#e2e8f0" strokeWidth="1.5" />
        ) : (
          <path d="M8 62 Q40 10 72 62 Z" fill={item.colour} stroke="#e2e8f0" strokeOpacity=".5" />
        )}
        <path d="M30 30 L40 26" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 60 84" className="h-[60px] w-[44px]" aria-hidden>
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

function HoldCard(p: { item: ShelfItem; mode: ReturnType<typeof dispenseMode>; speed: Speed; setSpeed: (s: Speed) => void; amount: number; setAmount: (n: number) => void; max: number; tilt: number; flowing: boolean; inFlight: number; onGo: () => void; onDropwise: () => void; onPutDown: () => void; compact?: boolean }) {
  const it = p.item;
  const unit = unitLabel(it);
  const step = it.limits.unit === "drops" ? 1 : it.limits.unit === "g" ? (it.limits.max <= 2 ? 0.1 : 0.5) : 1;
  const chips = it.limits.unit === "drops" ? [1, 3, 5, 10] : it.limits.unit === "g" ? [0.1, 0.5, 1, 2, 5] : [1, 5, 10, 25, 50];
  const verb = p.mode === "pour" ? "Pouring" : p.mode === "dropper" ? "Dropping" : p.mode === "spatula" ? "Adding" : "Bubbling";
  const rate = p.mode === "pour" && p.flowing ? (p.tilt > 0 ? RATE[p.speed] : 0) : 0;
  return (
    <Glass className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 shrink-0 rounded-[5px]" style={{ background: it.colour }} />
        <div className="min-w-0 flex-1">
          <b className="line-clamp-2 block font-heading text-[16px] leading-tight">
            {p.flowing ? verb : "Holding"} {it.name}
          </b>
          <div className="truncate text-[13px] text-[#9db2da]">
            {it.formula}
            {it.hazards.length > 0 && <span className="ml-1 text-[#ff9b9b]">· {it.hazards.join(", ")}</span>}
          </div>
        </div>
        <button onClick={p.onPutDown} className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#8fa6d1] hover:bg-white/[0.06] hover:text-white" aria-label="Put down">
          <X className="h-5 w-5" />
        </button>
      </div>
      {p.mode === "pour" && !p.compact && (
        <div className="flex items-center gap-3">
          <TiltGauge deg={p.tilt} max={135} size={56} />
          <div>
            <Kicker>Flow</Kicker>
            <div className="font-heading text-[18px] font-bold tabular-nums">
              {rate.toFixed(1)} <span className="text-[13px] text-[#8fa6d1]">mL/s</span>
            </div>
            <div className="text-[13px] font-semibold text-[#3de8a8]">{p.flowing ? `${p.inFlight.toFixed(1)} mL so far` : "Ready"}</div>
          </div>
        </div>
      )}
      {p.mode === "pour" && (
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
      )}
      <div className="flex items-center gap-1.5">
        <SquareButton aria-label="Less" onClick={() => p.setAmount(Math.max(it.limits.min, +(p.amount - step).toFixed(2)))}>
          <Minus className="h-4 w-4" />
        </SquareButton>
        <div className="flex h-[38px] min-w-0 flex-1 items-center justify-between rounded-[11px] border border-[rgba(140,180,255,.2)] bg-[rgba(2,8,24,.65)] px-3">
          <b className="font-heading text-[17px] tabular-nums">{fmt(p.amount, it.limits.unit)}</b>
          <small className="text-[13px] text-[#8fa6d1]">
            / {fmt(Math.min(p.max, it.limits.max), it.limits.unit)} {unit}
          </small>
        </div>
        <SquareButton aria-label="More" onClick={() => p.setAmount(Math.min(Math.max(it.limits.min, p.max), +(p.amount + step).toFixed(2)))}>
          <Plus className="h-4 w-4" />
        </SquareButton>
      </div>
      <div className="flex gap-1">
        {chips.filter((v) => v >= it.limits.min && v <= it.limits.max).map((v) => (
          <button key={v} onClick={() => p.setAmount(Math.min(v, Math.max(it.limits.min, p.max)))} className={cx("h-8 flex-1 rounded-lg text-[13px] font-semibold tabular-nums transition-colors", p.amount === v ? "bg-[rgba(61,139,255,.3)] text-white" : "bg-[rgba(120,160,255,.08)] text-[#a9bde4] hover:text-white")}>
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
      {p.mode === "pour" && !p.compact && (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-[#9db2da]">
          <MoveDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#39d6ff]" /> Or press and hold on the bench to pour by hand; drag down to tilt more.
        </p>
      )}
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

function SidePanel({ tab, setTab, result, friendly, onHeat, plateC, log, tray, online, busy, onClose }: { tab: Tab; setTab: (t: Tab) => void; result: SimulationResult | null; friendly: ReturnType<typeof friendlyOutcome>; onHeat: (c: number) => void; plateC: number; log: LogLine[]; tray: TrayItem[]; online: boolean | null; busy: boolean; onClose: (() => void) | null }) {
  const p = result?.presentation;
  const reacting = result?.outcome === "reaction";
  const waiting = !!friendly;
  // Title, then one line of what you see, then the details.
  const title = busy ? "Working it out…" : friendly?.title ?? p?.title ?? (online === false ? "Engine offline" : "Mixed");
  const seeLine = friendly?.line ?? p?.observations[0] ?? (p?.message ? p.message.split(/(?<=\.)\s/)[0] : null);
  const detail = friendly ? friendly.detail : p?.message && p.message !== seeLine ? p.message : null;
  const moreObs = friendly ? [] : (p?.observations ?? []).slice(seeLine === p?.observations[0] ? 1 : 0);
  return (
    <Glass className="flex min-h-0 w-full flex-col p-3" aria-label="What's happening">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Segmented<Tab>
            value={tab}
            label="Panel"
            onChange={setTab}
            options={[
              { id: "live", label: "Live" },
              { id: "molecules", label: "Molecules" },
              { id: "notebook", label: "Notes" },
              { id: "facts", label: "Facts" },
            ]}
          />
        </div>
        {onClose && (
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#8fa6d1] hover:bg-white/[0.06] hover:text-white" aria-label="Close panel">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="ls-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === "live" && (
              <div className="space-y-3">
                {!tray.length ? (
                  <div className="rounded-[14px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)] p-3">
                    <h3 className="font-heading text-[18px] font-bold text-white">An empty beaker</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#c8d6f3]">Pick something from the shelf and pour it in. Then add a second chemical and see what happens.</p>
                  </div>
                ) : (
                  <div className={cx("rounded-[14px] border p-3 transition-colors duration-300", reacting ? "border-[rgba(61,232,168,.35)] bg-[linear-gradient(120deg,rgba(61,232,168,.16),rgba(61,139,255,.08))]" : waiting ? "border-[rgba(255,194,61,.4)] bg-[rgba(255,194,61,.07)]" : "border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)]")}>
                    <h3 className="flex items-start gap-2 font-heading text-[19px] font-bold leading-snug">
                      {reacting && <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[#3de8a8] text-[14px] text-[#053]">✓</span>}
                      {title}
                    </h3>
                    {seeLine && !busy && <p className={cx("mt-1.5 text-[16px] font-semibold leading-snug", waiting ? "text-[#ffd59a]" : "text-white")}>{seeLine}</p>}
                    {friendly?.heatC && !busy && plateC < friendly.heatC && (
                      <button type="button" onClick={() => onHeat(friendly.heatC!)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[rgba(255,138,61,.22)] px-3 text-[14px] font-semibold text-[#ffd59a] ring-1 ring-inset ring-[rgba(255,160,90,.5)] hover:bg-[rgba(255,138,61,.32)]">
                        Heat to {friendly.heatC} °C
                      </button>
                    )}
                    {detail && !busy && <p className="mt-2 text-[15px] leading-relaxed text-[#c8d6f3]">{detail}</p>}
                    {moreObs.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[15px] leading-snug text-[#dbe7ff]">
                        {moreObs.map((o) => (
                          <li key={o} className="flex gap-2">
                            <span className="text-[#39d6ff]">•</span>
                            {o}
                          </li>
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
                          <b className="block truncate text-[14px]">{c.name ?? c.formula}</b>
                          <small className="block truncate text-[13px] text-[#9db2da]">
                            {c.formula} · {c.state === "aq" ? "dissolved" : c.state === "s" ? "solid" : c.state === "g" ? "gas" : "liquid"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {result?.equationLatex && <div className="overflow-x-auto rounded-xl border border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.5)] px-3 py-2.5 text-[15px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(result.equationLatex, { throwOnError: false }) }} />}
                {p && p.suggestions.length > 0 && result?.outcome !== "unsupported" && (
                  <div>
                    <Kicker>Try next</Kicker>
                    <ul className="mt-1.5 space-y-1.5">
                      {p.suggestions.slice(0, 3).map((s, i) => (
                        <li key={s} className="flex gap-2.5 rounded-xl border border-[rgba(255,194,61,.35)] bg-[rgba(255,194,61,.06)] p-2.5 text-[15px] leading-snug text-[#dbe7ff]">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#ffc23d] font-heading text-[13px] font-bold text-[#2a1d00]">{i + 1}</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <Kicker>In the beaker</Kicker>
                  <ul className="mt-1.5 space-y-1 text-[15px]">
                    {tray.map((t) => (
                      <li key={t.item.id} className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.item.colour }} />
                        <span className="min-w-0 flex-1 truncate">{t.item.name}</span>
                        <span className="text-[14px] tabular-nums text-[#9db2da]">
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
                {(p?.reactions ?? []).length === 0 && <p className="text-[15px] text-[#9db2da]">When something reacts, the particles involved appear here.</p>}
                {(p?.reactions ?? []).map((r) => (
                  <div key={r.id} className="rounded-[14px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)] p-3">
                    <Kicker>{r.type}</Kicker>
                    <b className="font-heading text-[17px]">{r.name}</b>
                    {r.participants && (
                      <div className="mt-2 flex justify-center">
                        <MicroView reactants={r.participants.reactants} products={r.participants.products} size={250} label={false} />
                      </div>
                    )}
                    {r.participants && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px]">
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
                    <div className="mt-2 overflow-x-auto text-[15px]" dangerouslySetInnerHTML={{ __html: katex.renderToString(r.equationLatex, { throwOnError: false }) }} />
                  </div>
                ))}
              </div>
            )}
            {tab === "notebook" && (
              <div>
                <Kicker>Notebook · written as you go</Kicker>
                <ul className="mt-1.5">
                  {log.map((l, i) => (
                    <li key={i} className="grid grid-cols-[52px_1fr] gap-2 border-b border-dashed border-[rgba(140,180,255,.12)] py-1.5 text-[14px] leading-snug">
                      <span className="text-[13px] tabular-nums text-[#39d6ff]">{clock(l.t)}</span>
                      <span className={l.tone === "bad" ? "text-[#ff9b9b]" : l.tone === "good" ? "text-[#3de8a8]" : ""}>{l.text}</span>
                    </li>
                  ))}
                  {!log.length && <li className="text-[15px] text-[#9db2da]">Everything you do is written down here as you go.</li>}
                </ul>
              </div>
            )}
            {tab === "facts" && (
              <div className="space-y-2">
                {(p?.facts ?? []).map((f) => (
                  <p key={f} className="rounded-[14px] border border-[rgba(167,123,255,.35)] bg-[linear-gradient(135deg,rgba(167,123,255,.22),rgba(57,214,255,.10))] p-3 text-[15px] leading-relaxed">
                    💡 {f}
                  </p>
                ))}
                {!(p?.facts ?? []).length && <p className="text-[15px] text-[#9db2da]">Facts about what you mix show up here.</p>}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Glass>
  );
}
