# Part 2 build plan: Lab Engine and Chemistry Lab

Scope: build plan §2.1–2.15. Branch: `part-2-lab-engine` (from `part-1-platform-core`).

## Two decisions

1. **One engine, run in both places.** `@labscape/lab-engine` is a pure, deterministic TypeScript
   reducer: `(state, LabEvent) -> state + SimulationResult cues`. The web app steps it every frame.
   The API runs the **same bundled JS** inside the JVM (GraalJS) to replay an attempt's event log,
   compute state hashes and score it. This makes "server replay gives identical hashes and the same
   score" true by construction, with no second Java copy of the physics to drift out of sync.
2. **Real 3D bench (approved v3 direction), with a lite tier.** The plan's MVP said 2.5D PixiJS. The
   approved v3 mockup is a real 3D bench, so the workbench uses React Three Fiber:
   - lathe-profile glassware;
   - a liquid shader (OKLab body colour, Beer–Lambert depth darkening, meniscus, 32-node surface wave);
   - instanced particles capped at 4,000 / 2,000 / 600.

   Lite turns off refraction and bloom. The engine is renderer-agnostic, so a 2D fallback stays possible.

## Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M1 | **lab-engine core.** Equipment entities (profile, capacity, lip, graduations, contents, temperature, snap sockets). Pour model (onset angle + weir law, spills). Dropper, burette (stopcock, tip bubble), pipette, measuring cylinder (parallax), balance. Mixing homogeneity and local concentration. Heat model with first-order thermometer lag. Client chemistry pack (strong/weak acid–base pH, indicators, Ksp precipitation, gas evolution, displacement deposit, enthalpy, thiosulfate turbidity, flame colours). State hash. | Unit tests: pour onset/rate, titration endpoint at 10.00 mL, precipitation, determinism. |
| M2 | **Protocols + evaluator + hints.** Contract 1 protocols for the 7 MVP experiments. Evaluator state machine (equipment, sequence, quantity, technique, mixing, conditions, timing, measurement, observation) with minor/major/order/safety severities. Hint ladder (idle 20 s, 2 fails, rate breach, wrong tool). | Fast pour flagged within 250 ms; scores match the default weights. |
| M3 | **Attempts API.** `/v1/experiments/{id}`, `/v1/attempts/*` (append events, autosave, resume, finish), `/v1/chem/packs/{id}`, `/v1/chem/simulate`. GraalJS replay plus server scoring; XP via Part 1 rewards; flip `features.experiments`. | Server replay hash equals client hash; completion awards XP once. |
| M4 | **3D workbench.** Scene in the v3 look. Equipment models. Liquid shader, pour stream (ballistic arc, breaks into drops under 0.3 mL/s), splashes, bubbles, precipitate, flame, steam, condensation. Interactions for mouse, touch and keyboard. Snap sockets (24 px). Zoom lens for readings. Pour-rate gauge. Sound and announce() for every cue. | Titration finishable with mouse, touch or keyboard alone. |
| M5 | **Experiment player.** Six-stage rail; Intro; Demo (golden-run replay with captions, 0.5x on key moments); Try with hints; Observe (equation, fidelity chip, molecular toggle); Quiz slot for Part 4; results with score breakdown and celebration. | All 7 experiments playable end to end. |
| M6 | **Molecular view, periodic table, equipment encyclopedia.** `/periodic-table` (118 elements, trends, Bohr model, Madelung filling with exceptions, compare tray). `/equipment` (turntable models, exploded burette). `/v1/elements`, `/v1/equipment`. | Pages live; elements link to experiments. |

MVP experiments (§2.12):
1. Acid-base indicators.
2. Acid-base titration.
3. Precipitation (Cu(OH)₂, BaSO₄).
4. Magnesium with HCl and the pop test.
5. Iron nail in copper sulfate.
6. Diluting acid safely.
7. Flame tests.

The rate of reaction and heat of dissolving experiments are Later.

Chemistry content still needs a chemistry teacher's review before publishing (§2.15). Each protocol
is marked `reviewStatus: "draft"` until then.

## Status

| # | State | Notes |
|---|-------|-------|
| M1-M5 | Done | 7 MVP experiments, server replay identical to V8 hashes. |
| M6 | Done | `/periodic-table`: 118 elements in the IUPAC layout (group 3 = Sc, Y, Lu, Lr), colour by family, 8 trends, block or state at any temperature; Bohr model; Aufbau filling with the 20 measured exceptions and their reasons; compare tray (up to 4). `/equipment`: 22 items on a 3D turntable, exploded burette. `/v1/elements`, `/v1/elements/{symbol or Z}`, `/v1/equipment`, `/v1/equipment/{id}`, cross-linked to experiments both ways. Molecular view in Observe for all 7 experiments (atom-mapped bonds, electron transfer, atom counter; emission view for flame tests). Admin golden-run recorder (`?record=1`) and live replay scores for every shipped demo. |

Still open: element and equipment data need the same teacher review as the protocols.
