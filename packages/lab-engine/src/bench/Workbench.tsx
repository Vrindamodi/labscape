import { useMotion } from "@labscape/motion";
import { cx, Kbd } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { Droplet, Droplets, Eye, Flame, Glasses, Hand, Minus, MoveDown, Plus, RotateCw, Snowflake, ThermometerSun, Vibrate, Wind, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buretteRateMlPerS, DROP_ML, KINDS, pourRateMlPerS, type EquipmentKind } from "../engine/equipment";
import { reagent } from "../engine/reagents";
import { look, type Item } from "../engine/state";
import type { StepSpec } from "../protocol/types";
import { DockButton, DockSeparator, Glass, GhostButton, Kicker, PrimaryButton, Readout, Segmented, SquareButton, TiltGauge } from "../studio/Glass";
import { beginHandDrag, Bench3D, PourStream, type BenchFrame, type BenchLabel, type HandState, type MixKind, type PourAnim, type Quality } from "./Bench3D";
import { EXTRA_MASS_G, extraAccepts, extraEvents, extraVerbsFor, type ExtraVerbId } from "./extraVerbs";
import { labSound, LoopSound } from "./labSound";
import type { LabSession } from "./useLabSession";

export type WorkbenchProps = {
  session: LabSession;
  /** The step the evaluator expects next (drives rate bands, target hints and guidance glow). */
  step?: StepSpec | null;
  /** Called the moment a live check fails (e.g. pour rate above the band), within one frame. */
  onLiveWarning?: (text: string) => void;
  /** Read-only (demo, replay): no controls; a ghost hand shows each action. */
  readOnly?: boolean;
  /** Extra overlay content (captions). */
  overlay?: ReactNode;
  className?: string;
  /**
   * "studio": the playground look. Stir, swirl and shake toggle on and off (so you can stir while you
   * pour), the dock gains Heat and Ice bath, and dockExtra (Undo, Reset step) sits at its end.
   */
  chrome?: "classic" | "studio";
  /** Extra dock buttons (studio). */
  dockExtra?: ReactNode;
  /** Lets a shelf outside the bench pick things up, or start dragging them onto the bench. */
  control?: MutableRefObject<WorkbenchControl | null>;
  /** Called when the pour card opens or closes (its mode: pour, drops or pipette delivery). */
  onPourChange?: (mode: "pour" | "drop" | "pipette-out" | null) => void;
  /** Called when the item in hand (or selected) changes. */
  onHeldChange?: (id: string | null) => void;
  /** Camera framing (close-up on the items in use). */
  frame?: BenchFrame | null;
  /** The learner moved the camera themselves (the page stops auto-framing and offers "Re-centre"). */
  onUserCamera?: () => void;
  /**
   * Studio: where the in-hand card and the readouts go (a side panel), so nothing sits on top of
   * the 3D bench. Without it they render in the strip under the bench.
   */
  handSlot?: HTMLElement | null;
  /** Studio: a message for the strip under the bench that takes priority (e.g. a live warning). */
  stripMessage?: ReactNode;
  /** Studio: extra buttons at the right of the strip under the bench (e.g. Re-centre). */
  stripExtra?: ReactNode;
};

export type WorkbenchControl = {
  /** Pick this item up (or select it) as if it was clicked on the bench. */
  pickUp: (id: string) => void;
  /** Click an item as if on the bench: uses it as the target of what is in hand when it is one, else picks it up. */
  choose: (id: string) => void;
  /** Pick it up and start carrying it with the pointer: releasing it over a glowing vessel uses it. */
  dragFromShelf: (id: string) => void;
  putDown: () => void;
  /**
   * The easy way to do a transfer: pick up `from` if needed, use it on `to`, and for a pour start
   * pouring `amountMl` straight away (the pour card stays open to stop or change it).
   */
  transfer: (from: string, to: string, amountMl?: number) => void;
};

const MASS_G: Record<string, number> = { "mg-ribbon": 0.05, "iron-nail": 3 };

type Verb = "pour" | "drop" | "draw" | "deliver" | "dip" | "flame" | "mouth" | "collect" | "thermo" | "add-solid" | "place" | ExtraVerbId;

/** Items that give `it` somewhere to stand (a white tile, a rack, a tripod), other than where it is now. */
function standsFor(it: Item, items: Item[]): Item[] {
  const fits = KINDS[it.kind].fits as string[];
  return items.filter((p) => p.id !== it.id && p.socket !== "worn" && (KINDS[p.kind].provides ?? []).some((s) => s !== "clamp" && fits.includes(s)) && it.socket?.split(":")[1] !== p.id);
}

/**
 * What a learner picks up and what they then click for a step. Usually the step's `from` and
 * `to`; collecting a gas is done by holding the empty tube over the one that makes it, and a
 * vessel is stood on a tile by clicking the tile.
 */
export function stepHands(step: StepSpec | null | undefined, items: Record<string, Item>): { pick: string | null; target: string | null } {
  if (!step) return { pick: null, target: null };
  const from = step.from && items[step.from] ? step.from : null;
  const to = step.to && items[step.to] ? step.to : null;
  if (step.action === "timer.mark" || step.action.startsWith("mix.")) return { pick: null, target: null };
  if (step.action === "equipment.connect" && from && to && items[to]!.kind === "test_tube" && !(items[to]!.liquid?.volumeMl ?? 0)) return { pick: to, target: from };
  if (step.action === "equipment.place" && from && items[from]!.kind !== "goggles") {
    const stand = standsFor(items[from]!, Object.values(items))[0];
    return { pick: from, target: stand?.id ?? null };
  }
  return { pick: from, target: to };
}
type Speed = "drop" | "slow" | "steady" | "fast" | "custom";
const SPEED_RATE: Record<Exclude<Speed, "custom">, number> = { drop: 0.35, slow: 1.4, steady: 4, fast: 10 };
const SPEED_LABEL: Record<Speed, string> = { drop: "Dropwise", slow: "Slow pour", steady: "Steady pour", fast: "Fast pour", custom: "Your tilt" };
const MIXABLE: EquipmentKind[] = ["conical_flask_100", "beaker_100", "beaker_250", "test_tube", "boiling_tube"];
const POUR_VESSELS: EquipmentKind[] = ["conical_flask_100", "beaker_100", "beaker_250", "test_tube", "boiling_tube", "measuring_cylinder_10", "measuring_cylinder_50"];

/** Tilt (deg) that gives a pour rate, by bisection on the engine's own weir model. */
export function tiltForRate(kind: EquipmentKind, volumeMl: number, rate: number): number {
  let lo = 0, hi = 135;
  if (pourRateMlPerS(kind, volumeMl, hi) < rate) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (pourRateMlPerS(kind, volumeMl, mid) < rate) lo = mid;
    else hi = mid;
  }
  return hi;
}

type VerbDef = { id: Verb; label: string; icon: ReactNode; target: boolean; button?: string };

/** What an item can do when it is in the learner's hand. Empty: it is not something you pick up. */
function verbsFor(it: Item): VerbDef[] {
  const def = KINDS[it.kind];
  const v: VerbDef[] = [];
  if (it.kind === "reagent_bottle" || (def.pours && (it.liquid?.volumeMl ?? 0) > 0 && it.kind !== "dropper_bottle" && it.kind !== "wash_bottle" && it.kind !== "pipette_10")) v.push({ id: "pour", label: "Pour", icon: <MoveDown className="h-4 w-4" />, target: true });
  if (it.kind === "dropper_bottle" || it.kind === "wash_bottle") v.push({ id: "drop", label: "Add drops", icon: <Droplet className="h-4 w-4" />, target: true });
  if (it.kind === "pipette_10") {
    if ((it.liquid?.volumeMl ?? 0) > 0) v.push({ id: "deliver", label: "Deliver", icon: <MoveDown className="h-4 w-4" />, target: true });
    v.push({ id: "draw", label: "Draw up", icon: <Droplets className="h-4 w-4" />, target: true });
  }
  if (it.kind === "wire_loop") v.push({ id: "dip", label: "Dip", icon: <Droplet className="h-4 w-4" />, target: true }, { id: "flame", label: "Into flame", icon: <Flame className="h-4 w-4" />, target: false });
  if (it.kind === "splint") v.push({ id: "flame", label: "Light it", icon: <Flame className="h-4 w-4" />, target: false }, { id: "mouth", label: "To tube mouth", icon: <Zap className="h-4 w-4" />, target: true });
  if (it.kind === "test_tube" && !(it.liquid?.volumeMl ?? 0)) v.push({ id: "collect", label: "Hold over", icon: <MoveDown className="h-4 w-4 rotate-180" />, target: true });
  if (it.kind === "thermometer") v.push({ id: "thermo", label: "Put in", icon: <ThermometerSun className="h-4 w-4" />, target: true });
  if (it.kind === "watch_glass") v.push({ id: "add-solid", label: "Tip in", icon: <Hand className="h-4 w-4" />, target: true });
  return v;
}

