import { Sparkles } from "lucide-react";
import { AssistantDock } from "../components/AssistantDock";

/** /assistant: the science assistant full width (build plan 4.4). */
export default function Assistant() {
  return (
    <div className="mx-auto flex h-[calc(100vh-120px)] max-w-3xl flex-col">
      <header className="mb-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#c4b1ff]">
          <Sparkles className="h-4 w-4" /> Labs
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">Science assistant</h1>
        <p className="mt-1 text-sm text-white/60">Answers come from LABscape's reviewed lessons and its chemistry engine. It never guesses what a mixture makes, and it won't help with anything harmful.</p>
      </header>
      <div className="min-h-0 flex-1 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.08]">
        <AssistantDock />
      </div>
    </div>
  );
}
