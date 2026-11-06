# Part 4 — 3-day plan (R1 slice)

Part 4 = Playground, Safety and Intelligence (build plan §4). The full part is roughly a quarter
of the whole project, so it cannot be finished in 3 days. These 3 days deliver **what Part 4 ships
in Release 1** (build plan, "What ships in each release"):

> Quiz engine, basic AI assistant answering from lab context; safety engine built behind a flag.

Everything else is on the [deferred list](#deferred-not-in-these-3-days).

**Assumptions**

- One full-time developer.
- Part 1 (auth, entitlements, rewards) and Part 2 (chemistry engine, workbench) are **not built
  yet**, so Part 4 builds against the contract fixtures in `packages/contracts/fixtures` and
  small stubs. The plan requires this ("mocks from day one").
- Backend code goes in `apps/api/.../intelligence`. Frontend code goes in `packages/quiz` and
  `packages/assistant`. Migrations are prefixed `p4_`.
- Order follows the plan's risk call: the safety engine comes first because it is the riskiest
  piece to get right.

---

## Day 1 — Safety engine (`/v1/safety/resolve`) behind a flag

**Goal:** every free-form mix goes through one server pipeline that returns one of the seven
outcomes. Nothing renders without it.

| #   | Task                                                                                                                                                        | Output                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Flyway `p4_safety`: `safety_rules`, `safety_audit` tables; seed catalogue allowlist (substances + quantity limits)                                          | `V…__p4_safety.sql`, seed data                  |
| 2   | Feature flag `safety.engine.enabled` (config property, default off in prod)                                                                                 | `@ConditionalOnProperty` or flag service        |
| 3   | Pipeline, in order: schema check → allowlist → prohibited-pattern check → reaction lookup → outcome resolution                                              | `SafetyPipeline` with one class per step        |
| 4   | Reaction lookup **stub** behind an interface (`ReactionResolver`) that reads `content/reactions` + contract fixtures; Part 2 swaps in the real engine later | `ReactionResolver`, `FixtureReactionResolver`   |
| 5   | Seven outcomes with reason codes (`NEEDS_HEAT`, `NOT_MODELLED`, `QTY_ABOVE_LIMIT`, …), each logged to `safety_audit`                                        | `SimulationResult` responses                    |
| 6   | **Prohibited never reveals anything:** one identical copy string; never names hazard, product or trigger ingredient                                         | constant + test asserting byte-identical bodies |
| 7   | Probing cooldown: N prohibited results per session in a window → cooldown + flag to admin review queue (Redis counter)                                      | `ProbeGuard`                                    |
| 8   | Tests: one per outcome, allowlist edge limits, identical prohibited copy, cooldown, flag-off returns 404/disabled                                           | `SafetyPipelineTest`, controller test           |

**Done when:** `mvn verify` passes; all 7 outcomes are reachable from test requests; two
different prohibited combos return identical bodies; audit rows are written.

### Day 1 — delivered (2026-11-05)

Scope grew on request: a full chemistry engine and a game-quality sandbox UI, not just the pipeline.

- **Pipeline** `POST /v1/safety/resolve` (`intelligence/safety`): schema, then allowlist and limits,
  then cooldown, then prohibited rules, then engine, then outcome and audit. Flag
  `labscape.safety.engine-enabled` (off gives 503 and no reactions anywhere). Prohibited copy is
  byte-identical and never names the rule. 3 prohibited results in 10 min give a 2-min cooldown
  and a flagged audit row.
- **Chemistry engine** (`intelligence/chem`, interim until Part 2's engine replaces it): 45
  allowlisted reagents, a whole-mixture ion model covering neutralisation, carbonates, metals and
  the reactivity series, oxides (needs heat), thiosulfate, catalysis, redox (permanganate,
  peroxide, iodide, iron(III)), displacement, solubility-rule precipitation, amphoteric zinc,
  ammine complexes, the starch test, the hydration test and indicators. It emits pH, ΔT, gas
  volumes, precipitate mass, balanced KaTeX equations and Oklab animation cues. Known
  unmodelled pairs are listed as `gaps` and answered as "unsupported", never as a wrong
  "no reaction".
- **Tests:** 34 API tests including **every reagent pair at 22 °C and 75 °C plus 3,000 random
  3–4 reagent mixes (5,070 mixtures)**, all resolving cleanly, with all 7 outcomes reached.
- **UI** `/playground/chemistry` (`packages/playground`): reagent shelf, tray with validated
  sliders, water bath, an SVG/canvas beaker (pour stream, bubbles, precipitate flakes and
  sediment, deposits, dissolving solids, oil layers, steam, hotplate glow, thermometer),
  safety-engine validation checklist, an animation per outcome (discovery ribbon and card flip,
  amber hatch and freeze, red shield with shake and vignette), a discovery journal (33
  collectibles), synthesised sound, reduced-motion support and a mobile layout.
- **Deviations from the plan:** rules load from `safety/rules.json` (the `safety_rules` table
  exists for Part 1's admin). The cooldown counter is in-memory (switch to Redis before running
  more than one instance). The audit falls back to the log in the `nodb` demo profile. XP shown
  in the playground is local until Part 1's rewards service exists.
- **Needs review:** every reagent, rule and reaction needs chemistry and safety reviewer sign-off
  before release (seven-stage review).

---

## Day 2 — Quiz engine + `<QuizRunner>`

**Goal:** stage 6 of every experiment works end to end. Grading happens on the server, and XP
is requested through a ProgressEvent.

| #   | Task                                                                                                                                                                                                                           | Output                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | Flyway `p4_quiz`: `quizzes`, `questions`, `quiz_attempts`, `concept_mastery`                                                                                                                                                   | migration                                    |
| 2   | Load question pools from `content/quizzes/*.json`; write the acid-base titration quiz (5 questions, including one technique question: "Why add NaOH dropwise near the end point?")                                             | content JSON                                 |
| 3   | `GET /v1/quizzes/{id}`: draw 3–7, shuffle, **strip answers** (`QuizSpec`)                                                                                                                                                      | controller + test that no answer field leaks |
| 4   | `POST /v1/quizzes/{id}/submit`: server grading for all 9 types (numeric tolerance, partial credit for match/order), idempotency key → returns `QuizResult`                                                                     | `QuizGrader` + per-type unit tests           |
| 5   | Emit `ProgressEvent` (`quiz.completed`) to a **rewards stub** until Part 1's rewards service exists                                                                                                                            | `RewardsClient` interface + stub             |
| 6   | Simple mastery update per concept (store right/wrong counts now; BKT later)                                                                                                                                                    | `concept_mastery` writes                     |
| 7   | `packages/quiz`: `<QuizRunner quizId attemptId onComplete>` with renderers for MC, true/false, numerical, fill-blank, arrange-steps, match (label-diagram, identify-equipment and predict-outcome reuse the MC/drag renderers) | components + reduced-motion variants         |
| 8   | Results screen: score ring, per-question explanation, revision concepts; reserve the `quiz.results_below_score` ad slot area                                                                                                   | `QuizResults`                                |

**Done when:** the titration quiz is playable in a dev page, re-submitting the same key doesn't
double-grade, and `pnpm typecheck` plus `mvn verify` pass.

---

## Day 3 — Basic AI assistant (`/v1/ai/chat`) + `<AssistantPanel>`

**Goal:** the assistant answers questions using the current `LabContext` and never invents
reaction products.

| #   | Task                                                                                                                                                                                                                                                    | Output                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Flyway `p4_ai`: `ai_conversations`, `ai_messages`                                                                                                                                                                                                       | migration                             |
| 2   | Provider-agnostic `ChatModel` interface + one real adapter (**provider is an open decision**; see below) + a fake adapter for tests                                                                                                                     | `ChatModel`, adapters                 |
| 3   | `POST /v1/ai/chat` streaming over SSE; `LabContext` attached to every message and passed to the model **as data, never as instructions**                                                                                                                | controller + prompt builder           |
| 4   | Grounding rule: questions about what a mix produces are answered only from the `SimulationResult` / reviewed content; unmodelled → "not modelled" + concepts                                                                                            | system prompt + tests with fake model |
| 5   | Level-aware tone from `userLevel` (Beginner → Advanced)                                                                                                                                                                                                 | prompt templates                      |
| 6   | Guardrails: input classifier (weapons, explosives, harmful synthesis, self-harm) → safe-science redirect; output check; per-plan message limit via an **entitlement stub** (`ai.messagesPerDay`)                                                        | `AiGuard`, limits                     |
| 7   | Read-only tools stubbed: `getSimulationResult`, `getProtocolStep`, `searchLibrary` (retrieval/pgvector deferred)                                                                                                                                        | tool registry                         |
| 8   | `packages/assistant`: `<AssistantPanel>` with streamed text, KaTeX, suggested chips ("Why did it change colour?", "What should I do next?", "Explain it more simply"); rendered standalone until Part 1's `<ContextPanel.Slot name="assistant">` exists | component                             |
| 9   | Start the red-team set: 30+ harmful prompts (direct, role-play, injected via lab notes) as an automated test against the guard                                                                                                                          | `redteam.json` + test                 |

**Done when:** you can ask "Why did it turn pink?" with the titration fixture as context and get
a grounded, streamed answer; every red-team prompt is refused; `mvn verify` passes.

---

## Deferred (not in these 3 days)

| Item                                                               | Plan release | Blocked on                            |
| ------------------------------------------------------------------ | ------------ | ------------------------------------- |
| Open Playground UI, all four modes, discovery journal              | R3           | Part 2/3 sandbox modes                |
| Emergency simulator (4 first scenarios)                            | R3           | Safety reviewer sign-off per scenario |
| Lab notebook + PDF export                                          | R2           | Real LabEvent log from Part 2         |
| Replay and compare                                                 | R2           | Part 2 engine state hashes            |
| AI retrieval over reviewed content (pgvector), "Show me" highlight | R1 → R3      | Reviewed content in DB                |
| Voice assistant                                                    | R4           | —                                     |
| AI-drafted quiz questions with human review                        | Later        | Admin review queue (Part 1)           |
| Bayesian knowledge tracing, recommendations endpoint               | Later        | Enough quiz data                      |
| Full red-team set (100+) and evaluation set                        | Before R3    | —                                     |

## Open decisions that affect these days

- **AI model provider and monthly budget per user** (Day 3). The build plan lists this as open.
- **Free-tier AI message limit** (Day 3). The entitlement stub uses a placeholder value.
- **Who reviews safety rules and scenarios** (Day 1 seed rules are placeholders until reviewed).
