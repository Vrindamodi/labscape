import { CONTRACTS_VERSION } from "@labscape/contracts";
import { colors } from "@labscape/ui";

/**
 * Shared-foundation placeholder. Part 1 replaces this with the real shell
 * (sidebar, top bar, context panel, router) per build plan 1.1.
 */
export function App() {
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
