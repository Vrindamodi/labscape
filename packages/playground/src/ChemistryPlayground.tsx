import type { ObservationCue, SimulationResult } from "@labscape/contracts";
import { animate, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProblemError, fetchCatalogue, resolveMix } from "./api";
import { blendHex, hexToRgba, mixRgba, oklabToCss } from "./colour";
import {
  Beaker,
  BOTTOM,
  LEFT,
  RIGHT,
  VIEW_H,
  VIEW_W,
  type BeakerHandle,
  type PptVisual,
  type SolidVisual,
} from "./components/Beaker";
import { NumberTicker } from "./components/bits";
import { DiscoveryJournal, ProgressRing } from "./components/DiscoveryJournal";
import { DiscoveryCard, FloatingNote, Ribbon } from "./components/Effects";
import { InfoSheet } from "./components/InfoSheet";
import type { Emitter } from "./components/particles";
import { DispenserControls, DispenserSvg, useDispenser } from "./lab/Dispenser";
import { InsightPanel, type InsightState } from "./lab/InsightPanel";
import { LabRoom } from "./lab/LabRoom";
import { ProhibitedDialog } from "./lab/ProhibitedDialog";
import { ReagentRack } from "./lab/ReagentRack";
import { sound, type SoundCue } from "./sound";
import {
  loadDiscoveries,
  loadMuted,
  saveDiscoveries,
  saveMuted,
  type FoundDiscovery,
} from "./storage";
import type { CatalogueResponse, DiscoveryDef, ShelfItem, TrayItem } from "./types";
import { dispenseMode } from "./types";
import "katex/dist/katex.min.css";
import "./playground.css";
import "./lab/lab.css";

const XP_PER_DISCOVERY = 20;
const CAPACITY = 150;
const ROOM_TEMP = 22;

type Content = { item: ShelfItem; amount: number };

type Vessel = {
  levelMl: number;
  levelMs: number;
  colour: string;
  colourMs: number;
  colourEase: "linear" | "sigmoid" | "flash-fade";
  ppts: PptVisual[];
  solids: SolidVisual[];
  oil: { ml: number; colour: string } | null;
  frozen: boolean;
  swirling: boolean;
  glow: string | null;
  shake: number;
  gasHaze: string | null;
  flame: { colour: string; intensity: number; key: number } | null;
  flash: { colour: string; intensity: number; key: number } | null;
  condense: { colour: string; amount: number } | null;
  skate: { colour: string; key: number; durationMs: number } | null;
};

const CLEAR = "rgba(216, 241, 255, 0.10)";

const EMPTY: Vessel = {
  levelMl: 0,
  levelMs: 400,
  colour: CLEAR,
  colourMs: 300,
  colourEase: "linear",
  ppts: [],
  solids: [],
  oil: null,
  frozen: false,
  swirling: false,
  glow: null,
  shake: 0,
  gasHaze: null,
  flame: null,
  flash: null,
  condense: null,
  skate: null,
};

type Preset = { label: string; emoji: string; steps: [string, number][]; ignite?: boolean };

const PRESETS: Preset[] = [
  {
    label: "Sodium in water",
    emoji: "🌊",
    steps: [
      ["water", 50],
      ["phenolphthalein", 3],
      ["el-Na", 0.15],
    ],
  },
  {
    label: "Make water: hydrogen + oxygen + spark",
    emoji: "💥",
    steps: [
      ["el-H", 100],
      ["el-O", 50],
    ],
    ignite: true,
  },
  {
    label: "Golden rain",
    emoji: "✨",
    steps: [
      ["pbno3", 10],
      ["ki", 5],
    ],
  },
  {
    label: "Burning magnesium",
    emoji: "🔥",
    steps: [
      ["el-Mg", 0.2],
      ["el-O", 120],
    ],
    ignite: true,
  },
  {
    label: "Potassium's lilac flame",
    emoji: "💜",
    steps: [
      ["water", 50],
      ["el-K", 0.08],
    ],
  },
  {
    label: "Chlorine pushes out bromine",
    emoji: "🟠",
    steps: [
      ["kbr", 20],
      ["el-Cl", 60],
    ],
  },
  {
    label: "Royal blue copper complex",
    emoji: "💙",
    steps: [
      ["cuso4", 5],
      ["ammonia", 40],
    ],
  },
  {
    label: "Catalyst eruption",
    emoji: "🌋",
    steps: [
      ["h2o2", 40],
      ["mno2-powder", 0.3],
    ],
  },
  {
    label: "Iron + sulfur, heated",
    emoji: "🟤",
    steps: [
      ["el-Fe", 1],
      ["el-S", 1],
    ],
    ignite: true,
  },
  {
    label: "Instant cold pack",
    emoji: "🧊",
    steps: [
      ["water", 50],
      ["nh4no3", 5],
    ],
  },
];

const SOUND_IDS: Record<string, SoundCue> = {
  pop: "pop",
  bang: "bang",
  crackle: "crackle",
  sizzle: "sizzle",
  whoosh: "whoosh",
  hiss: "hiss",
};

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
let uidCounter = 0;
const uid = () => `u${++uidCounter}`;

