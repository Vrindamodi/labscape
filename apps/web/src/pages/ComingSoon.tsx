import { Button, Card, Chip } from "@labscape/ui";
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
    <div className="mx-auto max-w-xl py-10">
      <Card className="overflow-hidden p-0 text-center">
        <div className="relative grid h-44 place-items-center bg-[radial-gradient(400px_180px_at_50%_0%,rgba(47,128,255,.35),transparent_70%)]">
          <div className="grid h-20 w-20 place-items-center rounded-3xl bg-white/[0.06] ring-1 ring-white/10" style={{ color: item?.color ?? "#8cbcff", boxShadow: `0 0 60px -10px ${item?.color ?? "#2f80ff"}` }}>
            <Icon className="h-10 w-10" />
          </div>
        </div>
        <div className="p-8">
          <Chip tone="blue">Arriving in Part {note.part}</Chip>
          <h1 className="mt-4 font-heading text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-white/60">{note.body}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/"><Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>Dashboard</Button></Link>
            <Link to="/playground/chemistry"><Button icon={<Beaker className="h-4 w-4" />}>Try the Playground</Button></Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
