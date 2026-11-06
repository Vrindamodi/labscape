# @labscape/contracts

The eight contracts that are the **only** way the four parts talk to each other
(build plan: "The eight contracts").

| #   | Contract                                       | File                  | Produced by                               | Consumed by                                          |
| --- | ---------------------------------------------- | --------------------- | ----------------------------------------- | ---------------------------------------------------- |
| 1   | ExperimentDefinition + Protocol                | `src/experiment.ts`   | Schema: Part 2 · content via Part 1 admin | Part 2/3 player + evaluator, Part 4 quiz/notebook/AI |
| 2   | LabEvent stream (append-only)                  | `src/lab-event.ts`    | Parts 2, 3, 4 workspaces                  | Evaluator, notebook, replay, AI, analytics           |
| 3   | SimulationRequest / SimulationResult           | `src/simulation.ts`   | Part 2 chem engine, Part 3 physics/maths  | Animation layers, Part 4 safety/playground/AI        |
| 4   | ProgressEvent → RewardResult                   | `src/progress.ts`     | Any part                                  | Part 1 rewards service, `celebrate()`                |
| 5   | LabContext snapshot                            | `src/lab-context.ts`  | Every lab/playground/scenario             | Part 4 AI assistant                                  |
| 6   | QuizSpec / QuizResult / `<QuizRunner>`         | `src/quiz.ts`         | Part 4                                    | Stage 6, emergency debriefs                          |
| 7   | Entitlements (`useEntitlement` + server check) | `src/entitlements.ts` | Part 1                                    | Everyone gating a feature                            |
| 8   | Shell slots                                    | `src/shell-slots.ts`  | Part 1                                    | Everyone                                             |

## Rules

- **Status: v0.3.0 draft.** Contracts v1 are agreed by all four owners in week 1, then frozen.
- After v1, any change is a pull request approved by all four owners (see `.github/CODEOWNERS`) and bumps
  `CONTRACTS_VERSION` + `package.json` by semver.
- The Java mirror lives in `apps/api/src/main/java/com/labscape/api/contracts/` and must change in the
  same PR.
- Producers publish fixtures in `fixtures/`; every consumer runs its tests against them in CI.
- Contract 3 rule: engines decide **what** happens; animation layers decide **how it looks**.
  Nothing is drawn without a cue that came from an engine.
- API conventions: REST under `/v1`, camelCase JSON, RFC 9457 problem details (`ProblemDetails`),
  cursor pagination (`CursorPage`), idempotency key on every award and payment call.
