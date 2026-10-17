import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { TraceDetail, TraceSummary } from '@nexus/shared';
import * as s from '../db/schema';
import { need } from '../plugins';
import { notFound } from '../lib/errors';

const toSummary = (t: typeof s.traces.$inferSelect): TraceSummary => ({
  traceId: t.traceId, rootService: t.rootService, rootOperation: t.rootOperation, startMs: t.startAt.getTime(), durationMs: t.durationMs, spanCount: t.spanCount, errorCount: t.errorCount, status: t.status as 'ok' | 'error', services: t.services,
});

export async function traceRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get('/traces', async (req) => {
    const a = need(req, 'service:read');
    const q = req.query as Record<string, string | undefined>;
    const where: (SQL | undefined)[] = [eq(s.traces.orgId, a.orgId), eq(s.traces.environment, q.env ?? 'production')];
    if (q.q) where.push(ilike(s.traces.traceId, `${q.q.replace(/[^a-f0-9]/gi, '')}%`));
    if (q.service) where.push(sql`${s.traces.services} ? ${q.service}`);
    if (q.minDuration) where.push(gte(s.traces.durationMs, Number(q.minDuration)));
    if (q.maxDuration) where.push(lte(s.traces.durationMs, Number(q.maxDuration)));
    if (q.status === 'ok' || q.status === 'error') where.push(eq(s.traces.status, q.status));
    if (q.from) where.push(gte(s.traces.startAt, new Date(Number(q.from))));
    if (q.to) where.push(lte(s.traces.startAt, new Date(Number(q.to))));
    const cond = and(...where);
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const page = Math.max(1, Number(q.page ?? 1));
    const order = q.sort === 'duration' ? desc(s.traces.durationMs) : desc(s.traces.startAt);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.traces).where(cond);
    const rows = await ctx.db.select().from(s.traces).where(cond).orderBy(order).limit(pageSize).offset((page - 1) * pageSize);
    return { simulated: true, items: rows.map(toSummary), total: n, page, pageSize };
  });

  app.get('/traces/:traceId', async (req): Promise<TraceDetail & { simulated: true }> => {
    const a = need(req, 'service:read');
    const traceId = (req.params as { traceId: string }).traceId;
    const [t] = await ctx.db.select().from(s.traces).where(and(eq(s.traces.traceId, traceId), eq(s.traces.orgId, a.orgId)));
    if (!t) throw notFound('Trace');
    const spans = await ctx.db.select().from(s.spans).where(eq(s.spans.traceId, traceId)).orderBy(asc(s.spans.startOffsetMs), asc(s.spans.id));
    const links = await ctx.db.select({ incidentId: s.incidentLinks.incidentId }).from(s.incidentLinks).where(and(eq(s.incidentLinks.orgId, a.orgId), eq(s.incidentLinks.kind, 'trace'), eq(s.incidentLinks.refId, traceId)));
    // incidents whose affected service+time window overlap this trace
    const info = await ctx.registry.org(a.orgId);
    const svcIds = t.services.map((k) => info.idByKey.get(k)).filter(Boolean) as string[];
    const overlap = svcIds.length
      ? await ctx.db.select({ id: s.incidents.id }).from(s.incidents).innerJoin(s.incidentServices, eq(s.incidentServices.incidentId, s.incidents.id)).where(and(eq(s.incidents.orgId, a.orgId), inArray(s.incidentServices.serviceId, svcIds), lte(s.incidents.createdAt, t.startAt), sql`(${s.incidents.resolvedAt} is null or ${s.incidents.resolvedAt} >= ${t.startAt})`)).limit(5)
      : [];
    return {
      simulated: true, ...toSummary(t),
      spans: spans.map((x) => ({ spanId: x.spanId, parentId: x.parentId, serviceKey: x.serviceKey, operation: x.operation, startOffsetMs: x.startOffsetMs, durationMs: x.durationMs, status: x.status as 'ok' | 'error', attributes: x.attributes })),
      incidentIds: [...new Set([...links.map((l) => l.incidentId), ...overlap.map((o) => o.id)])],
    };
  });
}
