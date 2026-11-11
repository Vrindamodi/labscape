# Part 4 build plan: Playground, Safety and Intelligence

Scope: build plan §4.1–4.10. Branch: `part-4-intelligence` (from `part-3-physics-maths`).

Already built (Day 1, see `part-4-3-day-plan.md`): the safety engine (`/v1/safety/resolve`, seven outcomes, identical prohibited copy, probe cooldown) and the chemistry playground with its discovery journal.

## Decisions

1. **AI provider stays swappable.** `/v1/ai/chat` streams over SSE from a `ChatModel` interface:
   - **Gemini adapter**: used when `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set. The model is configurable with `AI_MODEL`; the default is `gemini-3.8-flash`.
   - **Built-in grounded tutor**: a deterministic offline answerer for when no key is set, and for tests. It composes answers only from retrieval over reviewed content and the `LabContext`.

   Both sit behind the same guard, grounding rule, tools and limits, so safety does not depend on which model is used. (The plan lists the provider as an open decision; this keeps it open.)
2. **Retrieval over reviewed content only.** The corpus is experiment observations, formulas, element facts, equipment and safety notes. It is indexed in memory with BM25 now; pgvector embeddings replace the ranking once an embedding model is chosen, with no change to the interface.
3. **Safety is deterministic and tested.** The input classifier is rule-based, and a red-team set of 100+ prompts (direct, role-play, and injected through lab notes) runs in CI. The guard runs before any model call and checks the output again afterwards.
4. **Quizzes are content and are graded on the server.**
   - Pools live in `content/quizzes/<experiment>.json`; the API draws questions and strips the answers.
   - Mastery uses Bayesian knowledge tracing per concept.
   - AI-drafted questions enter a review queue and are never served until a person approves them.
5. **Notebook PDFs come from the browser's print engine**, using a dedicated print layout. KaTeX equations, tables and SVG charts then come out exactly as on screen. The plan's server-worker renderer can replace this behind the same `reports.export` entitlement.
6. **Emergency procedures are not invented.** Every step follows widely published official guidance:
   - National Disaster Management Authority, India, and the 112 emergency number;
   - NHS / St John Ambulance first aid for burns;
   - CLEAPSS-style school lab spill practice.

   Every scenario is `reviewStatus: "draft"` until a qualified safety reviewer signs it off.

## Milestones

| # | Milestone | Done when |
|---|-----------|-----------|
| M1 | **Quizzes.** 3–7 questions for each of the 19 experiments, covering all nine question types. `/v1/quizzes/{id}` (draw, shuffle, no answers) and `/submit` (server grading, numeric tolerance, partial credit, idempotent, XP). BKT mastery and revision topics. `<QuizRunner>` in the player's Quiz stage and a `/quizzes` hub. | No answer leaks; a re-submit is not graded twice; every question type is graded correctly. |
| M2 | **AI assistant.** `/v1/ai/chat` over SSE, LabContext as data, retrieval, read-only tools, level-aware answers, guard plus output check, per-plan limits, logging. `<AssistantPanel>` in the context panel and on `/assistant`, with chips, KaTeX, "Show me" highlight and voice. | All 100+ red-team prompts are refused; no product is named for an unmodelled combination on the evaluation set. |
| M3 | **Emergency simulator.** Four first scenarios as reviewed JSON. `<ScenarioPlayer>` with the six stages, escalating hazards and scoring. `/v1/emergency/*` with server scoring, XP and a badge. | All four are playable; the correct path scores 100; unsafe choices escalate and are explained. |
| M4 | **Notebook, replay, compare.** The notebook is generated from each finished attempt, with editable notes and conclusion and PDF export. `<ReplayPlayer>` has event and deviation markers, a golden-run ghost and a difference list. `<CompareView>` has presets. | Replay of any attempt reproduces its state hash; PDF keeps equations and tables. |
| M5 | **Playground modes.** Mode picker; physics sandbox (free circuit builder, projectile and pendulum with every parameter unlocked); maths sandbox (multi-function graphing with sliders); cross-subject bridges; session history; daily limit. | All modes live; the playground shows no reactions when the safety engine is off. |
