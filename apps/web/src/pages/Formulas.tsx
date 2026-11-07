import { solveFor } from "@labscape/mathlab";
import { Chip, cx, EmptyState, ErrorState, inputClass, Skeleton, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Calculator, Check, Copy, FlaskConical, FunctionSquare, Play, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

type Variable = { key: string; latex: string; name: string; unit: string };
type Formula = {
  id: string;
  subject: SubjectKey;
  topic: string;
  title: string;
  latex: string;
  expr: string | null;
  variables: Variable[];
  assumptions: string[];
  levels: string[];
  experiments: { slug: string; title: string; subject: string; playable: boolean }[];
};

const FAV_KEY = "ls.formulas.favourites";
const readFavs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/** \v{key} -> the variable's LaTeX, tagged so the rendered symbol knows which variable it is. */
function tagged(f: Formula) {
  return f.latex.replace(/\\v\{([^{}]*)\}/g, (_, k: string) => {
    const v = f.variables.find((x) => x.key === k);
    return v ? `\\htmlData{sym=${k}}{${v.latex}}` : k;
  });
}
const plainLatex = (f: Formula) => f.latex.replace(/\\v\{([^{}]*)\}/g, (_, k: string) => f.variables.find((x) => x.key === k)?.latex ?? k);

export default function Formulas() {
  const q = useQuery({ queryKey: ["formulas"], queryFn: () => api<{ items: Formula[] }>("/v1/formulas"), staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const subject = params.get("subject") as SubjectKey | null;
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [favs, setFavs] = useState<string[]>(readFavs);
  const focus = params.get("f");
  const toggleFav = (id: string) =>
    setFavs((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep it for this visit */
      }
      return next;
    });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(
      (f) =>
        (!subject || f.subject === subject) &&
        (!onlyFavs || favs.includes(f.id)) &&
        (!s || `${f.title} ${f.topic} ${f.variables.map((v) => `${v.name} ${v.key}`).join(" ")} ${f.expr ?? ""}`.toLowerCase().includes(s)),
    );
  }, [items, subject, onlyFavs, favs, search]);
  const topics = useMemo(() => [...new Set(shown.map((f) => `${f.subject}|${f.topic}`))], [shown]);
  const setSubject = (s: SubjectKey | null) => {
    const next = new URLSearchParams(params);
    if (s) next.set("subject", s);
    else next.delete("subject");
    setParams(next, { replace: true });
  };

  if (q.isError) return <ErrorState title="Couldn't load the formula library" onRetry={() => void q.refetch()} />;

  return (
    <div className="mx-auto max-w-[1180px]">
      <header className="relative mb-5 overflow-hidden rounded-2xl border border-white/[0.08] p-6 sm:p-7" style={{ background: "radial-gradient(700px 300px at 100% 0%, #fb923c33, transparent 60%), radial-gradient(500px 260px at 0% 100%, #2f80ff30, transparent 60%), linear-gradient(160deg,#18233f,#0e1529)" }}>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#ffc078]">
          <FunctionSquare className="h-4 w-4" /> Resources
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Formulas</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/65">Every formula you meet in the labs. Hover a symbol to see what it means, solve for any variable, and jump straight into the experiment that uses it.</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search: current, area, momentum…" className={cx(inputClass, "pl-9")} aria-label="Search formulas" />
          </label>
          {([null, "chemistry", "physics", "maths"] as (SubjectKey | null)[]).map((s) => (
            <button key={s ?? "all"} onClick={() => setSubject(s)} aria-pressed={subject === s} className={cx("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", subject === s ? "text-white ring-white/40" : "text-white/60 ring-white/10 hover:text-white")} style={subject === s && s ? { background: `${SUBJECTS[s].color}40` } : subject === s ? { background: "rgba(47,128,255,.35)" } : undefined}>
              {s ? SUBJECTS[s].label : "All"}
            </button>
          ))}
          <button onClick={() => setOnlyFavs((x) => !x)} aria-pressed={onlyFavs} className={cx("flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", onlyFavs ? "bg-amber-400/20 text-amber-200 ring-amber-300/50" : "text-white/60 ring-white/10")}>
            <Star className="h-3.5 w-3.5" /> Favourites ({favs.length})
          </button>
        </div>
      </header>

      {q.isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}
      {!q.isLoading && shown.length === 0 && <EmptyState title="No formulas match" body={onlyFavs ? "Star a formula to keep it here." : "Try another word, or clear the filters."} />}

      <div className="space-y-8">
        {topics.map((t) => {
          const [subj, topic] = t.split("|") as [SubjectKey, string];
          return (
            <section key={t} aria-label={topic}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-white/55">
                <span className="h-2 w-2 rounded-full" style={{ background: SUBJECTS[subj].color }} />
                {topic}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {shown
                  .filter((f) => f.subject === subj && f.topic === topic)
                  .map((f) => (
                    <FormulaCard key={f.id} f={f} fav={favs.includes(f.id)} onFav={() => toggleFav(f.id)} focus={focus === f.id} />
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FormulaCard({ f, fav, onFav, focus }: { f: Formula; fav: boolean; onFav: () => void; focus: boolean }) {
  const eq = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [solving, setSolving] = useState(focus);
  const html = useMemo(() => katex.renderToString(tagged(f), { displayMode: true, throwOnError: false, strict: false, trust: (ctx) => ctx.command === "\\htmlData" }), [f]);
  useEffect(() => {
    if (focus) card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  // highlight every rendered instance of the hovered symbol
  useEffect(() => {
    eq.current?.querySelectorAll<HTMLElement>("[data-sym]").forEach((el) => el.classList.toggle("ls-sym-on", el.dataset.sym === hover));
  }, [hover, html]);
  const v = f.variables.find((x) => x.key === hover);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainLatex(f));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <article ref={card} className={cx("relative rounded-xl bg-white/[0.035] p-4 ring-1 ring-inset", focus ? "ring-accent" : "ring-white/[0.08]")} aria-label={f.title}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">{f.title}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {f.levels.map((l) => (
              <Chip key={l}>{l.replace("_", " ")}</Chip>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={copy} className="grid h-8 w-8 place-items-center rounded-md text-white/50 hover:bg-white/[0.06] hover:text-white" aria-label="Copy LaTeX" title="Copy LaTeX">
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          </button>
          <button onClick={onFav} className={cx("grid h-8 w-8 place-items-center rounded-md hover:bg-white/[0.06]", fav ? "text-amber-300" : "text-white/50 hover:text-white")} aria-label={fav ? "Remove from favourites" : "Add to favourites"} aria-pressed={fav}>
            <Star className={cx("h-4 w-4", fav && "fill-current")} />
          </button>
        </div>
      </div>
      <div
        ref={eq}
        className="relative my-2 overflow-x-auto rounded-lg bg-[#0f1830] px-3 py-1 text-lg text-white [&_.ls-sym-on]:rounded [&_.ls-sym-on]:bg-accent/40 [&_[data-sym]]:cursor-help"
        onMouseOver={(e) => setHover(((e.target as HTMLElement).closest("[data-sym]") as HTMLElement | null)?.dataset.sym ?? null)}
        onMouseLeave={() => setHover(null)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="min-h-[1.25rem] text-xs text-white/60" aria-live="polite">
        {v ? (
          <span>
            <b className="text-white">{v.name}</b>
            {v.unit && <span className="text-white/50"> · {v.unit}</span>}
          </span>
        ) : f.variables.length ? (
          "Hover a symbol for its meaning."
        ) : null}
      </div>
      {f.variables.length > 0 && (
        <ul className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
          {f.variables.map((x) => (
            <li key={x.key} onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)} className={cx("flex items-baseline gap-1.5 rounded px-1", hover === x.key && "bg-accent/20")}>
              <span className="font-semibold text-white" dangerouslySetInnerHTML={{ __html: katex.renderToString(x.latex, { throwOnError: false }) }} />
              <span className="text-white/60">{x.name}</span>
              {x.unit && <span className="text-white/40">({x.unit})</span>}
            </li>
          ))}
        </ul>
      )}
      {f.assumptions.length > 0 && <p className="mt-2 text-[11px] text-white/45">Assumes: {f.assumptions.join("; ")}.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {f.expr && (
          <button onClick={() => setSolving((s) => !s)} aria-expanded={solving} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.1]">
            <Calculator className="h-3.5 w-3.5" /> Solve
          </button>
        )}
        {f.experiments.map((x) => (
          <Link key={x.slug} to={x.playable ? `/lab/${x.subject}/${x.slug}` : `/library/${x.slug}`} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-accent-cyan ring-1 ring-inset ring-accent/30 hover:bg-accent/10">
            {x.playable ? <Play className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
            {x.playable ? `Open in lab: ${x.title}` : x.title}
          </Link>
        ))}
      </div>
      {solving && f.expr && <Solver f={f} />}
    </article>
  );
}

/** Fill in what you know, pick what to find. Uses the maths engine's solver (Newton + bracketing). */
function Solver({ f }: { f: Formula }) {
  const [target, setTarget] = useState(f.variables[0]!.key);
  const [vals, setVals] = useState<Record<string, string>>({});
  const known: Record<string, number> = {};
  let missing = 0;
  for (const v of f.variables) {
    if (v.key === target) continue;
    const n = Number(vals[v.key]);
    if (vals[v.key] === undefined || vals[v.key]!.trim() === "" || !Number.isFinite(n)) missing++;
    else known[v.key] = n;
  }
  const result = missing ? null : solveFor(f.expr!, target, known, Number(vals[`guess:${target}`]) || 1);
  const tv = f.variables.find((v) => v.key === target)!;
  return (
    <div className="mt-3 rounded-lg bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs" role="radiogroup" aria-label="Solve for">
        <span className="text-white/50">Solve for</span>
        {f.variables.map((v) => (
          <button key={v.key} role="radio" aria-checked={target === v.key} onClick={() => setTarget(v.key)} className={cx("rounded-full px-2.5 py-0.5 ring-1 ring-inset", target === v.key ? "bg-accent text-white ring-accent" : "text-white/70 ring-white/15")} dangerouslySetInnerHTML={{ __html: katex.renderToString(v.latex, { throwOnError: false }) }} />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {f.variables
          .filter((v) => v.key !== target)
          .map((v) => (
            <label key={v.key} className="text-[11px] text-white/60">
              {v.name}
              <span className="mt-0.5 flex items-center gap-1">
                <input inputMode="decimal" value={vals[v.key] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [v.key]: e.target.value }))} className="h-8 w-full rounded-md bg-black/30 px-2 font-mono text-sm text-white ring-1 ring-inset ring-white/15 focus:outline-none focus:ring-accent" />
                {v.unit && <span className="shrink-0 text-white/40">{v.unit}</span>}
              </span>
            </label>
          ))}
      </div>
      <div className="mt-3 rounded-md bg-[#0f1830] px-3 py-2 text-sm" aria-live="polite">
        {missing ? (
          <span className="text-white/45">Fill in {missing} more value{missing > 1 ? "s" : ""}.</span>
        ) : result === null ? (
          <span className="text-amber-300">No real solution for these values.</span>
        ) : (
          <span className="text-white">
            {tv.name} = <b className="font-mono text-accent-cyan">{Number(result.toPrecision(5))}</b> {tv.unit}
          </span>
        )}
      </div>
      {f.id === "quadratic-formula" && (
        <label className="mt-2 block text-[11px] text-white/50">
          Start the search near (to find the other root)
          <input value={vals[`guess:${target}`] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [`guess:${target}`]: e.target.value }))} className="ml-2 h-7 w-20 rounded bg-black/30 px-2 font-mono text-xs text-white ring-1 ring-inset ring-white/15" />
        </label>
      )}
    </div>
  );
}