function solidVisual(item: ShelfItem, amount: number, existing?: SolidVisual): SolidVisual {
  const { min, max } = item.limits;
  const size = 0.75 + Math.min(1, (amount - min) / Math.max(1e-6, max - min)) * 0.55;
  return {
    key: existing?.key ?? uid(),
    substanceId: item.id,
    form: item.element && item.element.state === "l" ? "granules" : (item.solidForm ?? "powder"),
    colour: item.colour,
    size,
    remaining: existing?.remaining ?? 1,
    remainingMs: existing?.remainingMs ?? 400,
    deposit: existing?.deposit ?? null,
    tint: existing?.tint ?? null,
  };
}

function isLiquid(item: ShelfItem) {
  return (item.form === "solution" || item.form === "liquid") && !item.element;
}

function liquidVolume(c: Content) {
  if (!isLiquid(c.item)) return 0;
  return c.item.limits.unit === "drops" ? c.amount * 0.05 : c.amount;
}

/** What the vessel looks like from its contents alone (before the engine says anything). */
function baseline(contents: Content[], prev: Vessel): Vessel {
  const liquids = contents.filter((c) => isLiquid(c.item) && c.item.id !== "vegetable-oil");
  const level = contents.reduce((a, c) => a + liquidVolume(c), 0);
  const colour = liquids.length
    ? blendHex(
        liquids.map((c) => ({
          hex: c.item.colour,
          weight: liquidVolume(c),
          opacity: c.item.opacity,
        })),
      )
    : CLEAR;
  const gases = contents.filter((c) => c.item.form === "gas");
  const gasHaze = gases.length
    ? (() => {
        const coloured = gases.filter((g) => g.item.opacity > 0.1);
        if (!coloured.length) return "rgba(225,240,255,0.18)";
        return hexToRgba(
          coloured[0]?.item.colour ?? "#ffffff",
          Math.min(0.55, 0.15 + coloured.reduce((a, g) => a + g.amount, 0) / 400),
        );
      })()
    : null;
  const oilItem = contents.find((c) => c.item.id === "vegetable-oil");
  const solids = contents
    .filter((c) => c.item.form === "solid" || (c.item.element && c.item.form === "liquid"))
    .map((c) =>
      solidVisual(
        c.item,
        c.amount,
        prev.solids.find((s) => s.substanceId === c.item.id),
      ),
    );
  return {
    ...prev,
    levelMl: level,
    levelMs: 500,
    colour,
    colourMs: 500,
    colourEase: "linear",
    gasHaze,
    oil: oilItem ? { ml: oilItem.amount, colour: hexToRgba(oilItem.item.colour, 0.6) } : null,
    solids,
  };
}

export type ChemistryPlaygroundProps = {
  /**
   * Called with every discovery a mix produced (new or not), after the reaction plays out. The shell
   * turns these into ProgressEvents; the server's idempotency keys make repeats free.
   */
  onDiscoveries?: (ids: string[]) => void;
};

