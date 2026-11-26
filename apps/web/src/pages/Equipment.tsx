import { EquipmentViewer, type EquipmentKind } from "@labscape/lab-engine";
import { useMotion } from "@labscape/motion";
import { Chip, cx, ErrorState, inputClass, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, FlaskConical, Layers, Lightbulb, Pause, Play, Ruler, Search, ShieldCheck, XCircle } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CardTitle, PageHeader } from "../components/PageHeader";
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
      <PageHeader
        eyebrow="Resources"
        title="Equipment"
        sub="Every piece of kit on the LABscape bench, in 3D. Spin it, read how to use it properly, and see the mistakes that cost marks."
      />

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search equipment" className={cx(inputClass, "pl-10")} aria-label="Search equipment" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...Object.keys(q.data?.categories ?? {})].map((c) => (
              <button
                key={c ?? "all"}
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className={cx("rounded-full px-3 py-1.5 text-xs font-medium transition", cat === c ? "bg-ink-strong text-on-ink" : "bg-card text-ink-muted ring-1 ring-inset ring-line hover:text-ink-strong")}
              >
                {c ? q.data!.categories[c] : "All"}
              </button>
            ))}
          </div>
          <nav className="max-h-[62vh] space-y-0.5 overflow-y-auto rounded-card bg-card p-2" aria-label="Equipment list">
            {q.isLoading && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 rounded-[16px]" />)}
            {shown.map((i) => (
              <button
                key={i.id}
                onClick={() => setParams({ item: i.id }, { replace: true })}
                aria-current={current?.id === i.id}
                className={cx("flex w-full items-center justify-between gap-2 rounded-[16px] px-3 py-2.5 text-left text-sm transition", current?.id === i.id ? "bg-line-strong text-ink-strong" : "text-ink hover:bg-surface")}
              >
                <span className="font-medium">{i.name}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">{q.data!.categories[i.category]}</span>
              </button>
            ))}
            {!q.isLoading && shown.length === 0 && <p className="px-3 py-4 text-sm text-ink-muted">Nothing matches "{search}".</p>}
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
      {/* Viewer and details sit side by side only on very wide screens; with the sidebar and context
          panel open the viewer would be too narrow for its controls. */}
      <div className="grid gap-5 min-[1800px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* The 3D viewer keeps its dark well, like a media card on the cream page. */}
        <div data-surface="dark" className="relative h-[440px] overflow-hidden rounded-panel bg-[radial-gradient(500px_300px_at_50%_30%,#1d3263,#0a1124)]">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <EquipmentViewer kind={item.model} explode={explode} highlight={part} autoRotate={spin && explode === 0} reducedMotion={reduced} />
          </Suspense>
          <div className="absolute left-4 top-4 flex gap-2">
            <button onClick={() => setSpin((s) => !s)} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition hover:bg-white/85" aria-pressed={spin}>
              {spin ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {spin ? "Stop turning" : "Turn"}
            </button>
          </div>
          <p className="pointer-events-none absolute right-4 top-5 text-[11px] text-white/55">Drag to rotate · scroll to zoom</p>
          {explodable && (
            <div className="absolute bottom-4 left-4 w-[min(15rem,calc(100%-2rem))] rounded-[18px] bg-[#0a1124d9] p-3 ring-1 ring-white/15">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Layers className="h-3.5 w-3.5 text-accent-cyan" /> Exploded view
              </p>
              <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} className="mt-2 h-1 w-full accent-[#2f80ff]" aria-label="Explode the burette into its parts" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-card bg-card p-6">
            <Chip tone="blue">{category}</Chip>
            <h2 className="mt-3 font-heading text-[30px] font-normal leading-tight tracking-[-0.02em] text-ink-strong">{item.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink">{item.summary}</p>
            {item.precision !== "-" && (
              <div className="mt-4 flex items-start gap-3 rounded-[18px] bg-surface p-3 text-sm">
                <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-link" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Precision</p>
                  <p className="text-ink-strong">{item.precision}</p>
                </div>
              </div>
            )}
          </div>
          {explodable && (
            <div className="rounded-card bg-card p-4">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Parts</p>
              <ul className="space-y-1">
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
                      className={cx("w-full rounded-[16px] px-3 py-2 text-left text-sm transition", part === p.id ? "bg-[#E1EBFF]" : "bg-surface hover:bg-line")}
                    >
                      <b className="font-medium text-ink-strong">{p.name}</b>
                      <span className="block text-xs text-ink-muted">{p.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-start gap-3 rounded-card bg-[#FFF4CF] p-4 text-sm text-[#4a3500]">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#9A6B00]" />
            {item.fact}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="How to use it" icon={<CheckCircle2 className="h-4 w-4 text-[#1E8E3E]" />}>
          <ol className="space-y-2.5">
            {item.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint-blue/30 text-xs font-bold text-[#1A4FB8]">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="space-y-4">
          {item.mistakes.length > 0 && (
            <Panel title="Mistakes that cost marks" icon={<XCircle className="h-4 w-4 text-[#C5221F]" />}>
              <ul className="space-y-1.5 text-sm text-ink">
                {item.mistakes.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C5221F]" />
                    {m}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {item.safety.length > 0 && (
            <Panel title="Safety" icon={<ShieldCheck className="h-4 w-4 text-[#0369A1]" />}>
              <ul className="space-y-1.5 text-sm text-ink">
                {item.safety.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Used in" icon={<FlaskConical className="h-4 w-4 text-[#0F766E]" />}>
            {item.experiments.length ? (
              <div className="flex flex-wrap gap-2">
                {item.experiments.map((x) => (
                  <Link key={x.slug} to={x.playable ? `/lab/${x.subject}/${x.slug}` : `/library/${x.slug}`} className="rounded-full bg-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink">
                    {x.title}
                    {x.playable && <Play className="ml-1.5 inline h-3 w-3 -translate-y-px fill-current" aria-hidden />}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Used on every bench, in every experiment.</p>
            )}
          </Panel>
        </div>
      </div>
    </motion.section>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-card bg-card p-6">
      <CardTitle icon={icon} className="mb-4 text-lg">{title}</CardTitle>
      {children}
    </div>
  );
}
