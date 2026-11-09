import { PLANETS, type Planet } from "../../core/mechanics";
import { Btn, sf } from "../../ui/kit";

/** Arrow colours shared by every motion scene: sideways / velocity, up-down, and gravity. */
export const VX = "#7cf3ff", VY = "#f472b6", GRAV = "#ffd43b";

export function PlanetPicker({ value, onChange }: { value: Planet; onChange: (p: Planet) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Gravity">
      {(Object.keys(PLANETS) as Planet[]).map((k) => (
        <Btn key={k} tone={value === k ? "primary" : "ghost"} pressed={value === k} onClick={() => onChange(k)}>
          {PLANETS[k].label} <span className="text-white/50">{PLANETS[k].g}</span>
        </Btn>
      ))}
    </div>
  );
}

/** How gravity here compares with Earth's, in words. */
export function gravityWords(planet: Planet): string {
  const g = PLANETS[planet].g;
  if (planet === "earth") return "Earth's gravity: every second, a falling thing speeds up by 9.81 m/s.";
  const k = g / PLANETS.earth.g;
  return k < 1 ? `${PLANETS[planet].label}'s gravity is about ${sf(1 / k, 2)}× weaker than Earth's (${g} m/s² instead of 9.81).` : `${PLANETS[planet].label}'s gravity is about ${sf(k, 2)}× stronger than Earth's (${g} m/s² instead of 9.81).`;
}

/** Two small bars in a corner of a scene: how the energy is split right now, as a share of `max`. */
export function EnergyMini({ bars, max }: { bars: { label: string; value: number; colour: string }[]; max: number }) {
  return (
    <div className="absolute bottom-2 right-2 w-[118px] rounded-lg bg-black/40 p-1.5" role="img" aria-label={`Energy: ${bars.map((b) => `${b.label} ${Math.round((100 * b.value) / max)} percent`).join(", ")} of the starting energy`}>
      {bars.map((bar) => (
        <div key={bar.label} className="mb-0.5">
          <div className="text-[9.5px] font-semibold text-white/65">{bar.label}</div>
          <div className="h-1.5 overflow-hidden rounded bg-white/10">
            <div className="h-full rounded" style={{ width: `${Math.min(100, (100 * bar.value) / max)}%`, background: bar.colour }} />
          </div>
        </div>
      ))}
    </div>
  );
}
