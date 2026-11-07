import { Eye, Pencil, PlusSquare } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { rad } from "../core/runtime";
import { offEmergent, slabRay, type PinSet, type SlabSetup, type SlabState } from "../labs/refraction";
import { Btn, Panel, ReadingInput, Readout } from "./kit";
import type { SimSession } from "./useSimSession";

const PINS = ["P1", "P2", "P3", "P4"] as const;
type PinId = (typeof PINS)[number];

/**
 * Glass slab by the pin method. The sight-line strip shows what you see when you look through the
 * slab along the emergent ray: the images of P1 and P2, and P3 and P4 directly. When all four
 * line up they really are on the emergent ray.
 */
export function SlabWorkspace({ session }: { session: SimSession<SlabState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as SlabSetup;
  const ro = session.readOnly;
  const cur: PinSet = s.sets[s.sets.length - 1]!.done ? { pins: {}, traced: false, angles: {}, done: false } : s.sets[s.sets.length - 1]!;
  const nextPin = PINS.find((p) => !cur.pins[p]) ?? null;
  const [chosen, setChosen] = useState<PinId | null>(null);
  const active = chosen ?? nextPin;
  const [cursor, setCursor] = useState({ x: -40, y: -60 });
  const [protractorAt, setProtractorAt] = useState<"entry" | "exit">("entry");
  const ray = slabRay(cur, setup);

  // paper coordinates (mm) -> svg: x in [-110, 110], y in [-120, 170]
  const k = 2;
  const X = (x: number) => (x + 110) * k;
  const Y = (y: number) => (y + 120) * k;
  const W = 220 * k;
  const H = 290 * k;
  const place = (x: number, y: number) => {
    if (ro || !active || cur.traced) return;
    session.dispatch("equipment.place", { equipmentId: active, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
    setChosen(null);
  };
  const onPaper = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    place(p.x / k - 110, p.y / k - 120);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      setCursor((c) => ({ x: c.x + moves[e.key]![0], y: c.y + moves[e.key]![1] }));
    }
    if (e.key === "Enter") place(cursor.x, cursor.y);
  };

  const sight = ray && cur.pins.P1 && cur.pins.P2 ? PINS.map((p) => ({ p, off: p === "P1" || p === "P2" ? 0 : cur.pins[p] ? signedOff(cur.pins[p]!, ray) : null })) : null;
  const aligned = sight && sight.every((x) => x.off !== null && Math.abs(x.off) <= 0.8);
  const center = ray ? (protractorAt === "entry" ? ray.entry : ray.exit) : null;
  const done = s.sets.filter((x) => x.done);

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="relative min-h-[320px] overflow-hidden rounded-xl bg-[#e9e4d6] ring-1 ring-inset ring-black/20">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onPaper} tabIndex={ro ? -1 : 0} onKeyDown={onKey} role="application" aria-label={`Drawing paper with a glass slab. ${active && !cur.traced ? `Placing ${active}: click, or move the cross with the arrow keys and press Enter.` : ""}`}>
          {/* faint grid */}
          {Array.from({ length: 23 }, (_, i) => (
            <line key={`v${i}`} x1={i * 10 * k} y1={0} x2={i * 10 * k} y2={H} stroke="rgba(0,0,0,.05)" />
          ))}
          {Array.from({ length: 30 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 10 * k} x2={W} y2={i * 10 * k} stroke="rgba(0,0,0,.05)" />
          ))}
          {/* slab (outline once traced) */}
          <rect x={X(-setup.widthMm / 2)} y={Y(0)} width={setup.widthMm * k} height={setup.thicknessMm * k} fill={cur.traced ? "none" : "rgba(160,210,255,.45)"} stroke="#2b5d8a" strokeWidth={cur.traced ? 1.2 : 2} strokeDasharray={cur.traced ? "0" : undefined} />
          {cur.traced && ray && (
            <g>
              {/* normals */}
              {[ray.entry, ray.exit].map((p, i) => (
                <line key={i} x1={X(p.x)} y1={Y(p.y) - 70} x2={X(p.x)} y2={Y(p.y) + 70} stroke="#495057" strokeDasharray="5 4" strokeWidth={1} />
              ))}
              <line x1={X(cur.pins.P1!.x)} y1={Y(cur.pins.P1!.y)} x2={X(ray.entry.x)} y2={Y(ray.entry.y)} stroke="#1c7ed6" strokeWidth={1.5} />
              <line x1={X(ray.entry.x)} y1={Y(ray.entry.y)} x2={X(ray.exit.x)} y2={Y(ray.exit.y)} stroke="#1c7ed6" strokeWidth={1.5} />
              {cur.pins.P4 && <line x1={X(ray.exit.x)} y1={Y(ray.exit.y)} x2={X(cur.pins.P4.x)} y2={Y(cur.pins.P4.y)} stroke="#1c7ed6" strokeWidth={1.5} />}
              {/* lateral shift: the incident ray continued */}
              <line x1={X(ray.entry.x)} y1={Y(ray.entry.y)} x2={X(ray.entry.x + ray.dir.x * 140)} y2={Y(ray.entry.y + ray.dir.y * 140)} stroke="#868e96" strokeDasharray="3 4" strokeWidth={1} />
              {center && <Protractor cx={X(center.x)} cy={Y(center.y)} r={64} />}
            </g>
          )}
          {/* pins */}
          {PINS.map((p) => {
            const pin = cur.pins[p];
            if (!pin) return null;
            return (
              <g key={p}>
                <circle cx={X(pin.x)} cy={Y(pin.y)} r={4} fill="#c92a2a" stroke="#fff" strokeWidth={1.2} />
                <text x={X(pin.x) + 7} y={Y(pin.y) - 6} fontSize={11} fontWeight={700} fill="#c92a2a">
                  {p}
                </text>
              </g>
            );
          })}
          {/* keyboard cursor */}
          {!ro && active && !cur.traced && (
            <g pointerEvents="none">
              <line x1={X(cursor.x) - 8} y1={Y(cursor.y)} x2={X(cursor.x) + 8} y2={Y(cursor.y)} stroke="#1971c2" />
              <line x1={X(cursor.x)} y1={Y(cursor.y) - 8} x2={X(cursor.x)} y2={Y(cursor.y) + 8} stroke="#1971c2" />
            </g>
          )}
        </svg>
        <div className="absolute left-3 top-3 rounded-lg bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
          Sheet {done.length + 1} · {cur.traced ? "traced: measure the angles" : active ? `place ${active}${active === "P3" || active === "P4" ? " below the slab" : " above the slab"}` : "all pins placed"}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Pins" right={<span className="text-[11px] text-white/45">click a pin to move it</span>}>
          <div className="grid grid-cols-4 gap-1.5">
            {PINS.map((p) => (
              <Btn key={p} onClick={() => setChosen(p)} disabled={ro || cur.traced} pressed={active === p} tone={active === p ? "primary" : "secondary"}>
                {p}
              </Btn>
            ))}
          </div>
        </Panel>
        <Panel title="Looking through the slab" right={<Eye className="h-4 w-4 text-white/40" />}>
          {sight ? (
            <>
              <svg viewBox="0 0 280 70" className="w-full rounded-lg bg-[#dfe7ef]" role="img" aria-label={aligned ? "All four pins are in line" : "The pins are not yet in line"}>
                {sight.map(({ p, off }, i) =>
                  off === null ? null : (
                    <g key={p}>
                      <rect x={140 + Math.max(-130, Math.min(130, off * 14)) - (p === "P1" || p === "P2" ? 3 : 2)} y={8} width={p === "P1" || p === "P2" ? 6 : 4} height={54} fill={p === "P1" || p === "P2" ? "rgba(201,42,42,.45)" : "#c92a2a"} />
                      <text x={140 + Math.max(-130, Math.min(130, off * 14)) + 5} y={14 + i * 12} fontSize={9} fill="#333">
                        {p === "P1" || p === "P2" ? `${p} (image)` : p}
                      </text>
                    </g>
                  ),
                )}
              </svg>
              <p className={`mt-1 text-xs ${aligned ? "text-emerald-300" : "text-white/55"}`}>{aligned ? "All four pins line up." : "Move P3 and P4 until they hide the images of P1 and P2."}</p>
            </>
          ) : (
            <p className="text-xs text-white/50">Place P1 and P2 above the slab first.</p>
          )}
          <Btn tone="primary" className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "trace", value: true })} disabled={ro || cur.traced || !cur.pins.P3 || !cur.pins.P4}>
            <Pencil className="h-4 w-4" /> Remove the slab and trace
          </Btn>
        </Panel>
        <Panel title="Measure from the normals">
          <div className="mb-2 flex gap-1.5">
            <Btn onClick={() => setProtractorAt("entry")} pressed={protractorAt === "entry"} tone={protractorAt === "entry" ? "primary" : "secondary"}>
              Protractor at top face
            </Btn>
            <Btn onClick={() => setProtractorAt("exit")} pressed={protractorAt === "exit"} tone={protractorAt === "exit" ? "primary" : "secondary"}>
              at bottom face
            </Btn>
          </div>
          <div className="space-y-2">
            {(["i", "r", "e"] as const).map((k2) => (
              <ReadingInput key={k2} label={k2 === "i" ? "Angle of incidence i" : k2 === "r" ? "Angle of refraction r" : "Angle of emergence e"} unit="°" onRecord={(v) => session.dispatch("measure.read", { instrument: "protractor", reading: { key: k2, value: v, unit: "deg" } })} disabled={ro || !cur.traced} width="w-20" />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Readout label="i" value={cur.angles.i ?? "–"} unit={cur.angles.i !== undefined ? "°" : ""} />
            <Readout label="r" value={cur.angles.r ?? "–"} unit={cur.angles.r !== undefined ? "°" : ""} />
            <Readout label="e" value={cur.angles.e ?? "–"} unit={cur.angles.e !== undefined ? "°" : ""} />
          </div>
          {!cur.done && cur.traced && (
            <Btn className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "new-sheet", value: true })} disabled={ro}>
              <PlusSquare className="h-4 w-4" /> Start this sheet again
            </Btn>
          )}
        </Panel>
        <Panel title={`Sheets (${done.length}/3)`}>
          {done.length ? (
            <table className="w-full text-xs">
              <thead className="text-white/45">
                <tr>
                  <th className="text-left">i</th>
                  <th className="text-right">r</th>
                  <th className="text-right">e</th>
                  <th className="text-right">sin i / sin r</th>
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
            <p className="text-xs text-white/50">Complete a sheet to see it here.</p>
          )}
          <div className="mt-2">
            <ReadingInput label="Refractive index n (mean)" onRecord={(v) => session.dispatch("param.set", { key: "result:n", value: v })} disabled={ro || done.length < 1} />
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

/** A full-circle protractor centred on a face, 0° along the normal, ticks every degree. */
function Protractor({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,.35)" stroke="#1c3d5a" strokeWidth={0.8} />
      {Array.from({ length: 360 }, (_, d) => {
        const a = (d * Math.PI) / 180;
        const fromNormal = d <= 90 ? d : d <= 180 ? 180 - d : d <= 270 ? d - 180 : 360 - d;
        const len = d % 10 === 0 ? 9 : d % 5 === 0 ? 6 : 3.5;
        return (
          <g key={d}>
            <line x1={cx + Math.sin(a) * r} y1={cy - Math.cos(a) * r} x2={cx + Math.sin(a) * (r - len)} y2={cy - Math.cos(a) * (r - len)} stroke="#1c3d5a" strokeWidth={d % 10 === 0 ? 0.9 : 0.45} />
            {d % 10 === 0 && (
              <text x={cx + Math.sin(a) * (r - 16)} y={cy - Math.cos(a) * (r - 16) + 3} fontSize={7} textAnchor="middle" fill="#1c3d5a">
                {fromNormal}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
