import { Stagger, StaggerItem } from "@labscape/motion";
import { AdSlot, Button, cx, EmptyState, ErrorState, inputClass, Segmented, Skeleton, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FlaskConical, Search, SlidersHorizontal, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExperimentCardView } from "../components/ExperimentCardView";
import { SubjectArt } from "../components/visuals";
import { api } from "../lib/api";
import type { LibraryPage } from "../lib/types";

const FILTER_KEYS = ["subject", "chapter", "difficulty", "level", "duration", "equipment", "completed", "featured"] as const;

export default function Library() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const subject = params.get("subject") as SubjectKey | null;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q) next.set("q", q);
      else next.delete("q");
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, params, setParams]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of [...FILTER_KEYS, "q"] as const) {
      const v = params.get(k);
      if (v) p.set(k, v);
    }
    return p.toString();
  }, [params]);

  const lib = useQuery({
    queryKey: ["library", query],
    queryFn: () => api<LibraryPage>(`/v1/library/experiments${query ? `?${query}` : ""}`),
    placeholderData: keepPreviousData,
  });

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "subject") next.delete("chapter");
    setParams(next);
  };
  const active = FILTER_KEYS.filter((k) => k !== "subject" && params.get(k));
  const meta = subject ? SUBJECTS[subject] : null;

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* hero */}
      <div
        className="relative mb-6 overflow-hidden rounded-2xl border border-white/[0.08] p-6 sm:p-8"
        style={{ background: `radial-gradient(700px 300px at 100% 0%, ${meta?.color ?? "#2F80FF"}40, transparent 60%), linear-gradient(160deg,#18233f,#0e1529)` }}
      >
        <div className="absolute -right-2 -top-4 hidden opacity-90 sm:block">
          {subject ? <SubjectArt subject={subject} size={190} /> : (
            <div className="flex -space-x-10"><SubjectArt subject="chemistry" size={150} /><SubjectArt subject="physics" size={150} /><SubjectArt subject="maths" size={150} /></div>
          )}
        </div>
        <div className="relative max-w-xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: meta?.color ?? "#22D3EE" }}>{meta ? `${meta.label} lab` : "Experiment library"}</div>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight sm:text-4xl">{meta ? `${meta.label} experiments` : "Every experiment, one bench"}</h1>
          <p className="mt-2 text-white/60">Search by name or concept. Typos and synonyms are fine: try “neutralization” or “pendlum”.</p>
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search experiments and concepts"
              className={cx(inputClass, "h-12 pl-11 text-base")}
              aria-label="Search experiments and concepts"
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Subject"
          value={subject ?? "all"}
          onChange={(v) => set("subject", v === "all" ? null : v)}
          options={[
            { value: "all", label: "All" },
            { value: "chemistry", label: "Chemistry" },
            { value: "physics", label: "Physics" },
            { value: "maths", label: "Maths" },
          ]}
        />
        <Button variant={showFilters || active.length ? "secondary" : "ghost"} size="sm" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{active.length ? ` · ${active.length}` : ""}
        </Button>
        {active.map((k) => (
          <button key={k} onClick={() => set(k, null)} className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-[#8cbcff] ring-1 ring-inset ring-accent/30 hover:bg-accent/25">
            {label(k, params.get(k) ?? "")} <X className="h-3 w-3" />
          </button>
        ))}
        <span className="tabular ml-auto text-sm text-white/45">{lib.data ? `${lib.data.total} experiment${lib.data.total === 1 ? "" : "s"}` : ""}</span>
      </div>
      {showFilters && (
        <div className="mb-6 grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Select label="Chapter" value={params.get("chapter")} onChange={(v) => set("chapter", v)} options={(lib.data?.facets.chapters ?? []).map((c) => [c, c])} />
          <Select label="Difficulty" value={params.get("difficulty")} onChange={(v) => set("difficulty", v)} options={[["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]]} />
          <Select label="Learning level" value={params.get("level")} onChange={(v) => set("level", v)} options={[["beginner", "Beginner"], ["school", "School"], ["high_school", "High school"], ["undergraduate", "Undergraduate"], ["advanced", "Advanced"], ["exploring", "Exploring"]]} />
          <Select label="Duration" value={params.get("duration")} onChange={(v) => set("duration", v)} options={[["short", "10 min or less"], ["medium", "10 – 20 min"], ["long", "Over 20 min"]]} />
          <Select label="Equipment" value={params.get("equipment")} onChange={(v) => set("equipment", v)} options={(lib.data?.facets.equipment ?? []).map((c) => [c, c])} />
          <Select label="Completed" value={params.get("completed")} onChange={(v) => set("completed", v)} options={[["yes", "Completed"], ["no", "Not yet"]]} />
        </div>
      )}

      {lib.isError ? (
        <ErrorState onRetry={() => void lib.refetch()} />
      ) : lib.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[300px] rounded-xl" />)}</div>
      ) : lib.data?.items.length ? (
        <Stagger key={query} className={cx("grid gap-5 sm:grid-cols-2 xl:grid-cols-3 transition-opacity", lib.isPlaceholderData && "opacity-60")}>
          {lib.data.items.map((e, i) => (
            <Fragment key={e.id}>
              <StaggerItem index={i}>
                <ExperimentCardView e={e} />
              </StaggerItem>
              {/* every ninth slot in the grid can carry an ad (free plan only) */}
              {(i + 1) % 8 === 0 && i + 1 < lib.data.items.length && <AdSlot placement="library.grid_ninth" />}
            </Fragment>
          ))}
        </Stagger>
      ) : (
        <EmptyState
          icon={<FlaskConical className="h-6 w-6" />}
          title="No experiments match"
          body="Try a different word or clear a filter."
          action={<Button variant="secondary" size="sm" onClick={() => { setQ(""); setParams(subject ? { subject } : {}); }}>Clear filters</Button>}
        />
      )}
    </div>
  );
}

function label(k: string, v: string) {
  const map: Record<string, string> = { short: "≤10 min", medium: "10–20 min", long: "20+ min", yes: "Completed", no: "Not completed", true: "Featured" };
  return map[v] ?? v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  void k;
}

function Select({ label: l, value, onChange, options }: { label: string; value: string | null; onChange: (v: string | null) => void; options: string[][] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-white/50">{l}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-10 w-full rounded-md border border-white/10 bg-[#0f1628] px-3 text-sm text-white outline-none focus:border-accent/70"
      >
        <option value="">Any</option>
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </label>
  );
}
