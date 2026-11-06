import { useMotion } from "@labscape/motion";
import { cx, Kbd } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { Droplet, Droplets, Eye, Flame, Glasses, Hand, MoveDown, RotateCw, ThermometerSun, Wind, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buretteRateMlPerS, DROP_ML, KINDS, pourRateMlPerS } from "../engine/equipment";
import { reagent } from "../engine/reagents";
import { look, type Item } from "../engine/state";
import type { StepSpec } from "../protocol/types";
import { Bench3D, PourStream, type PourAnim, type Quality } from "./Bench3D";
import { labSound, LoopSound } from "./labSound";
import type { LabSession } from "./useLabSession";

type Picking = { verb: string; from: string; accept: (it: Item) => boolean } | null;

export type WorkbenchProps = {
  session: LabSession;
  /** The step the evaluator expects next (drives rate bands and target hints). */
  step?: StepSpec | null;
  /** Called the moment a live check fails (e.g. pour rate above the band), within one frame. */
  onLiveWarning?: (text: string) => void;
  /** Read-only (demo): no controls. */
  readOnly?: boolean;
  /** Extra overlay content (captions, ghost hand). */
  overlay?: ReactNode;
  className?: string;
};

const MASS_G: Record<string, number> = { "mg-ribbon": 0.05, "iron-nail": 3 };

