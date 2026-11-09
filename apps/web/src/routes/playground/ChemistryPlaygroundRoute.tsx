import { PlaygroundStudio } from "../../playground/PlaygroundStudio";
import { ErrorState, FullscreenLab, Skeleton } from "@labscape/ui";
import { useNavigate } from "react-router-dom";
import { LimitReached, usePlaygroundSession } from "../../pages/Playground";
import { useCallback } from "react";
import { useSession } from "../../lib/session";

/**
 * /playground/chemistry - owned by Part 4, mounted full-screen in Part 1's shell.
 * Every discovery becomes a ProgressEvent; "discovery:<id>" keys make repeats free on the server.
 */
export default function ChemistryPlaygroundRoute() {
  const { award } = useSession();
  const navigate = useNavigate();
  const { session, loading, limited, error, retry } = usePlaygroundSession("chemistry");
  const onDiscoveries = useCallback(
    (ids: string[]) => {
      ids.forEach((id, i) => {
        window.setTimeout(() => {
          void award(
            { kind: "playground.discovery", refId: id, subject: "chemistry", idempotencyKey: `discovery:${id}` },
            { origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.45 }, label: "New discovery" },
          ).catch(() => {});
        }, i * 300);
      });
    },
    [award],
  );
  return (
    <FullscreenLab>
      {session ? (
        <PlaygroundStudio onDiscoveries={onDiscoveries} />
      ) : (
        <div className="h-screen bg-[#0b0f1a] p-4">
          {loading && <Skeleton className="h-full rounded-2xl" />}
          {limited && <LimitReached onBack={() => navigate("/playground")} />}
          {error && <ErrorState title="Couldn't start the playground" onRetry={retry} />}
        </div>
      )}
    </FullscreenLab>
  );
}