function accepts(verb: Verb, it: Item, held?: Item | null): boolean {
  if (held && extraAccepts(verb, held, it)) return true;
  if (verb === "place") return !!held && standsFor(held, [it]).length > 0;
  switch (verb) {
    case "pour":
      return !!it.liquid && it.kind !== "reagent_bottle" && it.kind !== "dropper_bottle" && it.kind !== "pipette_10" && it.kind !== "wash_bottle";
    case "drop":
    case "deliver":
      return !!it.liquid && KINDS[it.kind].pours && it.kind !== "reagent_bottle";
    case "draw":
      return it.kind === "reagent_bottle" && (it.liquid?.volumeMl ?? 0) > 0;
    case "dip":
      return !!it.liquid && it.liquid.volumeMl > 0 && it.kind === "test_tube";
    case "mouth":
      return it.kind === "test_tube";
    case "collect":
      return it.kind === "test_tube" && (it.liquid?.volumeMl ?? 0) > 0;
    case "thermo":
      return !!it.liquid && it.liquid.volumeMl > 0;
    case "add-solid":
      return !!it.liquid && it.liquid.volumeMl > 0 && KINDS[it.kind].pours && it.kind !== "reagent_bottle";
    default:
      return false;
  }
}

function safeReagent(id: string | undefined) {
  if (!id) return null;
  try {
    return reagent(id);
  } catch {
    return null;
  }
}

const fmtMl = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(1));
/** "Sodium hydroxide 0.100 M" -> "sodium hydroxide 0.100 M". */
const lowerFirst = (s: string | undefined) => (s ? (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s) : undefined);

