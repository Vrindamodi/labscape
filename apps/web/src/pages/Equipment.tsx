import { EquipmentViewer, type EquipmentKind } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { Chip, cx, ErrorState, inputClass, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, FlaskConical, Layers, Lightbulb, Pause, Play, Ruler, Search, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

type Part = { id: string; name: string; detail: string };
type Item = {
  id: string;
  name: string;
  model: EquipmentKind;
  category: string;
  summary: string;
  precision: string;
  steps: string[];
  mistakes: string[];
  safety: string[];
  fact: string;
  parts?: Part[];
  experiments: { slug: string; title: string; subject: string; playable: boolean }[];
};
type Payload = { categories: Record<string, string>; items: Item[] };

export default function Equipment() {
  const q = useQuery({ queryKey: ["equipment"], queryFn: () => api<Payload>("/v1/equipment"), staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const current = items.find((i) => i.id === params.get("item")) ?? items[0] ?? null;
  const shown = useMemo(
    () => items.filter((i) => (!cat || i.category === cat) && (!search || `${i.name} ${i.summary}`.toLowerCase().includes(search.toLowerCase()))),
    [items, cat, search],
  );

  if (q.isError) return <ErrorState title="Couldn't load the equipment encyclopedia" onRetry={() => void q.refetch()} />;

  return (
    <div className="mx-auto max-w-[1300px]">
      <header className="mb-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#8cbcff]">
          <Wrench className="h-4 w-4" /> Resources
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Equipment</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/65">Every piece of kit on the LABscape bench, in 3D. Spin it, read how to use it properly, and see the mistakes that cost marks.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search equipment" className={cx(inputClass, "pl-9")} aria-label="Search equipment" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...Object.keys(q.data?.categories ?? {})].map((c) => (
              <button key={c ?? "all"} onClick={() => setCat(c)} className={cx("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", cat === c ? "bg-accent text-white ring-accent" : "text-white/60 ring-white/10 hover:text-white")}>
                {c ? q.data!.categories[c] : "All"}
              </button>
            ))}
          </div>
          <nav className="max-h-[62vh] space-y-1 overflow-y-auto pr-1" aria-label="Equipment list">
            {q.isLoading && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            {shown.map((i) => (
              <button
                key={i.id}
                onClick={() => setParams({ item: i.id }, { replace: true })}
                aria-current={current?.id === i.id}
                className={cx("flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition", current?.id === i.id ? "bg-accent/15 text-white ring-1 ring-inset ring-accent/50" : "text-white/75 hover:bg-white/[0.05] hover:text-white")}
              >
                <span className="font-semibold">{i.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-white/35">{q.data!.categories[i.category]}</span>
              </button>
            ))}
            {!q.isLoading && shown.length === 0 && <p className="px-2 py-4 text-sm text-white/50">Nothing matches "{search}".</p>}
          </nav>
        </aside>

        <AnimatePresence mode="wait">{current && <ItemView key={current.id} item={current} category={q.data!.categories[current.category] ?? ""} />}</AnimatePresence>
      </div>
    </div>
  );
}

function ItemView({ item, category }: { item: Item; category: string }) {
  const { reduced } = useMotion();
  const [spin, setSpin] = useState(true);
  const [explode, setExplode] = useState(0);
  const [part, setPart] = useState<string | null>(null);
  const explodable = !!item.parts?.length;

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2 }} className="min-w-0 space-y-5" aria-label={item.name}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="relative h-[440px] overflow-hidden rounded-2xl bg-[radial-gradient(500px_300px_at_50%_30%,#1d3263,#0a1124)] ring-1 ring-inset ring-white/10">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <EquipmentViewer kind={item.model} explode={explode} highlight={part} autoRotate={spin && explode === 0} reducedMotion={reduced} />
          </Suspense>
          <div className="absolute left-3 top-3 flex gap-2">
            <button onClick={() => setSpin((s) => !s)} className="flex items-center gap-1.5 rounded-full bg-[#0a1124cc] px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/15 hover:text-white" aria-pressed={spin}>
              {spin ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {spin ? "Stop turning" : "Turn"}
            </button>
          </div>
          <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-white/45">Drag to rotate · scroll to zoom</p>
          {explodable && (
            <div className="absolute right-3 top-3 w-52 rounded-xl bg-[#0a1124d9] p-3 ring-1 ring-white/15">
              <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Layers className="h-3.5 w-3.5 text-accent-cyan" /> Exploded view
              </p>
              <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="mt-2 h-1 w-full accent-[#2f80ff]" aria-label="Explode the burette into its parts" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <Chip tone="blue">{category}</Chip>
            <h2 className="mt-2 text-2xl font-extrabold text-white">{item.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/80">{item.summary}</p>
          </div>
          {item.precision !== "-" && (
            <div className="flex items-start gap-2 rounded-xl bg-white/[0.04] p-3 text-sm ring-1 ring-inset ring-white/[0.07]">
              <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">Precision</p>
                <p className="text-white">{item.precision}</p>
              </div>
            </div>
          )}
          {explodable && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/45">Parts</p>
              <ul className="space-y-1.5">
                {item.parts!.map((p) => (
                  <li key={p.id}>
                    <button
                      onMouseEnter={() => setPart(p.id)}
                      onMouseLeave={() => setPart(null)}
                      onFocus={() => {
                        setPart(p.id);
                        if (explode < 0.5) setExplode(1);
                      }}
                      onBlur={() => setPart(null)}
                      onClick={() => setExplode((x) => (x < 0.5 ? 1 : x))}
                      className={cx("w-full rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset transition", part === p.id ? "bg-accent/15 ring-accent/50" : "bg-white/[0.03] ring-white/[0.06]")}
                    >
                      <b className="text-white">{p.name}</b>
                      <span className="block text-xs text-white/60">{p.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-xl bg-amber-400/[0.07] p-3 text-sm text-amber-100/90 ring-1 ring-inset ring-amber-300/20">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            {item.fact}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="How to use it" icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />}>
          <ol className="space-y-2">
            {item.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-white/85">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-bold text-[#8cbcff]">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="space-y-4">
          {item.mistakes.length > 0 && (
            <Panel title="Mistakes that cost marks" icon={<XCircle className="h-4 w-4 text-red-300" />}>
              <ul className="space-y-1.5 text-sm text-white/80">
                {item.mistakes.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300/80" />
                    {m}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {item.safety.length > 0 && (
            <Panel title="Safety" icon={<ShieldCheck className="h-4 w-4 text-sky-300" />}>
              <ul className="space-y-1.5 text-sm text-white/80">
                {item.safety.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Used in" icon={<FlaskConical className="h-4 w-4 text-teal-300" />}>
            {item.experiments.length ? (
              <div className="flex flex-wrap gap-2">
                {item.experiments.map((x) => (
                  <Link key={x.slug} to={x.playable ? `/lab/${x.subject}/${x.slug}` : `/library/${x.slug}`} className="rounded-full bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.1]">
                    {x.title}
                    {x.playable && <span className="ml-1.5 text-accent-cyan">▶</span>}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/50">Used on every bench, in every experiment.</p>
            )}
          </Panel>
        </div>
      </div>
    </motion.section>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.07]">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
