import archimedesJson from "../../../../content/experiments/archimedes-principle.json";
import ohmsJson from "../../../../content/experiments/ohms-law.json";
import projectileJson from "../../../../content/experiments/projectile-motion.json";
import slabJson from "../../../../content/experiments/refraction-snells-law.json";
import seriesJson from "../../../../content/experiments/series-and-parallel.json";
import pendulumJson from "../../../../content/experiments/simple-pendulum.json";
import type { SimContent, SimModel } from "../protocol/types";
import { ohmsLaw, seriesParallel } from "./circuits";
import { archimedes, pendulum, projectile } from "./mechanics";
import { refraction } from "./refraction";

export * from "./circuits";
export * from "./mechanics";
export * from "./refraction";

/** Physics experiments: reviewed content (JSON) and the model behind each, keyed by slug. */
export const PHYSICS_CONTENT: Record<string, SimContent> = Object.fromEntries(
  [ohmsJson, seriesJson, projectileJson, slabJson, pendulumJson, archimedesJson].map((c) => [c.slug, c as unknown as SimContent]),
);

export const PHYSICS_MODELS: Record<string, SimModel<any>> = Object.fromEntries( // eslint-disable-line @typescript-eslint/no-explicit-any
  [ohmsLaw, seriesParallel, projectile, refraction, pendulum, archimedes].map((m) => [m.slug, m]),
);
