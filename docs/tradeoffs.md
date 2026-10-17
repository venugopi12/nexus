# Trade-offs, deviations from the brief, and status

## Deliberate deviations
| Brief | What was done | Why |
|---|---|---|
| `apps/worker` | simulator + alert evaluator run inside the API process as isolated modules | single-node correctness first; both are idempotent functions of time, so moving them out later is mechanical |
| `packages/ui` | shadcn/ui components live in `apps/web/src/components/ui` (CLI-generated) | one consumer; extracting a package adds build plumbing without benefit |
| `packages/config` | one root `tsconfig.base.json`, `eslint.config.js`, `.prettierrc` | enough for 3 workspaces |
| Prisma | **Drizzle ORM** + generated SQL migrations | no codegen step, SQL-first, partial/expression indexes (`alerts_one_open`) expressed directly, small runtime |
| Redis | **not used** | no cross-process coordination is needed in this deployment; documented upgrade path (Socket.IO Redis adapter + leader for the engine) |
| Real telemetry | **simulated** | a demo cannot instrument real fleets; the simulator is deterministic so the product is testable |
| `docker compose` verified | **not verified** (no Docker daemon available when built) | local dev uses `embedded-postgres` (real PostgreSQL 18) instead; see README |
| MCP tooling | Playwright/Context7/shadcn/Motion MCP servers were **not connected**; I used the shadcn CLI, npm Playwright and library docs knowledge directly | |
| Motion for *every* popover/dropdown | Dialogs, drawers, toasts, tabs/nav indicators, lists, page entrances, number tweens use Motion; Radix dropdown/select/popover/tooltip use `tw-animate-css` CSS transitions | those are short, frequent, accessible-by-default primitives; Motion's `forceMount` wrapping adds complexity for no UX gain |

## Technical trade-offs
* **Latency percentiles** are computed over raw 15 s samples of a *per-request* latency variable. It's a model of a sampled-request distribution, not
  a histogram merge; long ranges are strided (≤ ~3 000 samples/series) so very long percentile queries are approximations (the response says `sampledEvery`).
* **Offset pagination** for events (sparse pages pinned to a snapshot). Cursor pagination would be cheaper at deep offsets; at 100k rows with the
  `(org, env, ts desc)` index it is fine and keeps virtual scrolling random-access.
* **Health is derived on read** (60 s window) instead of stored; cheap with the pure model, and it guarantees consistency with charts.
* **In-memory login throttling and SimModel cache** — correct for one replica; shared storage needed for more.
* **Optimistic concurrency** for incidents uses a `version` column and returns 409 (UI reloads and tells the user) rather than CRDT/merge.
* **Bundle**: Motion's full `motion` component is used (≈ 45 kB gz); `LazyMotion` + `m` would save ~25 kB gz but touches every file.
* **Charts** are ECharts (canvas): great for dense series/brush, but not DOM-accessible; every chart has an `aria-label`, a text summary elsewhere on the page,
  and the Metrics Explorer offers CSV export as the table alternative. A dedicated data-table view per chart is not built.

## Status
| Area | State |
|---|---|
| Shell, nav, palette, theme, shortcuts, notifications | complete |
| Overview, Incidents (+detail), Services (+detail), Metrics, Traces (+waterfall), Event stream, Dependency map, Deployments, Alerts, Team, Audit, Settings | complete, backed by the API |
| Auth, RBAC, tenant isolation, audit, flags (global/org/env, % rollout, history) | complete |
| Alert evaluator (thresholds, windows, cooldown, dedupe, ack, incident-from-alert, notifications) | complete |
| AI assistant | rule-based complete; LLM narrative path implemented but **not exercised** (no API key during development) |
| Tests | see below |
| Docker images, GitHub Actions workflow | written, **not executed** |
| Not built | per-chart accessible data tables, password reset/MFA, Redis adapter, trace compare view (flag exists, no UI), staging-specific seeded incidents |

## Test inventory
* `packages/shared` — 11 unit tests (state machine, permissions, flag bucketing/precedence, simulator determinism & propagation, percentiles, alert evaluation, dedupe/cooldown)
* `apps/api` — 14 integration tests against a throw-away embedded PostgreSQL (auth, RBAC, lifecycle, optimistic locking, tenant isolation, alerts, metrics, Socket.IO)
* `apps/web` — 33 tests (realtime client/backoff/buffer, command registry, command palette keyboard interactions, route guard, dashboard loading/error states, span tree, graph layout)
* `apps/web/e2e` — Playwright: the full 11-step workflow from the brief + auth redirect + invalid login + palette keyboard flow
