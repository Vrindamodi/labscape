# LABscape

**Explore. Experiment. Discover.** A gamified virtual science laboratory for Chemistry, Physics
and Mathematics.

- Product spec: [docs/LABSCAPE_SPEC.md](docs/LABSCAPE_SPEC.md)
- Build plan: [docs/LABscape-4-Part-Build-Plan.pdf](docs/LABscape-4-Part-Build-Plan.pdf)
- Architecture and stack: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Shared contracts: [packages/contracts](packages/contracts/README.md)

## Stack

React + Vite + TypeScript (web) · Spring Boot 3.5 / Java 21 (API) · Neon Postgres + pgvector ·
Redis · Flyway · pnpm workspaces.

## Prerequisites

- Node.js 24 LTS + pnpm 9 (`corepack enable`)
- JDK 21+ (Maven optional: use `apps/api/mvnw`)
- Docker (for local Postgres/Redis), or a Neon database

## Getting started

```bash
cp .env.example .env          # set DATABASE_URL etc. (local or Neon)
pnpm install
pnpm db:up                    # local Postgres (pgvector) + Redis
pnpm api                      # Spring Boot on :8080  (Flyway runs migrations)
# or, with no database at all:  pnpm api:demo
pnpm dev                      # web on :5173, proxies /v1 to the API
# open http://localhost:5173/playground/chemistry
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm api:test` (includes contract fixture tests).
