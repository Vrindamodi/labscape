import type { ObservationCue, SimulationResult } from "@labscape/contracts";
import { animate, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProblemError, fetchCatalogue, resolveMix } from "./api";
import { blendHex, hexToRgba, oklabToCss } from "./colour";
import { BenchControls } from "./components/BenchControls";
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
import { DiscoveryCard, FloatingNote, Ribbon, SafetyShield, Vignette } from "./components/Effects";
import { InfoSheet } from "./components/InfoSheet";
import { OutcomePanel, type PanelState } from "./components/OutcomePanel";
import type { Emitter } from "./components/particles";
import { Shelf } from "./components/Shelf";
import { sound } from "./sound";
import {
  loadDiscoveries,
  loadMuted,
  saveDiscoveries,
  saveMuted,
  type FoundDiscovery,
} from "./storage";
import type { CatalogueResponse, DiscoveryDef, ShelfItem, TrayItem } from "./types";
import { liquidMl } from "./types";
import "katex/dist/katex.min.css";
import "./playground.css";

const MAX_TRAY = 6;
const XP_PER_DISCOVERY = 20;

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
  pour: { colour: string } | null;
  glow: string | null;
  shake: number;
};

const EMPTY: Vessel = {
  levelMl: 0,
  levelMs: 400,
  colour: "rgba(216, 241, 255, 0.06)",
  colourMs: 300,
  colourEase: "linear",
  ppts: [],
  solids: [],
  oil: null,
  frozen: false,
  swirling: false,
  pour: null,
  glow: null,
  shake: 0,
};

type Preset = { label: string; items: [string, number][]; temperature?: number };

const PRESETS: Preset[] = [
  {
    label: "Neutralise an acid (with universal indicator)",
    items: [
      ["hcl", 20],
      ["universal-indicator", 4],
      ["naoh", 20],
    ],
  },
  {
    label: "Royal blue copper complex",
    items: [
      ["cuso4", 5],
      ["ammonia", 40],
    ],
  },
  {
    label: "Iodine clock",
    items: [
      ["ki", 10],
      ["h2so4", 10],
      ["starch", 5],
      ["h2o2", 10],
    ],
  },
  {
    label: "Catalyst eruption",
    items: [
      ["h2o2", 40],
      ["mno2-powder", 0.3],
    ],
  },
  {
    label: "Silver halide test",
    items: [
      ["kbr", 5],
      ["agno3", 10],
    ],
  },
  {
    label: "Copper displacement",
    items: [
      ["cuso4", 30],
      ["zn-granules", 2],
    ],
  },
  {
    label: "Disappearing cross (warm)",
    items: [
      ["na2s2o3", 40],
      ["hcl", 10],
    ],
    temperature: 50,
  },
  {
    label: "Magnesium in acid",
    items: [
      ["hcl", 40],
      ["mg-ribbon", 0.3],
    ],
  },
  {
    label: "The cooling fizz",
    items: [
      ["ethanoic-acid", 30],
      ["nahco3", 30],
    ],
  },
  {
    label: "Test for water",
    items: [
      ["cuso4-anhydrous", 2],
      ["water", 20],
    ],
  },
  {
    label: "Amphoteric zinc",
    items: [
      ["znso4", 5],
      ["naoh", 30],
    ],
  },
  {
    label: "Rust-brown hydroxide",
    items: [
      ["fecl3", 20],
      ["naoh", 10],
    ],
  },
];

let uidCounter = 0;
const uid = () => `u${++uidCounter}`;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function defaultAmount(item: ShelfItem): number {
  const { min, max, unit } = item.limits;
  if (unit === "drops") return Math.min(max, Math.max(min, 3));
  if (unit === "mL") return Math.min(max, Math.max(min, 10));
  const v = min + (max - min) / 4;
  return Math.round(v * 100) / 100;
}

function solidSize(t: TrayItem) {
  const { min, max } = t.item.limits;
  return 0.8 + ((t.amount - min) / Math.max(1e-6, max - min)) * 0.5;
}

