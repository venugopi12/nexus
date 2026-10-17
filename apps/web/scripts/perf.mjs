/**
 * Measures the production build in headless Chromium and writes docs/perf-results.json.
 *   pnpm --filter @nexus/web build && pnpm --filter @nexus/web exec vite preview &   (port 4273)
 *   pnpm --filter @nexus/web perf
 * Requires the API + seeded DB to be running. Numbers are from THIS machine/run; see docs/performance.md.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';

const base = process.env.PERF_BASE ?? 'http://localhost:4273';
const out = new URL('../../../docs/perf-results.json', import.meta.url);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] ?? 0;

const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const login = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(base + '/login');
  await p.fill('#email', 'sre@acme.nexus.dev');
  await p.fill('#password', 'nexus-demo-2026');
  await p.click('button[type=submit]');
  await p.waitForURL(base + '/');
  await p.close();
};
const probe = `
  window.__perf = { lcp: 0, cls: 0, longTasks: [], fcp: 0, events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__perf.events.push({ name: e.name, dur: e.duration }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
`;
const result = { measuredAt: new Date().toISOString(), machine: `${os.cpus()[0].model} · ${os.cpus().length} cores · ${(os.totalmem() / 2 ** 30).toFixed(0)} GB · node ${process.version}`, base, runs: {} };

// --- 1. cold load of the dashboard (authenticated), 5 runs, throttled CPU 4x is NOT applied: raw local numbers
const loads = [];
for (let i = 0; i < 5; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(probe);
  const t0 = Date.now();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=System health');
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => ({ ...window.__perf, nav: performance.getEntriesByType('navigation')[0].toJSON() }));
  const res = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js')).map((r) => r.decodedBodySize));
  loads.push({ lcp: m.lcp, fcp: m.fcp, cls: m.cls, tbt: m.longTasks.reduce((a, t) => a + Math.max(0, t.dur - 50), 0), dcl: m.nav.domContentLoadedEventEnd, load: m.nav.loadEventEnd, ready: Date.now() - t0, jsBytes: res.reduce((a, b) => a + b, 0), jsReq: res.length });
  await ctx.close();
}
const agg = (k) => Number(median(loads.map((l) => l[k])).toFixed(k === 'cls' ? 4 : 0));
result.runs.coldLoad = { runs: loads.length, median: Object.fromEntries(['fcp', 'lcp', 'cls', 'tbt', 'dcl', 'load', 'jsBytes', 'jsReq'].map((k) => [k, agg(k)])), note: 'jsBytes/cssBytes are response content-length (gzip when the server compresses; vite preview does not compress, so raw sizes are reported here — see bundle table for gzip).' };

// --- authed context for the remaining scenarios
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await login(ctx);
const page = await ctx.newPage();
await page.addInitScript(probe);
const cdp = await ctx.newCDPSession(page);
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); return (await page.evaluate(() => performance.memory.usedJSHeapSize)) / 2 ** 20; };

// --- 2. event stream with the full seeded set: virtualization + scroll smoothness
await page.goto(base + '/events', { waitUntil: 'networkidle' });
await page.waitForSelector('[role=row][aria-rowindex]');
const total = await page.evaluate(() => Number(document.querySelector('[role=table][aria-label=Events]').getAttribute('aria-rowcount')));
const domRowsTop = await page.locator('[role=row][aria-rowindex]').count();
const scroll = await page.evaluate(async () => {
  const el = document.querySelector('[role=table][aria-label=Events] .overflow-y-auto');
  const frames = [];
  let last = performance.now();
  let running = true;
  const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const max = el.scrollHeight - el.clientHeight;
  const t0 = performance.now();
  for (let i = 1; i <= 120; i++) { el.scrollTop = (max * i) / 120; await new Promise((r) => requestAnimationFrame(r)); }
  const elapsed = performance.now() - t0;
  running = false;
  return { frames, elapsed, maxDomRows: document.querySelectorAll('[role=row][aria-rowindex]').length, nodes: document.getElementsByTagName('*').length };
});
await page.waitForTimeout(800);
result.runs.eventStream = {
  totalRows: total, domRowsAtTop: domRowsTop, domRowsAfterScrollToEnd: scroll.maxDomRows, totalDomNodes: scroll.nodes,
  scroll: { steps: 120, elapsedMs: Math.round(scroll.elapsed), frameP50: Number(median(scroll.frames).toFixed(1)), frameP95: Number(pct(scroll.frames, 95).toFixed(1)), frameMax: Number(Math.max(...scroll.frames).toFixed(1)), framesOver50ms: scroll.frames.filter((f) => f > 50).length },
};

// --- 3. interaction latency: command palette open + type + result
await page.goto(base + '/', { waitUntil: 'networkidle' });
const palette = [];
for (let i = 0; i < 8; i++) {
  const t0 = Date.now();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#palette-input:focus');
  const open = Date.now() - t0;
  const t1 = Date.now();
  await page.keyboard.type('traces', { delay: 0 });
  await page.waitForSelector('[role=option]:has-text("Distributed Traces")');
  palette.push({ open, firstResult: Date.now() - t1 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#palette-input', { state: 'detached' });
}
const inp = await page.evaluate(() => window.__perf.events.map((e) => e.dur));
result.runs.commandPalette = { runs: palette.length, openMsMedian: median(palette.map((p) => p.open)), typeToResultMsMedian: median(palette.map((p) => p.firstResult)), interactionDurationsMs: { count: inp.length, p50: median(inp), max: Math.max(0, ...inp) }, note: 'wall-clock around Playwright actions; includes Playwright round-trip overhead' };

// --- 4. live dashboard under streaming load: long tasks during 20s idle observation
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__perf.longTasks = []; });
await page.waitForTimeout(20000);
const lt = await page.evaluate(() => window.__perf.longTasks);
result.runs.liveIdle20s = { longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt.map((t) => t.dur))), totalBlockingMs: Math.round(lt.reduce((a, t) => a + Math.max(0, t.dur - 50), 0)) };

// --- 5. memory: heap after repeated route navigation (leak check)
const routes = ['/', '/incidents', '/services', '/metrics', '/traces', '/events', '/map', '/alerts'];
await page.goto(base + '/', { waitUntil: 'networkidle' });
for (const r of routes) { await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, r); await page.waitForTimeout(600); }
const h0 = await heap();
for (let round = 0; round < 6; round++) for (const r of routes) { await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, r); await page.waitForTimeout(350); }
await page.waitForTimeout(1500);
const h1 = await heap();
result.runs.memoryAfterNavigation = { navigations: routes.length * 6, heapBeforeMB: Number(h0.toFixed(1)), heapAfterMB: Number(h1.toFixed(1)), deltaMB: Number((h1 - h0).toFixed(1)), note: 'after forced GC; routes cycled 6×' };

fs.mkdirSync(new URL('.', out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