export function Workbench({ session, step, onLiveWarning, readOnly, overlay, className, chrome = "classic", dockExtra, control, onHeldChange, onPourChange, frame, onUserCamera, handSlot, stripMessage, stripExtra }: WorkbenchProps) {
  const studio = chrome === "studio";
  const { reduced } = useMotion();
  const { state, dispatch } = session;
  /** The item in hand (or inspected, for things you do not pick up such as a burner). */
  const [selected, setSelected] = useState<string | null>(null);
  const [verb, setVerb] = useState<Verb | null>(null);
  const [pourTarget, setPourTarget] = useState<{ from: string; to: string; mode: "pour" | "drop" | "pipette-out" } | null>(null);
  const [tilt, setTilt] = useState(0);
  const [speed, setSpeed] = useState<Speed>("steady");
  const [amount, setAmount] = useState<number | null>(null);
  const [pouring, setPouring] = useState(false);
  const [poured, setPoured] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [mix, setMix] = useState<MixKind | null>(null);
  const [lens, setLens] = useState<string | null>(null);
  /** "Show me" from the assistant: an item pulses as a target for a few seconds. */
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!state.items[id]) return;
      setShown(id);
      window.clearTimeout(t);
      t = window.setTimeout(() => setShown(null), 3500);
    };
    window.addEventListener("labscape:highlight", on);
    return () => {
      window.removeEventListener("labscape:highlight", on);
      window.clearTimeout(t);
    };
  }, [state.items]);
  const [quality, setQuality] = useState<Quality>(() => (((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? "lite" : "high"));
  const pourRef = useRef({ poured: 0, chunk: 0, peak: 0, chunkStart: 0, rate: 0, warned: false });
  const tiltRef = useRef(0);
  tiltRef.current = tilt;
  const pourLoop = useMemo(() => new LoopSound("pour"), []);
  const burnerLoop = useMemo(() => new LoopSound("burner"), []);
  const fizzLoop = useMemo(() => new LoopSound("fizz"), []);

  const items = useMemo(() => Object.values(state.items), [state.items]);
  const sel = selected ? state.items[selected] ?? null : null;
  const verbs = useMemo<VerbDef[]>(() => {
    if (!sel) return [];
    const all = Object.values(state.items);
    const v: VerbDef[] = [...verbsFor(sel), ...extraVerbsFor(sel, all)];
    if (standsFor(sel, all).length && sel.kind !== "burette_50" && sel.kind !== "thermometer") v.push({ id: "place", label: "Stand on", icon: <MoveDown className="h-4 w-4" />, target: true });
    return v;
  }, [sel, state.items]);
  const holding = !!sel && verbs.length > 0;
  const hands = stepHands(step, state.items);
  // Holding what the step needs: start on the verb that reaches the step's target (e.g. "Stand on" the tile).
  const stepVerb = holding && !readOnly && sel!.id === hands.pick && hands.target && state.items[hands.target] ? verbs.find((v) => v.target && accepts(v.id, state.items[hands.target!]!, sel)) : undefined;
  const activeVerb = holding ? verbs.find((v) => v.id === verb) ?? stepVerb ?? verbs[0]! : null;
  const flash = useCallback((text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus((s) => (s === text ? null : s)), 2600);
  }, []);

  const putDown = useCallback(() => {
    setPouring(false);
    setPourTarget(null);
    setSelected(null);
    setVerb(null);
    setAmount(null);
    setPoured(0);
  }, []);

  useEffect(() => onHeldChange?.(selected), [selected, onHeldChange]);
  useEffect(() => onPourChange?.(pourTarget?.mode ?? null), [pourTarget?.mode, onPourChange]);

  /* ---------------------------------------------------------------- targets and guidance */

  const choosing = holding && activeVerb?.target && !pourTarget;
  const targets = choosing ? items.filter((it) => it.id !== sel!.id && accepts(activeVerb!.id, it, sel)).map((i) => i.id) : pourTarget ? [pourTarget.to] : [];
  // Guidance: with nothing in hand, the step's source glows; once it is in hand, its destination does.
  const guide = !readOnly && step ? (!holding && hands.pick ? hands.pick : holding && hands.target && sel?.id === hands.pick && targets.includes(hands.target) ? hands.target : null) : null;
  const glow = [...targets, ...(guide && !targets.includes(guide) ? [guide] : []), ...(shown && !targets.includes(shown) ? [shown] : [])];
  // One glowing ring and one name tag for the next thing to click; the item in hand keeps its tag.
  const rings = [...(guide ? [guide] : pourTarget ? [pourTarget.to] : []), ...(shown && shown !== guide ? [shown] : [])];
  const labels: BenchLabel[] = readOnly
    ? []
    : [
        ...(sel ? [{ id: sel.id, tone: "held" as const }] : []),
        ...rings.filter((id) => id !== sel?.id).map((id) => ({ id, tone: id === guide ? ("guide" as const) : ("target" as const) })),
      ];
  /** Set by transfer(): start pouring this amount as soon as the pour card is ready. */
  const autoPour = useRef<number | null>(null);

  const complete = (v: Verb, from: string, to: string) => {
    const src = state.items[from];
    switch (v) {
      case "pour": {
        setPourTarget({ from, to, mode: "pour" });
        setTilt(0);
        setPoured(0);
        pourRef.current.poured = 0;
        // Pre-fill the amount the step asks for.
        const q = step && step.from === from && step.to === to ? step.quantity : undefined;
        const wanted = autoPour.current !== null && autoPour.current > 0 ? autoPour.current : null;
        setAmount(wanted ?? (q && q.unit === "mL" ? q.target : null));
        if (autoPour.current !== null) {
          autoPour.current = null;
          pourRef.current.poured = 0;
          window.setTimeout(() => setPouring(true), 450);
        }
        if (step?.technique && "maxRateMlPerS" in step.technique && step.technique.maxRateMlPerS !== undefined) {
          const band = step.technique.maxRateMlPerS;
          // The fastest preset that stays inside the band (with a margin: a hand is never perfectly steady).
          setSpeed(band >= SPEED_RATE.fast * 1.15 ? "fast" : band >= SPEED_RATE.steady * 1.15 ? "steady" : band >= SPEED_RATE.slow * 1.15 ? "slow" : "drop");
        }
        labSound.clink(0.5);
        break;
      }
      case "drop":
        setPourTarget({ from, to, mode: "drop" });
        break;
      case "draw":
        setLens(`pipette:${from}:${to}`);
        break;
      case "deliver":
        setPourTarget({ from, to, mode: "pipette-out" });
        break;
      case "dip":
        dispatch("equipment.connect", { from, to, port: "dip" });
        labSound.plink();
        break;
      case "mouth":
        dispatch("equipment.connect", { from, to, port: "mouth" });
        break;
      case "collect":
        dispatch("equipment.connect", { from: to, to: from, port: "collect" });
        putDown();
        break;
      case "thermo":
        dispatch("equipment.connect", { from, to, port: "in" });
        dispatch("equipment.place", { equipmentId: from, x: state.items[to]!.x, y: state.items[to]!.z, socket: `vessel:${to}` });
        putDown();
        break;
      case "add-solid": {
        const r = src?.reagentId ?? from;
        dispatch("solid.add", { from: r, to, massG: MASS_G[r] ?? EXTRA_MASS_G[r] ?? 0.1 });
        labSound.plink();
        putDown();
        break;
      }
      case "flame":
        break;
      case "place": {
        const stand = state.items[to]!;
        const kind = (KINDS[stand.kind].provides ?? []).find((x) => (KINDS[state.items[from]!.kind].fits as string[]).includes(x)) ?? "bench";
        dispatch("equipment.place", { equipmentId: from, x: stand.x, y: stand.z, socket: kind + ":" + to });
        labSound.clink(0.5);
        putDown();
        break;
      }
      default:
        // Part 5 verbs (heat, litmus, water bath, filter): plain events, then put the item down.
        if (src) for (const e of extraEvents(v, src, to)) dispatch(e.type as never, e.payload as never);
        putDown();
        break;
    }
  };

  /** Part 5 verbs with no target (blow out a splint, power on, waft). */
  const extraNow = () => {
    if (!sel || !activeVerb) return;
    for (const e of extraEvents(activeVerb.id as ExtraVerbId, sel)) dispatch(e.type as never, e.payload as never);
  };

  const onPick = (id: string) => {
    if (readOnly) return;
    if (choosing && targets.includes(id)) return complete(activeVerb!.id, sel!.id, id);
    if (pourTarget && id === pourTarget.to) return;
    if (id === selected) return putDown();
    setSelected(id);
    setVerb(null);
    setPourTarget(null);
    setPouring(false);
    labSound.clink(0.6);
  };

  const pickUp = (id: string) => {
    if (readOnly || !state.items[id]) return;
    setSelected(id);
    setVerb(null);
    setPourTarget(null);
    setPouring(false);
    labSound.clink(0.6);
  };
  if (control) {
    control.current = {
      pickUp,
      choose: onPick,
      dragFromShelf: (id) => {
        const it = state.items[id];
        if (readOnly || !it || it.socket === "worn") return;
        pickUp(id);
        if (verbsFor(it).some((v) => v.target)) beginHandDrag(it.x, it.z);
      },
      putDown,
      transfer: (from, to, amountMl) => {
        const it = state.items[from];
        if (readOnly || !it || !state.items[to]) return;
        const vs = [...verbsFor(it), ...extraVerbsFor(it, Object.values(state.items))];
        const v = vs.find((x) => x.target && accepts(x.id, state.items[to]!, it));
        if (!v) return pickUp(from);
        setSelected(from);
        setVerb(v.id);
        setPouring(false);
        if (v.id === "pour") autoPour.current = amountMl ?? -1;
        complete(v.id, from, to);
      },
    };
  }

  const onDropOnto = (held: string, target: string) => {
    if (readOnly || held !== selected || !activeVerb?.target) return;
    if (accepts(activeVerb.id, state.items[target]!, sel)) complete(activeVerb.id, held, target);
  };

  const flameIt = () => {
    const b = items.find((i) => i.kind === "bunsen");
    if (!b || !sel) return flash("There is no burner on this bench.");
    if (!b.gasOn) return flash("Light the burner first.");
    dispatch("equipment.connect", { from: sel.id, to: b.id, port: "flame" });
  };

  /* ---------------------------------------------------------------- pouring */

  const band = step?.technique && "maxRateMlPerS" in step.technique ? step.technique.maxRateMlPerS : undefined;
  const fromItem = pourTarget ? state.items[pourTarget.from] : null;
  const toItem = pourTarget ? state.items[pourTarget.to] ?? null : null;
  const available = fromItem?.liquid?.volumeMl ?? (fromItem?.kind === "reagent_bottle" ? 250 : 0);

  const flushPour = useCallback(
    (final: boolean) => {
      const p = pourRef.current;
      if (!pourTarget || p.chunk <= 0.0005) return;
      const now = performance.now();
      dispatch("liquid.pour", {
        from: pourTarget.from,
        to: pourTarget.to,
        volumeMl: Math.round(p.chunk * 1000) / 1000,
        tiltDegMax: Math.round(tiltRef.current),
        meanRateMlPerS: Math.round((p.chunk / Math.max(0.05, (now - p.chunkStart) / 1000)) * 100) / 100,
        peakRateMlPerS: Math.round(p.peak * 100) / 100,
        durationMs: Math.round(now - p.chunkStart),
      });
      p.poured += p.chunk;
      p.chunk = 0;
      p.chunkStart = now;
      setPoured(p.poured);
      if (final) p.peak = 0;
    },
    [dispatch, pourTarget],
  );

  useEffect(() => {
    if (!pouring || !pourTarget || pourTarget.mode !== "pour" || !fromItem) {
      pourLoop.set(0);
      if (!pouring && pourTarget?.mode === "pour") setTilt(0);
      return;
    }
    const p = pourRef.current;
    p.chunkStart = performance.now();
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const left = Math.max(0, (state.items[pourTarget.from]?.liquid?.volumeMl ?? 0) - p.chunk);
      // Presets hold the flow steady by tilting further as the vessel empties, like a careful hand.
      const t = speed === "custom" ? tiltRef.current : tiltForRate(fromItem.kind, left, SPEED_RATE[speed]);
      if (speed !== "custom") setTilt(t);
      const rate = pourRateMlPerS(fromItem.kind, left, t);
      p.rate = rate;
      p.peak = Math.max(p.peak, rate);
      let add = Math.min(left, rate * dt);
      if (amount !== null) add = Math.min(add, Math.max(0, amount - p.poured - p.chunk));
      p.chunk += add;
      const to = state.items[pourTarget.to];
      const fill = to?.liquid ? to.liquid.volumeMl / Math.max(1, KINDS[to.kind].capacityMl) : 0;
      pourLoop.set(Math.min(1, rate / 15), fill);
      if (band && rate > band && !p.warned) {
        p.warned = true;
        onLiveWarning?.(`Too fast: ${rate.toFixed(1)} mL/s. Keep it under ${band} mL/s.`);
      }
      if (rate <= (band ?? Infinity)) p.warned = false;
      if (amount !== null && p.poured + p.chunk >= amount - 1e-6) {
        flushPour(true);
        setPouring(false);
        flash(`Stopped at ${fmtMl(amount)} mL`);
        labSound.clink(0.4);
        return;
      }
      if (left <= 0.005) {
        flushPour(true);
        setPouring(false);
        flash("Empty");
        return;
      }
      if (now - p.chunkStart > 400) flushPour(false);
    }, 50);
    return () => {
      window.clearInterval(id);
      flushPour(true);
      pourLoop.set(0);
    };
  }, [pouring, pourTarget, fromItem, speed, amount, band, flushPour, onLiveWarning, pourLoop, state.items, flash]);

  /* dropper: one drop per tap, two per second while held */
  const dropOnce = useCallback(() => {
    if (!pourTarget) return;
    const src = state.items[pourTarget.from];
    if (!src?.liquid || src.liquid.volumeMl < DROP_ML * 0.5) return;
    dispatch("liquid.drop", { from: pourTarget.from, to: pourTarget.to, drops: 1, volumeMl: DROP_ML });
    labSound.plink();
  }, [dispatch, pourTarget, state.items]);
  useEffect(() => {
    if (!pouring || pourTarget?.mode !== "drop") return;
    const id = window.setInterval(dropOnce, 500);
    return () => window.clearInterval(id);
  }, [pouring, pourTarget, dropOnce]);

  /* burette: whatever sits under the tip receives the flow */
  const burettes = items.filter((i) => i.kind === "burette_50");
  const buretteState = burettes.map((b) => `${b.id}:${b.stopcock ?? 0}`).join("|");
  useEffect(() => {
    const open = burettes.filter((b) => (b.stopcock ?? 0) > 0 && (b.liquid?.volumeMl ?? 0) > 0);
    if (!open.length || readOnly) return;
    const acc: Record<string, number> = {};
    const id = window.setInterval(() => {
      for (const b of open) {
        const rate = buretteRateMlPerS(b.stopcock ?? 0, false) * session.speed;
        acc[b.id] = (acc[b.id] ?? 0) + rate * 0.25;
        if ((acc[b.id] ?? 0) >= DROP_ML) {
          const vol = Math.floor((acc[b.id] ?? 0) / DROP_ML) * DROP_ML;
          acc[b.id] = (acc[b.id] ?? 0) - vol;
          const under = underTip(b);
          dispatch("liquid.drop", { from: b.id, to: under?.id ?? "bench", drops: Math.round(vol / DROP_ML), volumeMl: Math.round(vol * 1000) / 1000 });
          if (vol <= 0.1) labSound.plink();
        }
      }
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buretteState, readOnly, session.speed]);

  const underTip = (b: Item) => items.find((i) => i.id !== b.id && i.liquid && KINDS[i.kind].pours && Math.hypot(i.x - b.x, i.z - b.z) < 45 && i.kind !== "reagent_bottle");

  /* ambient loops */
  useEffect(() => {
    const burning = items.find((i) => i.kind === "bunsen" && i.gasOn);
    burnerLoop.set(burning ? 0.7 : 0, burning?.airHoleOpen ? 0.9 : 0.2);
    const fizz = items.some((i) => i.metals.some((m) => m.symbol === "Mg" && m.mol > 1e-6));
    fizzLoop.set(fizz ? 0.8 : 0, 0.6);
  }, [items, burnerLoop, fizzLoop]);
  useEffect(() => () => [pourLoop, burnerLoop, fizzLoop].forEach((l) => l.stop()), [pourLoop, burnerLoop, fizzLoop]);

  const lastCue = useRef(0);
  useEffect(() => {
    for (const c of session.cues) {
      if (c.uid <= lastCue.current) continue;
      lastCue.current = c.uid;
      if (c.kind === "sound") {
        if (c.soundId === "squeaky-pop") labSound.pop();
        else if (c.soundId === "splash" || c.soundId === "spatter") labSound.splash();
        else if (c.soundId === "clink") labSound.clink();
      }
    }
  }, [session.cues]);

  /* ---------------------------------------------------------------- mixing (hold) */

  // The vessel the dock's Stir, Swirl, Shake and Ice bath act on: the pour target, else the vessel in
  // hand; in the studio also the step's destination or the last vessel something went into.
  const lastInto = useMemo(() => {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const p = session.events[i]!.payload as { to?: string; into?: string };
      const id = p.to ?? p.into;
      if (id && state.items[id] && MIXABLE.includes(state.items[id]!.kind)) return id;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.events.length, state.items]);
  const mixTarget = (() => {
    const has = (id: string | null | undefined) => {
      const it = id ? state.items[id] : null;
      return it?.liquid && it.liquid.volumeMl > 0 && MIXABLE.includes(it.kind) ? it : null;
    };
    const direct = pourTarget?.to ?? (sel && MIXABLE.includes(sel.kind) ? sel.id : null);
    if (direct || !studio) return has(direct);
    return has(step?.to) ?? has(lastInto);
  })();
  const canMix = (k: MixKind) => !!mixTarget && (k === "shake" ? mixTarget.kind === "test_tube" || mixTarget.kind === "boiling_tube" : k === "stir" ? (mixTarget.kind === "beaker_100" || mixTarget.kind === "beaker_250") && items.some((i) => i.kind === "glass_rod") : mixTarget.kind !== "test_tube" && mixTarget.kind !== "boiling_tube");
  const mixRef = useRef<{ kind: MixKind; start: number; target: string } | null>(null);
  const startMix = (kind: MixKind) => {
    if (!canMix(kind) || !mixTarget) return;
    mixRef.current = { kind, start: performance.now(), target: mixTarget.id };
    setMix(kind);
  };
  /* studio: mixing toggles on and off; while on, a short mix event goes in every 0.8 s so the
     evaluator sees continuous stirring during a pour. */
  const [mixOn, setMixOn] = useState<{ kind: MixKind; target: string } | null>(null);
  const toggleMix = (kind: MixKind) => {
    if (mixOn?.kind === kind) return setMixOn(null);
    if (!canMix(kind) || !mixTarget) return;
    setMixOn({ kind, target: mixTarget.id });
    labSound.clink(0.3);
  };
  const mixOnLive = mixOn && state.items[mixOn.target]?.liquid?.volumeMl ? mixOn : null;
  useEffect(() => {
    if (!mixOnLive || readOnly) return;
    const { kind, target } = mixOnLive;
    const send = () => {
      const ms = Math.round(800 * session.speed);
      if (kind === "swirl") dispatch("mix.swirl", { target, durationMs: ms });
      else if (kind === "stir") dispatch("mix.stir", { target, intensity: "gentle", durationMs: ms });
      else dispatch("mix.shake", { target, durationMs: ms });
    };
    const first = window.setTimeout(send, 250);
    const id = window.setInterval(send, 800);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixOnLive?.kind, mixOnLive?.target, readOnly, session.speed]);
  // An undo or reset that empties the vessel switches the mixer off.
  useEffect(() => {
    if (mixOn && !mixOnLive) setMixOn(null);
  }, [mixOn, mixOnLive]);

  const endMix = () => {
    const m = mixRef.current;
    mixRef.current = null;
    setMix(null);
    if (!m) return;
    const ms = Math.round((performance.now() - m.start) * session.speed);
    if (ms < 150) return;
    if (m.kind === "swirl") dispatch("mix.swirl", { target: m.target, durationMs: ms });
    else if (m.kind === "stir") dispatch("mix.stir", { target: m.target, intensity: "gentle", durationMs: ms });
    else dispatch("mix.shake", { target: m.target, durationMs: ms });
  };

  /* ---------------------------------------------------------------- keyboard */

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        setLens(null);
        putDown();
      } else if (e.key === "Tab" && !e.ctrlKey) {
        e.preventDefault();
        const ids = choosing ? targets : items.filter((i) => i.socket !== "worn").map((i) => i.id);
        const cur = choosing ? cursorRef.current : selected;
        const i = cur ? ids.indexOf(cur) : -1;
        const next = ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length] ?? null;
        if (choosing) setCursor(next);
        else {
          setSelected(next);
          setVerb(null);
        }
      } else if (e.key === "Enter" && choosing && cursorRef.current) {
        e.preventDefault();
        complete(activeVerb!.id, sel!.id, cursorRef.current);
        setCursor(null);
      } else if (e.key === "[" || e.key === "]") {
        setSpeed("custom");
        setTilt((t) => Math.max(0, Math.min(135, t + (e.key === "]" ? 5 : -5))));
      }
      else if (e.key === " " && pourTarget && !e.repeat) {
        e.preventDefault();
        if (pourTarget.mode === "drop") dropOnce();
        setPouring(true);
      } else if ((e.key === "d" || e.key === "D") && pourTarget?.mode === "drop") dropOnce();
      else if (/^[0-5]$/.test(e.key) && sel?.kind === "burette_50") dispatch("param.set", { key: `stopcock:${sel.id}`, value: Number(e.key) / 5 });
      else if ((e.key === "w" || e.key === "W") && !e.repeat) {
        if (studio) toggleMix("swirl");
        else startMix("swirl");
      }
      else if ((e.key === "k" || e.key === "K") && !e.repeat) {
        if (studio) toggleMix("shake");
        else startMix("shake");
      }
      else if ((e.key === "s" || e.key === "S") && !e.repeat && studio) toggleMix("stir");
      else if ((e.key === "r" || e.key === "R") && sel && readable(sel)) setLens(`read:${sel.id}`);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") setPouring(false);
      if ("wWkK".includes(e.key) && !studio) endMix();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;

  /* ---------------------------------------------------------------- demo ghost hand */

  // In demos and replays each recorded action is shown being done: the source lifts, travels to
  // its target and tilts, so the learner sees the motion instead of liquid teleporting.
  const [ghost, setGhost] = useState<{ from: string; to: string | null; tilt: number } | null>(null);
  const lastSeq = useRef(0);
  const ghostTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(ghostTimer.current), []);
  const evs = session.events;
  useEffect(() => {
    if (!readOnly || !evs.length) return;
    const e = evs[evs.length - 1]!;
    if (e.seq <= lastSeq.current) {
      lastSeq.current = e.seq;
      return;
    }
    lastSeq.current = e.seq;
    const p = e.payload as { from?: string; to?: string; equipmentId?: string; durationMs?: number };
    // A clamped burette does not move: its drips show the flow.
    if (p.from && state.items[p.from]?.kind === "burette_50") return;
    if ((e.type === "liquid.pour" || e.type === "liquid.drop") && p.from && p.to && state.items[p.from] && state.items[p.to] && p.from !== p.to) {
      setGhost({ from: p.from, to: p.to, tilt: e.type === "liquid.pour" ? 75 : 20 });
    } else if ((e.type === "equipment.connect" || e.type === "solid.add") && p.from && state.items[p.from]) {
      setGhost({ from: p.from, to: p.to && state.items[p.to] ? p.to : null, tilt: 0 });
    } else return;
    // Long pours stay on screen for (part of) their recorded duration so the stream is seen.
    const ms = reduced ? 400 : Math.max(1400, Math.min(3500, (p.durationMs ?? 0) / Math.max(0.25, session.speed)));
    window.clearTimeout(ghostTimer.current);
    ghostTimer.current = window.setTimeout(() => setGhost(null), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, evs.length]);

  /* ---------------------------------------------------------------- pour pad (drag to tilt) */

  const pad = useRef<{ y: number; tilt: number; moved: boolean } | null>(null);
  const onPadDown = (e: ReactPointerEvent) => {
    if (!pourTarget) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pourTarget.mode === "drop") {
      dropOnce();
      setPouring(true);
      return;
    }
    if (pourTarget.mode === "pipette-out") {
      const v = state.items[pourTarget.from]?.liquid?.volumeMl ?? 0;
      dispatch("liquid.drop", { from: pourTarget.from, to: pourTarget.to, drops: 1, volumeMl: Math.round(v * 1000) / 1000 });
      putDown();
      return;
    }
    pad.current = { y: e.clientY, tilt: speed === "custom" ? tilt : fromItem ? tiltForRate(fromItem.kind, available, SPEED_RATE[speed]) : 60, moved: false };
    setPouring(true);
  };
  const onPadMove = (e: ReactPointerEvent) => {
    const p = pad.current;
    if (!p || pourTarget?.mode !== "pour") return;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.abs(dy) < 6) return;
    p.moved = true;
    setSpeed("custom");
    setTilt(Math.max(0, Math.min(135, p.tilt + dy * 0.45)));
  };
  const onPadUp = () => {
    pad.current = null;
    setPouring(false);
  };

  /* ---------------------------------------------------------------- render */

  const liveRate = pouring && pourTarget?.mode === "pour" ? pourRef.current.rate : 0;
  const hand: HandState = readOnly
    ? ghost
      ? { id: ghost.from, over: ghost.to, tiltDeg: ghost.tilt }
      : null
    : holding
      ? { id: sel!.id, over: pourTarget?.to ?? null, tiltDeg: pourTarget?.mode === "pour" ? tilt : pourTarget?.mode === "drop" ? 25 : 0 }
      : null;
  const pourAnim: PourAnim = readOnly
    ? ghost && ghost.to && ghost.tilt > 30
      ? { from: ghost.from, to: ghost.to, tiltDeg: ghost.tilt, rateMlPerS: 4 }
      : null
    : pourTarget && pourTarget.mode === "pour"
      ? { from: pourTarget.from, to: pourTarget.to, tiltDeg: tilt, rateMlPerS: liveRate }
      : null;
  const focus = toItem ?? (sel?.liquid ? sel : null);
  const focusLook = focus ? look(focus) : null;
  const burner = items.find((i) => i.kind === "bunsen");
  const goggles = items.find((i) => i.kind === "goggles" && i.socket !== "worn");
  const rateTone = band === undefined ? "#39d6ff" : liveRate <= band ? "#3de8a8" : liveRate <= band * 1.25 ? "#ffc23d" : "#ff5b6b";

  const readouts = focus && focusLook && (focus.liquid?.volumeMl ?? 0) > 0 && (
    <div className="flex gap-2">
      <Readout label={`${focus.label} · volume`} value={fmtMl(focusLook.volumeMl)} unit="mL" />
      <Readout label="Temperature" value={focusLook.tempC.toFixed(1)} unit="°" delta={Math.abs(focusLook.tempC - 22) >= 0.3 ? `${focusLook.tempC > 22 ? "▲" : "▼"} ${Math.abs(focusLook.tempC - 22).toFixed(1)}` : null} tone={focusLook.tempC > 22 ? "up" : "down"} />
    </div>
  );

  const handCard =
    !readOnly && sel ? (
      <Glass className="p-3" role="region" aria-label={`Tools for ${sel.label}`}>
        {pourTarget ? (
          <PourCard
            from={sel}
            to={toItem}
            mode={pourTarget.mode}
            tilt={tilt}
            rate={liveRate}
            rateTone={rateTone}
            band={band}
            speed={speed}
            setSpeed={setSpeed}
            amount={amount}
            setAmount={setAmount}
            stepAmount={step && step.from === pourTarget.from && step.to === pourTarget.to && step.quantity?.unit === "mL" ? step.quantity.target : null}
            poured={poured}
            available={available}
            pouring={pouring}
            onAuto={() => {
              if (pourTarget.mode === "drop") return dropOnce();
              if (pourTarget.mode === "pipette-out") {
                const v = state.items[pourTarget.from]?.liquid?.volumeMl ?? 0;
                dispatch("liquid.drop", { from: pourTarget.from, to: pourTarget.to, drops: 1, volumeMl: Math.round(v * 1000) / 1000 });
                putDown();
                return;
              }
              if (speed === "custom") setSpeed("steady");
              pourRef.current.poured = 0;
              setPoured(0);
              setPouring(true);
            }}
            onStop={() => setPouring(false)}
            onDropwise={() => {
              setSpeed("drop");
              setPouring(true);
            }}
            onChange={() => {
              setPouring(false);
              setPourTarget(null);
            }}
            onPutDown={putDown}
          />
        ) : (
          <HandCard
            item={sel}
            verbs={verbs}
            active={activeVerb}
            setVerb={setVerb}
            targetsCount={targets.length}
            onFlame={flameIt}
            onExtra={extraNow}
            onPutDown={putDown}
            onGoggles={() => {
              dispatch("equipment.place", { equipmentId: sel.id, x: 0, y: 0, socket: "worn" });
              labSound.clink(0.4);
              putDown();
            }}
            onGas={() => dispatch("heat.set", { target: sel.id, powerPct: sel.gasOn ? 0 : 100 })}
            onAirhole={() => dispatch("param.set", { key: `airhole:${sel.id}`, value: !sel.airHoleOpen })}
            onStopcock={(v) => dispatch("param.set", { key: `stopcock:${sel.id}`, value: v })}
            onRead={() => setLens(`read:${sel.id}`)}
          />
        )}
      </Glass>
    ) : null;

  // One short line under the bench (studio): what is happening or what to do next.
  const stripText: ReactNode = status ? (
    <span className="text-[#3de8a8]">{status}</span>
  ) : stripMessage ? (
    stripMessage
  ) : readOnly ? null : pourTarget?.mode === "pour" && pouring ? (
    <>
      <MoveDown className="h-4 w-4 text-[#39d6ff]" /> Pouring… {fmtMl(poured)} mL so far
    </>
  ) : pourTarget?.mode === "pour" ? (
    <>
      <MoveDown className="h-4 w-4 text-[#39d6ff]" /> Press <b className="mx-1 text-white">Pour</b> in the panel (or press and hold on the bench)
    </>
  ) : pourTarget ? (
    <>
      <Droplet className="h-4 w-4 text-[#39d6ff]" /> {pourTarget.mode === "drop" ? "Press Add one drop, or tap the bench" : "Press Let it drain"}
    </>
  ) : choosing ? (
    <>
      <span className="h-2 w-2 rounded-full bg-[#39d6ff] motion-safe:animate-pulse" />
      {guide ? `Now click the ${lowerFirst(state.items[guide]?.label) ?? "glowing vessel"}` : `Click where it goes (or drag it there)`}
    </>
  ) : !sel ? (
    <>
      <Hand className="h-4 w-4 text-[#39d6ff]" />
      {guide ? `Pick up the ${lowerFirst(state.items[guide]?.label) ?? "glowing item"}` : "Click a bottle or vessel to pick it up"}
    </>
  ) : null;

  const bench = (
    <>
      <Bench3D
        state={state}
        cues={session.cues}
        selected={choosing && cursor ? cursor : selected}
        targets={glow}
        rings={readOnly ? [] : rings}
        labels={labels}
        onPick={onPick}
        onBackground={() => !choosing && !pourTarget && putDown()}
        onPlace={(id, x, z, socket) => dispatch("equipment.place", { equipmentId: id, x, y: z, ...(socket ? { socket } : {}) })}
        draggable={(id) => !readOnly && !holding && !!state.items[id] && POUR_VESSELS.includes(state.items[id]!.kind) && verbsFor(state.items[id]!).length === 0}
        hand={hand}
        onDropOnto={onDropOnto}
        mixing={mixOnLive ? { id: mixOnLive.target, kind: mixOnLive.kind } : mix && mixTarget ? { id: mixTarget.id, kind: mix } : null}
        frame={frame ?? null}
        {...(onUserCamera ? { onUserCamera } : {})}
        pour={pourAnim}
        quality={quality}
        onQuality={setQuality}
        reducedMotion={reduced}
      >
        <PourStream state={state} pour={pourAnim} />
      </Bench3D>

      {/* drag-to-tilt pad over the bench while pouring (optional: the panel has a Pour button) */}
      {!readOnly && pourTarget && (
        <div
          className={cx("absolute inset-0 z-[5]", pourTarget.mode === "pour" ? "cursor-ns-resize" : "cursor-pointer")}
          onPointerDown={onPadDown}
          onPointerMove={onPadMove}
          onPointerUp={onPadUp}
          onPointerCancel={onPadUp}
          onWheel={(e) => {
            if (pourTarget.mode !== "pour") return;
            setSpeed("custom");
            setTilt((t) => Math.max(0, Math.min(135, t + (e.deltaY > 0 ? 3 : -3))));
          }}
          role="slider"
          aria-label={pourTarget.mode === "pour" ? "Pour: press and hold to pour, drag down to tilt further" : "Press to add a drop"}
          aria-valuenow={Math.round(tilt)}
          aria-valuemin={0}
          aria-valuemax={135}
          tabIndex={-1}
        />
      )}

      {overlay}

      <AnimatePresence>
        {lens && (
          <ReadingLens
            spec={lens}
            items={state.items}
            onCancel={() => setLens(null)}
            onRead={(instrument, value, trueValue, unit) => {
              dispatch("measure.read", { instrument, reading: { key: instrument, value, unit }, trueValue });
              setLens(null);
            }}
            onDraw={(from, into, volumeMl) => {
              dispatch("liquid.draw", { from, into, volumeMl });
              setLens(null);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );

  if (studio) {
    return (
      <div className={cx("flex h-full w-full flex-col gap-2 font-sans", className)} aria-label="Lab bench">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[#0b1530]">{bench}</div>

        {/* status strip: one line, never on top of the bench */}
        {!readOnly && (
          <div className="flex min-h-[38px] items-center gap-2 px-1">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 truncate text-center text-[14px] font-semibold text-[#dbe7ff]" role="status" aria-live="polite">
              {stripText}
            </div>
            {stripExtra}
          </div>
        )}

        {/* the in-hand card and readouts: in the side panel when the page gives a slot */}
        {!readOnly && (readouts || handCard) && (handSlot ? createPortal(<div className="space-y-2">{readouts}{handCard}</div>, handSlot) : <div className="max-h-[40%] space-y-2 overflow-y-auto">{readouts}{handCard}</div>)}

        {/* tool dock */}
        {!readOnly && (
          <div className="flex justify-center">
            <div className="max-w-full overflow-x-auto rounded-[22px] [scrollbar-width:none]">
              <Glass radius="xl" className="flex w-max items-center gap-0.5 p-1.5 sm:gap-1" role="toolbar" aria-label="Bench tools">
                {(["stir", "swirl", "shake"] as const)
                  .filter((k) => k !== "shake" || mixOn?.kind === "shake" || mixTarget?.kind === "test_tube" || mixTarget?.kind === "boiling_tube")
                  .map((k) => {
                    const on = mixOn?.kind === k;
                    const name = k[0]!.toUpperCase() + k.slice(1);
                    const why = mixTarget ? (k === "stir" ? "Stir needs a beaker and a glass rod on the bench" : k === "swirl" ? "Swirl a flask or beaker" : "Shake a test tube") : "Put some liquid in a vessel first";
                    return (
                      <DockButton
                        key={k}
                        icon={k === "shake" ? <Vibrate /> : k === "stir" ? <RotateCw /> : <Wind />}
                        label={on ? "Stop" : name}
                        kbd={k === "swirl" ? "W" : k === "shake" ? "K" : "S"}
                        tone={on ? "on" : "default"}
                        disabled={!on && !canMix(k)}
                        aria-pressed={on}
                        title={on ? `Stop ${k}ing` : canMix(k) && mixTarget ? `${name} the ${mixTarget.label.toLowerCase()} (click again to stop)` : why}
                        onClick={() => toggleMix(k)}
                      />
                    );
                  })}
                <DockSeparator />
                <DockButton
                  icon={<Flame />}
                  label={burner?.gasOn ? "Heat off" : "Heat"}
                  tone={burner?.gasOn ? "hot" : burner && guide === burner.id ? "on" : "default"}
                  disabled={!burner}
                  title={burner ? (burner.gasOn ? "Turn the Bunsen burner off" : "Light the Bunsen burner") : "No heating in this experiment"}
                  onClick={() => burner && dispatch("heat.set", { target: burner.id, powerPct: burner.gasOn ? 0 : 100 })}
                />
                {burner?.gasOn && <DockButton icon={<Wind />} label={burner.airHoleOpen ? "Air open" : "Air shut"} tone={burner.airHoleOpen ? "on" : "default"} onClick={() => dispatch("param.set", { key: `airhole:${burner.id}`, value: !burner.airHoleOpen })} />}
                <DockButton
                  icon={<Snowflake />}
                  label="Ice bath"
                  tone={mixTarget?.inIceBath ? "on" : "default"}
                  disabled={!mixTarget}
                  aria-pressed={!!mixTarget?.inIceBath}
                  title={mixTarget ? (mixTarget.inIceBath ? `Take the ${mixTarget.label.toLowerCase()} out of the ice` : `Stand the ${mixTarget.label.toLowerCase()} in ice to cool it`) : "Put some liquid in a vessel first"}
                  onClick={() => mixTarget && dispatch("cool.set", { target: mixTarget.id, method: mixTarget.inIceBath ? "air" : "ice_bath" })}
                />
                {(goggles || items.some(readable)) && <DockSeparator />}
                {goggles && (
                  <DockButton
                    icon={<Glasses />}
                    label="Goggles"
                    tone={guide === goggles.id ? "on" : "default"}
                    onClick={() => {
                      dispatch("equipment.place", { equipmentId: goggles.id, x: 0, y: 0, socket: "worn" });
                      labSound.clink(0.4);
                    }}
                  />
                )}
                {items.some(readable) && (
                  <DockButton icon={<Eye />} label="Read" kbd="R" disabled={!sel || !readable(sel)} title={sel && readable(sel) ? `Read the ${sel.label.toLowerCase()}` : "Pick up a thermometer, burette or cylinder to read it"} onClick={() => sel && setLens(`read:${sel.id}`)} />
                )}
                {dockExtra && <DockSeparator />}
                {dockExtra}
              </Glass>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cx("relative h-full w-full overflow-hidden rounded-xl bg-[#0b1530] font-sans", className)} aria-label="Lab bench">
      {bench}

      {/* anchored readouts for the vessel being worked on */}
      {readouts && <div className="pointer-events-none absolute left-3 top-3 z-[6]">{readouts}</div>}

      {/* the card beside the thing in hand */}
      <AnimatePresence>
        {handCard && sel && (
          <motion.div key={sel.id} initial={reduced ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.18 }} className="absolute right-3 top-3 z-10 max-h-[calc(100%-96px)] w-[min(272px,calc(100%-24px))] overflow-y-auto rounded-[18px] [scrollbar-width:thin]">
            {handCard}
          </motion.div>
        )}
      </AnimatePresence>

      {!readOnly && stripText && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[6] w-max max-w-[calc(100%-24px)] -translate-x-1/2">
          <Glass radius="md" className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-[#dbe7ff]">
            {stripText}
          </Glass>
        </div>
      )}

      {!readOnly && (
        <div className="absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2 overflow-x-auto">
          <Glass radius="xl" className="flex items-center gap-1 p-2" role="toolbar" aria-label="Bench tools">
            {(["swirl", "stir", "shake"] as const).map((k) => (
              <DockButton
                key={k}
                icon={k === "shake" ? <Vibrate /> : <RotateCw />}
                label={k[0]!.toUpperCase() + k.slice(1)}
                kbd={k === "swirl" ? "W" : k === "shake" ? "K" : undefined}
                tone={mix === k ? "on" : "default"}
                disabled={!canMix(k)}
                title={canMix(k) ? `Hold to ${k}` : `Pick up a ${k === "shake" ? "test tube" : k === "stir" ? "beaker (with a glass rod on the bench)" : "flask or beaker"} with liquid to ${k}`}
                onPointerDown={() => startMix(k)}
                onPointerUp={endMix}
                onPointerLeave={() => mix === k && endMix()}
              />
            ))}
            <DockSeparator />
            {burner && (
              <DockButton icon={<Flame />} label={burner.gasOn ? "Gas off" : "Light"} tone={burner.gasOn ? "hot" : "default"} onClick={() => dispatch("heat.set", { target: burner.id, powerPct: burner.gasOn ? 0 : 100 })} />
            )}
            {burner?.gasOn && <DockButton icon={<Wind />} label={burner.airHoleOpen ? "Air: open" : "Air: shut"} tone={burner.airHoleOpen ? "on" : "default"} onClick={() => dispatch("param.set", { key: `airhole:${burner.id}`, value: !burner.airHoleOpen })} />}
            {goggles && (
              <DockButton
                icon={<Glasses />}
                label="Goggles"
                tone={guide === goggles.id ? "on" : "default"}
                onClick={() => {
                  dispatch("equipment.place", { equipmentId: goggles.id, x: 0, y: 0, socket: "worn" });
                  labSound.clink(0.4);
                }}
              />
            )}
            <DockButton icon={<Eye />} label="Read" kbd="R" disabled={!sel || !readable(sel)} onClick={() => sel && setLens(`read:${sel.id}`)} />
            <DockSeparator />
            <DockButton icon={<X />} label="Put down" disabled={!sel} onClick={putDown} />
          </Glass>
        </div>
      )}
    </div>
  );
}

function readable(it: Item) {
  return it.kind === "burette_50" || it.kind === "thermometer" || it.kind === "measuring_cylinder_10" || it.kind === "measuring_cylinder_50";
}

/* ------------------------------------------------------------------ cards */

function ItemHeader({ item, sub }: { item: Item; sub?: string }) {
  const r = safeReagent(item.reagentId);
  const l = look(item);
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 h-[14px] w-[14px] shrink-0 rounded-[4px] ring-1 ring-white/20" style={{ background: r?.hex ?? (l ? undefined : "#334155") }} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-heading text-[16px] font-bold">{sub ?? item.label}</div>
        <div className="text-[13px] text-[#a9bde4]">
          {r ? `${r.formula} · ` : ""}
          {item.liquid ? `${fmtMl(item.liquid.volumeMl)} mL` : KINDS[item.kind].label}
        </div>
        {r && r.hazards.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {r.hazards.map((h) => (
              <span key={h} className="rounded-md bg-[rgba(255,91,107,.14)] px-1.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-[#ff9b9b] ring-1 ring-inset ring-[rgba(255,91,107,.35)]">
                {h}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HandCard(p: {
  item: Item;
  verbs: VerbDef[];
  active: VerbDef | null;
  setVerb: (v: Verb) => void;
  targetsCount: number;
  onFlame: () => void;
  onExtra?: () => void;
  onPutDown: () => void;
  onGoggles: () => void;
  onGas: () => void;
  onAirhole: () => void;
  onStopcock: (v: number) => void;
  onRead: () => void;
}) {
  const it = p.item;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Kicker>{p.verbs.length ? "In your hand" : "Selected"}</Kicker>
        <button onClick={p.onPutDown} className="text-[13px] font-semibold text-[#8fa6d1] hover:text-white">
          {p.verbs.length ? "Put down" : "Close"}
        </button>
      </div>
      <ItemHeader item={it} />
      {p.verbs.length > 1 && (
        <Segmented value={p.active!.id} label="What to do with it" size="sm" options={p.verbs.map((v) => ({ id: v.id, label: v.label }))} onChange={p.setVerb} />
      )}
      {p.active && p.active.target && (
        <p className="text-[14px] leading-snug text-[#c8d6f3]">
          {p.targetsCount ? (
            <>
              <b className="text-white">Drag it</b> onto a glowing {p.active.id === "draw" ? "bottle" : "vessel"} (or click one).
            </>
          ) : (
            "Nothing on the bench can take this right now."
          )}
        </p>
      )}
      {p.active && !p.active.target && p.active.button && p.onExtra && (
        <PrimaryButton className="w-full" onClick={p.onExtra}>
          {p.active.icon} {p.active.button}
        </PrimaryButton>
      )}
      {p.active?.id === "flame" && (
        <PrimaryButton className="w-full" onClick={p.onFlame}>
          <Flame className="h-4 w-4" /> Hold it in the flame
        </PrimaryButton>
      )}
      {it.kind === "goggles" && (
        <PrimaryButton className="w-full" onClick={p.onGoggles}>
          <Glasses className="h-4 w-4" /> Put on goggles
        </PrimaryButton>
      )}
      {it.kind === "bunsen" && (
        <div className="grid grid-cols-2 gap-2">
          <GhostButton onClick={p.onGas}>
            <Flame className="h-4 w-4" /> {it.gasOn ? "Gas off" : "Light it"}
          </GhostButton>
          <GhostButton onClick={p.onAirhole}>
            <Wind className="h-4 w-4" /> Air {it.airHoleOpen ? "shut" : "open"}
          </GhostButton>
        </div>
      )}
      {it.kind === "burette_50" && (
        <label className="block">
          <span className="flex justify-between text-[13px] text-[#a9bde4]">
            <span>
              Stopcock <Kbd>0</Kbd>–<Kbd>5</Kbd>
            </span>
            <span className="tabular-nums">
              {Math.round((it.stopcock ?? 0) * 100)}% · {buretteRateMlPerS(it.stopcock ?? 0, false).toFixed(2)} mL/s
            </span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={it.stopcock ?? 0} onChange={(e) => p.onStopcock(Number(e.target.value))} className="mt-1.5 w-full accent-[#3d8bff]" aria-label="Stopcock opening" />
        </label>
      )}
      {readable(it) && (
        <GhostButton className="w-full" onClick={p.onRead}>
          <Eye className="h-4 w-4" /> Read the scale <Kbd>R</Kbd>
        </GhostButton>
      )}
    </div>
  );
}

function PourCard(p: {
  from: Item;
  to: Item | null;
  mode: "pour" | "drop" | "pipette-out";
  tilt: number;
  rate: number;
  rateTone: string;
  band: number | undefined;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  amount: number | null;
  setAmount: (v: number | null) => void;
  /** The amount the current step asks for (offered as the first chip). */
  stepAmount?: number | null;
  poured: number;
  available: number;
  pouring: boolean;
  onAuto: () => void;
  onStop: () => void;
  onDropwise: () => void;
  onChange: () => void;
  onPutDown: () => void;
}) {
  const r = safeReagent(p.from.reagentId);
  const cap = p.to ? KINDS[p.to.kind].capacityMl - (p.to.liquid?.volumeMl ?? 0) : 0;
  const max = Math.max(0, Math.min(p.available, cap));
  const step = max <= 12 ? 0.5 : 1;
  const amt = p.amount;
  const verbing = p.mode === "drop" ? "Adding drops" : p.mode === "pipette-out" ? "Delivering" : "Pouring";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="h-[14px] w-[14px] shrink-0 rounded-[4px]" style={{ background: r?.hex ?? "#ffd23f" }} />
        <b className="min-w-0 flex-1 truncate font-heading text-[16px]">
          {verbing} {r?.formula ?? p.from.label}
        </b>
        <button onClick={p.onChange} className="text-[13px] font-semibold text-[#8fa6d1] hover:text-white">
          Change
        </button>
      </div>
      <div className="text-[14px] text-[#a9bde4]">
        into <b className="text-white">{p.to?.label}</b>
      </div>

      {p.mode === "pour" ? (
        <>
          <div className="flex items-center gap-3">
            <TiltGauge deg={p.tilt} max={135} />
            <div className="min-w-0">
              <Kicker>Flow</Kicker>
              <div className="font-heading text-[20px] font-bold tabular-nums">
                {p.rate.toFixed(1)} <span className="text-[13px] text-[#8fa6d1]">mL/s</span>
              </div>
              <div className="text-[13px] font-semibold" style={{ color: p.rateTone }}>
                {p.band !== undefined && p.rate > p.band ? "Too fast!" : p.pouring ? SPEED_LABEL[p.speed] : p.band !== undefined ? `Keep under ${p.band} mL/s` : "Ready"}
              </div>
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
          <div className="flex items-center gap-1.5">
            <SquareButton aria-label="Less" disabled={!amt} onClick={() => p.setAmount(amt ? Math.max(step, +(amt - step).toFixed(2)) : null)}>
              <Minus className="h-4 w-4" />
            </SquareButton>
            <div className="flex h-[38px] min-w-0 flex-1 items-center justify-between rounded-[11px] border border-[rgba(140,180,255,.2)] bg-[rgba(2,8,24,.65)] px-3">
              <b className="font-heading text-[17px] tabular-nums">{amt === null ? "—" : fmtMl(amt)}</b>
              <small className="text-[13px] text-[#8fa6d1]">{amt === null ? "no limit" : "mL target"}</small>
            </div>
            <SquareButton aria-label="More" disabled={max <= 0} onClick={() => p.setAmount(Math.min(max, +((amt ?? 0) + step).toFixed(2)))}>
              <Plus className="h-4 w-4" />
            </SquareButton>
          </div>
          <div className="flex gap-1">
            {[...new Set([...(p.stepAmount ? [p.stepAmount] : []), 1, 5, 10, 25, 50])]
              .filter((v) => v <= max + 1e-6)
              .slice(0, 5)
              .map((v) => (
                <button key={v} onClick={() => p.setAmount(amt === v ? null : v)} className={cx("h-[30px] flex-1 rounded-lg text-[13px] font-semibold tabular-nums", amt === v ? "bg-[rgba(61,139,255,.3)] text-white" : "bg-[rgba(120,160,255,.08)] text-[#a9bde4] hover:text-white", v === p.stepAmount && amt !== v && "ring-1 ring-inset ring-[#39d6ff]/60")}>
                  {v === p.stepAmount ? `${v} mL` : v}
                </button>
              ))}
          </div>
          {amt !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${fmtMl(p.poured)} of ${fmtMl(amt)} mL poured`}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#3de8a8,#39d6ff)] transition-[width] duration-100" style={{ width: `${Math.min(100, (p.poured / amt) * 100)}%` }} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {p.pouring ? (
              <PrimaryButton className="col-span-2" onClick={p.onStop}>
                Stop
              </PrimaryButton>
            ) : (
              <>
                <PrimaryButton onClick={p.onAuto} disabled={max <= 0}>
                  <MoveDown className="h-4 w-4" /> {amt === null ? "Pour" : `Pour ${fmtMl(amt)}`}
                </PrimaryButton>
                <GhostButton onClick={p.onDropwise} disabled={max <= 0}>
                  <Droplet className="h-4 w-4" /> Dropwise
                </GhostButton>
              </>
            )}
          </div>
        </>
      ) : (
        <PrimaryButton className="w-full" onClick={p.onAuto}>
          <Droplet className="h-4 w-4" /> {p.mode === "drop" ? "Add one drop" : "Let it drain"}
        </PrimaryButton>
      )}
      <GhostButton className="w-full" onClick={p.onPutDown}>
        <Hand className="h-4 w-4" /> Put down
      </GhostButton>
    </div>
  );
}

/* ------------------------------------------------------------------ reading lens */

function ReadingLens({
  spec,
  items,
  onCancel,
  onRead,
  onDraw,
}: {
  spec: string;
  items: Record<string, Item>;
  onCancel: () => void;
  onRead: (instrument: string, value: number, trueValue: number, unit: string) => void;
  onDraw: (from: string, into: string, volumeMl: number) => void;
}) {
  const [kind, a, b] = spec.split(":");
  const [eye, setEye] = useState(0.6);
  const [level, setLevel] = useState(10.6);
  const pipetteMode = kind === "pipette";
  const it = items[pipetteMode ? (a ?? "") : (a ?? "")];
  if (!it) return null;
  const isThermo = it.kind === "thermometer";
  const trueValue = pipetteMode ? level : isThermo ? (it.readingC ?? 22) : it.kind === "burette_50" ? 50 - (it.liquid?.volumeMl ?? 0) : it.liquid?.volumeMl ?? 0;
  const step = pipetteMode ? 0.05 : isThermo ? 1 : 0.05;
  // Reading from above or below eye level shifts the apparent value (parallax).
  const parallax = (eye - 0.5) * (isThermo ? 2 : 0.3) * (it.kind === "burette_50" ? -1 : 1);
  const shown = Math.round((trueValue + parallax) / step) * step;
  const unit = isThermo ? "°C" : "mL";
  const atEye = Math.abs(eye - 0.5) < 0.08;

  return (
    <motion.div className="absolute inset-0 z-20 grid place-items-center bg-[#03060f]/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} className="w-[min(380px,calc(100%-32px))] rounded-2xl border border-white/10 bg-[#101a33] p-5 shadow-2xl" role="dialog" aria-label="Reading lens">
        <div className="flex items-center justify-between">
          <div className="font-heading font-semibold">{pipetteMode ? "Release to the mark" : `Read the ${it.label.toLowerCase()}`}</div>
          <button onClick={onCancel} aria-label="Close" className="text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 flex gap-4">
          <div className="relative h-56 w-28 overflow-hidden rounded-full border-2 border-white/30 bg-[radial-gradient(circle_at_40%_35%,#1d2b52,#0b1328)] shadow-inner">
            {/* zoomed scale with the meniscus; the line shifts with eye height (parallax) */}
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="absolute left-3 right-3 flex items-center gap-2" style={{ top: `${8 + i * 11}%` }}>
                <div className={cx("h-px bg-white/70", i % 2 ? "w-4" : "w-8")} />
                {i % 2 === 0 && <span className="tabular text-[10px] text-white/70">{pipetteMode ? (i === 4 ? "mark" : "") : (Math.round((trueValue - step * (4 - i) * 2) / step) * step).toFixed(isThermo ? 0 : 2)}</span>}
              </div>
            ))}
            <div className="absolute inset-x-0 bottom-0 bg-[#7fb6ff]/40" style={{ top: `${44 + (pipetteMode ? (10 - level) * 60 : 0) + (eye - 0.5) * 18}%` }}>
              <div className="h-3 w-full rounded-b-[100%] border-b-2 border-[#cfe6ff]" />
            </div>
            <div className="absolute inset-x-0 h-px bg-accent-cyan shadow-[0_0_6px_#22d3ee]" style={{ top: `${44 + (eye - 0.5) * 30}%` }} aria-hidden />
          </div>
          <div className="flex-1 space-y-3">
            <label className="block text-xs text-white/60">
              Eye level
              <input type="range" min={0} max={1} step={0.01} value={eye} onChange={(e) => setEye(Number(e.target.value))} className="mt-1 w-full accent-[#22d3ee]" aria-label="Eye level" />
              <span className={atEye ? "text-state-success" : "text-state-warning"}>{atEye ? "At eye level ✓" : eye > 0.5 ? "Looking from above" : "Looking from below"}</span>
            </label>
            {pipetteMode && (
              <label className="block text-xs text-white/60">
                Release liquid
                <input type="range" min={9.7} max={10.8} step={0.01} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="mt-1 w-full accent-[#2f80ff]" aria-label="Pipette level" style={{ direction: "rtl" }} />
              </label>
            )}
            <div className="rounded-lg bg-black/30 p-3 text-center">
              <div className="text-xs text-white/50">{pipetteMode ? "Volume in the pipette" : "Your reading"}</div>
              <div className="tabular font-heading text-3xl font-bold">{(pipetteMode ? level : shown).toFixed(isThermo ? 0 : 2)}<span className="ml-1 text-base text-white/50">{unit}</span></div>
            </div>
            <button
              onClick={() => (pipetteMode ? onDraw(b ?? "", a ?? "", Math.round(level * 100) / 100) : onRead(it.id, Math.round(shown * 100) / 100, Math.round(trueValue * 100) / 100, unit))}
              className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-white shadow-[0_8px_24px_-8px_#2f80ff]"
            >
              {pipetteMode ? "Draw this volume" : "Record reading"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
export type { BenchFrame } from "./Bench3D";
