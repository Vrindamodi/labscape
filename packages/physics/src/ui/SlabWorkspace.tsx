import { Eye, Pencil, PlusSquare } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { rad } from "../core/runtime";
import { offEmergent, slabRay, type PinSet, type SlabSetup, type SlabState } from "../labs/refraction";
import { DragHandle, easeInOut, GhostHand, LabStyles, mix, PulseRect, Stage, Tag, toSvgPoint, useCommitLater, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { Btn, Panel, ReadingInput, Readout } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const PINS = ["P1", "P2", "P3", "P4"] as const;
type PinId = (typeof PINS)[number];
const ALIGN_MM = 0.8;
const K = 2;
const X = (x: number) => (x + 110) * K;
const Y = (y: number) => (y + 120) * K;
const W = 220 * K;
const H = 290 * K;
const TRAY = { x: 92, y: -108 }; // pin cushion in the paper's top-right corner (mm)
const half = (v: number) => Math.round(v * 2) / 2;

/**
 * Glass slab by the pin method. Click the paper to push in the next pin, then drag any pin to fine-
 * tune it: the sight-line strip and the pins themselves glow when P3 and P4 sit on the emergent ray.
 * After tracing, drag the protractor onto either face (it snaps) and swing its reading arm.
 */
export function SlabWorkspace({ session }: { session: SimSession<SlabState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as SlabSetup;
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1200);
  const stored: PinSet = s.sets[s.sets.length - 1]!.done ? { pins: {}, traced: false, angles: {}, done: false } : s.sets[s.sets.length - 1]!;

  /* ---------------------------------------------------------------- local pin drags + demo glide */
  const [moving, setMoving] = useState<{ id: PinId; x: number; y: number } | null>(null);
  const demoPlace = demo.next?.type === "equipment.place" ? (demo.next.payload as { equipmentId: PinId; x: number; y: number }) : null;
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const demoFrom = demoPlace ? (stored.pins[demoPlace.equipmentId] ?? TRAY) : null;
  const demoAt = demoPlace && demoFrom ? { x: mix(demoFrom.x, demoPlace.x, kk), y: mix(demoFrom.y, demoPlace.y, kk) } : null;
  const cur: PinSet = moving ? { ...stored, pins: { ...stored.pins, [moving.id]: { x: moving.x, y: moving.y } } } : demoPlace && demoAt && demo.k > 0.3 ? { ...stored, pins: { ...stored.pins, [demoPlace.equipmentId]: demoAt } } : stored;

  const nextPin = PINS.find((p) => !stored.pins[p]) ?? null;
  const [chosen, setChosen] = useState<PinId | null>(null);
  const active = chosen ?? nextPin;
  const [cursor, setCursor] = useState({ x: -40, y: -60 });
  const [hover, setHover] = useState<Pt | null>(null);
  const ray = slabRay(cur, setup);
  const svg = useRef<SVGSVGElement>(null);

  const place = (id: PinId, x: number, y: number) => {
    if (ro || stored.traced) return;
    session.dispatch("equipment.place", { equipmentId: id, x: half(x), y: half(y) });
  };
  const onPaper = (e: React.MouseEvent<SVGSVGElement>) => {
    if (ro || !active || stored.traced || moving) return;
    if ((e.target as Element).closest(".ls-handle")) return;
    const p = toSvgPoint(e.currentTarget, e.clientX, e.clientY);
    place(active, p.x / K - 110, p.y / K - 120);
    setChosen(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      setCursor((c) => ({ x: c.x + moves[e.key]![0], y: c.y + moves[e.key]![1] }));
    }
    if (e.key === "Enter" && active) {
      place(active, cursor.x, cursor.y);
      setChosen(null);
    }
  };
  const nudge = useCommitLater((m: { id: PinId; x: number; y: number }) => {
    place(m.id, m.x, m.y);
    setMoving(null);
  }, 450);

  const offOf = (p: PinId) => (ray && cur.pins[p] ? offEmergent(cur.pins[p]!, ray) : null);
  const sight = ray && cur.pins.P1 && cur.pins.P2 ? PINS.map((p) => ({ p, off: p === "P1" || p === "P2" ? 0 : cur.pins[p] ? signedOff(cur.pins[p]!, ray) : null })) : null;
  const aligned = !!sight && sight.every((x) => x.off !== null && Math.abs(x.off) <= ALIGN_MM);
  const done = s.sets.filter((x) => x.done);

  /* ---------------------------------------------------------------- protractor */
  const [prot, setProt] = useState<{ at: "entry" | "exit" | Pt; arm: number }>({ at: "entry", arm: 30 });
  const anchor = (a: "entry" | "exit") => (ray ? { x: X(a === "entry" ? ray.entry.x : ray.exit.x), y: Y(a === "entry" ? ray.entry.y : ray.exit.y) } : { x: W / 2, y: H / 2 });
  const protC = typeof prot.at === "string" ? anchor(prot.at) : prot.at;
  const snapped = typeof prot.at === "string";

  /* ---------------------------------------------------------------- guidance + demo hand */
  const placingTop = !stored.traced && (nextPin === "P1" || nextPin === "P2");
  const placingBottom = !stored.traced && (nextPin === "P3" || nextPin === "P4");
  const working = !ro && (focus === "set-1" || focus === "set-2" || focus === "set-3");
  const fixPins = working && !nextPin && !stored.traced && !aligned;
  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  if (demoPlace && demoFrom) {
    const p = demo.k > 0.3 && demoAt ? demoAt : demoFrom;
    hand = { x: X(p.x), y: Y(p.y) };
    pressing = demo.k > 0.25;
    follow = demo.k > 0.3;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_330px]">
      <LabStyles />
      <Stage className="min-h-[340px] !bg-[#0b1730] p-3" label={`Sheet ${done.length + 1} · ${stored.traced ? "traced: drag the protractor onto a face and read the angles" : active ? `click to push in ${active}${active === "P3" || active === "P4" ? " below the slab" : " above the slab"}, then drag to adjust` : aligned ? "all four pins line up" : "drag P3 and P4 until all four line up"}`}>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full cursor-crosshair select-none rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#39d6ff]"
          onClick={onPaper}
          onPointerMove={(e) => !ro && !stored.traced && active && setHover(toSvgPoint(e.currentTarget, e.clientX, e.clientY))}
          onPointerLeave={() => setHover(null)}
          tabIndex={ro ? -1 : 0}
          onKeyDown={onKey}
          role="application"
          aria-label={`Drawing paper with a glass slab. ${active && !stored.traced ? `Placing ${active}: click, or move the cross with the arrow keys and press Enter. Tab to a placed pin to nudge it with the arrow keys.` : ""}`}
        >
          <defs>
            <linearGradient id="sl-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="rgba(190,230,255,.55)" />
              <stop offset="0.5" stopColor="rgba(140,200,255,.35)" />
              <stop offset="1" stopColor="rgba(190,230,255,.5)" />
            </linearGradient>
            <filter id="sl-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.35" />
            </filter>
          </defs>
          <rect width={W} height={H} rx={10} fill="#f4f0e4" />
          {Array.from({ length: 23 }, (_, i) => (
            <line key={`v${i}`} x1={i * 10 * K} y1={0} x2={i * 10 * K} y2={H} stroke="rgba(30,60,120,.07)" />
          ))}
          {Array.from({ length: 30 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 10 * K} x2={W} y2={i * 10 * K} stroke="rgba(30,60,120,.07)" />
          ))}
          {/* where the next pin goes */}
          {working && placingTop && <PulseRect x={X(-100)} y={Y(-112)} w={200 * K} h={100 * K} />}
          {working && placingBottom && <PulseRect x={X(-100)} y={Y(setup.thicknessMm + 12)} w={200 * K} h={(155 - setup.thicknessMm) * K} />}
          {/* slab */}
          <rect x={X(-setup.widthMm / 2)} y={Y(0)} width={setup.widthMm * K} height={setup.thicknessMm * K} rx={stored.traced ? 0 : 3} fill={stored.traced ? "none" : "url(#sl-glass)"} stroke="#2b5d8a" strokeWidth={stored.traced ? 1.2 : 2} filter={stored.traced ? undefined : "url(#sl-shadow)"} />
          {!stored.traced && <line x1={X(-setup.widthMm / 2) + 6} y1={Y(0) + 4} x2={X(setup.widthMm / 2) - 30} y2={Y(0) + 4} stroke="rgba(255,255,255,.7)" strokeWidth={2} strokeLinecap="round" />}
          {/* incident line through P1 and P2 (what you would rule in) */}
          {!stored.traced && ray && cur.pins.P1 && <line x1={X(cur.pins.P1.x)} y1={Y(cur.pins.P1.y)} x2={X(ray.entry.x)} y2={Y(ray.entry.y)} stroke="#1c7ed6" strokeOpacity={0.35} strokeDasharray="6 5" />}
          {stored.traced && ray && (
            <g>
              {[ray.entry, ray.exit].map((p, i) => (
                <line key={i} x1={X(p.x)} y1={Y(p.y) - 70} x2={X(p.x)} y2={Y(p.y) + 70} stroke="#495057" strokeDasharray="5 4" strokeWidth={1} />
              ))}
              <line x1={X(cur.pins.P1!.x)} y1={Y(cur.pins.P1!.y)} x2={X(ray.entry.x)} y2={Y(ray.entry.y)} stroke="#1c7ed6" strokeWidth={1.6} />
              <line x1={X(ray.entry.x)} y1={Y(ray.entry.y)} x2={X(ray.exit.x)} y2={Y(ray.exit.y)} stroke="#1c7ed6" strokeWidth={1.6} />
              {cur.pins.P4 && <line x1={X(ray.exit.x)} y1={Y(ray.exit.y)} x2={X(cur.pins.P4.x)} y2={Y(cur.pins.P4.y)} stroke="#1c7ed6" strokeWidth={1.6} />}
              <line x1={X(ray.entry.x)} y1={Y(ray.entry.y)} x2={X(ray.entry.x + ray.dir.x * 140)} y2={Y(ray.entry.y + ray.dir.y * 140)} stroke="#868e96" strokeDasharray="3 4" strokeWidth={1} />
            </g>
          )}
          {/* pin cushion */}
          {!stored.traced && (
            <g pointerEvents="none">
              <ellipse cx={X(TRAY.x)} cy={Y(TRAY.y)} rx={16} ry={9} fill="#c92a2a" opacity={0.9} />
              <ellipse cx={X(TRAY.x)} cy={Y(TRAY.y) - 2} rx={12} ry={5} fill="#e35d5d" />
              <text x={X(TRAY.x)} y={Y(TRAY.y) + 24} fontSize={9} textAnchor="middle" fill="#7a5050">
                pins
              </text>
            </g>
          )}
          {/* pins (drag to adjust) */}
          {PINS.map((p) => {
            const pin = cur.pins[p];
            if (!pin) return null;
            const off = p === "P3" || p === "P4" ? offOf(p) : null;
            const good = off !== null && off <= ALIGN_MM;
            const isMoving = moving?.id === p;
            const colour = good ? "#0ca678" : "#c92a2a";
            return (
              <DragHandle
                key={p}
                label={`Pin ${p}. Drag, or use the arrow keys, to move it.`}
                valueText={`${p} at ${pin.x.toFixed(1)}, ${pin.y.toFixed(1)} millimetres${off !== null ? `, ${off.toFixed(1)} millimetres off the emergent ray` : ""}`}
                disabled={ro || stored.traced}
                ring={{ cx: X(pin.x), cy: Y(pin.y), r: 8 }}
                pulse={fixPins && (p === "P3" || p === "P4") && !good}
                onDrag={(pt) => setMoving({ id: p, x: half(pt.x / K - 110), y: half(pt.y / K - 120) })}
                onDragEnd={(_pt, moved) => {
                  if (moved && moving) place(moving.id, moving.x, moving.y);
                  setMoving(null);
                }}
                onActivate={() => setChosen(p)}
                onKey={(key, shift) => {
                  const st = shift ? 5 : 0.5;
                  const base = moving?.id === p ? moving : { id: p, ...pin };
                  const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
                  if (!d[key]) return false;
                  const m = { id: p, x: base.x + d[key]![0], y: base.y + d[key]![1] };
                  setMoving(m);
                  nudge(m);
                  return true;
                }}
              >
                <circle cx={X(pin.x)} cy={Y(pin.y)} r={14} fill="transparent" />
                {good && <circle className="ls-snap" cx={X(pin.x)} cy={Y(pin.y)} r={10} fill="rgba(12,166,120,.18)" stroke="#0ca678" />}
                <ellipse cx={X(pin.x) + 2} cy={Y(pin.y) + 3} rx={5} ry={2.5} fill="rgba(0,0,0,.18)" />
                <circle cx={X(pin.x)} cy={Y(pin.y) - (isMoving ? 3 : 0)} r={isMoving ? 6 : 4.5} fill={colour} stroke="#fff" strokeWidth={1.4} />
                <text x={X(pin.x) + 9} y={Y(pin.y) - 8} fontSize={11} fontWeight={800} fill={colour}>
                  {p}
                </text>
              </DragHandle>
            );
          })}
          {/* next-pin ghost under the mouse, and the keyboard cross */}
          {!ro && active && !stored.traced && !moving && hover && (
            <g pointerEvents="none" opacity={0.55}>
              <circle cx={hover.x} cy={hover.y} r={4.5} fill="#c92a2a" />
              <text x={hover.x + 9} y={hover.y - 8} fontSize={11} fontWeight={800} fill="#c92a2a">
                {active}
              </text>
            </g>
          )}
          {!ro && active && !stored.traced && !hover && (
            <g pointerEvents="none">
              <line x1={X(cursor.x) - 8} y1={Y(cursor.y)} x2={X(cursor.x) + 8} y2={Y(cursor.y)} stroke="#1971c2" />
              <line x1={X(cursor.x)} y1={Y(cursor.y) - 8} x2={X(cursor.x)} y2={Y(cursor.y) + 8} stroke="#1971c2" />
            </g>
          )}
          {/* protractor: drag onto a face (it snaps), swing the arm to read */}
          {stored.traced && ray && (
            <Protractor
              c={protC}
              arm={prot.arm}
              snapped={snapped}
              pulse={!ro && focus !== null && focus !== "result" && Object.keys(stored.angles).length < 3}
              disabled={ro}
              onMove={(p) => {
                const near = (["entry", "exit"] as const).find((a) => Math.hypot(anchor(a).x - p.x, anchor(a).y - p.y) < 26);
                setProt((o) => ({ ...o, at: near ?? p }));
              }}
              onArm={(a) => setProt((o) => ({ ...o, arm: a }))}
              onSnap={(a) => setProt((o) => ({ ...o, at: a }))}
            />
          )}
          {fixPins && !moving && <Tag x={W / 2} y={H - 18} text="Drag P3 and P4 until they turn green" />}
          <GhostHand at={hand} pressing={pressing} follow={follow} />
        </svg>
      </Stage>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Pins" right={<span className="text-[11px] text-[#8fa6d1]">choose one to move it</span>}>
          <div className="grid grid-cols-4 gap-1.5">
            {PINS.map((p) => (
              <button key={p} type="button" onClick={() => setChosen(p)} disabled={ro || stored.traced} aria-pressed={active === p} className="ls-chip justify-center font-mono">
                {p}
                {stored.pins[p] && <span className="h-1.5 w-1.5 rounded-full" style={{ background: (p === "P3" || p === "P4") && (offOf(p) ?? 9) <= ALIGN_MM ? V3.mint : (p === "P1" || p === "P2") ? V3.blue : V3.red }} />}
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Looking through the slab" right={<Eye className="h-4 w-4 text-[#8fa6d1]" />} glow={!ro && !!sight && !aligned && working}>
          {sight ? (
            <>
              <svg viewBox="0 0 280 70" className="w-full rounded-[12px] bg-[#dfe7ef]" role="img" aria-label={aligned ? "All four pins are in line" : "The pins are not yet in line"}>
                <line x1={140} y1={4} x2={140} y2={66} stroke={aligned ? "#0ca678" : "rgba(0,0,0,.15)"} strokeDasharray="3 3" />
                {sight.map(({ p, off }, i) =>
                  off === null ? null : (
                    <g key={p} style={{ transition: "transform .12s" }} transform={`translate(${Math.max(-130, Math.min(130, off * 14))} 0)`}>
                      <rect x={140 - (p === "P1" || p === "P2" ? 3 : 2)} y={8} width={p === "P1" || p === "P2" ? 6 : 4} height={54} rx={1} fill={p === "P1" || p === "P2" ? "rgba(201,42,42,.45)" : Math.abs(off) <= ALIGN_MM ? "#0ca678" : "#c92a2a"} />
                      <text x={145} y={14 + i * 12} fontSize={9} fill="#333">
                        {p === "P1" || p === "P2" ? `${p} (image)` : p}
                      </text>
                    </g>
                  ),
                )}
              </svg>
              <p className={`mt-1.5 text-xs ${aligned ? "text-[#3de8a8]" : "text-[#8fa6d1]"}`}>{aligned ? "All four pins line up." : "Drag P3 and P4 until they hide the images of P1 and P2."}</p>
            </>
          ) : (
            <p className="text-xs text-[#8fa6d1]">Place P1 and P2 above the slab first.</p>
          )}
          <Btn tone="primary" className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "trace", value: true })} disabled={ro || stored.traced || !stored.pins.P3 || !stored.pins.P4}>
            <Pencil className="h-4 w-4" /> Remove the slab and trace
          </Btn>
        </Panel>
        <Panel title="Measure from the normals" glow={!ro && stored.traced && Object.keys(stored.angles).length < 3}>
          <div className="mb-2 flex gap-1.5">
            {(["entry", "exit"] as const).map((a) => (
              <button key={a} type="button" className="ls-chip flex-1 justify-center" aria-pressed={prot.at === a} onClick={() => setProt((o) => ({ ...o, at: a }))} disabled={!stored.traced}>
                Protractor at {a === "entry" ? "top" : "bottom"} face
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(["i", "r", "e"] as const).map((k2) => (
              <ReadingInput key={k2} label={k2 === "i" ? "Angle of incidence i" : k2 === "r" ? "Angle of refraction r" : "Angle of emergence e"} unit="°" onRecord={(v) => session.dispatch("measure.read", { instrument: "protractor", reading: { key: k2, value: v, unit: "deg" } })} value={stored.angles[k2] ?? null} disabled={ro || !stored.traced} width="w-20" />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Readout label="i" value={stored.angles.i ?? "–"} unit={stored.angles.i !== undefined ? "°" : ""} />
            <Readout label="r" value={stored.angles.r ?? "–"} unit={stored.angles.r !== undefined ? "°" : ""} />
            <Readout label="e" value={stored.angles.e ?? "–"} unit={stored.angles.e !== undefined ? "°" : ""} />
          </div>
          {!stored.done && stored.traced && (
            <Btn className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "new-sheet", value: true })} disabled={ro}>
              <PlusSquare className="h-4 w-4" /> Start this sheet again
            </Btn>
          )}
        </Panel>
        <Panel title={`Sheets (${done.length}/3)`} glow={!ro && focus === "result"}>
          {done.length ? (
            <table className="w-full text-xs">
              <thead className="text-[#8fa6d1]">
                <tr>
                  <th className="text-left font-semibold">i</th>
                  <th className="text-right font-semibold">r</th>
                  <th className="text-right font-semibold">e</th>
                  <th className="text-right font-semibold">sin i / sin r</th>
                </tr>
              </thead>
              <tbody className="font-mono text-white/85">
                {done.map((x, j) => (
                  <tr key={j}>
                    <td>{x.angles.i}°</td>
                    <td className="text-right">{x.angles.r}°</td>
                    <td className="text-right">{x.angles.e}°</td>
                    <td className="text-right">{(Math.sin(rad(x.angles.i!)) / Math.sin(rad(x.angles.r!))).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-[#8fa6d1]">Complete a sheet to see it here.</p>
          )}
          <div className="mt-2">
            <ReadingInput label="Refractive index n (mean)" onRecord={(v) => session.dispatch("param.set", { key: "result:n", value: v })} value={submitted(session.events, "result:n")} disabled={ro || done.length < 1} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function signedOff(p: { x: number; y: number }, ray: NonNullable<ReturnType<typeof slabRay>>) {
  const w = { x: p.x - ray.exit.x, y: p.y - ray.exit.y };
  return Math.sign(w.x * ray.dir.y - w.y * ray.dir.x) * offEmergent(p, ray);
}

/** A full-circle protractor, 0° along the normal, ticks every degree; body drags, the arm swings. */
function Protractor({ c, arm, snapped, pulse, disabled, onMove, onArm, onSnap }: { c: Pt; arm: number; snapped: boolean; pulse: boolean; disabled: boolean; onMove: (p: Pt) => void; onArm: (deg: number) => void; onSnap: (a: "entry" | "exit") => void }) {
  const r = 64;
  const grab = useRef<Pt>({ x: 0, y: 0 });
  const a = (arm * Math.PI) / 180;
  const knob = { x: c.x + Math.sin(a) * (r + 14), y: c.y - Math.cos(a) * (r + 14) };
  return (
    <g>
      <DragHandle
        label="Protractor. Drag it onto the top or bottom face; it snaps to where the ray crosses. Press Enter to swap faces."
        role="button"
        disabled={disabled}
        ring={{ cx: c.x, cy: c.y, r: 12 }}
        pulse={pulse && !snapped}
        onDragStart={(p) => (grab.current = { x: p.x - c.x, y: p.y - c.y })}
        onDrag={(p) => onMove({ x: p.x - grab.current.x, y: p.y - grab.current.y })}
        onActivate={() => onSnap(c.y < 300 ? "exit" : "entry")}
      >
        <circle cx={c.x} cy={c.y} r={r} fill="rgba(255,255,255,.45)" stroke={snapped ? "#0ca678" : "#1c3d5a"} strokeWidth={snapped ? 1.6 : 0.8} />
        {Array.from({ length: 360 }, (_, d) => {
          const t = (d * Math.PI) / 180;
          const fromNormal = d <= 90 ? d : d <= 180 ? 180 - d : d <= 270 ? d - 180 : 360 - d;
          const len = d % 10 === 0 ? 9 : d % 5 === 0 ? 6 : 3.5;
          return (
            <g key={d}>
              <line x1={c.x + Math.sin(t) * r} y1={c.y - Math.cos(t) * r} x2={c.x + Math.sin(t) * (r - len)} y2={c.y - Math.cos(t) * (r - len)} stroke="#1c3d5a" strokeWidth={d % 10 === 0 ? 0.9 : 0.45} />
              {d % 10 === 0 && (
                <text x={c.x + Math.sin(t) * (r - 16)} y={c.y - Math.cos(t) * (r - 16) + 3} fontSize={7} textAnchor="middle" fill="#1c3d5a">
                  {fromNormal}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={c.x} cy={c.y} r={3} fill={snapped ? "#0ca678" : "#1c3d5a"} />
      </DragHandle>
      <line x1={c.x} y1={c.y} x2={knob.x} y2={knob.y} stroke="#e8590c" strokeWidth={1.2} pointerEvents="none" />
      <DragHandle
        label="Protractor reading arm. Drag it round, or use the arrow keys, to line it up with a ray."
        valueText={`arm at ${Math.round(arm)} degrees round from the top`}
        value={arm}
        min={0}
        max={359}
        disabled={disabled}
        ring={{ cx: knob.x, cy: knob.y, r: 7 }}
        onDrag={(p) => onArm(((Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI + 360) % 360)}
        onKey={(key, shift) => {
          const st = shift ? 10 : 0.5;
          if (key === "ArrowRight" || key === "ArrowUp") onArm((arm + st) % 360);
          else if (key === "ArrowLeft" || key === "ArrowDown") onArm((arm - st + 360) % 360);
          else return false;
          return true;
        }}
      >
        <circle cx={knob.x} cy={knob.y} r={12} fill="transparent" />
        <circle cx={knob.x} cy={knob.y} r={6} fill="#e8590c" stroke="#fff" strokeWidth={1.5} />
      </DragHandle>
    </g>
  );
}
