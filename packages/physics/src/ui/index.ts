import type { ComponentType } from "react";
import { ArchimedesWorkspace } from "./ArchimedesWorkspace";
import { CircuitWorkspace } from "./CircuitWorkspace";
import { PendulumWorkspace } from "./PendulumWorkspace";
import { ProjectileWorkspace } from "./ProjectileWorkspace";
import { SlabWorkspace } from "./SlabWorkspace";
import { HeatCapacityWorkspace } from "./HeatCapacityWorkspace";
import { TrolleyWorkspace } from "./TrolleyWorkspace";
import type { SimSession } from "./useSimSession";

export * from "./kit";
export * from "./interact";
export * from "./useSimSession";
export * from "./history";
export * from "./explain";
export { ScaleLens } from "./ArchimedesWorkspace";

export type WorkspaceProps = { session: SimSession<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The interactive bench for each physics experiment, by slug. */
export const PHYSICS_WORKSPACES: Record<string, ComponentType<WorkspaceProps>> = {
  "ohms-law": CircuitWorkspace,
  "series-and-parallel": CircuitWorkspace,
  "projectile-motion": ProjectileWorkspace,
  "refraction-snells-law": SlabWorkspace,
  "simple-pendulum": PendulumWorkspace,
  "archimedes-principle": ArchimedesWorkspace,
  "newtons-second-law": TrolleyWorkspace,
  "specific-heat-capacity": HeatCapacityWorkspace,
};
export * from "./guide";