export function Workbench({ session, step, onLiveWarning, readOnly, overlay, className }: WorkbenchProps) {
  const { reduced } = useMotion();
  const { state, dispatch } = session;
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [pourTarget, setPourTarget] = useState<{ from: string; to: string; mode: "pour" | "drop" | "pipette-out" } | null>(null);
  const [tilt, setTilt] = useState(0);
  const [pouring, setPouring] = useState(false);
  const [lens, setLens] = useState<string | null>(null);
  /** Keyboard cursor while choosing a target (Tab moves it, Enter confirms). */
  const [cursor, setCursor] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>(() => ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4 ? "lite" : "high");
  const pourRef = useRef({ poured: 0, chunk: 0, peak: 0, start: 0, chunkStart: 0, rate: 0, warned: false });
  const pourLoop = useMemo(() => new LoopSound("pour"), []);
  const burnerLoop = useMemo(() => new LoopSound("burner"), []);
  const fizzLoop = useMemo(() => new LoopSound("fizz"), []);

  const items = useMemo(() => Object.values(state.items), [state.items]);
  const sel = selected ? state.items[selected] ?? null : null;

  /* ---------------------------------------------------------------- picking targets */

  const startPick = (verb: string, from: string, accept: (it: Item) => boolean) => {
    setPicking({ verb, from, accept });
    setCursor(null);
  };
  const targets = picking ? items.filter((it) => it.id !== picking.from && picking.accept(it)).map((i) => i.id) : pourTarget ? [pourTarget.to] : [];

  const onPick = (id: string) => {
    if (readOnly) return;
    if (picking) {
      const it = state.items[id];
      if (!it || !targets.includes(id)) return;
      const from = picking.from;
      const verb = picking.verb;
      setPicking(null);
      complete(verb, from, id);
      return;
    }
    setSelected((s) => (s === id ? null : id));
    setPourTarget(null);
    labSound.clink(0.6);
  };

  const complete = (verb: string, from: string, to: string) => {
    switch (verb) {
      case "pour":
        setPourTarget({ from, to, mode: "pour" });
        setTilt(0);
        break;
      case "drop":
        setPourTarget({ from, to, mode: "drop" });
        break;
      case "draw": {
        // Pipette: draw above the mark, then the lens lets you release to the mark.
        setLens(`pipette:${from}:${to}`);
        break;
      }
      case "deliver":
        setPourTarget({ from, to, mode: "pipette-out" });
        break;
      case "dip":
        dispatch("equipment.connect", { from, to, port: "dip" });
        break;
      case "mouth":
        dispatch("equipment.connect", { from, to, port: "mouth" });
        break;
      case "collect":
        dispatch("equipment.connect", { from: to, to: from, port: "collect" });
        break;
      case "thermo":
        dispatch("equipment.connect", { from, to, port: "in" });
        dispatch("equipment.place", { equipmentId: from, x: state.items[to]!.x, y: state.items[to]!.z, socket: `vessel:${to}` });
        break;
      case "add-solid": {
        const r = state.items[from]?.reagentId ?? from;
        dispatch("solid.add", { from: r, to, massG: MASS_G[r] ?? 0.1 });
        labSound.plink();
        break;
      }
    }
  };

  /* ---------------------------------------------------------------- pouring */

  const band = step?.technique && "maxRateMlPerS" in step.technique ? step.technique.maxRateMlPerS : undefined;
  const fromItem = pourTarget ? state.items[pourTarget.from] : null;
  const available = fromItem?.liquid?.volumeMl ?? 0;
  const liveRate = pourTarget?.mode === "pour" && fromItem ? pourRateMlPerS(fromItem.kind, Math.max(0, available - pourRef.current.chunk), tilt) : 0;

  const flushPour = useCallback(
    (final: boolean) => {
      const p = pourRef.current;
      if (!pourTarget || p.chunk <= 0.0005) return;
      const now = performance.now();
      dispatch("liquid.pour", {
        from: pourTarget.from,
        to: pourTarget.to,
        volumeMl: Math.round(p.chunk * 1000) / 1000,
        tiltDegMax: tilt,
        meanRateMlPerS: Math.round((p.chunk / Math.max(0.05, (now - p.chunkStart) / 1000)) * 100) / 100,
        peakRateMlPerS: Math.round(p.peak * 100) / 100,
        durationMs: Math.round(now - p.chunkStart),
      });
      p.poured += p.chunk;
      p.chunk = 0;
      p.chunkStart = now;
      if (final) p.peak = 0;
    },
    [dispatch, pourTarget, tilt],
  );

  useEffect(() => {
    if (!pouring || !pourTarget || pourTarget.mode !== "pour" || !fromItem) {
      pourLoop.set(0);
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
      const rate = pourRateMlPerS(fromItem.kind, left, tilt);
      p.rate = rate;
      p.peak = Math.max(p.peak, rate);
      p.chunk += Math.min(left, rate * dt);
      const to = state.items[pourTarget.to];
      const fill = to?.liquid ? to.liquid.volumeMl / Math.max(1, KINDS[to.kind].capacityMl) : 0;
      pourLoop.set(Math.min(1, rate / 15), fill);
      // Live rate check: flagged within one tick (< 250 ms) of crossing the band.
      if (band && rate > band && !p.warned) {
        p.warned = true;
        onLiveWarning?.(`Too fast: ${rate.toFixed(1)} mL/s. Keep it under ${band} mL/s.`);
      }
      if (rate <= (band ?? Infinity)) p.warned = false;
      if (now - p.chunkStart > 400) flushPour(false);
    }, 50);
    return () => {
      window.clearInterval(id);
      flushPour(true);
      pourLoop.set(0);
    };
  }, [pouring, pourTarget, fromItem, tilt, band, flushPour, onLiveWarning, pourLoop, state.items]);

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

  /* ambient loops: burner hiss/roar, fizzing */
  useEffect(() => {
    const burning = items.find((i) => i.kind === "bunsen" && i.gasOn);
    burnerLoop.set(burning ? 0.7 : 0, burning?.airHoleOpen ? 0.9 : 0.2);
    const fizz = items.some((i) => i.metals.some((m) => m.symbol === "Mg" && m.mol > 1e-6));
    fizzLoop.set(fizz ? 0.8 : 0, 0.6);
  }, [items, burnerLoop, fizzLoop]);
  useEffect(() => () => [pourLoop, burnerLoop, fizzLoop].forEach((l) => l.stop()), [pourLoop, burnerLoop, fizzLoop]);

  /* sounds for engine cues */
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

  /* ---------------------------------------------------------------- keyboard */

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        setPicking(null);
        setPourTarget(null);
        setLens(null);
      } else if (e.key === "Tab" && !e.ctrlKey) {
        e.preventDefault();
        const ids = picking ? targets : items.filter((i) => i.socket !== "worn").map((i) => i.id);
        const curId = picking ? cursor : selected;
        const i = curId ? ids.indexOf(curId) : -1;
        const next = ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length] ?? null;
        if (picking) setCursor(next);
        else setSelected(next);
      } else if (e.key === "Enter" && picking && cursor) {
        e.preventDefault();
        onPick(cursor);
        setCursor(null);
      } else if (e.key === "[") setTilt((t) => Math.max(0, t - 5));
      else if (e.key === "]") setTilt((t) => Math.min(120, t + 5));
      else if (e.key === " " && pourTarget && !e.repeat) {
        e.preventDefault();
        if (pourTarget.mode === "drop") dropOnce();
        setPouring(true);
      } else if ((e.key === "d" || e.key === "D") && pourTarget?.mode === "drop") dropOnce();
      else if (/^[0-5]$/.test(e.key) && sel?.kind === "burette_50") dispatch("param.set", { key: `stopcock:${sel.id}`, value: Number(e.key) / 5 });
      else if ((e.key === "w" || e.key === "W") && sel?.liquid && !e.repeat) startMix("swirl");
      else if ((e.key === "r" || e.key === "R") && sel && readable(sel)) setLens(`read:${sel.id}`);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") setPouring(false);
      if (e.key === "w" || e.key === "W") endMix();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  });

  /* ---------------------------------------------------------------- mixing (hold) */

  const mixRef = useRef<{ kind: "swirl" | "stir" | "shake"; start: number } | null>(null);
  const startMix = (kind: "swirl" | "stir" | "shake") => (mixRef.current = { kind, start: performance.now() });
  const endMix = () => {
    const m = mixRef.current;
    mixRef.current = null;
    if (!m || !sel) return;
    const ms = Math.round((performance.now() - m.start) * session.speed);
    if (ms < 150) return;
    if (m.kind === "swirl") dispatch("mix.swirl", { target: sel.id, durationMs: ms });
    else if (m.kind === "stir") dispatch("mix.stir", { target: sel.id, intensity: "gentle", durationMs: ms });
    else dispatch("mix.shake", { target: sel.id, durationMs: ms });
  };

  /* ---------------------------------------------------------------- render */

  const pourAnim: PourAnim =
    pourTarget && pourTarget.mode === "pour" ? { from: pourTarget.from, to: pourTarget.to, tiltDeg: tilt, rateMlPerS: pouring ? liveRate : 0 } : null;

  return (
    <div className={cx("relative h-full w-full overflow-hidden rounded-xl bg-[#0b1530]", className)} aria-label="Lab bench">
      <Bench3D
        state={state}
        cues={session.cues}
        selected={picking && cursor ? cursor : selected}
        targets={targets}
        onPick={onPick}
        onBackground={() => !picking && (setSelected(null), setPourTarget(null))}
        onPlace={(id, x, z, socket) => dispatch("equipment.place", { equipmentId: id, x, y: z, ...(socket ? { socket } : {}) })}
        draggable={(id) => !readOnly && !pourTarget && !!state.items[id] && ["conical_flask_100", "beaker_100", "beaker_250", "test_tube", "boiling_tube", "measuring_cylinder_10"].includes(state.items[id]!.kind)}
        pour={pourAnim}
        quality={quality}
        onQuality={setQuality}
        reducedMotion={reduced}
      >
        <PourStream state={state} pour={pourAnim} />
      </Bench3D>

      {overlay}

      {/* picking banner */}
      <AnimatePresence>
        {picking && (
          <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent-cyan/50 bg-[#0d1830]/95 px-4 py-2 text-sm shadow-xl backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-cyan" />
            {pickPrompt(picking.verb)} <span className="text-white/45">(click a glowing item, or <Kbd>Tab</Kbd> then <Kbd>Enter</Kbd>)</span>
            <button onClick={() => setPicking(null)} className="rounded-full p-1 text-white/50 hover:text-white" aria-label="Cancel"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* contextual tools beside the selection */}
      {!readOnly && sel && !picking && (
        <ToolPanel
          item={sel}
          items={items}
          pourTarget={pourTarget}
          tilt={tilt}
          setTilt={setTilt}
          liveRate={pouring ? pourRef.current.rate || liveRate : liveRate}
          band={band}
          onHoldStart={() => {
            if (pourTarget?.mode === "drop") dropOnce();
            if (pourTarget?.mode === "pipette-out") {
              const v = state.items[pourTarget.from]?.liquid?.volumeMl ?? 0;
              dispatch("liquid.drop", { from: pourTarget.from, to: pourTarget.to, drops: 1, volumeMl: Math.round(v * 1000) / 1000 });
              setPourTarget(null);
              return;
            }
            setPouring(true);
          }}
          onHoldEnd={() => setPouring(false)}
          pouring={pouring}
          act={(a) => {
            switch (a) {
              case "pour":
                startPick("pour", sel.id, (it) => !!it.liquid && it.kind !== "reagent_bottle" && it.kind !== "dropper_bottle" && it.kind !== "pipette_10");
                break;
              case "drop":
                startPick("drop", sel.id, (it) => !!it.liquid && KINDS[it.kind].pours && it.kind !== "reagent_bottle");
                break;
              case "draw":
                startPick("draw", sel.id, (it) => it.kind === "reagent_bottle" && (it.liquid?.volumeMl ?? 0) > 0);
                break;
              case "deliver":
                startPick("deliver", sel.id, (it) => !!it.liquid && KINDS[it.kind].pours && it.kind !== "reagent_bottle");
                break;
              case "dip":
                startPick("dip", sel.id, (it) => !!it.liquid && it.liquid.volumeMl > 0 && it.kind === "test_tube");
                break;
              case "flame": {
                const b = items.find((i) => i.kind === "bunsen");
                if (b) dispatch("equipment.connect", { from: sel.id, to: b.id, port: "flame" });
                break;
              }
              case "mouth":
                startPick("mouth", sel.id, (it) => it.kind === "test_tube");
                break;
              case "collect":
                startPick("collect", sel.id, (it) => it.kind === "test_tube" && (it.liquid?.volumeMl ?? 0) > 0);
                break;
              case "thermo":
                startPick("thermo", sel.id, (it) => !!it.liquid && it.liquid.volumeMl > 0);
                break;
              case "add-solid":
                startPick("add-solid", sel.id, (it) => !!it.liquid && it.liquid.volumeMl > 0 && KINDS[it.kind].pours && it.kind !== "reagent_bottle");
                break;
              case "goggles":
                dispatch("equipment.place", { equipmentId: sel.id, x: 0, y: 0, socket: "worn" });
                setSelected(null);
                break;
              case "airhole":
                dispatch("param.set", { key: `airhole:${sel.id}`, value: !sel.airHoleOpen });
                break;
              case "gas":
                dispatch("heat.set", { target: sel.id, powerPct: sel.gasOn ? 0 : 100 });
                break;
              case "read":
                setLens(`read:${sel.id}`);
                break;
              case "cancel":
                setPourTarget(null);
                break;
            }
          }}
          onMixStart={startMix}
          onMixEnd={endMix}
          onStopcock={(v) => dispatch("param.set", { key: `stopcock:${sel.id}`, value: v })}
        />
      )}

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

      <div className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-white/35">
        {quality === "lite" ? "Lite graphics" : "High graphics"} · drag to orbit · scroll to zoom
      </div>
    </div>
  );
}

function pickPrompt(verb: string) {
  return (
    {
      pour: "Pour into which vessel?",
      drop: "Add drops to which vessel?",
      draw: "Draw from which bottle?",
      deliver: "Deliver into which vessel?",
      dip: "Dip the loop into which tube?",
      mouth: "Hold the splint at which tube?",
      collect: "Hold this tube over which reaction tube?",
      thermo: "Put the thermometer in which vessel?",
      "add-solid": "Add it to which vessel?",
    }[verb] ?? "Choose a target"
  );
}

function readable(it: Item) {
  return it.kind === "burette_50" || it.kind === "thermometer" || it.kind === "measuring_cylinder_10" || it.kind === "measuring_cylinder_50";
}

/* ------------------------------------------------------------------ tool panel */

type Action = "pour" | "drop" | "draw" | "deliver" | "dip" | "flame" | "mouth" | "collect" | "thermo" | "add-solid" | "goggles" | "airhole" | "gas" | "read" | "cancel";

function ToolPanel(props: {
  item: Item;
  items: Item[];
  pourTarget: { from: string; to: string; mode: "pour" | "drop" | "pipette-out" } | null;
  tilt: number;
  setTilt: (t: number) => void;
  liveRate: number;
  band: number | undefined;
  pouring: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  act: (a: Action) => void;
  onMixStart: (k: "swirl" | "stir" | "shake") => void;
  onMixEnd: () => void;
  onStopcock: (v: number) => void;
}) {
  const { item: it, pourTarget } = props;
  const def = KINDS[it.kind];
  const r = it.reagentId ? (() => { try { return reagent(it.reagentId); } catch { return null; } })() : null;
  const l = look(it);
  const actions: { id: Action; label: string; icon: ReactNode; key?: string }[] = [];
  const mixes: { id: "swirl" | "stir" | "shake"; label: string; icon: ReactNode; key: string }[] = [];

  if (it.kind === "reagent_bottle" || ((def.pours && it.liquid && it.liquid.volumeMl > 0) && it.kind !== "dropper_bottle")) actions.push({ id: "pour", label: "Pour into…", icon: <MoveDown className="h-4 w-4" /> });
  if (it.kind === "dropper_bottle" || it.kind === "wash_bottle") actions.push({ id: "drop", label: "Add drops to…", icon: <Droplet className="h-4 w-4" />, key: "D" });
  if (it.kind === "pipette_10") {
    actions.push({ id: "draw", label: "Draw from…", icon: <Droplets className="h-4 w-4" /> });
    if ((it.liquid?.volumeMl ?? 0) > 0) actions.push({ id: "deliver", label: "Deliver into…", icon: <MoveDown className="h-4 w-4" /> });
  }
  if (it.kind === "wire_loop") actions.push({ id: "dip", label: "Dip into…", icon: <Droplet className="h-4 w-4" /> }, { id: "flame", label: "Hold in flame", icon: <Flame className="h-4 w-4" /> });
  if (it.kind === "splint") actions.push({ id: "flame", label: "Light in flame", icon: <Flame className="h-4 w-4" /> }, { id: "mouth", label: "Hold at tube mouth…", icon: <Zap className="h-4 w-4" /> });
  if (it.kind === "test_tube" && !(it.liquid?.volumeMl)) actions.push({ id: "collect", label: "Hold over…", icon: <MoveDown className="h-4 w-4 rotate-180" /> });
  if (it.kind === "thermometer") actions.push({ id: "thermo", label: "Put in…", icon: <ThermometerSun className="h-4 w-4" /> });
  if (it.kind === "watch_glass") actions.push({ id: "add-solid", label: "Add to…", icon: <Hand className="h-4 w-4" /> });
  if (it.kind === "goggles") actions.push({ id: "goggles", label: "Put on goggles", icon: <Glasses className="h-4 w-4" /> });
  if (it.kind === "bunsen") actions.push({ id: "airhole", label: it.airHoleOpen ? "Close air hole" : "Open air hole", icon: <Wind className="h-4 w-4" /> }, { id: "gas", label: it.gasOn ? "Turn gas off" : "Light burner", icon: <Flame className="h-4 w-4" />, key: "H" });
  if (readable(it)) actions.push({ id: "read", label: "Read", icon: <Eye className="h-4 w-4" />, key: "R" });
  if (it.liquid && (it.kind === "conical_flask_100" || it.kind === "beaker_100" || it.kind === "beaker_250")) mixes.push({ id: "swirl", label: "Swirl", icon: <RotateCw className="h-4 w-4" />, key: "W" });
  if (it.liquid && (it.kind === "beaker_100" || it.kind === "beaker_250") && props.items.some((i) => i.kind === "glass_rod")) mixes.push({ id: "stir", label: "Stir", icon: <RotateCw className="h-4 w-4" />, key: "S" });
  if (it.liquid && (it.kind === "test_tube" || it.kind === "boiling_tube")) mixes.push({ id: "shake", label: "Shake", icon: <RotateCw className="h-4 w-4" />, key: "K" });

  const target = pourTarget ? props.items.find((i) => i.id === pourTarget.to) : null;
  const rateColour = props.band === undefined ? "#22d3ee" : props.liveRate <= props.band ? "#22C55E" : props.liveRate <= props.band * 1.25 ? "#F59E0B" : "#EF4444";

  return (
    <motion.div
      key={it.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      className="absolute bottom-3 left-3 z-10 w-[min(330px,calc(100%-24px))] rounded-2xl border border-white/10 bg-[#0d1830]/92 p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl"
      role="region"
      aria-label={`Tools for ${it.label}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-white/15" style={{ background: r?.hex ?? "#1e293b" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{it.label}</div>
          <div className="text-xs text-white/50">
            {r ? `${r.formula} · ` : ""}
            {it.liquid ? `${(it.liquid.volumeMl).toFixed(it.liquid.volumeMl < 10 ? 2 : 1)} mL` : def.label}
            {l && it.liquid && it.liquid.volumeMl > 0 ? ` · ${l.tempC.toFixed(1)} °C` : ""}
          </div>
          {r && r.hazards.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.hazards.map((h) => (
                <span key={h} className="rounded border border-state-danger/40 bg-state-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff9b9b]">{h}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {pourTarget && pourTarget.from === it.id ? (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>{pourTarget.mode === "drop" ? "Dropping into" : pourTarget.mode === "pipette-out" ? "Delivering into" : "Pouring into"} <b className="text-white">{target?.label}</b></span>
            <button onClick={() => props.act("cancel")} className="text-white/50 hover:text-white">Change</button>
          </div>
          {pourTarget.mode === "pour" && (
            <>
              <label className="block">
                <span className="flex justify-between text-xs text-white/55"><span>Tilt <Kbd>[</Kbd> <Kbd>]</Kbd></span><span className="tabular">{props.tilt}°</span></span>
                <input type="range" min={0} max={120} value={props.tilt} onChange={(e) => props.setTilt(Number(e.target.value))} className="mt-1 w-full accent-[#2f80ff]" aria-label="Tilt angle" />
              </label>
              <div className="flex items-center gap-3">
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-label="Pour rate gauge">
                  {props.band !== undefined && <div className="absolute inset-y-0 bg-state-success/25" style={{ left: 0, width: `${Math.min(100, (props.band / 20) * 100)}%` }} />}
                  <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${Math.min(100, (props.liveRate / 20) * 100)}%`, background: rateColour }} />
                </div>
                <span className="tabular w-20 text-right text-xs font-semibold" style={{ color: rateColour }}>{props.liveRate.toFixed(1)} mL/s</span>
              </div>
            </>
          )}
          <button
            onPointerDown={props.onHoldStart}
            onPointerUp={props.onHoldEnd}
            onPointerLeave={props.onHoldEnd}
            className={cx("flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition", props.pouring ? "bg-accent text-white shadow-[0_0_24px_-4px_#2f80ff]" : "bg-white/[0.08] text-white hover:bg-white/[0.12]")}
          >
            {pourTarget.mode === "drop" ? <Droplet className="h-4 w-4" /> : <MoveDown className="h-4 w-4" />}
            {pourTarget.mode === "drop" ? "Tap for a drop · hold for more" : pourTarget.mode === "pipette-out" ? "Let it drain" : "Hold to pour"} <Kbd>Space</Kbd>
          </button>
        </div>
      ) : (
        <>
          {it.kind === "burette_50" && (
            <label className="mt-3 block">
              <span className="flex justify-between text-xs text-white/55"><span>Stopcock <Kbd>0</Kbd>–<Kbd>5</Kbd></span><span className="tabular">{Math.round((it.stopcock ?? 0) * 100)}% · {buretteRateMlPerS(it.stopcock ?? 0, false).toFixed(2)} mL/s</span></span>
              <input type="range" min={0} max={1} step={0.05} value={it.stopcock ?? 0} onChange={(e) => props.onStopcock(Number(e.target.value))} className="mt-1 w-full accent-[#2f80ff]" aria-label="Stopcock opening" />
            </label>
          )}
          {(actions.length > 0 || mixes.length > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {actions.map((a) => (
                <button key={a.id} onClick={() => props.act(a.id)} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2 text-left text-sm font-medium text-white/85 ring-1 ring-inset ring-white/10 transition hover:bg-accent/20 hover:text-white">
                  {a.icon}
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.key && <Kbd>{a.key}</Kbd>}
                </button>
              ))}
              {mixes.map((m) => (
                <button
                  key={m.id}
                  onPointerDown={() => props.onMixStart(m.id)}
                  onPointerUp={props.onMixEnd}
                  onPointerLeave={props.onMixEnd}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2 text-left text-sm font-medium text-white/85 ring-1 ring-inset ring-white/10 transition hover:bg-accent/20 hover:text-white active:bg-accent/40"
                >
                  {m.icon}
                  <span className="flex-1">Hold to {m.label.toLowerCase()}</span>
                  <Kbd>{m.key}</Kbd>
                </button>
              ))}
            </div>
          )}
          {["conical_flask_100", "beaker_100", "beaker_250", "test_tube", "boiling_tube"].includes(it.kind) && (
            <p className="mt-2 text-[11px] text-white/40">Drag it on the bench to move it. Supports like the white tile pull it in when close.</p>
          )}
        </>
      )}
    </motion.div>
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
