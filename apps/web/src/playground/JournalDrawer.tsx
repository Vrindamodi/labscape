import { Glass, Kicker, Segmented } from "@labscape/lab-engine";
import type { DiscoveryDef, FoundDiscovery } from "@labscape/playground";
import { cx } from "@labscape/ui";
import katex from "katex";
import { Check, Lock, Search, Target, Trophy, X } from "lucide-react";
import { useMemo, useState } from "react";

type Show = "all" | "todo" | "found";

/** Journal sections, in the order a beginner tends to meet them. Unknown types fall to the end under their own name. */
const SECTIONS: [string, string][] = [
  ["neutralisation", "Acids meet bases"],
  ["indicator", "Indicators"],
  ["gas", "Fizz and gases"],
  ["precipitation", "Solids from clear solutions"],
  ["displacement", "Metals pushing metals out"],
  ["redox", "Colour-changing redox"],
  ["complex", "Coloured complexes"],
  ["catalysis", "Catalysts"],
  ["enzyme", "Enzymes"],
  ["hydration", "Reacting with water"],
  ["hydrolysis", "Split apart by water"],
  ["synthesis", "Elements joining up"],
  ["combustion", "Burning"],
  ["decomposition", "Broken by heat"],
  ["esterification", "Esters and smells"],
  ["addition", "Addition"],
  ["dehydration", "Dehydration"],
  ["denaturation", "Proteins"],
  ["polymer", "Polymers"],
  ["fermentation", "Fermentation"],
  ["equilibrium", "Equilibria"],
  ["physical", "Physical changes"],
];
const SECTION_NAME = new Map(SECTIONS);
const sectionRank = (type: string) => {
  const i = SECTIONS.findIndex(([id]) => id === type);
  return i < 0 ? SECTIONS.length : i;
};

/**
 * The discovery journal: every mission in one place, grouped by the kind of chemistry. Found ones show
 * their name and equation; the rest show only their clue. Picking one makes it the tracked mission.
 */
export function JournalDrawer({ discoveries, found, tracked, onTrack, onClose }: { discoveries: DiscoveryDef[]; found: Record<string, FoundDiscovery>; tracked: string | null; onTrack: (id: string) => void; onClose: () => void }) {
  const [show, setShow] = useState<Show>("all");
  const [q, setQ] = useState("");
  const foundCount = discoveries.filter((d) => found[d.id]).length;
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const by = new Map<string, DiscoveryDef[]>();
    for (const d of discoveries) {
      const got = !!found[d.id];
      if ((show === "todo" && got) || (show === "found" && !got)) continue;
      // An unfound mission is searchable by its clue only, so searching can't reveal its name.
      if (s && !d.clue.toLowerCase().includes(s) && !(got && d.name.toLowerCase().includes(s))) continue;
      by.set(d.type, [...(by.get(d.type) ?? []), d]);
    }
    return [...by.entries()].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]));
  }, [discoveries, found, show, q]);
  const pct = discoveries.length ? (foundCount / discoveries.length) * 100 : 0;

  return (
    <Glass className="absolute bottom-[92px] left-2 right-2 top-[76px] z-30 flex flex-col p-4 sm:left-4 sm:right-4 lg:bottom-[96px] lg:right-[328px] lg:top-[84px] xl:right-[372px]" role="dialog" aria-label="Discovery journal">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[linear-gradient(135deg,#ffd56b,#ff9a3d)] text-[#3a2200]">
          <Trophy className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block font-heading text-[19px] leading-tight">Discovery journal</b>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-[#9db2da]">
            <span className="tabular-nums">
              {foundCount} of {discoveries.length} found
            </span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <span className="block h-full rounded-full bg-[#ffc23d]" style={{ width: `${pct}%` }} />
            </span>
          </div>
        </div>
        <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[#8fa6d1] hover:bg-white/[0.06] hover:text-white" aria-label="Close journal">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[280px]">
          <Segmented<Show>
            value={show}
            label="Show"
            size="sm"
            onChange={setShow}
            options={[
              { id: "all", label: "All" },
              { id: "todo", label: "To find" },
              { id: "found", label: "Found" },
            ]}
          />
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[11px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.55)] px-3 text-[14px] text-[#8fa6d1]">
          <Search className="h-4 w-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clues" className="min-w-0 flex-1 bg-transparent text-white placeholder:text-[#8fa6d1] focus:outline-none" aria-label="Search clues" />
        </label>
      </div>
      <p className="mt-2 text-[13px] text-[#9db2da]">Pick a clue to track it. Each one is a real reaction you can set off on the bench - the clue says what to look for, not what to mix.</p>

      <div className="ls-scroll mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {groups.map(([type, list]) => (
          <section key={type} aria-label={SECTION_NAME.get(type) ?? type}>
            <Kicker className="flex items-center gap-2">
              {SECTION_NAME.get(type) ?? type}
              <span className="font-normal normal-case tracking-normal text-[#6f86b3]">
                {list.filter((d) => found[d.id]).length}/{list.length}
              </span>
            </Kicker>
            <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {list.map((d) => {
                const got = found[d.id];
                const on = tracked === d.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onTrack(d.id)}
                      aria-pressed={on}
                      className={cx(
                        "flex h-full w-full items-start gap-2.5 rounded-[14px] border p-2.5 text-left transition-[border-color,background-color] duration-200",
                        on ? "border-[#ffc23d] bg-[rgba(255,194,61,.10)]" : got ? "border-[rgba(61,232,168,.3)] bg-[rgba(61,232,168,.06)] hover:border-[rgba(61,232,168,.55)]" : "border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.45)] hover:border-[rgba(140,180,255,.4)]",
                      )}
                    >
                      <span className={cx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px]", got ? "bg-[#3de8a8] text-[#053]" : "bg-white/[0.07] text-[#8fa6d1]")}>{got ? <Check className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}</span>
                      <span className="min-w-0 flex-1">
                        {got && <b className="block text-[15px] leading-tight text-white">{d.name}</b>}
                        <span className={cx("block leading-snug", got ? "mt-0.5 text-[13px] text-[#9db2da]" : "text-[15px] font-semibold text-[#dbe7ff]")}>{d.clue}</span>
                        {got?.equationLatex && <span className="mt-1 block overflow-x-auto text-[13px] text-[#c8d6f3]" dangerouslySetInnerHTML={{ __html: katex.renderToString(got.equationLatex, { throwOnError: false }) }} />}
                        {on && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold uppercase tracking-[0.06em] text-[#ffc23d]">
                            <Target className="h-3.5 w-3.5" /> Tracking
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="py-8 text-center text-[15px] text-[#8fa6d1]">{show === "found" && !q ? "Nothing found yet. Mix two things and see what happens." : "No clues match."}</p>}
      </div>
    </Glass>
  );
}
