# LABscape architecture: shared foundation

This repo follows `docs/LABscape-4-Part-Build-Plan.pdf` ("Shared foundation"), adapted to the
team's chosen stack. Product requirements are in `docs/LABSCAPE_SPEC.md`.

## Stack (adapted from the plan's locked stack)

| Plan said                                             | This repo uses                                                                         | Notes                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js (App Router)                                  | **React 18 + Vite + TypeScript strict**                                                | SPA; routing via react-router. SSR not needed for an app behind login.                                                                 |
| Tailwind, shadcn/ui, Framer Motion, Rive, PixiJS, R3F | Same                                                                                   | Added by the part that first needs them (Part 1 for shadcn/Framer).                                                                    |
| FastAPI + Pydantic v2                                 | **Spring Boot 3.5 (Java 21)**                                                          | One deployable, one package per part.                                                                                                  |
| Alembic                                               | **Flyway**                                                                             | `V<yyyyMMddHHmm>__p<part>_<desc>.sql` in `apps/api/src/main/resources/db/migration`.                                                   |
| PostgreSQL 16 + pgvector                              | **Neon** (serverless Postgres) + pgvector                                              | Local dev: `docker compose up -d`. Pooled host for the app, direct host for Flyway.                                                    |
| Redis                                                 | Redis                                                                                  | Leaderboards, rate limits.                                                                                                             |
| Auth.js + JWKS                                        | **Spring Security** (Part 1 decides: OAuth2 login for Google + JWT in httpOnly cookie) | Not wired in setup.                                                                                                                    |
| FastAPI OpenAPI → TS client                           | **springdoc** at `/v1/openapi.json` → `openapi-typescript`                             | Generator added with the first real endpoint.                                                                                          |
| Python science services (NumPy, SciPy, RDKit)         | **Open decision**                                                                      | Options: Java libs (CDK for chemistry, Hipparchus for numerics) or a small Python sidecar. Part 2 decides before the chemistry engine. |
| worker app                                            | Spring `@Scheduled`/async in the API for now                                           | Split out when PDF export / AI quiz drafts need it.                                                                                    |

## Layout

```
apps/
  web/            React + Vite. Route folders under src/routes map to owners (see CODEOWNERS)
  api/            Spring Boot. com.labscape.api.{core=P1, lab=P2, sim=P3, intelligence=P4}
                  com.labscape.api.contracts = Java mirror of the eight contracts
packages/
  contracts/      8 contracts (TS) + fixtures. Changes need all four owners.
  ui/             design tokens (TS, CSS vars, Tailwind preset); components: Part 1
  motion/         motion tokens and rules; celebrate()/<Reveal>/particles: Part 1
  audio/          sound-bus channel config; Howler bus: Part 1
  lab-engine/ chem-view/            Part 2
  physics/ mathlab/                 Part 3
  playground/ assistant/ quiz/ scenarios/   Part 4
content/          experiments, reactions, scenarios, quizzes (reviewed JSON)
```

## Ownership rules (from the plan)

- No part calls into another except through the eight contracts.
- A part never alters another part's tables; it opens a PR to the owner.
- Server is authoritative for XP, scores, entitlements and safety decisions.
- Every award and payment endpoint takes an idempotency key.
- REST under `/v1`, camelCase JSON, RFC 9457 problem details, cursor pagination.
- Contract tests: producers publish fixtures in `packages/contracts/fixtures`; the API's
  `ContractFixturesTest` reads them and fails on unknown fields.

## Merge order

1. Contracts + ui/motion/audio packages ← **this setup** (tokens and contracts done; components are Part 1)
2. Shell and auth (Part 1)
3. Experiment player and workbench (Part 2)
4. Progress events → rewards service
5. AI panel in the context-panel slot
6. Notebook and replay
7. Playground on sandbox modes + safety engine
