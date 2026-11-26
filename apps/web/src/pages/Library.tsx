import { Stagger, StaggerItem } from "@labscape/motion";
import { AdSlot, Blob, Button, cx, EmptyState, ErrorState, inputClass, Segmented, Skeleton, SUBJECTS, type SubjectKey } from "@labscape/ui";
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
      {/* hero: a white panel with flat colour blobs in the subject's tint */}
      <div className="relative mb-8 overflow-hidden rounded-panel bg-card p-6 sm:p-10">
        {meta && subject ? (
          <>
            <Blob shape="cloud" color={meta.tint} size={380} className="absolute -right-20 -top-32 hidden sm:block" />
            <div data-surface="dark" className="absolute right-12 top-10 hidden h-44 w-44 place-items-center rounded-full bg-[#141414] lg:grid">
              <SubjectArt subject={subject} size={150} />
            </div>
          </>
        ) : (
          <>
            <Blob shape="cloud" color="#48F08B" size={300} className="absolute -right-16 -top-28 hidden sm:block" />
            <Blob shape="hex" color="#5E9BFF" size={200} rotate={10} className="absolute right-[220px] -bottom-24 hidden lg:block" />
            <Blob shape="pebble" color="#FCC934" size={150} className="absolute right-10 bottom-6 hidden lg:block" />
          </>
        )}
        <div className="relative max-w-xl">
          <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: meta?.ink ?? "rgb(var(--ls-ink-muted))" }}>{meta ? `${meta.label} lab` : "Experiment library"}</div>
          <h1 className="mt-3 font-heading text-[38px] font-normal leading-[1.05] tracking-[-0.03em] text-ink-strong sm:text-[56px]">{meta ? `${meta.label} experiments` : "Every experiment, one bench"}</h1>
          <p className="mt-3 text-[15px] text-ink-muted">Search by name or concept. Typos and synonyms are fine: try “neutralization” or “pendlum”.</p>
          <div className="relative mt-6">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search experiments and concepts"
              className={cx(inputClass, "h-14 bg-surface pl-12 text-base")}
              aria-label="Search experiments and concepts"
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-muted hover:bg-line hover:text-ink-strong">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
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
          <button key={k} onClick={() => set(k, null)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink-strong px-3.5 text-xs font-medium text-on-ink transition hover:bg-ink-strong/85" aria-label={`Remove filter ${label(k, params.get(k) ?? "")}`}>
            {label(k, params.get(k) ?? "")} <X className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="tabular ml-auto text-sm text-ink-muted">{lib.data ? `${lib.data.total} experiment${lib.data.total === 1 ? "" : "s"}` : ""}</span>
      </div>
      {showFilters && (
        <div className="mb-6 grid gap-4 rounded-card bg-card p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[320px] rounded-card" />)}</div>
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
      <span className="mb-1.5 block px-1 text-xs font-medium text-ink-muted">{l}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm text-ink-strong outline-none transition hover:border-line-strong focus:border-ink/40"
      >
        <option value="">Any</option>
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </label>
  );
}
