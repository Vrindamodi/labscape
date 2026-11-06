import { CONTRACTS_VERSION } from "@labscape/contracts";
import { colors } from "@labscape/ui";
import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";

// Part 4 route, lazy-loaded so its assets only load on the playground (performance budget).
const ChemistryPlaygroundRoute = lazy(() => import("./routes/playground/ChemistryPlaygroundRoute"));

/**
 * Minimal router. Part 1 replaces the home page with the real shell
 * (sidebar, top bar, context panel) per build plan 1.1.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/playground/chemistry"
        element={
          <Suspense
            fallback={
              <div className="grid h-screen place-items-center text-white/40">Loading lab…</div>
            }
          >
            <ChemistryPlaygroundRoute />
          </Suspense>
        }
      />
    </Routes>
  );
}

function Home() {
  const swatches = [
    ["Primary", colors.accent.primary],
    ["Cyan", colors.accent.cyan],
    ["AI violet", colors.ai.violet],
    ["Chemistry", colors.subject.chemistry],
    ["Physics", colors.subject.physics],
    ["Maths", colors.subject.maths],
  ] as const;

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 p-8">
      <header>
        <h1 className="font-heading text-h2 font-semibold">LABscape</h1>
        <p className="text-accent-cyan">Explore. Experiment. Discover.</p>
      </header>
      <Link
        to="/playground/chemistry"
        className="group rounded-xl border border-subject-chemistry/40 bg-subject-chemistry/10 p-6 transition hover:bg-subject-chemistry/15"
      >
        <div className="text-xs uppercase tracking-[0.2em] text-subject-chemistry">
          Part 4 · Day 1
        </div>
        <div className="mt-1 font-heading text-2xl font-semibold text-white">
          Open Playground: Chemistry →
        </div>
        <p className="mt-1 text-sm text-white/60">
          Mix anything from the shelf. Every combination goes through the safety engine.
        </p>
      </Link>
      <section className="rounded-lg border border-glass-border bg-glass-fill p-6 backdrop-blur-glass">
        <p className="text-sm text-white/70">
          Shared foundation ready. Contracts <span className="tabular">v{CONTRACTS_VERSION}</span>
        </p>
        <ul className="mt-4 grid grid-cols-3 gap-3">
          {swatches.map(([label, hex]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className="h-4 w-4 rounded-sm" style={{ background: hex }} aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
