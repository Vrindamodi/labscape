import { Sparkles } from "lucide-react";
import { AssistantDock } from "../components/AssistantDock";
import { PageHeader } from "../components/PageHeader";

/** /assistant: the science assistant full width (build plan 4.4). */
export default function Assistant() {
  return (
    // Below lg the bottom nav takes ~70px, so the chat ends above it instead of under it.
    <div className="mx-auto flex h-[calc(100dvh-180px)] max-w-3xl flex-col lg:h-[calc(100vh-120px)]">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Labs
          </span>
        }
        title="Science assistant"
        sub={
          // Too long for a phone, where the chat needs the room.
          <span className="hidden sm:inline">
            Ask about an idea in chemistry, physics or maths, or about the experiment on your bench. What a mixture makes always comes from LABscape's chemistry engine, never a guess, and it won't help with anything harmful.
          </span>
        }
        className="max-sm:mb-5"
      />
      <div className="min-h-0 flex-1 rounded-panel bg-card p-4 sm:p-5">
        <AssistantDock panel={{ placeholder: "Ask a question…" }} />
      </div>
    </div>
  );
}
