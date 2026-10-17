# Security

| Area | What is implemented | Where |
|---|---|---|
| Passwords | argon2id (19 MiB, t=2); unknown-user logins still run a verification against a dummy hash to avoid a timing oracle | `lib/password.ts`, `routes/auth.ts` |
| Sessions | 256-bit random token; **only its SHA-256 is stored**; HttpOnly + SameSite=Lax cookie (`Secure` via `COOKIE_SECURE=true`); server-side expiry (`SESSION_TTL_HOURS`); logout deletes the row | `plugins.ts` |
| Brute force | 8 failed logins / 5 min per IP+email → 429 (in-memory; use a shared store behind multiple replicas) | `routes/auth.ts` |
| CSRF | SameSite=Lax + required `x-nexus-client` header on all mutating requests + CORS limited to `WEB_ORIGIN` | `plugins.ts`, `app.ts` |
| Authorization | explicit permission strings; role→permission matrix in `@nexus/shared/permissions.ts`; **every route calls `need(req, perm)`** | all `routes/*` |
| Multi-tenancy | `org_id` on every tenant table; every query filters by the session org; client-supplied ids (services, users, deployments, alert ids, trace links) are verified to belong to the org; cross-tenant ids return **404** (no existence leak) | `domain/*`, `routes/*` |
| Org switching | membership checked server-side; role is re-derived per org from the DB on every request | `routes/auth.ts`, `plugins.ts` |
| Audit | sign-in/out, org switch, incident create/status/severity/owner/comment/link, alert rule + alert actions, member add/role/remove, flag and settings changes, service config, deployments, AI analysis | `lib/audit.ts` |
| Input validation | zod on request bodies (shared schemas), ids validated as UUIDs, bounded page sizes, bounded metric range (8 d) and series count | routes |
| Secrets | all via env (`env.ts` validates); `.env` is git-ignored; AI key is server-side only; logs redact cookie/authorization headers | `env.ts`, `app.ts` |
| Output | React escapes by default; no `dangerouslySetInnerHTML`; chart tooltips are built from server numbers and fixed strings | web |
| Headers | nginx sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` (CSP is **not** configured) | `infrastructure/nginx` |

## Tests that guard this (`apps/api/test/api.test.ts`)
unauthenticated → 401; bad credentials → 401; only a hash of the token is stored; CSRF header required; viewer cannot create/update/read audit/add members;
engineer cannot resolve; cross-tenant read/patch/comment/link/trace/service → 404; cross-tenant service attached to own incident → 400;
org switch to a non-member org → 403; multi-org user has different roles per org; Socket.IO rejects unauthenticated clients and delivers only the caller's tenant.

## Known gaps (honest list)
No password change/reset flow, no MFA, no email verification, no per-user session management UI, no CSP, login limiter is in-memory,
demo password is shared across seeded users, WebSocket origin is checked only by CORS config, secrets rotation is manual.
