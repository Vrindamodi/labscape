import { Clock, Flame, Power, Thermometer, Timer } from "lucide-react";
import { cFromReadings, thermoShown, type HeatSetup, type HeatState } from "../labs/thermal";
import { GhostHand, LabStyles, paramOf, Stage, Tag, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { AnalogMeter, Btn, LiveGraph, Panel, ReadingInput, Readout, sf } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const W = 520;
const H = 340;
const BX = 190; // block left
const BY = 120; // block top
const BW = 150;
const BH = 170;

const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Block colour: cool grey-blue at room temperature, warming to amber. */
function blockFill(c: number) {
  const k = Math.max(0, Math.min(1, (c - 20) / 60));
  const r = Math.round(150 + k * 90);
  const g = Math.round(160 - k * 40);
  const b = Math.round(180 - k * 120);
  return `rgb(${r},${g},${b})`;
}

/**
 * Specific heat capacity. Set up the aluminium block (heater in, thermometer in with oil,
 * insulation), switch on, and step time forward a minute at a time, reading the thermometer after
 * each minute. Then work out E = VIt and c = E / (m Δθ).
 */
export function HeatCapacityWorkspace({ session }: { session: SimSession<HeatState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as HeatSetup;
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1000);
  const live = s.heaterOn && s.heaterIn;
  const shown = s.thermoIn ? thermoShown(s) : Math.round(setup.roomC * 10) / 10;
  const set = (key: string, value: number | boolean) => !ro && session.dispatch("param.set", { key, value });
  const sinceOn = s.onAt === null ? null : s.t - s.onAt;
  const start = s.onAt === null ? null : s.readings.find((r) => r.t === s.onAt) ?? null;
  const pts = s.onAt === null ? [] : s.readings.filter((r) => r.t >= s.onAt!).map((r) => ({ x: (r.t - s.onAt!) / 60, y: r.T }));
  const cEst = cFromReadings(s, setup);

  /* ---------------------------------------------------------------- demo hand */
  let hand: Pt | null = null;
  if (paramOf(demo.next, "heater-in") !== undefined) hand = { x: BX + 45, y: BY - 50 };
  else if (paramOf(demo.next, "thermo-in") !== undefined || paramOf(demo.next, "oil") !== undefined) hand = { x: BX + 110, y: BY - 50 };
  else if (paramOf(demo.next, "insulate") !== undefined) hand = { x: BX + BW + 12, y: BY + 80 };
  else if (paramOf(demo.next, "heater") !== undefined) hand = { x: 80, y: 250 };

  const heaterY = s.heaterIn ? BY + 10 : BY - 110;
  const thermoY = s.thermoIn ? BY + 20 : BY - 120;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_340px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Stage className="min-h-[300px]" label={live ? `Heating · ${clock(sinceOn ?? 0)}` : s.onS > 0 ? "Heater off · the block is still hot" : "Set up the block"}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="img" aria-label={`Aluminium block at ${shown.toFixed(1)} degrees Celsius. Heater ${s.heaterIn ? "in the block" : "on the bench"}, ${s.heaterOn ? "on" : "off"}. Thermometer ${s.thermoIn ? "in the block" : "out"}${s.oil ? " with oil" : ""}. ${s.insulated ? "Insulated." : "Not insulated."}`}>
            <rect x={0} y={BY + BH} width={W} height={H - BY - BH} fill="#1b2232" />
            {/* insulation */}
            {s.insulated && (
              <g>
                <rect x={BX - 16} y={BY - 6} width={BW + 32} height={BH + 6} rx={10} fill="#e9d9a6" opacity={0.9} />
                {Array.from({ length: 9 }, (_, i) => (
                  <line key={i} x1={BX - 16} y1={BY + 10 + i * 18} x2={BX + BW + 16} y2={BY + 2 + i * 18} stroke="#b89d52" strokeWidth={1} />
                ))}
              </g>
            )}
            {/* block */}
            <rect x={BX} y={BY} width={BW} height={BH} rx={6} fill={blockFill(s.blockC)} stroke="#5b6680" strokeWidth={2} style={{ transition: "fill .6s" }} />
            <text x={BX + BW / 2} y={BY + BH - 12} fontSize={11} textAnchor="middle" fill="#1f2937" fontWeight={700}>
              aluminium · 1.00 kg
            </text>
            {/* holes */}
            <rect x={BX + 36} y={BY} width={18} height={110} rx={3} fill="#2b3142" />
            <rect x={BX + 100} y={BY} width={12} height={90} rx={3} fill="#2b3142" />
            {s.oil && <rect x={BX + 101} y={BY + 70} width={10} height={19} rx={2} fill="#d4a017" opacity={0.85} />}
            {/* heater */}
            <g transform={`translate(0 ${heaterY - (BY + 10)})`} style={{ transition: "transform .5s" }}>
              <rect x={BX + 38} y={BY + 10} width={14} height={98} rx={5} fill={s.heaterOn ? "#ff7a45" : "#9aa3b2"} stroke="#5b6680" />
              {s.heaterOn && <rect x={BX + 38} y={BY + 10} width={14} height={98} rx={5} fill="#ff5b3a" opacity={0.5} className="animate-pulse motion-reduce:animate-none" />}
              <rect x={BX + 34} y={BY - 2} width={22} height={14} rx={3} fill="#1f2937" />
              <path d={`M${BX + 45} ${BY - 2} C ${BX + 45} ${BY - 40}, 110 ${BY - 40}, 90 250`} stroke="#ef4444" strokeWidth={2} fill="none" />
            </g>
            {/* thermometer */}
            <g transform={`translate(0 ${thermoY - (BY + 20)})`} style={{ transition: "transform .5s" }}>
              <rect x={BX + 102} y={BY - 90} width={8} height={176} rx={4} fill="rgba(220,235,255,.25)" stroke="#c9d3e6" />
              <rect x={BX + 104} y={BY + 86 - Math.min(170, ((shown + 10) / 120) * 170)} width={4} height={Math.min(170, ((shown + 10) / 120) * 170)} rx={2} fill="#ef4444" />
              <circle cx={BX + 106} cy={BY + 86} r={6} fill="#ef4444" />
            </g>
            {/* power supply and switch */}
            <g>
              <rect x={30} y={225} width={110} height={60} rx={8} fill="#1f2937" stroke="#5b6680" />
              <text x={85} y={246} fontSize={11} textAnchor="middle" fill="#dbe7ff" fontWeight={700}>
                12 V supply
              </text>
              <circle cx={85} cy={266} r={9} fill={s.heaterOn ? V3.mint : "#4b5671"} stroke="#c9d3e6" />
            </g>
            {/* digital thermometer readout */}
            <g>
              <rect x={BX + BW + 40} y={BY - 70} width={120} height={46} rx={8} fill="#060d1f" stroke="rgba(140,180,255,.3)" />
              <text x={BX + BW + 100} y={BY - 38} fontSize={22} textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono, monospace" fontWeight={700}>
                {shown.toFixed(1)} °C
              </text>
              <rect x={BX + BW + 40} y={BY - 18} width={120} height={30} rx={8} fill="#060d1f" stroke="rgba(140,180,255,.3)" />
              <Timer x={BX + BW + 54} y={BY - 10} width={14} height={14} color={V3.cyan} strokeWidth={2.25} aria-hidden />
              <text x={BX + BW + 108} y={BY + 2} fontSize={14} textAnchor="middle" fill={V3.cyan} fontFamily="JetBrains Mono, monospace">
                {clock(sinceOn ?? 0)}
              </text>
            </g>
            {live && <Tag x={BX + BW / 2} y={BY - 128} text="Hot! Do not touch" colour={V3.red} />}
            {!ro && focus === "setup" && !s.heaterIn && <Tag x={BX + 45} y={BY - 128} text="Heater into its hole" />}
            <GhostHand at={hand} pressing={demo.k > 0.7} />
          </svg>
        </Stage>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Set up" glow={!ro && focus === "setup"}>
            <div className="grid grid-cols-2 gap-2">
              <Btn pressed={s.heaterIn} tone={s.heaterIn ? "primary" : "secondary"} onClick={() => set("heater-in", !s.heaterIn)} disabled={ro || s.heaterOn}>
                Heater {s.heaterIn ? "in" : "out"}
              </Btn>
              <Btn pressed={s.thermoIn} tone={s.thermoIn ? "primary" : "secondary"} onClick={() => set("thermo-in", !s.thermoIn)} disabled={ro}>
                <Thermometer className="h-4 w-4" /> {s.thermoIn ? "In" : "Out"}
              </Btn>
              <Btn pressed={s.oil} tone={s.oil ? "primary" : "secondary"} onClick={() => set("oil", !s.oil)} disabled={ro}>
                Drop of oil
              </Btn>
              <Btn pressed={s.insulated} tone={s.insulated ? "primary" : "secondary"} onClick={() => set("insulate", !s.insulated)} disabled={ro}>
                Insulation
              </Btn>
            </div>
            <p className="mt-2 text-[11px] text-[#8fa6d1]">Never switch the heater on outside the block. Switch off before you take it out.</p>
          </Panel>
          <Panel title="Heater and clock" glow={!ro && (focus === "start" || focus === "readings" || focus === "off")}>
            <div className="grid grid-cols-2 gap-2">
              <Btn tone={s.heaterOn ? "danger" : "primary"} onClick={() => set("heater", !s.heaterOn)} disabled={ro}>
                <Power className="h-4 w-4" /> Heater {s.heaterOn ? "off" : "on"}
              </Btn>
              <Btn onClick={() => set("wait", 60)} disabled={ro}>
                <Clock className="h-4 w-4" /> Wait 1 min
              </Btn>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Readout label="Heating time" value={String(s.onS)} unit="s" />
              <Readout label="Power V × I" value={live ? (setup.volts * setup.amps).toFixed(1) : "0"} unit="W" tone={live ? "warn" : "default"} />
            </div>
            <div className="mt-2">
              <ReadingInput label="Thermometer" unit="°C" disabled={ro} onRecord={(v) => session.dispatch("measure.read", { instrument: "thermometer", reading: { key: "T", value: v, unit: "°C" } })} value={submitted(session.events, "T", "thermometer")} />
            </div>
          </Panel>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Meters" glow={!ro && focus === "meters"}>
          <div className="flex justify-around">
            <AnalogMeter label="Voltmeter" value={live ? setup.volts : 0} max={15} unit="V" size={130} />
            <AnalogMeter label="Ammeter" value={live ? setup.amps : 0} max={5} unit="A" size={130} colour={V3.amber} />
          </div>
          <div className="mt-2 grid gap-2">
            <ReadingInput label="Voltage V" unit="V" disabled={ro} onRecord={(v) => session.dispatch("measure.read", { instrument: "voltmeter", reading: { key: "V", value: v, unit: "V" } })} value={submitted(session.events, "V", "voltmeter")} />
            <ReadingInput label="Current I" unit="A" disabled={ro} onRecord={(v) => session.dispatch("measure.read", { instrument: "ammeter", reading: { key: "I", value: v, unit: "A" } })} value={submitted(session.events, "I", "ammeter")} />
          </div>
        </Panel>
        <Panel title={`Temperature against time (${pts.length} readings)`} glow={!ro && (focus === "energy" || focus === "result")}>
          <LiveGraph series={[{ label: "θ against t", colour: V3.red, mode: "line", points: pts }]} xLabel="t / min" yLabel="θ / °C" height={130} yMin={15} />
          {pts.length > 0 && (
            <div className="mt-2 grid grid-cols-5 gap-1 font-mono text-[11px] text-white/80">
              {pts.map((p) => (
                <span key={p.x}>
                  {p.x}′ {p.y.toFixed(1)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Readout label="Δθ (last − first)" value={start && pts.length > 1 ? (pts[pts.length - 1]!.y - start.T).toFixed(1) : "–"} unit="°C" />
            <Readout label="E ÷ (m Δθ)" value={cEst ? sf(cEst, 3) : "–"} unit="J/kg°C" />
          </div>
          <div className="mt-2 grid gap-2">
            <ReadingInput label="Energy E = VIt" unit="J" disabled={ro || s.onS === 0} onRecord={(v) => session.dispatch("param.set", { key: "result:E", value: v })} value={submitted(session.events, "result:E")} />
            <ReadingInput label="Specific heat capacity c" unit="J/kg°C" disabled={ro || pts.length < 2} onRecord={(v) => session.dispatch("param.set", { key: "result:c", value: v })} value={submitted(session.events, "result:c")} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8fa6d1]">
            <Flame className="h-3.5 w-3.5 text-[#ffc23d]" /> The block stays hot long after switching off. Let it cool before you move it.
          </p>
        </Panel>
      </div>
    </div>
  );
}
