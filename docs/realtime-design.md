# Real-time design

## Server

* **Transport.** Socket.IO attached to the Fastify HTTP server. The handshake is authenticated from the session cookie (`io.use`); no token in
  the URL. On `subscribe {env}` the socket is moved into rooms `org:{id}`, `org:{id}:env:{env}` and `user:{id}`. Rooms are derived from the
  **re-resolved session** each time, so an org switch is honoured and a revoked session disconnects.
* **Ticker.** `SimEngine.tick()` every `SIM_TICK_MS` (2 s): for each org × environment it generates the deterministic events whose timestamps fall in
  `(lastTs, now]`, inserts them (idempotent), and emits one `events:batch` (≤ 400 events; larger gaps are catch-up and are recovered via REST) plus one
  `metrics:tick` (health/rps/error/latency per service, computed by the same `SimModel` that serves REST queries).
* **Startup catch-up.** Cursors start at the newest persisted event (max 6 h back) so a restart neither duplicates nor floods.
* **Heartbeat.** Server emits `heartbeat` every 5 s; clients ack. Socket.IO ping interval 10 s / timeout 8 s.
* **Scaling note.** Rooms are in-process. For several API replicas add the Socket.IO Redis adapter and move the engine to a single leader/worker;
  not implemented (no Redis is required for the single-node deployment this repo ships).

## Client (`features/realtime`)

| Concern | Implementation |
|---|---|
| Connection status | `connecting → connected → stale → reconnecting → offline`, shown in the top bar with attempt count and next retry |
| Reconnect | own scheduler (`reconnection:false` on the socket) using **exponential backoff with full jitter**: `delay ∈ [250ms, min(20s, 500ms·2ⁿ)]`; attempt counter resets on success; `retryNow()` for manual retry |
| Heartbeat watchdog | no message for 15 s → `stale` (banner on the event stream); 35 s → force reconnect |
| Recovery | after a *re*connect `onRecovered` invalidates all queries so missed incidents/alerts/history are refetched; the event stream re-snapshots |
| Batching | socket events are buffered and handed to React at most every 250 ms (`flushMs`) |
| De-duplication & ordering | `EventBuffer` drops repeated ids (also after reconnect), inserts out-of-order arrivals at the right position (newest-first) |
| Bounded memory | live buffer capped at 5 000 events (evicted ids are forgotten); held-while-paused buffer also capped |
| Pause / resume | while paused, events accumulate in a separate bounded buffer and merge on resume; the UI shows how many are held |
| Re-render isolation | `metrics:tick` updates one Zustand map; each table row / graph node subscribes with `useLive(s => s.services[key])`, and unchanged services keep object identity so their selectors do not fire |

## Event stream with 100k+ rows

`pages/EventStream.tsx` renders `liveRows ++ historyRows` through TanStack Virtual (34 px rows, overscan 20):

* **Live part** — events newer than the page's *snapshot timestamp*, filtered client-side with the same predicate the server uses.
* **History part** — a *sparse page cache* (`useEventHistory`): pages of 100 rows are fetched with `offset/limit` only when the virtualizer's visible range
  needs them, pinned to `before=snapshot` so row indices stay stable while new events stream in. Total count comes from page 0.
* "Jump to latest" or a reconnect re-snapshots. Only ~40–60 DOM rows exist regardless of the 70k–100k total (measured in [performance.md](performance.md)).

Tested: backoff bounds, reconnect/reset, batching, stale detection, forced reconnect, dedupe, ordering, bounded eviction
(`apps/web/src/features/realtime/realtime.test.ts`); tenant-scoped Socket.IO delivery and unauthenticated rejection (`apps/api/test/api.test.ts`).
