# API reference (v1)

Base path `/api/v1`. JSON in/out. Auth is a `nexus_session` **HttpOnly, SameSite=Lax** cookie.
Every mutating request (`POST/PUT/PATCH/DELETE`) must send `x-nexus-client: web` (CSRF defence in depth). Errors share one shape:

```json
{ "error": { "code": "forbidden", "message": "Missing permission: incident:resolve", "details": null } }
```

Status codes: `400` validation / invalid transition, `401` unauthenticated, `403` missing permission or CSRF header, `404` not found **or not in your tenant**,
`409` optimistic-concurrency conflict, `429` login rate limit.

Probes (no prefix): `GET /healthz` (liveness), `GET /readyz` (checks the database).

| Method & path | Permission | Notes |
|---|---|---|
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | – | login rate-limited: 8 failures / 5 min per IP+email |
| `POST /auth/switch-org` `{orgId}` | membership | updates the session's active org |
| `GET /overview?env&from&to&services` | `service:read` | KPIs + series for the dashboard |
| `GET /services?env` · `GET /services/:id` · `PATCH /services/:id/config` | `service:read` / `service:write` | live health computed per request |
| `GET /graph?env` | `service:read` | nodes (measured), edges, `inferredImpact` (inferred) |
| `GET /metrics/catalog` · `GET /metrics/query` | `service:read` | `metric, services, env, from, to, step, agg(avg/min/max/p50/p95/p99), compare` — invalid metric/agg combos → 400 |
| `GET /events` · `GET /events/histogram` | `service:read` | `q, types, severities, services, from, to, before, limit(≤500), offset, total=false` |
| `GET /traces` · `GET /traces/:traceId` | `service:read` | filters: `q` (id prefix), `service`, `status`, `minDuration`, `maxDuration`, `sort` |
| `GET /incidents` | `incident:read` | `q, status, severity, owner(me/unassigned/id), serviceId, active, sort, dir, page, pageSize` |
| `POST /incidents` | `incident:create` | |
| `GET /incidents/:id` | `incident:read` | detail + timeline + links + `version` |
| `PATCH /incidents/:id` | `incident:update` (+ `incident:resolve` for resolved) | `status, severity, ownerId, responderIds, serviceIds, title, summary, notes, expectedVersion` |
| `POST /incidents/:id/comments` · `/links` | `incident:comment` / `incident:update` | mentions notify members |
| `POST /incidents/:id/analysis` | `ai:use` + `ai-assistant` flag | rule-based or provider narrative |
| `GET /alert-rules` · `POST` · `PUT /:id` · `PATCH /:id/enabled` · `DELETE /:id` | `alert:read` / `alert:write` | |
| `GET /alerts` · `POST /alerts/:id/ack` · `POST /alerts/:id/incident` | `alert:read` / `alert:ack` / `incident:create` | |
| `GET /deployments` · `POST /deployments` | `deployment:read` / `deployment:write` | |
| `GET /team` · `POST /team` · `PATCH /team/:userId` · `DELETE /team/:userId` | `team:read` / `team:write` | last admin cannot be demoted |
| `GET /audit` | `audit:read` | |
| `GET /flags` · `PUT /flags` | `flag:read` / `flag:write` | org/env overrides only |
| `GET /notifications` · `POST /notifications/read` | session | |
| `GET /settings` · `PATCH /settings` | `settings:read` / `settings:write` | |
| `GET /search?q` | `incident:read` | incidents, services, traces (hex prefix), events |

## Incident state machine

```
triggered ─▶ acknowledged ─▶ investigating ─▶ mitigated ─▶ resolved ─▶ (reopen) investigating
     └──────────────▶ investigating / resolved           mitigated ─▶ investigating
```
Implemented once in `@nexus/shared/incident.ts`; enforced by `PATCH /incidents/:id`. `acknowledgedAt` is set on the first transition out of
`triggered`; `resolvedAt` on `resolved` and cleared on reopen.

## Socket.IO contract (`@nexus/shared/types.ts`)

Server → client: `events:batch {events, seq}`, `metrics:tick {t, env, services}`, `incident:changed`, `alert:fired`, `notification:new`, `heartbeat`.
Client → server: `subscribe {env}` (ack), `heartbeat:ack`.
