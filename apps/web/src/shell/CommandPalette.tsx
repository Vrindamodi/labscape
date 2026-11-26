import { sound } from "@labscape/audio";
import { cx, Kbd, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Atom, CornerDownLeft, FlaskConical, FunctionSquare, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { ELEMENTS, FORMULAS } from "../lib/reference";
import type { LibraryPage } from "../lib/types";
import { NAV } from "./nav";

type Result = { id: string; group: string; title: string; sub?: string | undefined; to: string; icon: React.ReactNode; color?: string | undefined };

/** Result accents are bright (made for dark); mix them toward ink so the icons read on white. */
const deepen = (hex: string) => `color-mix(in srgb, ${hex} 62%, #1a1a1a)`;

/** Ctrl/Cmd+K: experiments, concepts, elements, formulas and pages in one list. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 120);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      sound.play("open");
      window.setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const lib = useQuery({
    queryKey: ["library", "palette", debounced],
    queryFn: () => api<LibraryPage>(`/v1/library/experiments${debounced ? `?q=${encodeURIComponent(debounced)}` : "?featured=true"}`),
    enabled: open,
    staleTime: 60_000,
  });

  const results = useMemo<Result[]>(() => {
    const term = debounced.trim().toLowerCase();
    const out: Result[] = [];
    for (const e of (lib.data?.items ?? []).slice(0, 6)) {
      const s = SUBJECTS[e.subject as SubjectKey];
      const I = s?.icon ?? FlaskConical;
      out.push({ id: `x-${e.id}`, group: "Experiments", title: e.title, sub: `${e.chapter} · ${e.estimatedMinutes} min`, to: `/library/${e.slug}`, icon: <I className="h-4 w-4" />, color: s?.color });
    }
    if (term) {
      for (const el of ELEMENTS.filter((x) => x.name.toLowerCase().startsWith(term) || x.symbol.toLowerCase() === term).slice(0, 4)) {
        out.push({ id: `e-${el.z}`, group: "Elements", title: `${el.name}`, sub: `${el.symbol} · atomic number ${el.z}`, to: `/periodic-table?z=${el.z}`, icon: <Atom className="h-4 w-4" />, color: "#22D3EE" });
      }
      for (const f of FORMULAS.filter((x) => (x.name + " " + x.expr + " " + x.tags).toLowerCase().includes(term)).slice(0, 4)) {
        out.push({ id: `f-${f.name}`, group: "Formulas", title: f.name, sub: f.expr, to: "/formulas", icon: <FunctionSquare className="h-4 w-4" />, color: "#FB923C" });
      }
    }
    for (const g of NAV)
      for (const item of g.items)
        if (!term || item.label.toLowerCase().includes(term)) {
          const I = item.icon;
          out.push({ id: `p-${item.to}`, group: "Go to", title: item.label, to: item.to, icon: <I className="h-4 w-4" />, color: item.color });
        }
    return out.slice(0, 18);
  }, [debounced, lib.data]);

  useEffect(() => setCursor(0), [debounced]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    sound.play("click");
    onClose();
    navigate(r.to);
  };

  if (typeof document === "undefined") return null;
  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-[#1a1a1a]/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="relative w-full max-w-xl overflow-hidden rounded-[28px] bg-card text-ink shadow-pop ring-1 ring-inset ring-line"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") go(results[cursor]);
            }}
          >
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="h-5 w-5 text-ink-muted" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search experiments, concepts, elements, formulas…"
                className="h-16 flex-1 bg-transparent text-[17px] text-ink-strong outline-none placeholder:text-ink-faint focus-visible:outline-none"
                aria-label="Search"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={results[cursor]?.id}
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={list} id="palette-list" role="listbox" className="ls-scroll max-h-[min(440px,60vh)] overflow-y-auto p-2">
              {results.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-muted">No matches. Try “titration” or “pendulum”.</div>}
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <div key={r.id}>
                    {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{header}</div>}
                    <button
                      id={r.id}
                      data-i={i}
                      role="option"
                      aria-selected={i === cursor}
                      onMouseMove={() => setCursor(i)}
                      onClick={() => go(r)}
                      className={cx("flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors", i === cursor ? "bg-surface" : "")}
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                        style={{ color: r.color ? deepen(r.color) : undefined, background: r.color ? `${r.color}26` : "rgb(var(--ls-line))" }}
                      >
                        {r.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-strong">{r.title}</span>
                        {r.sub && <span className="block truncate text-xs text-ink-muted">{r.sub}</span>}
                      </span>
                      {i === cursor ? <CornerDownLeft className="h-4 w-4 text-ink-muted" /> : <ArrowRight className="h-4 w-4 text-ink/20" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-5 py-3 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
              <span className="ml-auto">Ctrl K to toggle</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
