import { Blob, Button, Card, Chip } from "@labscape/ui";
import { ArrowLeft, Beaker, Hammer } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { NAV } from "../shell/nav";

const NOTES: Record<string, { part: number; body: string }> = {
  emergency: { part: 4, body: "Timed lab-safety scenarios: spills, fires and burns, with a safety score and debrief." },
  assistant: { part: 4, body: "Ask about any reaction, step or formula. It reads what's on your bench and answers at your level." },
  quizzes: { part: 4, body: "Quizzes after every experiment, with explanations for every answer." },
  "periodic-table": { part: 2, body: "An interactive periodic table with 3D atoms, trends and every element's story." },
  equipment: { part: 2, body: "A 3D encyclopedia of lab equipment: what it does and how to use it." },
  formulas: { part: 3, body: "Every physics and maths formula, with live plots you can drag." },
  notebook: { part: 4, body: "An automatic lab notebook of everything you measured and observed." },
  community: { part: 1, body: "Study groups, class leaderboards and shareable achievement cards (a later release)." },
  lab: { part: 2, body: "The six-stage experiment player: intro, demo, try it, hints, observations and quiz." },
  playground: { part: 4, body: "Physics and maths sandboxes join the chemistry Playground soon." },
};

export default function ComingSoon() {
  const { pathname } = useLocation();
  const key = pathname.split("/")[1] ?? "";
  const note = NOTES[key] ?? { part: 2, body: "This part of LABscape is being built." };
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === `/${key}`);
  const Icon = item?.icon ?? Hammer;
  const title = key === "lab" ? "Experiment player" : item?.label ?? "Coming soon";
  return (
    <div className="mx-auto max-w-xl py-6">
      <Card className="overflow-hidden rounded-panel p-0 text-center">
        {/* A flat colour band with a blob, and the section's icon on a white disc. */}
        <div className="relative grid h-48 place-items-center overflow-hidden bg-tint-blue">
          <Blob shape="cloud" color="#FCC934" size={220} className="absolute -left-16 -top-24" />
          <Blob shape="hex" color="#FFBDF9" size={140} rotate={12} className="absolute -bottom-16 -right-8" />
          <div className="relative grid h-24 w-24 place-items-center rounded-full bg-card text-ink-strong">
            <Icon className="h-10 w-10" />
          </div>
        </div>
        <div className="p-8 sm:p-10">
          <Chip tone="blue">Arriving in Part {note.part}</Chip>
          <h1 className="mt-5 font-heading text-[34px] font-normal tracking-[-0.02em] text-ink-strong">{title}</h1>
          <p className="mt-2 text-ink-muted">{note.body}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/"><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Dashboard</Button></Link>
            <Link to="/playground/chemistry"><Button icon={<Beaker className="h-4 w-4" />}>Try the Playground</Button></Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
