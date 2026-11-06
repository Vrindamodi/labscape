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
- No database install needed for development: the `dev` profile starts a real embedded Postgres 17
  (data in `apps/api/.data/pg`). Use Neon (or Docker Postgres) by running the default profile with
  `DATABASE_URL` / `FLYWAY_URL` set.

## Getting started

```bash
pnpm install
pnpm api                      # Spring Boot on :8080 with embedded Postgres; Flyway runs migrations
pnpm dev                      # web on :5173, proxies /v1 to the API
# open http://localhost:5173  ->  welcome, onboarding, dashboard
```

- Sign up with `admin@labscape.dev` (dev profile) to get a super-admin account and the `/admin` page.
- Payments run in **sandbox** mode: the checkout sheet's "Pay (test)" sends the same signed webhook
  Razorpay would. Set `BILLING_MODE=razorpay` plus keys for live payments.
- Password-reset links are written to the API log until email delivery is configured.
- If `pnpm api` reports `could not lock .../epg-lock`, an earlier API process is still running: stop it
  (and its `postgres.exe`) first.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm api:test` (51 tests, including Part 1's done-when checks on a
real embedded Postgres).