export function ChemistryPlayground({ onDiscoveries }: ChemistryPlaygroundProps = {}) {
  const onDiscoveriesRef = useRef(onDiscoveries);
  onDiscoveriesRef.current = onDiscoveries;
  const reduced = useReducedMotion() ?? false;
  const [cat, setCat] = useState<CatalogueResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contents, setContents] = useState<Content[]>([]);
  const [history, setHistory] = useState<{ id: string; amount: number }[]>([]);
  const [inHand, setInHand] = useState<ShelfItem | null>(null);
  const [rackTab, setRackTab] = useState<"elements" | "chemicals">("elements");
  const [vessel, setVessel] = useState<Vessel>(EMPTY);
  const [insight, setInsight] = useState<InsightState>({ kind: "idle" });
  const [bathTemp, setBathTemp] = useState(ROOM_TEMP);
  const [liveTemp, setLiveTemp] = useState(ROOM_TEMP);
  const [ph, setPh] = useState<number | null>(null);
  const [burnerOn, setBurnerOn] = useState(false);
  const [ignited, setIgnited] = useState(false);
  const [stirring, setStirring] = useState(false);
  const [toolGlow, setToolGlow] = useState<string | null>(null);
  const [shelfGlow, setShelfGlow] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, FoundDiscovery>>(loadDiscoveries);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<{ d: DiscoveryDef; eq: string | null }[]>([]);
  const [ribbon, setRibbon] = useState<{ text: string; sub: string } | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    alternatives: string[];
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [muted, setMuted] = useState(loadMuted);
  const [journalOpen, setJournalOpen] = useState(false);
  const [info, setInfo] = useState<ShelfItem | null>(null);
  const [journalPulse, setJournalPulse] = useState(0);
  const [busy, setBusy] = useState(false);

  const beakerRef = useRef<BeakerHandle>(null);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const vesselRef = useRef(vessel);
  vesselRef.current = vessel;
  const bathRef = useRef(bathTemp);
  bathRef.current = bathTemp;
  const ignitedRef = useRef(ignited);
  ignitedRef.current = ignited;
  const stirRef = useRef(stirring);
  stirRef.current = stirring;
  const insightKindRef = useRef(insight.kind);
  insightKindRef.current = insight.kind;
  const seq = useRef(0);
  const debounce = useRef<number | null>(null);
  const shown = useRef<Set<string>>(new Set());
  const pending = useRef(0);
  const emitters = useRef<Emitter[]>([]);
  const timers = useRef<number[]>([]);
  const tempAnim = useRef<{ stop: () => void } | null>(null);
  const lastDelta = useRef(0);
  const cooldownUntil = useRef(0);
  const lastTempBand = useRef(Math.floor(ROOM_TEMP / 10));

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    sound.muted = muted;
    saveMuted(muted);
    if (muted) sound.stopAll();
  }, [muted]);

  useEffect(() => {
    fetchCatalogue()
      .then((c) => {
        setCat(c);
        setEngineOnline(c.safetyEngineOnline);
      })
      .catch((e: unknown) => {
        setLoadError(
          e instanceof ProblemError ? e.problem.title : "Could not reach the LABscape API.",
        );
        setEngineOnline(false);
      });
    return () => sound.stopAll();
  }, []);

  // ------------------------------------------------------------------ resolving

  const recordDiscoveries = useCallback(
    (r: SimulationResult, delay: number) => {
      const ids = r.presentation?.discoveryIds ?? [];
      if (ids.length) later(delay + 400, () => onDiscoveriesRef.current?.(ids));
      const newly = ids.filter((id) => !found[id]);
      if (!newly.length) return newly;
      const next = { ...found };
      for (const id of newly) {
        next[id] = {
          at: Date.now(),
          equationLatex:
            r.presentation?.reactions.find((x) => x.discoveryId === id)?.equationLatex ?? "",
        };
      }
      setFound(next);
      saveDiscoveries(next);
      setFresh((f) => new Set([...f, ...newly]));
      const defs = cat?.discoveries ?? [];
      const queued = newly
        .slice(0, 3)
        .map((id) => ({ d: defs.find((d) => d.id === id), eq: next[id]?.equationLatex ?? null }))
        .filter((x): x is { d: DiscoveryDef; eq: string | null } => x.d !== undefined);
      later(delay, () => setCards(queued));
      setJournalPulse((p) => p + 1);
      return newly;
    },
    [cat, found, later],
  );

  const applyCue = useCallback(
    (cue: ObservationCue, fresh: boolean, baseTemp: number) => {
      const beaker = beakerRef.current;
      switch (cue.kind) {
        case "colour": {
          const to = oklabToCss(cue.to);
          if (cue.target === "vessel") {
            setVessel((v) => ({
              ...v,
              colour: to,
              colourMs: reduced ? 150 : cue.durationMs,
              colourEase: cue.curve,
            }));
          } else if (cue.target.startsWith("solid:")) {
            const id = cue.target.slice(6);
            setVessel((v) => ({
              ...v,
              solids: v.solids.map((s) =>
                s.substanceId === id
                  ? { ...s, tint: { colour: to, durationMs: cue.durationMs } }
                  : s,
              ),
            }));
          }
          break;
        }
        case "gas": {
          const slot = cue.target.startsWith("solid:")
            ? beaker?.solidSlot(cue.target.slice(6))
            : null;
          const place = slot ?? { x0: LEFT + 14, x1: RIGHT - 14, y: BOTTOM + 2 };
          const e: Emitter = {
            id: uid(),
            ...place,
            ratePerS: cue.ratePerS,
            size: cue.bubble,
            until: performance.now() + cue.durationMs,
          };
          emitters.current = [...emitters.current.filter((x) => x.until > performance.now()), e];
          beaker?.setEmitters(emitters.current);
          sound.loop("fizz", true, Math.min(1.4, cue.ratePerS / 50));
          later(cue.durationMs, () => {
            if (emitters.current.every((x) => x.until <= performance.now() + 50))
              sound.loop("fizz", false);
          });
          if (cue.colour) {
            const haze = oklabToCss(cue.colour, 0.6);
            setVessel((v) => ({ ...v, gasHaze: haze }));
            beaker?.smoke(haze, 0.5, cue.durationMs);
          }
          break;
        }
        case "precipitate": {
          const colour = oklabToCss(cue.colour);
          setVessel((v) => {
            const exists = v.ppts.some((p) => p.id === cue.id);
            return {
              ...v,
              ppts: exists
                ? v.ppts.map((p) => (p.id === cue.id ? { ...p, turbidity: cue.turbidity } : p))
                : [
                    ...v.ppts,
                    {
                      id: cue.id,
                      colour,
                      turbidity: cue.turbidity,
                      settleMs: cue.settleMs,
                      dissolved: 0,
                    },
                  ],
            };
          });
          if (fresh) {
            beaker?.flakes(colour, cue.turbidity, cue.settleMs);
            sound.play("drop");
          }
          break;
        }
        case "temperature": {
          lastDelta.current = cue.deltaC;
          tempAnim.current?.stop();
          tempAnim.current = animate(liveTempRef.current, baseTemp + cue.deltaC, {
            duration: reduced ? 0.2 : Math.min(4, cue.tauMs / 1500),
            onUpdate: (v) => setLiveTemp(v),
          });
          break;
        }
        case "dissolve": {
          const fraction = cue.fraction ?? 1;
          if (cue.target.startsWith("solid:")) {
            const id = cue.target.slice(6);
            setVessel((v) => ({
              ...v,
              solids: v.solids.map((s) =>
                s.substanceId === id
                  ? { ...s, remaining: Math.max(0, 1 - fraction), remainingMs: cue.durationMs }
                  : s,
              ),
            }));
          } else if (cue.target.startsWith("precipitate:")) {
            const id = cue.target.slice(12);
            setVessel((v) => ({
              ...v,
              ppts: v.ppts.map((p) => (p.id === id ? { ...p, dissolved: fraction } : p)),
            }));
          }
          break;
        }
        case "deposit": {
          const id = cue.target.slice(6);
          const colour = oklabToCss(cue.colour);
          setVessel((v) => ({
            ...v,
            solids: v.solids.map((s) =>
              s.substanceId === id ? { ...s, deposit: { colour, durationMs: cue.durationMs } } : s,
            ),
          }));
          break;
        }
        case "layers":
          setVessel((v) => ({ ...v, oil: { ml: cue.volumeMl, colour: oklabToCss(cue.colour) } }));
          break;
        case "smoke":
          if (fresh) beaker?.smoke(oklabToCss(cue.colour), cue.density, cue.durationMs);
          break;
        case "flame":
          if (fresh) {
            const colour = oklabToCss({ ...cue.colour, alpha: 1 });
            setVessel((v) => ({
              ...v,
              flame: { colour, intensity: cue.intensity, key: Date.now() },
            }));
            beaker?.embers(colour, cue.durationMs);
            later(cue.durationMs, () => setVessel((v) => ({ ...v, flame: null })));
          }
          break;
        case "light":
          if (fresh)
            setVessel((v) => ({
              ...v,
              flash: {
                colour: oklabToCss({ ...cue.colour, alpha: 1 }),
                intensity: cue.intensity,
                key: Date.now(),
              },
            }));
          break;
        case "condense":
          if (fresh)
            setVessel((v) => ({
              ...v,
              condense: { colour: oklabToCss(cue.colour), amount: cue.amount },
            }));
          break;
        case "skate":
          if (fresh)
            setVessel((v) => ({
              ...v,
              skate: {
                colour: oklabToCss({ ...cue.colour, alpha: 1 }),
                key: Date.now(),
                durationMs: cue.durationMs,
              },
            }));
          break;
        case "sound":
          if (fresh) sound.play(SOUND_IDS[cue.soundId] ?? "pop");
          break;
        case "odour":
          if (fresh) {
            setNote(`👃 You notice ${cue.description}`);
            later(3800, () => setNote(null));
          }
          break;
        default:
          break;
      }
    },
    [later, reduced],
  );

  const liveTempRef = useRef(liveTemp);
  liveTempRef.current = liveTemp;

  const historyRef = useRef(history);
  historyRef.current = history;

  const undoLast = useCallback((silent = false) => {
    const h = historyRef.current;
    const last = h[h.length - 1];
    if (!last) return;
    const next = contentsRef.current
      .map((c) => (c.item.id === last.id ? { ...c, amount: c.amount - last.amount } : c))
      .filter((c) => c.amount > 1e-6);
    contentsRef.current = next;
    historyRef.current = h.slice(0, -1);
    setContents(next);
    setHistory(h.slice(0, -1));
    setVessel((v) =>
      baseline(next, { ...v, frozen: false, glow: null, ppts: [], flame: null, condense: null }),
    );
    shown.current.clear();
    if (!silent) sound.play("pour");
  }, []);

  const handleResult = useCallback(
    (r: SimulationResult, baseTemp: number) => {
      setEngineOnline(true);
      const reactionIds = (r.presentation?.reactions ?? []).map((x) => x.id);
      const newIds = reactionIds.filter((id) => !shown.current.has(id));
      const freshEvents = newIds.length > 0;
      newIds.forEach((id) => shown.current.add(id));
      const temp = r.measurements.find((m) => m.key === "temperature");
      const phM = r.measurements.find((m) => m.key === "pH");

      if (r.outcome === "prohibited") {
        undoLast(true);
        setVessel((v) => ({ ...v, shake: v.shake + 1, glow: "rgba(239,68,68,0.55)" }));
        sound.play("deny");
        setDialog({
          title: r.presentation?.title ?? "Not allowed",
          message: r.presentation?.message ?? "",
          alternatives: r.presentation?.suggestions ?? [],
        });
        setInsight({ kind: "result", result: r });
        later(1600, () => setVessel((v) => ({ ...v, glow: null })));
        return;
      }
      if (r.outcome === "out_of_range") {
        undoLast(true);
        sound.play("warn");
        setNote(r.presentation?.message ?? "That's too much.");
        later(3500, () => setNote(null));
        return;
      }
      setVessel((v) => ({ ...v, frozen: r.outcome === "unsupported", glow: null }));
      setPh(phM ? phM.value : null);
      if (r.outcome === "unsupported") {
        sound.play("freeze");
        setVessel((v) => ({ ...v, glow: "rgba(245,158,11,0.45)" }));
        setInsight({ kind: "result", result: r });
        return;
      }
      if (r.outcome === "needs_conditions") {
        sound.play("warn");
        const tool = r.presentation?.neededTool;
        setToolGlow(tool ?? null);
        if (tool === "catalyst") {
          setRackTab("chemicals");
          setShelfGlow("mno2-powder");
        } else if (tool === "acid") {
          setRackTab("chemicals");
          setShelfGlow("h2so4");
        }
      } else {
        setToolGlow(null);
        setShelfGlow(null);
      }
      for (const cue of r.cues) later(cue.startMs ?? 0, () => applyCue(cue, freshEvents, baseTemp));
      if (!r.cues.some((c) => c.kind === "temperature") && temp) {
        lastDelta.current = temp.value - baseTemp;
        setLiveTemp(temp.value);
      }
      // Water made in a dry vessel collects as a visible puddle at the bottom.
      const water = r.presentation?.compounds.find((x) => x.formula === "H2O" && x.state === "l");
      if (water && freshEvents && vesselRef.current.levelMl < 1) {
        later(900, () =>
          setVessel((v) => ({
            ...v,
            levelMl: Math.max(v.levelMl, 6),
            levelMs: 2500,
            colour: "rgba(120,190,255,0.35)",
            colourMs: 800,
          })),
        );
      }
      setInsight({ kind: "result", result: r });
      if (r.outcome === "reaction" && freshEvents) {
        const settle = Math.min(
          3500,
          Math.max(
            900,
            ...r.cues.map(
              (c) => (c.startMs ?? 0) + ("durationMs" in c ? Math.min(c.durationMs, 1500) : 400),
            ),
          ),
        );
        later(Math.min(1200, settle * 0.5), () => {
          const newly = recordDiscoveries(r, Math.max(1600, settle));
          const defs = cat?.discoveries ?? [];
          setVessel((v) => ({ ...v, glow: "rgba(34,197,94,0.45)" }));
          setRibbon(
            newly.length
              ? {
                  text: "New discovery!",
                  sub: newly.map((id) => defs.find((d) => d.id === id)?.name ?? id).join(" · "),
                }
              : { text: "Reaction!", sub: r.presentation?.title ?? "" },
          );
          beakerRef.current?.sparks(
            newly.length ? ["#22D3EE", "#E879F9", "#22C55E", "#FDE68A"] : ["#22C55E", "#A7F3D0"],
            newly.length ? 80 : 30,
          );
          sound.play(newly.length ? "discover" : "chime");
          later(2400, () => setRibbon(null));
          later(2600, () => setVessel((v) => ({ ...v, glow: null })));
        });
      } else if (r.outcome === "no_reaction") {
        recordDiscoveries(r, 1200);
      }
    },
    [applyCue, cat, later, recordDiscoveries, undoLast],
  );

  const doResolve = useCallback(async () => {
    const list = contentsRef.current;
    if (!list.length) return;
    if (Date.now() < cooldownUntil.current) return;
    const my = ++seq.current;
    const tray: TrayItem[] = list.map((c) => ({
      key: c.item.id,
      item: c.item,
      amount: Math.round(c.amount * 1000) / 1000,
    }));
    const temp = Math.round(bathRef.current);
    setBusy(true);
    setVessel((v) => ({ ...v, swirling: true }));
    if (insightKindRef.current !== "result") setInsight({ kind: "working" });
    try {
      const [r] = await Promise.all([
        resolveMix(tray, temp, stirRef.current, ignitedRef.current),
        sleep(reduced ? 100 : 350),
      ]);
      if (my !== seq.current) return;
      handleResult(r, temp);
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ProblemError && e.status === 429) {
        const secs = Number(e.problem["retryAfterSeconds"] ?? 60);
        cooldownUntil.current = Date.now() + secs * 1000;
        undoLast(true);
        setInsight({
          kind: "cooldown",
          until: cooldownUntil.current,
          message: e.problem.detail ?? "Cooldown active.",
        });
        sound.play("deny");
      } else {
        if (!(e instanceof ProblemError) || e.status === 503 || e.status === 0)
          setEngineOnline(false);
        setVessel((v) => ({ ...v, frozen: true }));
        setInsight({
          kind: "offline",
          message:
            e instanceof ProblemError
              ? (e.problem.detail ?? e.problem.title)
              : "Something went wrong.",
        });
      }
    } finally {
      if (my === seq.current) {
        setBusy(false);
        setVessel((v) => ({ ...v, swirling: false }));
      }
    }
  }, [handleResult, reduced, undoLast]);

  const requestResolve = useCallback(
    (ms = 220) => {
      if (debounce.current) window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => void doResolve(), ms);
    },
    [doResolve],
  );

  // ------------------------------------------------------------------ adding things

  const addAmount = useCallback((item: ShelfItem, delta: number) => {
    const cs = contentsRef.current;
    const i = cs.findIndex((c) => c.item.id === item.id);
    const next =
      i >= 0
        ? cs.map((c, k) => (k === i ? { ...c, amount: c.amount + delta } : c))
        : [...cs, { item, amount: delta }];
    contentsRef.current = next;
    setContents(next);
    if (isLiquid(item) && item.id !== "vegetable-oil") {
      const ml = item.limits.unit === "drops" ? delta * 0.05 : delta;
      const poured = hexToRgba(item.colour, Math.max(0.12, item.opacity));
      setVessel((old) => {
        const total = old.levelMl + ml;
        return {
          ...old,
          frozen: false,
          levelMl: total,
          levelMs: 120,
          colour: mixRgba(
            old.levelMl > 0.5 ? old.colour : poured,
            poured,
            ml / Math.max(total, 1e-6),
          ),
          colourMs: 150,
          colourEase: "linear",
        };
      });
    } else {
      setVessel((old) => {
        const b = baseline(next, old);
        return { ...old, frozen: false, solids: b.solids, gasHaze: b.gasHaze, oil: b.oil };
      });
    }
    pending.current += delta;
  }, []);

  const commitAddition = useCallback(
    (item: ShelfItem) => {
      const amount = pending.current;
      pending.current = 0;
      if (amount <= 1e-6) return;
      setHistory((h) => [...h, { id: item.id, amount }]);
      requestResolve();
    },
    [requestResolve],
  );

  const current = (id: string) => contents.find((c) => c.item.id === id)?.amount ?? 0;
  const totalLiquid = contents.reduce((a, c) => a + liquidVolume(c), 0);
  const handItem = inHand ?? PLACEHOLDER;
  const remaining = inHand
    ? Math.max(
        0,
        Math.min(
          handItem.limits.max - current(handItem.id),
          isLiquid(handItem)
            ? (CAPACITY - totalLiquid) / (handItem.limits.unit === "drops" ? 0.05 : 1)
            : Infinity,
        ),
      )
    : 0;

  const dispenser = useDispenser({
    item: handItem,
    remaining,
    onDispense: (d) => {
      if (inHand) addAmount(inHand, d);
    },
    onDone: () => {
      if (inHand) commitAddition(inHand);
    },
  });

  const pickUp = useCallback((item: ShelfItem) => {
    setInHand(item);
    setShelfGlow(null);
    sound.play("clink");
  }, []);

  const emptyVessel = useCallback(() => {
    seq.current++;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    emitters.current = [];
    tempAnim.current?.stop();
    beakerRef.current?.clear();
    sound.loop("fizz", false);
    shown.current.clear();
    setContents([]);
    setHistory([]);
    setVessel(EMPTY);
    setInsight({ kind: "idle" });
    setIgnited(false);
    setPh(null);
    setToolGlow(null);
    setRibbon(null);
    lastDelta.current = 0;
    setLiveTemp(bathRef.current);
    sound.play("pour");
  }, []);

  const runPreset = useCallback(
    async (p: Preset) => {
      if (!cat) return;
      emptyVessel();
      await sleep(350);
      for (const [id, amount] of p.steps) {
        const item = cat.substances.find((s) => s.id === id);
        if (!item) continue;
        setInHand(item);
        const mode = dispenseMode(item);
        sound.play(
          mode === "pour"
            ? "pour"
            : mode === "dropper"
              ? "drip"
              : mode === "spatula"
                ? "scoop"
                : "hiss",
        );
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          addAmount(item, amount / steps);
          await sleep(reduced ? 10 : 70);
        }
        pending.current = 0;
        setHistory((h) => [...h, { id: item.id, amount }]);
        await sleep(250);
      }
      if (p.ignite) {
        await sleep(300);
        setVessel((v) => ({
          ...v,
          flash: { colour: "#ffffff", intensity: 0.25, key: Date.now() },
        }));
        sound.play("spark");
        setIgnited(true);
        ignitedRef.current = true;
      }
      requestResolve(50);
    },
    [addAmount, cat, emptyVessel, reduced, requestResolve],
  );

  // ------------------------------------------------------------------ tools

  useEffect(() => {
    sound.loop("burner", burnerOn);
    const id = window.setInterval(() => {
      setBathTemp((t) => {
        const next = burnerOn ? Math.min(90, t + 0.6) : Math.max(ROOM_TEMP, t - 0.25);
        const band = Math.floor(next / 10);
        if (band !== lastTempBand.current && contentsRef.current.length) {
          lastTempBand.current = band;
          window.setTimeout(() => requestResolve(100), 0);
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [burnerOn, requestResolve]);

  useEffect(() => {
    if (!busy) setLiveTemp(bathTemp + lastDelta.current);
  }, [bathTemp, busy]);

  const toggleBurner = () => {
    const on = !burnerOn;
    setBurnerOn(on);
    sound.play(on ? "whoosh" : "click");
    setToolGlow(null);
    if (on && totalLiquid < 0.5 && contents.length) {
      setIgnited(true);
      ignitedRef.current = true;
      requestResolve(600);
    }
  };

  const strikeSpark = () => {
    sound.play("spark");
    setVessel((v) => ({ ...v, flash: { colour: "#fff6c8", intensity: 0.3, key: Date.now() } }));
    setIgnited(true);
    ignitedRef.current = true;
    setToolGlow(null);
    if (contents.length) requestResolve(120);
  };

  const stir = (on: boolean) => {
    setStirring(on);
    sound.loop("stir", on);
  };

  const onOption = (o: string) => {
    if (/supported|concepts|energy|reaction/i.test(o)) {
      const pick = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      if (pick) void runPreset(pick);
      return;
    }
    if (/properties/i.test(o) && contents[0]) {
      setInfo(contents[0].item);
      return;
    }
    setNote(
      /AI/i.test(o)
        ? "The AI science assistant is coming next"
        : /emergency/i.test(o)
          ? "The emergency simulator is coming next"
          : "Lessons are coming with the experiment library",
    );
    later(2400, () => setNote(null));
  };

  const presets = useMemo(
    () => PRESETS.map((p) => ({ label: p.label, emoji: p.emoji, onPick: () => void runPreset(p) })),
    [runPreset],
  );
  const nextCard = useCallback(() => setCards((c) => c.slice(1)), []);
  const foundCount = cat ? cat.discoveries.filter((d) => found[d.id]).length : 0;
  const card = cards[0] ?? null;

  if (loadError) {
    return (
      <div className="lab-root grid min-h-screen place-items-center p-6 text-center">
        <LabRoom />
        <div className="lab-card relative max-w-md p-8">
          <div className="lab-eyebrow text-red-600">Simulation unavailable</div>
          <h1 className="mt-2 font-heading text-2xl text-slate-800">
            Can't reach the LABscape API
          </h1>
          <p className="mt-3 text-sm text-slate-600">{loadError}</p>
          <p className="mt-3 text-sm text-slate-500">
            Start it with <code className="font-mono text-cyan-700">pnpm api:demo</code>, then
            reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="lab-root relative flex h-screen min-h-[680px] flex-col overflow-hidden">
      <LabRoom />
      <Header
        online={engineOnline}
        found={foundCount}
        total={cat?.discoveries.length ?? 0}
        xp={foundCount * XP_PER_DISCOVERY}
        muted={muted}
        pulse={journalPulse}
        onMute={() => setMuted((m) => !m)}
        onJournal={() => setJournalOpen(true)}
      />
      <main className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[340px_minmax(0,1fr)_380px] lg:overflow-hidden">
        <div className="h-[520px] lg:h-auto lg:min-h-0">
          {cat ? (
            <ReagentRack
              items={cat.substances}
              inHand={inHand?.id ?? null}
              highlightId={shelfGlow}
              onPick={pickUp}
              onInfo={setInfo}
              tab={rackTab}
              onTab={setRackTab}
            />
          ) : (
            <div className="lab-card h-full animate-pulse" />
          )}
        </div>

        <div className="order-first flex min-h-[560px] flex-col gap-2 lg:order-none lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 flex items-end justify-center">
              <div className="relative h-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
                <Beaker
                  ref={beakerRef}
                  levelMl={vessel.levelMl}
                  levelMs={vessel.levelMs}
                  liquidColour={vessel.colour}
                  colourMs={vessel.colourMs}
                  colourEase={vessel.colourEase}
                  ppts={vessel.ppts}
                  solids={vessel.solids}
                  oil={vessel.oil}
                  frozen={vessel.frozen}
                  swirling={vessel.swirling || stirring}
                  stirring={stirring}
                  temperature={liveTemp}
                  pour={null}
                  glow={vessel.glow}
                  shake={vessel.shake}
                  gasHaze={vessel.gasHaze}
                  flame={vessel.flame}
                  flash={vessel.flash}
                  condense={vessel.condense}
                  skate={vessel.skate}
                  burner={burnerOn}
                  hand={inHand ? (g) => <DispenserSvg d={dispenser} g={g} /> : undefined}
                />
              </div>
            </div>

            <div className="absolute left-2 top-2 flex flex-col gap-2">
              <Instrument
                label="Thermometer"
                value={liveTemp}
                unit="°C"
                decimals={1}
                colour="#ef4444"
              />
              <Instrument label="pH meter" value={ph} unit="" decimals={1} colour="#8b5cf6" />
              <Instrument
                label="Liquid"
                value={vessel.levelMl}
                unit="mL"
                decimals={1}
                colour="#0ea5e9"
              />
            </div>

            {contents.length > 0 && (
              <div className="absolute right-2 top-2 max-w-[220px]">
                <div className="lab-contents">
                  <div className="lab-eyebrow mb-1">In the vessel</div>
                  {contents.map((c) => (
                    <div
                      key={c.item.id}
                      className="flex items-center gap-1.5 text-[12px] text-slate-700"
                    >
                      <i
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: c.item.colour, border: "1px solid rgba(0,0,0,0.15)" }}
                      />
                      <span className="truncate">{c.item.name}</span>
                      <span className="tabular ml-auto text-slate-500">
                        {c.amount.toFixed(
                          c.item.limits.unit === "drops" ? 0 : c.item.limits.unit === "g" ? 2 : 1,
                        )}{" "}
                        {c.item.limits.unit}
                      </span>
                    </div>
                  ))}
                  {ignited && (
                    <div className="mt-1 text-[11px] font-semibold text-orange-600">🔥 Ignited</div>
                  )}
                </div>
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 top-[12%] flex justify-center">
              <Ribbon show={ribbon !== null} text={ribbon?.text ?? ""} sub={ribbon?.sub ?? ""} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
              <FloatingNote text={note} />
            </div>
            {vessel.frozen && insight.kind === "result" && (
              <motion.div
                className="lab-frozen-badge"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                🧩 Simulation not available for this mix
              </motion.div>
            )}
          </div>

          {inHand && <DispenserControls d={dispenser} onPutDown={() => setInHand(null)} />}

          <div className="lab-toolbar">
            <Tool
              icon="🔥"
              label={burnerOn ? `Burner on · ${bathTemp.toFixed(0)}°C` : "Bunsen burner"}
              active={burnerOn}
              glow={toolGlow === "heater"}
              onClick={toggleBurner}
            />
            <Tool
              icon="⚡"
              label="Spark igniter"
              glow={toolGlow === "spark"}
              onClick={strikeSpark}
            />
            <Tool
              icon="🥄"
              label={stirring ? "Stirring…" : "Hold to stir"}
              active={stirring}
              onDown={() => stir(true)}
              onUp={() => stir(false)}
            />
            <Tool
              icon="↶"
              label="Undo last"
              disabled={!history.length}
              onClick={() => {
                undoLast();
                requestResolve(300);
              }}
            />
            <Tool
              icon="🧽"
              label="Empty & wash"
              disabled={!contents.length}
              onClick={emptyVessel}
            />
            {!inHand && (
              <span className="ml-auto hidden text-[12.5px] font-medium text-white/90 drop-shadow md:block">
                Pick something from the shelf to hold it ✋
              </span>
            )}
          </div>
        </div>

        <div className="h-[560px] lg:h-auto lg:min-h-0">
          <InsightPanel
            state={insight}
            newDiscoveries={fresh}
            presets={presets}
            onOption={onOption}
          />
        </div>
      </main>

      <DiscoveryCard discovery={card?.d ?? null} equation={card?.eq ?? null} onDone={nextCard} />
      <AutoAdvance cardId={card?.d.id ?? null} onAdvance={nextCard} />
      <ProhibitedDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        message={dialog?.message ?? ""}
        alternatives={dialog?.alternatives ?? []}
        onClose={() => setDialog(null)}
        onAlternative={(a) => {
          setDialog(null);
          onOption(a);
        }}
      />
      <DiscoveryJournal
        open={journalOpen}
        onClose={() => setJournalOpen(false)}
        discoveries={cat?.discoveries ?? []}
        found={found}
        fresh={fresh}
      />
      <InfoSheet
        item={info}
        onClose={() => setInfo(null)}
        onAdd={(i) => {
          pickUp(i);
          setInfo(null);
        }}
      />
    </div>
  );
}

const PLACEHOLDER: ShelfItem = {
  id: "__none",
  name: "",
  formula: "",
  concentrationM: null,
  category: "",
  form: "solution",
  solidForm: null,
  colour: "#ffffff",
  opacity: 0,
  hazards: [],
  limits: { min: 0, max: 0, unit: "mL" },
  description: "",
  element: null,
};

function AutoAdvance({ cardId, onAdvance }: { cardId: string | null; onAdvance: () => void }) {
  useEffect(() => {
    if (!cardId) return;
    const id = window.setTimeout(onAdvance, 2800);
    return () => window.clearTimeout(id);
  }, [cardId, onAdvance]);
  return null;
}

function Instrument({
  label,
  value,
  unit,
  decimals,
  colour,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals: number;
  colour: string;
}) {
  return (
    <div className="lab-instrument" style={{ ["--accent" as string]: colour }}>
      <span className="lab-instrument-label">{label}</span>
      <span className="lab-instrument-screen">
        {value === null ? (
          "--.-"
        ) : (
          <NumberTicker value={value} decimals={decimals} durationMs={400} />
        )}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function Tool(p: {
  icon: string;
  label: string;
  active?: boolean;
  glow?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onDown?: () => void;
  onUp?: () => void;
}) {
  return (
    <motion.button
      className={`lab-tool ${p.active ? "lab-tool-on" : ""} ${p.glow ? "lab-tool-glow" : ""}`}
      disabled={p.disabled}
      onClick={p.onClick}
      onPointerDown={p.onDown}
      onPointerUp={p.onUp}
      onPointerLeave={p.onUp}
      whileTap={{ scale: 0.94 }}
      animate={p.glow ? { y: [0, -4, 0] } : { y: 0 }}
      transition={p.glow ? { duration: 1.2, repeat: Infinity } : { duration: 0.2 }}
    >
      <span className="text-lg">{p.icon}</span>
      <span>{p.label}</span>
    </motion.button>
  );
}

function Header(props: {
  online: boolean | null;
  found: number;
  total: number;
  xp: number;
  muted: boolean;
  pulse: number;
  onMute: () => void;
  onJournal: () => void;
}) {
  const status =
    props.online === null
      ? { t: "Connecting…", c: "#64748b" }
      : props.online
        ? { t: "Safety engine online", c: "#16a34a" }
        : { t: "Safety engine offline", c: "#dc2626" };
  return (
    <header className="lab-header relative z-10">
      <div className="flex items-center gap-3">
        <div className="lab-logo">⚗</div>
        <div>
          <div className="font-heading text-[19px] font-bold leading-none text-slate-800">
            LAB<span className="text-cyan-600">scape</span>
          </div>
          <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">
            Open playground · Chemistry
          </div>
        </div>
      </div>
      <div
        className="hidden items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-[11.5px] font-semibold md:flex"
        style={{ color: status.c }}
        role="status"
      >
        <motion.span
          className="h-2 w-2 rounded-full"
          style={{ background: status.c }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        {status.t}
      </div>
      <div className="flex items-center gap-2">
        <motion.button
          key={props.pulse}
          className="lab-pillbtn"
          onClick={props.onJournal}
          animate={props.pulse ? { scale: [1, 1.15, 1] } : {}}
          aria-label={`Discovery journal: ${props.found} of ${props.total}`}
        >
          <ProgressRing value={props.found} total={props.total} size={26} />
          <span className="tabular">
            {props.found}/{props.total}
          </span>
          <span className="hidden sm:inline">discoveries</span>
        </motion.button>
        <span className="lab-pillbtn lab-xp">⭐ {props.xp} XP</span>
        <button
          className="lab-pillbtn"
          onClick={props.onMute}
          aria-label={props.muted ? "Unmute" : "Mute"}
        >
          {props.muted ? "🔇" : "🔊"}
        </button>
      </div>
    </header>
  );
}