export function ChemistryPlayground() {
  const reduced = useReducedMotion() ?? false;
  const [cat, setCat] = useState<CatalogueResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [temperature, setTemperature] = useState(22);
  const [stirring, setStirring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mixed, setMixed] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ kind: "idle" });
  const [category, setCategory] = useState("all");
  const [shelfGlow, setShelfGlow] = useState<string | null>(null);
  const [heaterGlow, setHeaterGlow] = useState(false);
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [info, setInfo] = useState<ShelfItem | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [found, setFound] = useState<Record<string, FoundDiscovery>>(loadDiscoveries);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<{ d: DiscoveryDef; eq: string | null }[]>([]);
  const [muted, setMuted] = useState(loadMuted);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [ribbon, setRibbon] = useState<{ text: string; sub: string } | null>(null);
  const [shield, setShield] = useState(false);
  const [vignette, setVignette] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [vessel, setVessel] = useState<Vessel>(EMPTY);
  const [liveTemp, setLiveTemp] = useState(22);
  const [ph, setPh] = useState<number | null>(null);
  const [journalPulse, setJournalPulse] = useState(0);

  const beakerRef = useRef<BeakerHandle>(null);
  const timers = useRef<number[]>([]);
  const emitters = useRef<Emitter[]>([]);
  const runId = useRef(0);
  const tempAnim = useRef<{ stop: () => void } | null>(null);
  const cooldownUntil = useRef(0);

  useEffect(() => {
    sound.muted = muted;
    saveMuted(muted);
  }, [muted]);

  useEffect(() => {
    fetchCatalogue()
      .then((c) => {
        setCat(c);
        setEngineOnline(c.safetyEngineOnline);
        setTemperature(c.conditions.defaultTemperatureC);
        setLiveTemp(c.conditions.defaultTemperatureC);
      })
      .catch((e: unknown) => {
        setLoadError(
          e instanceof ProblemError ? e.problem.title : "Could not reach the LABscape API.",
        );
        setEngineOnline(false);
      });
  }, []);

  useEffect(() => {
    if (!busy) setLiveTemp(temperature);
  }, [temperature, busy]);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  const clearStage = useCallback(() => {
    runId.current++;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    emitters.current = [];
    tempAnim.current?.stop();
    beakerRef.current?.clear();
    setVessel(EMPTY);
    setRibbon(null);
    setShield(false);
    setVignette(null);
    setNote(null);
    setPh(null);
    setHeaterGlow(false);
    setShelfGlow(null);
    setFocusRef(null);
  }, []);

  // ------------------------------------------------------------------ tray

  const addToTray = useCallback(
    (item: ShelfItem) => {
      if (busy) return;
      setTray((t) => {
        if (t.some((x) => x.item.id === item.id)) {
          setNote(`${item.name} is already in the tray`);
          window.setTimeout(() => setNote(null), 1600);
          return t;
        }
        if (t.length >= MAX_TRAY) {
          setNote(`The tray holds ${MAX_TRAY} reagents`);
          window.setTimeout(() => setNote(null), 1600);
          return t;
        }
        sound.play("clink");
        return [...t, { key: uid(), item, amount: defaultAmount(item) }];
      });
      setShelfGlow((g) => (g === item.id ? null : g));
      setFocusRef(null);
    },
    [busy],
  );

  // ------------------------------------------------------------------ cue playback

  const applyCue = useCallback(
    (cue: ObservationCue, baseTemp: number) => {
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
          sound.play("fizz", Math.min(1.5, cue.ratePerS / 60));
          break;
        }
        case "precipitate": {
          const colour = oklabToCss(cue.colour);
          setVessel((v) => ({
            ...v,
            ppts: [
              ...v.ppts,
              {
                id: cue.id,
                colour,
                turbidity: cue.turbidity,
                settleMs: cue.settleMs,
                dissolved: 0,
              },
            ],
          }));
          beaker?.flakes(colour, cue.turbidity, cue.settleMs);
          sound.play("drop");
          break;
        }
        case "temperature": {
          tempAnim.current?.stop();
          const target = baseTemp + cue.deltaC;
          tempAnim.current = animate(baseTemp, target, {
            duration: reduced ? 0.2 : Math.min(4, cue.tauMs / 1500),
            ease: [0.2, 0, 0, 1],
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
        case "layers": {
          const colour = oklabToCss(cue.colour);
          setVessel((v) => ({ ...v, oil: { ml: cue.volumeMl, colour } }));
          break;
        }
        case "odour": {
          setNote(`👃 You notice ${cue.description}`);
          later(3800, () => setNote(null));
          break;
        }
        default:
          break;
      }
    },
    [later, reduced],
  );

  // ------------------------------------------------------------------ outcomes

  const recordDiscoveries = useCallback(
    (r: SimulationResult, cardDelayMs: number) => {
      const ids = r.presentation?.discoveryIds ?? [];
      const newly = ids.filter((id) => !found[id]);
      if (newly.length === 0) return [];
      const next = { ...found };
      for (const id of newly) {
        const eq = r.presentation?.reactions.find((x) => x.discoveryId === id)?.equationLatex ?? "";
        next[id] = { at: Date.now(), equationLatex: eq };
      }
      setFound(next);
      saveDiscoveries(next);
      setFresh((f) => new Set([...f, ...newly]));
      const defs = cat?.discoveries ?? [];
      const queued = newly
        .slice(0, 3)
        .map((id) => ({ d: defs.find((d) => d.id === id), eq: next[id]?.equationLatex ?? null }))
        .filter((x): x is { d: DiscoveryDef; eq: string | null } => x.d !== undefined);
      // Cards wait until the reaction has played out, so they never hide the moment itself.
      later(cardDelayMs, () => setCards(queued));
      setJournalPulse((p) => p + 1);
      return newly;
    },
    [cat, found, later],
  );

  const reveal = useCallback(
    (r: SimulationResult, baseTemp: number) => {
      const p = r.presentation;
      const showPanel = (delay: number) =>
        later(delay, () => setPanel({ kind: "result", result: r }));
      const phMeasure = r.measurements.find((m) => m.key === "pH");
      switch (r.outcome) {
        case "reaction":
        case "no_reaction": {
          for (const cue of r.cues) {
            later(cue.startMs ?? 0, () => applyCue(cue, baseTemp));
          }
          const settle = Math.min(
            4200,
            Math.max(
              r.outcome === "reaction" ? 1300 : 700,
              ...r.cues.map(
                (c) => (c.startMs ?? 0) + ("durationMs" in c ? Math.min(c.durationMs, 1800) : 600),
              ),
            ),
          );
          showPanel(r.outcome === "reaction" ? 650 : 400);
          later(settle * 0.6, () => phMeasure && setPh(phMeasure.value));
          if (r.outcome === "reaction") {
            const ribbonAt = Math.min(1400, settle * 0.5);
            later(ribbonAt, () => {
              const newly = recordDiscoveries(r, Math.max(1800, settle - ribbonAt + 1400));
              const defs = cat?.discoveries ?? [];
              setVessel((v) => ({ ...v, glow: "rgba(34,197,94,0.55)" }));
              setRibbon(
                newly.length > 0
                  ? {
                      text: "Reaction discovered",
                      sub: newly.map((id) => defs.find((d) => d.id === id)?.name ?? id).join(" · "),
                    }
                  : { text: "Reaction", sub: p?.title ?? "" },
              );
              beakerRef.current?.sparks(
                newly.length > 0
                  ? ["#22D3EE", "#E879F9", "#22C55E", "#FDE68A"]
                  : ["#22C55E", "#A7F3D0"],
                newly.length > 0 ? 90 : 40,
              );
              sound.play(newly.length > 0 ? "discover" : "chime");
              later(2600, () => setRibbon(null));
            });
          } else {
            later(500, () => {
              recordDiscoveries(r, 1600);
              setVessel((v) => ({ ...v, glow: "rgba(56,189,248,0.35)" }));
              sound.play("click");
            });
          }
          break;
        }
        case "needs_conditions": {
          for (const cue of r.cues) later(cue.startMs ?? 0, () => applyCue(cue, baseTemp));
          setVessel((v) => ({ ...v, glow: "rgba(245,158,11,0.45)" }));
          sound.play("warn");
          const tool = p?.neededTool;
          if (tool === "heater") setHeaterGlow(true);
          if (tool === "catalyst") {
            setCategory("solid");
            setShelfGlow("mno2-powder");
          }
          if (tool === "acid") {
            setCategory("acid");
            setShelfGlow("h2so4");
          }
          showPanel(250);
          break;
        }
        case "procedure_mismatch": {
          for (const cue of r.cues) later(cue.startMs ?? 0, () => applyCue(cue, baseTemp));
          setVessel((v) => ({ ...v, glow: "rgba(245,158,11,0.45)" }));
          setHeaterGlow(p?.neededTool === "heater");
          sound.play("warn");
          showPanel(250);
          break;
        }
        case "out_of_range": {
          setVessel((v) => ({
            ...v,
            levelMl: 0,
            levelMs: 900,
            oil: null,
            solids: [],
            glow: "rgba(245,158,11,0.45)",
          }));
          beakerRef.current?.drops("rgba(220,235,255,0.7)", 24, true);
          setFocusRef(p?.focusRef ?? null);
          setHeaterGlow(p?.neededTool === "heater");
          sound.play("warn");
          showPanel(250);
          break;
        }
        case "unsupported": {
          setVessel((v) => ({ ...v, frozen: true, glow: "rgba(245,158,11,0.4)" }));
          sound.play("freeze");
          showPanel(300);
          break;
        }
        case "prohibited": {
          setVessel((v) => ({
            ...v,
            levelMl: 0,
            levelMs: 900,
            oil: null,
            solids: v.solids.map((s) => ({ ...s, remaining: 0, remainingMs: 500 })),
            glow: "rgba(239,68,68,0.6)",
            shake: v.shake + 1,
          }));
          beakerRef.current?.drops("rgba(255,180,180,0.8)", 40, true);
          sound.play("deny");
          later(250, () => {
            setShield(true);
            setVignette("rgba(239,68,68,0.55)");
          });
          later(2600, () => setShield(false));
          later(2200, () => setVignette(null));
          showPanel(450);
          break;
        }
      }
    },
    [applyCue, cat, later, recordDiscoveries],
  );

  const handleError = useCallback(
    (e: unknown) => {
      const status = e instanceof ProblemError ? e.status : 0;
      if (status === 429 && e instanceof ProblemError) {
        const secs = Number(e.problem["retryAfterSeconds"] ?? 60);
        cooldownUntil.current = Date.now() + secs * 1000;
        setPanel({
          kind: "cooldown",
          until: cooldownUntil.current,
          message: e.problem.detail ?? "Cooldown active.",
        });
        setVignette("rgba(239,68,68,0.4)");
        later(1500, () => setVignette(null));
        setVessel((v) => ({ ...v, levelMl: 0, levelMs: 700, solids: [], oil: null }));
        sound.play("deny");
        later(secs * 1000, () => setPanel({ kind: "idle" }));
        return;
      }
      if (status === 503 || status === 0) setEngineOnline(false);
      setVessel((v) => ({ ...v, frozen: true }));
      sound.play("freeze");
      const message =
        e instanceof ProblemError
          ? (e.problem.detail ?? e.problem.title)
          : "Something went wrong talking to the safety engine.";
      setPanel({ kind: "offline", message });
    },
    [later],
  );

  // ------------------------------------------------------------------ mix

  const runMix = useCallback(
    async (snapshot: TrayItem[], temp: number) => {
      if (snapshot.length === 0 || busy) return;
      if (Date.now() < cooldownUntil.current) return;
      clearStage();
      const myRun = runId.current;
      setBusy(true);
      setMixed(true);
      setPanel({ kind: "pouring" });
      setLiveTemp(temp);

      const request = resolveMix(snapshot, temp, stirring).then(
        (r) => ({ ok: true as const, r }),
        (e: unknown) => ({ ok: false as const, e }),
      );

      const per = reduced ? 160 : Math.max(420, Math.min(720, 2600 / snapshot.length));
      const poured: { hex: string; weight: number; opacity: number }[] = [];
      let level = 0;
      let oilMl = 0;
      for (let i = 0; i < snapshot.length; i++) {
        const t = snapshot[i];
        if (!t) continue;
        if (i > 0) await sleep(per);
        if (runId.current !== myRun) return;
        if (t.item.form === "solid") {
          setVessel((v) => ({
            ...v,
            pour: null,
            solids: [
              ...v.solids,
              {
                key: uid(),
                substanceId: t.item.id,
                form: t.item.solidForm ?? "powder",
                colour: t.item.colour,
                size: solidSize(t),
                remaining: 1,
                remainingMs: 400,
                deposit: null,
                tint: null,
              },
            ],
          }));
          sound.play("drop");
          continue;
        }
        const ml = liquidMl(t);
        level += ml;
        if (t.item.id === "vegetable-oil") {
          oilMl += ml;
          const oil = { ml: oilMl, colour: hexToRgba(t.item.colour, 0.6) };
          setVessel((v) => ({
            ...v,
            pour: { colour: hexToRgba(t.item.colour, 0.8) },
            levelMl: level,
            levelMs: per * 0.9,
            oil,
          }));
        } else {
          poured.push({ hex: t.item.colour, weight: ml, opacity: t.item.opacity });
          const colour = blendHex(poured);
          setVessel((v) => ({
            ...v,
            pour: { colour: hexToRgba(t.item.colour, Math.max(0.45, t.item.opacity)) },
            levelMl: level,
            levelMs: per * 0.9,
            colour,
            colourMs: per,
            colourEase: "linear",
          }));
        }
        beakerRef.current?.drops(
          hexToRgba(t.item.colour, Math.max(0.5, t.item.opacity)),
          t.item.limits.unit === "drops" ? 4 : 14,
        );
        sound.play(t.item.limits.unit === "drops" ? "drop" : "pour");
      }
      await sleep(per);
      if (runId.current !== myRun) return;
      setVessel((v) => ({ ...v, pour: null, swirling: true }));
      setPanel({ kind: "resolving" });

      const [res] = await Promise.all([request, sleep(reduced ? 300 : 700)]);
      if (runId.current !== myRun) return;
      setVessel((v) => ({ ...v, swirling: false }));
      setBusy(false);
      if (res.ok) {
        setEngineOnline(true);
        reveal(res.r, temp);
      } else {
        handleError(res.e);
      }
    },
    [busy, clearStage, handleError, reduced, reveal, stirring],
  );

  const runPreset = useCallback(
    (preset: Preset) => {
      if (!cat || busy) return;
      const items: TrayItem[] = [];
      for (const [id, amount] of preset.items) {
        const item = cat.substances.find((s) => s.id === id);
        if (item) items.push({ key: uid(), item, amount });
      }
      const t = preset.temperature ?? cat.conditions.defaultTemperatureC;
      setTray(items);
      setTemperature(t);
      void runMix(items, t);
    },
    [busy, cat, runMix],
  );

  const onOption = useCallback(
    (option: string) => {
      if (/supported combination|reaction concepts|energy/i.test(option)) {
        const pool = /energy/i.test(option)
          ? PRESETS.filter((p) => /Magnesium|Neutralise|Catalyst/.test(p.label))
          : PRESETS;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) runPreset(pick);
        return;
      }
      if (/properties/i.test(option)) {
        const first = tray[0];
        if (first) setInfo(first.item);
        return;
      }
      setNote(
        /AI/i.test(option)
          ? "The AI science assistant arrives on Day 3"
          : /emergency/i.test(option)
            ? "The emergency simulator arrives in Release 3"
            : "Concept lessons arrive with the experiment library",
      );
      later(2400, () => setNote(null));
    },
    [later, runPreset, tray],
  );

  const empty = useCallback(() => {
    if (busy) return;
    if (mixed) {
      clearStage();
      setMixed(false);
      setPanel({ kind: "idle" });
      sound.play("pour");
    } else {
      setTray([]);
    }
  }, [busy, clearStage, mixed]);

  const nextCard = useCallback(() => setCards((c) => c.slice(1)), []);

  // ------------------------------------------------------------------ derived

  const selected = useMemo(() => new Set(tray.map((t) => t.item.id)), [tray]);
  const foundCount = cat ? cat.discoveries.filter((d) => found[d.id]).length : 0;
  const totalLiquid = tray.reduce((a, t) => a + liquidMl(t), 0);
  const presets = useMemo(
    () => PRESETS.slice(0, 6).map((p) => ({ label: p.label, onPick: () => runPreset(p) })),
    [runPreset],
  );
  const canMix =
    !busy && tray.length > 0 && engineOnline !== false && Date.now() >= cooldownUntil.current;

  if (loadError) {
    return (
      <div className="ls-bg grid min-h-screen place-items-center p-6 text-center">
        <div className="ls-panel max-w-md p-8">
          <div className="ls-eyebrow text-state-danger">Simulation unavailable</div>
          <h1 className="mt-2 font-heading text-2xl text-white">Can't reach the LABscape API</h1>
          <p className="mt-3 text-sm text-white/60">{loadError}</p>
          <p className="mt-3 text-sm text-white/45">
            Start it with <code className="tabular text-accent-cyan">pnpm api:demo</code>, then
            reload.
          </p>
        </div>
      </div>
    );
  }

  const card = cards[0] ?? null;

  return (
    <div className="ls-bg flex h-screen min-h-[640px] flex-col overflow-hidden text-white">
      <Header
        online={engineOnline}
        found={foundCount}
        total={cat?.discoveries.length ?? 0}
        xp={foundCount * XP_PER_DISCOVERY}
        muted={muted}
        pulse={journalPulse}
        onMute={() => setMuted((m) => !m)}
        onJournal={() => setJournalOpen(true)}
        onInspire={() => {
          const pick = PRESETS[Math.floor(Math.random() * PRESETS.length)];
          if (pick) runPreset(pick);
        }}
        busy={busy}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)_370px] lg:overflow-hidden">
        <div className="h-[460px] lg:h-auto lg:min-h-0">
          {cat ? (
            <Shelf
              items={cat.substances}
              selected={selected}
              category={category}
              onCategory={setCategory}
              highlightId={shelfGlow}
              onAdd={(item) => addToTray(item)}
              onInfo={setInfo}
              disabled={busy}
            />
          ) : (
            <div className="ls-panel h-full animate-pulse" />
          )}
        </div>

        <div className="order-first grid grid-rows-[400px_auto] gap-3 lg:order-none lg:min-h-0 lg:grid-rows-[minmax(380px,1fr)_auto]">
          <div className="ls-stage relative min-h-0 overflow-hidden">
            <div className="ls-stage-floor" aria-hidden />
            <div className="absolute inset-0 flex items-center justify-center p-4 pt-10">
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
                  swirling={vessel.swirling}
                  stirring={stirring}
                  temperature={liveTemp}
                  pour={vessel.pour}
                  glow={vessel.glow}
                  shake={vessel.shake}
                />
              </div>
            </div>

            <div className="ls-hud absolute left-3 top-3 flex flex-col gap-2">
              <Readout label="Temp" value={liveTemp} decimals={1} unit="°C" />
              <Readout label="pH" value={ph} decimals={2} unit="" />
              <Readout label="Volume" value={vessel.levelMl} decimals={1} unit="mL" />
            </div>

            {busy && panel.kind === "resolving" && (
              <motion.div
                className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-accent-cyan/40 bg-bg-base/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-accent-cyan backdrop-blur"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <motion.span
                  className="h-2 w-2 rounded-full bg-accent-cyan"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                />
                Safety engine validating
              </motion.div>
            )}

            {vessel.frozen && panel.kind === "result" && (
              <motion.div
                className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-lg border border-state-warning/50 bg-state-warning/15 px-4 py-2 font-heading text-[13px] font-semibold uppercase tracking-[0.18em] text-state-warning backdrop-blur"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                Simulation not available
              </motion.div>
            )}

            <div className="pointer-events-none absolute inset-x-0 top-[16%] flex justify-center">
              <Ribbon show={ribbon !== null} text={ribbon?.text ?? ""} sub={ribbon?.sub ?? ""} />
            </div>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <SafetyShield show={shield} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
              <FloatingNote text={note} />
            </div>
          </div>

          <BenchControls
            tray={tray}
            maxItems={MAX_TRAY}
            capacityMl={cat?.conditions.vesselCapacityMl ?? 150}
            temperature={temperature}
            minT={cat?.conditions.minTemperatureC ?? 5}
            maxT={cat?.conditions.maxTemperatureC ?? 90}
            stirring={stirring}
            busy={busy}
            canMix={canMix && totalLiquid <= (cat?.conditions.vesselCapacityMl ?? 150) + 1}
            focusRef={focusRef}
            heaterGlow={heaterGlow}
            mixed={mixed}
            onAmount={(key, amount) =>
              setTray((t) => t.map((x) => (x.key === key ? { ...x, amount } : x)))
            }
            onRemove={(key) => setTray((t) => t.filter((x) => x.key !== key))}
            onTemperature={(v) => {
              setTemperature(v);
              setHeaterGlow(false);
            }}
            onStirring={setStirring}
            onMix={() => void runMix(tray, temperature)}
            onEmpty={empty}
          />
        </div>

        <div className="min-h-[420px] lg:min-h-0">
          <OutcomePanel
            state={panel}
            newDiscoveries={fresh}
            onOption={onOption}
            presets={presets}
          />
        </div>
      </main>

      <Vignette colour={vignette ?? "transparent"} show={vignette !== null} />
      <DiscoveryCard discovery={card?.d ?? null} equation={card?.eq ?? null} onDone={nextCard} />
      <AutoAdvance cardId={card?.d.id ?? null} onAdvance={nextCard} />
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
          addToTray(i);
          setInfo(null);
        }}
      />
    </div>
  );
}

