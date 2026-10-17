# Performance report

All numbers below were **measured on one machine in one session** and are not benchmarks or guarantees:
Apple M4 · 10 cores · 16 GB · Node 24 · headless Chromium (Playwright) · API + PostgreSQL on localhost · production build served by `vite preview`
· **no CPU or network throttling** (so absolute times are optimistic compared with real devices). Raw output: [`perf-results.json`](perf-results.json);
reproduce with `pnpm --filter @nexus/web build && pnpm --filter @nexus/web exec vite preview` then `pnpm --filter @nexus/web perf`.

## Bundle (from `vite build`, gzip)

| Chunk | gzip | Loaded |
|---|---|---|
| `index` (app shell, router, stores, shadcn, palette) | 70.0 kB | initially |
| `vendor` (React, React DOM, Router, TanStack Query) | 118.9 kB | initially |
| `motion` | 44.7 kB | initially |
| `realtime` (socket.io-client) | 13.0 kB | initially |
| CSS | 17.4 kB | initially |
| **Initial JS total** | **≈ 246.6 kB** (+ 17.4 kB CSS) | |
| `echarts` | ≈ 224 kB | lazily, first time a chart renders |
| `flow` (React Flow) | 58.9 kB | only on the dependency map |
| `forms` (zod + react-hook-form) | ≈ 27 kB | when a form/login is opened |
| per-route page chunks | 0.5–6.7 kB each | on navigation |

Before this work the initial JS was ≈ 276 kB gzip (zod, react-hook-form and the create-incident dialog were in the entry). Changes: split
`@nexus/shared` into a zod-free `core` entry for the web app, lazy-loaded the login page and create-incident dialog, and moved to function-based chunking.
The ECharts chunk is large; only the modules used (line/bar, grid, tooltip, legend, brush, mark-area, canvas) are registered, but ECharts' core still dominates. It is
never on the critical path of the shell.

## Runtime (production build)

| Scenario | Result |
|---|---|
| Cold load of the authenticated dashboard, median of 5 | FCP **72 ms**, LCP **612 ms**, CLS **0.016**, total blocking time **0 ms**, DCL 24 ms |
| Event stream, **73,923** stored events, 120 programmatic scroll steps top→bottom | DOM rows: **37** at top, **38** after scrolling to the end; **806** DOM nodes on the whole page; frame time p50 16.7 ms, p95 16.8 ms, max 16.8 ms (vsync-bound), **0** frames > 50 ms |
| Command palette, 8 runs | open→input focused median **12 ms**; typed query→first result median **7 ms** (wall-clock around Playwright calls, includes its round-trip) |
| Interaction latency (Event Timing, all interactions in the palette run, n = 147) | p50 16 ms, max **56 ms** (max > 50 ms means a worst-case "needs improvement" interaction occurred once) |
| Dashboard receiving live updates, 20 s | **0** long tasks (> 50 ms) |
| Memory: 48 route navigations (6 × 8 routes), forced GC before/after | heap 14.2 MB → 16.0 MB (**+1.8 MB**, not growth-per-navigation proof; no runaway growth observed) |

### What these do *not* show
* Real-device or throttled-CPU performance, mobile networks, or INP in the field (RUM). Lighthouse was not run.
* The LCP element is the dashboard's first chart/heading and includes a client-side data fetch; it is fast here because API and browser share a host.
* The "+1.8 MB" memory figure comes from a single run; a longer soak test was not performed.
* Server throughput/latency under load was not benchmarked.

## Techniques and where they are
| Technique | Where |
|---|---|
| Route code splitting, lazy heavy visualisations | `App.tsx` (`lazy`), `EChart.tsx` (dynamic `import`), `DependencyMap` chunk |
| Virtualization | event stream (`@tanstack/react-virtual`, sparse page cache), trace waterfall |
| WebSocket batching, bounded buffers, dedupe | `features/realtime/*` (250 ms flush, 5 000-event cap) |
| Selector-level subscriptions | `useLive(s => s.services[key])` in table rows and graph nodes; identity preserved for unchanged services |
| Query caching, refetch intervals, `placeholderData` | TanStack Query defaults in `main.tsx`, per-page overrides |
| Debounced search | palette (180 ms), incidents/traces/audit/events (250 ms) |
| Server-side pagination | incidents, traces, deployments, alerts, audit, events (offset pages) |
| Bounded server work | metrics range ≤ 8 d, ≤ 12 series, stride sampling for long ranges (`strideFor`), `impact()` memo in `SimModel` |
| Error boundaries & subscription cleanup | `ErrorBoundary` per page; `useEffect` cleanups for sockets, observers, intervals; chart dispose on unmount |
| Chart updates | in-place `setOption` with `replaceMerge: ['series']`; canvas renderer; ResizeObserver |
