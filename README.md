# NEXUS — Real-time Incident & Observability Command Center

NEXUS is a full-stack incident management and observability platform: live service health, incident lifecycle with an audit trail,
metrics explorer, distributed traces, a live event stream (50k+ events, virtualized), an interactive service dependency map, alert rules
with a real evaluator, RBAC across multiple tenants, feature flags, and an evidence-linked incident assistant.

> **Honesty note.** All *telemetry* (metrics, events, traces, faults) is produced by a **deterministic simulator** and is labelled
> "Simulated" in the UI. Everything else — incidents, comments, alerts, audit logs, users, roles, flags, settings — is real persisted
> data in PostgreSQL. See [docs/tradeoffs.md](docs/tradeoffs.md) for what is and isn't covered.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19, TypeScript (strict), Vite, Tailwind CSS v4, shadcn/ui (Radix), Motion (`motion/react`), React Router, TanStack Query, Zustand, React Hook Form + Zod, Apache ECharts, React Flow, TanStack Virtual, Lucide |
| API | Node 22+, Fastify 5, Drizzle ORM, PostgreSQL, Socket.IO, argon2id, pino |
| Shared | `@nexus/shared`: permissions, incident state machine, zod schemas, form schemas, simulation model, alert evaluator, feature-flag bucketing |
| Quality | Vitest, React Testing Library, Playwright, ESLint, Prettier, GitHub Actions |
| Infra | Docker Compose (Postgres, API, nginx), embedded Postgres for local dev without Docker |

## Quick start (no Docker required)

Prerequisites: **Node ≥ 22**, **pnpm ≥ 10** (`corepack enable`). Everything else is installed from npm — including a real PostgreSQL 18 binary via
`embedded-postgres`.

```bash
pnpm install
cp .env.example .env            # already present if you cloned this repo's working copy

pnpm dev:db                     # terminal 1 — starts PostgreSQL on :54329 (data in apps/api/.pgdata)
pnpm db:migrate                 # terminal 2 — apply migrations
pnpm db:seed                    #   deterministic demo data (~108k events, 690 traces, 17 incidents, 2 tenants)
pnpm dev                        #   API on :4000 + web on :5273
```

Open **http://localhost:5273**.

### Demo accounts

All passwords: `nexus-demo-2026` (set by `SEED_PASSWORD`; never reuse outside demos).

| Email | Organization | Role | Use it to… |
|---|---|---|---|
| `admin@acme.nexus.dev` | Acme Cloud (+ Globex as *viewer*) | Admin | everything; test org switching |
| `sre@acme.nexus.dev` | Acme Cloud | SRE | resolve incidents, edit alert rules, audit logs |
| `engineer@acme.nexus.dev` | Acme Cloud | Engineer | create/update incidents; cannot resolve |
| `viewer@acme.nexus.dev` | Acme Cloud | Viewer | read-only; see blocked actions |
| `admin@globex.nexus.dev` | Globex Systems | Admin | second tenant for isolation checks |

## Docker

```bash
docker compose up --build
docker compose run --rm api node dist/seed.js     # first run only
# → http://localhost:8080
```

> The Docker files were written but **could not be executed in the environment this project was built in (no Docker daemon)**. The API
> bundle they run (`pnpm --filter @nexus/api build` → `node dist/server.js`) was verified locally against Postgres; the images themselves were not built.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API + web with hot reload |
| `pnpm dev:db` | embedded PostgreSQL for local development |
| `pnpm db:migrate` / `db:seed` / `db:reset` | migrations (Drizzle SQL) / deterministic seed / wipe+reseed |
| `pnpm test` | all unit + integration suites (shared, web, API with a throw-away Postgres) |
| `pnpm e2e` | Playwright end-to-end suite (needs API + web running) |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | static checks and production build |
| `pnpm --filter @nexus/web perf` | measure the production build, writes `docs/perf-results.json` |

## Repository layout

```
apps/
  api/            Fastify API, Socket.IO, simulator engine, alert evaluator, AI assistant, Drizzle schema + migrations, seed
  web/            React SPA (shell, command palette, pages, realtime client, design system)
packages/
  shared/         isomorphic domain logic + contracts (see above)
infrastructure/
  docker/ nginx/  Dockerfiles and nginx config
docs/             architecture, data model, API, realtime, security, performance, tradeoffs
```

`apps/worker` and `packages/ui` from the original brief were intentionally **not** created — see [tradeoffs](docs/tradeoffs.md).

## Documentation

[Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [API](docs/api.md) · [Real-time design](docs/realtime-design.md) ·
[Security](docs/security.md) · [Performance report](docs/performance.md) · [Trade-offs & status](docs/tradeoffs.md)

## Optional AI provider

The incident assistant works out of the box with a deterministic, rule-based engine. To let an LLM write the narrative summary set
`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` on the **API** (the key never reaches the browser). The model only receives the
rule engine's findings and is instructed not to add facts. On any provider error the UI falls back to the rule-based summary.