function AutoAdvance({ cardId, onAdvance }: { cardId: string | null; onAdvance: () => void }) {
  useEffect(() => {
    if (!cardId) return;
    const id = window.setTimeout(onAdvance, 2600);
    return () => window.clearTimeout(id);
  }, [cardId, onAdvance]);
  return null;
}

function Readout({
  label,
  value,
  decimals,
  unit,
}: {
  label: string;
  value: number | null;
  decimals: number;
  unit: string;
}) {
  return (
    <div className="ls-hud-chip">
      <span className="text-[9.5px] uppercase tracking-[0.16em] text-white/45">{label}</span>
      <span className="text-[15px] text-white">
        {value === null ? (
          <span className="tabular text-white/35">—</span>
        ) : (
          <NumberTicker value={value} decimals={decimals} durationMs={500} />
        )}
        {unit && <span className="ml-1 text-[10px] text-white/45">{unit}</span>}
      </span>
    </div>
  );
}

function Header(props: {
  online: boolean | null;
  found: number;
  total: number;
  xp: number;
  muted: boolean;
  pulse: number;
  busy: boolean;
  onMute: () => void;
  onJournal: () => void;
  onInspire: () => void;
}) {
  const status =
    props.online === null
      ? { text: "Connecting", colour: "#94A3B8" }
      : props.online
        ? { text: "Safety engine online", colour: "#22C55E" }
        : { text: "Safety engine offline", colour: "#EF4444" };
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
          <defs>
            <linearGradient id="logo" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#22D3EE" />
              <stop offset="1" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <path
            d="M12 3h8v2h-1v8l8 13a3 3 0 0 1-2.6 4.5H7.6A3 3 0 0 1 5 26l8-13V5h-1z"
            fill="none"
            stroke="url(#logo)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M9 22h14l2 4H7z" fill="url(#logo)" opacity="0.8" />
        </svg>
        <div className="min-w-0">
          <div className="font-heading text-[17px] font-bold leading-none tracking-tight">
            LAB<span className="text-accent-cyan">scape</span>
          </div>
          <div className="mt-1 hidden items-center gap-2 text-[10.5px] uppercase tracking-[0.2em] text-white/45 sm:flex">
            Open playground
            <span className="rounded-full bg-subject-chemistry/15 px-2 py-0.5 text-subject-chemistry">
              Chemistry
            </span>
          </div>
        </div>
      </div>

      <div
        className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] md:flex"
        role="status"
      >
        <motion.span
          className="h-2 w-2 rounded-full"
          style={{ background: status.colour, boxShadow: `0 0 10px ${status.colour}` }}
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <span style={{ color: status.colour }}>{status.text}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex">
          <button
            className="ls-btn-ghost"
            onClick={props.onInspire}
            disabled={props.busy}
            title="Run a random experiment"
          >
            🎲 Inspire me
          </button>
        </span>
        <motion.button
          key={props.pulse}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 hover:bg-white/[0.08]"
          onClick={props.onJournal}
          animate={props.pulse ? { scale: [1, 1.15, 1] } : {}}
          transition={{ duration: 0.5 }}
          aria-label={`Discovery journal: ${props.found} of ${props.total} discovered`}
        >
          <ProgressRing value={props.found} total={props.total} size={30} />
          <span className="tabular text-[13px]">
            {props.found}
            <span className="text-white/40">/{props.total}</span>
          </span>
        </motion.button>
        <div className="tabular hidden rounded-full bg-state-success/10 px-3 py-1.5 text-[12px] font-semibold text-state-success sm:block">
          {props.xp} XP
        </div>
        <button
          className="ls-icon-btn"
          onClick={props.onMute}
          aria-label={props.muted ? "Unmute sounds" : "Mute sounds"}
          title={props.muted ? "Sound off" : "Sound on"}
        >
          {props.muted ? "🔇" : "🔊"}
        </button>
      </div>
    </header>
  );
}
