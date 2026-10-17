import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  METRICS, autoStepMs, mean, percentile, strideFor, type Aggregation, type MetricKey, type MetricSeries, type OverviewDto, type Severity,
} from '@nexus/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { need, parse } from '../plugins';
import { badRequest } from '../lib/errors';

const querySchema = z.object({
  metric: z.enum(METRICS.map((m) => m.key) as [MetricKey, ...MetricKey[]]),
  services: z.string().optional(),
  env: z.string().default('production'),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  step: z.coerce.number().int().optional(),
  agg: z.enum(['avg', 'min', 'max', 'p50', 'p95', 'p99']).default('avg'),
  compare: z.enum(['true', 'false']).default('false'),
});

const MAX_RANGE = 8 * 86400_000;

export async function metricRoutes(app: FastifyInstance) {
  app.get('/metrics/catalog', async (req) => {
    need(req, 'service:read');
    return { metrics: METRICS, simulated: true };
  });

  app.get('/metrics/query', async (req) => {
    const a = need(req, 'service:read');
    const q = parse(querySchema, req.query);
    if (q.to <= q.from) throw badRequest('`to` must be after `from`');
    if (q.to - q.from > MAX_RANGE) throw badRequest('Range too large (max 8 days)');
    const def = METRICS.find((m) => m.key === q.metric)!;
    if (!(def.aggs as readonly string[]).includes(q.agg)) throw badRequest(`Aggregation ${q.agg} is not valid for ${q.metric}`);
    const info = await app.ctx.registry.org(a.orgId);
    const model = await app.ctx.registry.model(a.orgId, q.env);
    const keys = (q.services ? q.services.split(',') : info.profiles.slice(0, 1).map((p) => p.key)).slice(0, 12);
    const unknown = keys.filter((k) => !info.idByKey.has(k));
    if (unknown.length) throw badRequest(`Unknown services: ${unknown.join(', ')}`);
    const range = q.to - q.from;
    const step = q.step ?? autoStepMs(range);
    const stride = strideFor(range, 3000);
    const series: (MetricSeries & { compare?: boolean })[] = [];
    for (const key of keys) {
      const name = info.rows.find((r) => r.key === key)!.name;
      series.push({ serviceKey: key, serviceName: name, metric: q.metric, agg: q.agg, points: model.series(key, q.metric, q.from, q.to, step, q.agg as Aggregation, stride) });
      if (q.compare === 'true') {
        const shifted = model.series(key, q.metric, q.from - range, q.to - range, step, q.agg as Aggregation, stride).map((p) => ({ t: p.t + range, v: p.v }));
        series.push({ serviceKey: key, serviceName: `${name} (previous period)`, metric: q.metric, agg: q.agg, points: shifted, compare: true });
      }
    }
    return { simulated: true, unit: def.unit, step, sampledEvery: stride > 1 ? stride * 15 : 15, series };
  });

  app.get('/overview', async (req): Promise<OverviewDto> => {
    const a = need(req, 'service:read');
    const q = req.query as Record<string, string | undefined>;
    const env = q.env ?? 'production';
    const now = Date.now();
    const to = q.to ? Number(q.to) : now;
    const from = q.from ? Number(q.from) : to - 3_600_000;
    if (to <= from || to - from > MAX_RANGE) throw badRequest('Invalid range');
    const info = await app.ctx.registry.org(a.orgId);
    const model = await app.ctx.registry.model(a.orgId, env);
    const filter = q.services ? new Set(q.services.split(',')) : null;
    const pool = info.profiles.filter((p) => !filter || filter.has(p.key));
    if (!pool.length) throw badRequest('No services match filter');
    const user = pool.filter((p) => p.kind === 'edge' || p.kind === 'service');
    const traffic = (user.length ? user : pool);
    const edges = pool.filter((p) => p.kind === 'edge');
    const step = autoStepMs((to - from) * 2); // ~60 points: enough samples per bucket for stable percentiles
    const stride = strideFor(to - from, 1500);

    // per-bucket aggregation across services
    const buckets: number[] = [];
    for (let b = Math.floor(from / step) * step; b < to; b += step) buckets.push(b);
    const idx = (t: number) => Math.min(buckets.length - 1, Math.floor((t - buckets[0]!) / step));
    const tput: (number | null)[] = buckets.map(() => null);
    const errNum = buckets.map(() => 0);
    const errDen = buckets.map(() => 0);
    const lat: number[][] = buckets.map(() => []);
    for (const svc of traffic) {
      const rps = model.samples(svc.key, 'request_rate', from, to, stride);
      const err = model.samples(svc.key, 'error_rate', from, to, stride);
      const l = model.samples(svc.key, 'latency_ms', from, to, stride);
      const isIngress = edges.length ? svc.kind === 'edge' : true;
      const sum = buckets.map(() => 0);
      const cnt = buckets.map(() => 0);
      rps.forEach((p, i) => {
        const bi = idx(p.t);
        sum[bi]! += p.v;
        cnt[bi]!++;
        errNum[bi]! += err[i]!.v * p.v;
        errDen[bi]! += p.v;
      });
      if (isIngress) sum.forEach((v, i) => { if (cnt[i]) tput[i] = (tput[i] ?? 0) + v / cnt[i]!; });
      l.forEach((p) => lat[idx(p.t)]!.push(p.v));
    }
    const tputSeries = buckets.map((t, i) => ({ t, v: tput[i] ?? null }));
    const errSeries = buckets.map((t, i) => ({ t, v: errDen[i]! > 0 ? errNum[i]! / errDen[i]! : null }));
    const avgSeries = buckets.map((t, i) => ({ t, v: lat[i]!.length ? mean(lat[i]!) : null }));
    const p95Series = buckets.map((t, i) => ({ t, v: lat[i]!.length ? percentile(lat[i]!, 95) : null }));
    const p99Series = buckets.map((t, i) => ({ t, v: lat[i]!.length ? percentile(lat[i]!, 99) : null }));
    const liveLat = traffic.flatMap((p) => model.samples(p.key, 'latency_ms', now - 120_000, now).map((x) => x.v));

    const healths = pool.map((p) => model.health(p.key, now));
    const count = (st: string) => healths.filter((h) => h.status === st).length;
    const totalRps = edges.length ? edges.reduce((acc, e) => acc + model.health(e.key, now).rps, 0) : healths.reduce((acc, h) => acc + h.rps, 0);
    const wErr = healths.reduce((acc, h) => acc + h.errorRate * h.rps, 0) / Math.max(1, healths.reduce((acc, h) => acc + h.rps, 0));
    const unavailable = count('unavailable');
    const degraded = count('degraded');
    const score = Math.max(0, Math.round(100 - (unavailable * 22 + degraded * 8) * (17 / Math.max(pool.length, 8))));
    const rows = await app.ctx.db.select({ severity: s.incidents.severity, n: sql<number>`count(*)::int` }).from(s.incidents).where(and(eq(s.incidents.orgId, a.orgId), eq(s.incidents.environment, env), ne(s.incidents.status, 'resolved'))).groupBy(s.incidents.severity);
    const bySev: Record<Severity, number> = { 'SEV-1': 0, 'SEV-2': 0, 'SEV-3': 0, 'SEV-4': 0 };
    rows.forEach((r) => (bySev[r.severity as Severity] = r.n));
    const [{ n: activeAlerts } = { n: 0 }] = await app.ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.alerts).where(and(eq(s.alerts.orgId, a.orgId), ne(s.alerts.status, 'resolved')));
    return {
      simulated: true, now, range: { from, to, stepMs: step },
      totals: {
        rps: totalRps, errorRate: wErr, avgLatency: mean(liveLat), p95: percentile(liveLat, 95), p99: percentile(liveLat, 99),
        healthy: count('healthy'), degraded, unavailable, health: unavailable > 0 ? 'unavailable' : degraded > 0 ? 'degraded' : 'healthy', score,
      },
      series: { throughput: tputSeries, errorRate: errSeries, avg: avgSeries, p95: p95Series, p99: p99Series },
      incidentsBySeverity: bySev, activeAlerts,
    };
  });
}
