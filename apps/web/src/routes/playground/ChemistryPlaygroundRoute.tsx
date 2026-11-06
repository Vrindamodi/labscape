import { ChemistryPlayground } from "@labscape/playground";
import { FullscreenLab } from "@labscape/ui";
import { useCallback } from "react";
import { useSession } from "../../lib/session";

/**
 * /playground/chemistry - owned by Part 4, mounted full-screen in Part 1's shell.
 * Every discovery becomes a ProgressEvent; "discovery:<id>" keys make repeats free on the server.
 */
export default function ChemistryPlaygroundRoute() {
  const { award } = useSession();
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
      <ChemistryPlayground onDiscoveries={onDiscoveries} />
    </FullscreenLab>
  );
}
