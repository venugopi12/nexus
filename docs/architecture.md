# Architecture

```
 Browser (React SPA)                                   API process (Fastify)                          PostgreSQL
 ┌──────────────────────────┐   HTTPS /api/v1 (JSON)   ┌─────────────────────────────────┐         ┌───────────────┐
 │ Router · TanStack Query  │ ───────────────────────▶ │ auth (cookie session) · RBAC     │ ──────▶ │ orgs, users,  │
 │ Zustand (ui, live, toasts)│                         │ routes → domain services         │         │ incidents,    │
 │ Command palette registry │   Socket.IO (cookie auth) │ SimRegistry (SimModel per org/env)│         │ events (100k) │
 │ LiveClient (backoff/hb)  │ ◀─────────────────────── │ SimEngine (2s tick) → events/ticks│ ◀────── │ traces/spans, │
 └──────────────────────────┘                          │ Alert evaluator (10s)            │         │ alerts, audit │
                                                       └─────────────────────────────────┘         └───────────────┘
              ▲ shared types, zod schemas, state machine, permissions, simulation model, alert maths (@nexus/shared)
```

## Principles

1. **One source of truth for domain logic.** The incident state machine, permission matrix, simulation model, alert evaluation and
   feature-flag bucketing live in `@nexus/shared` and are imported by the API, the web app and the tests, so the UI cannot drift from the server.
2. **Telemetry is a pure function of time.** `SimModel` computes every metric value from `(org, env, service, timestamp, faults)`.
   Metric queries, the live ticker, health, alert evaluation and trace generation all call the same function, so charts, incidents,
   events and service states are internally consistent by construction (see *Simulation* below).
3. **Server enforces; UI reflects.** Every route calls `need(req, permission)`; hiding buttons is UX only.
4. **Tenant scoping at the query.** Every table carrying tenant data has `org_id` and every query filters on the session's `orgId`;
   foreign IDs supplied by the client (services, users, deployments) are validated to belong to the same org before use.
5. **Pay for what you render.** Heavy views (ECharts, React Flow, forms/zod) are lazy-loaded; large lists are virtualized; high-frequency
   data is batched and kept out of React state where possible.

## API process

| Module | Responsibility |
|---|---|
| `plugins.ts` | session resolution from the `nexus_session` cookie (hashed token lookup), CSRF header check, error mapping (`HttpError`, `ZodError`) |
| `routes/*` | thin HTTP layer: parse (zod) → authorize → call domain |
| `domain/incidents.ts` | lifecycle: create/update/comment/link inside transactions, row lock (`FOR UPDATE`), optimistic `version`, audit + timeline writes |
| `domain/alerts.ts` | rule evaluation, de-duplication (partial unique index) + cooldown, notifications, optional auto-incident |
| `sim/registry.ts` | builds/caches `SimModel` per (org, env) from services, dependency edges and `faults` rows |
| `sim/engine.ts` | live loop: generates deterministic events since the last tick, persists them (`ON CONFLICT DO NOTHING`), emits batches + metric ticks; deterministic "chaos" fault injection |
| `sim/traces.ts` | causally-consistent span tree generator (used by the seed) |
| `realtime/socket.ts` | Socket.IO auth by cookie, per-org/env rooms, 5 s heartbeat |
| `ai/assistant.ts` | evidence gathering + rule-based findings; optional LLM narrative via fetch |

A separate `worker` process was deliberately **not** split out: the simulator and evaluator are idempotent functions of wall-clock time,
so they can run in the API process for a single-node deployment. They are isolated modules (`SimEngine`, `startEvaluator`) that can be moved
to their own process behind a Redis pub/sub bus when horizontal scaling is needed — see [tradeoffs](tradeoffs.md).

## Simulation

* **Metrics.** 15-second samples. `request_rate` follows a diurnal/weekly curve with noise; `latency_ms` is a *per-sampled-request*
  latency drawn from a log-normal whose median depends on load and faults — so percentile aggregation over raw samples is meaningful.
  `error_rate`, `cpu`, `memory` likewise. Noise is hash-based (`gaussian(org, env, service, metric, slot)`), so the same timestamp always yields the same value.
* **Faults** (`error_spike`, `latency`, `outage`, `saturation`) have a magnitude and a 90 s ramp. A direct fault is *measured* on its service;
  a weaker effect **propagates to callers** through the dependency graph. The UI distinguishes the two (`inferredOnly`, `atRisk`).
* **Health** per service is derived from the trailing 60 s: unavailable if error ≥ 20 % (or outage), degraded if error ≥ 2 % or p95 ≥ 2× the service's own baseline.
* **Events** are generated per (service, 10 s bucket) as a Poisson draw whose rate scales with fault stress; ids are deterministic, so restarts never duplicate.
* **Chaos.** Every 20-minute slot a hash decides whether to inject a 6–12 minute fault into a tier ≤ 2 service in production. This keeps the demo alive
  (alerts fire, incidents auto-open for `outage`-level health rules) and is idempotent (`faults.chaos_key` unique).
* The seed places two ongoing scenarios (Payments DB saturation after a deploy; Search latency), one recent resolved edge outage and ~14 days of history anchored to "now".

## Frontend structure

```
src/
  app/            AppShell, Sidebar, Topbar, MobileNav, NotificationCenter, CreateIncidentDialog, LoginPage
  components/     ui/ (shadcn), Overlay (Motion modal/drawer), SchemaForm, EChart, TimeSeriesChart, primitives
  features/       auth, command (registry + palette), realtime (client, buffer, store), graph (layout), traces (span tree), incidents
  pages/          one lazy route component per navigation item (+ detail pages)
  lib/ stores/    api client, motion tokens, chart theme, queries, zustand stores
```

State boundaries: **server state** → TanStack Query; **live streaming state** → `useLive` (Zustand, selector-subscribed per service);
**UI state** (sidebar, theme, env, range, palette) → `useUi`; **URL state** for filterable pages (shareable).
