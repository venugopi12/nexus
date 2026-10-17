import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ilike, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { EventDto } from '@nexus/shared';
import * as s from '../db/schema';
import { need } from '../plugins';

const csv = (v?: string) => (v ? v.split(',').filter(Boolean) : []);

export async function eventRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  const buildWhere = async (orgId: string, q: Record<string, string | undefined>) => {
    const info = await ctx.registry.org(orgId);
    const where: (SQL | undefined)[] = [eq(s.events.orgId, orgId), eq(s.events.environment, q.env ?? 'production')];
    if (q.from) where.push(gte(s.events.ts, new Date(Number(q.from))));
    if (q.to) where.push(lte(s.events.ts, new Date(Number(q.to))));
    if (q.before) where.push(lt(s.events.ts, new Date(Number(q.before))));
    const types = csv(q.types);
    if (types.length) where.push(inArray(s.events.type, types));
    const sev = csv(q.severities);
    if (sev.length) where.push(inArray(s.events.severity, sev));
    const svcIds = csv(q.services).map((k) => info.idByKey.get(k)).filter(Boolean) as string[];
    if (csv(q.services).length) where.push(svcIds.length ? inArray(s.events.serviceId, svcIds) : sql`false`);
    if (q.q) where.push(ilike(s.events.message, `%${q.q.replace(/[%_]/g, '\\$&')}%`));
    return { cond: and(...where), info };
  };

  app.get('/events', async (req) => {
    const a = need(req, 'service:read');
    const q = req.query as Record<string, string | undefined>;
    const { cond, info } = await buildWhere(a.orgId, q);
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? 100)));
    const offset = Math.max(0, Number(q.offset ?? 0));
    const rows = await ctx.db.select().from(s.events).where(cond).orderBy(desc(s.events.ts), desc(s.events.id)).limit(limit).offset(offset);
    const items: EventDto[] = rows.map((r) => {
      const key = r.serviceId ? info.keyById.get(r.serviceId) ?? '' : '';
      return { id: r.id, ts: r.ts.getTime(), serviceKey: key, serviceId: r.serviceId, serviceName: info.rows.find((x) => x.key === key)?.name ?? key, type: r.type as never, severity: r.severity as never, message: r.message, attributes: r.attributes, environment: r.environment };
    });
    const total = q.total === 'false' ? -1 : (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.events).where(cond))[0]!.n;
    return { items, total, offset, limit };
  });

  /** Event density histogram used by the stream header and chart brush. */
  app.get('/events/histogram', async (req) => {
    const a = need(req, 'service:read');
    const q = req.query as Record<string, string | undefined>;
    const to = Number(q.to ?? Date.now());
    const from = Number(q.from ?? to - 3_600_000);
    const buckets = Math.min(120, Math.max(10, Number(q.buckets ?? 60)));
    const step = Math.max(1000, Math.ceil((to - from) / buckets));
    const { cond } = await buildWhere(a.orgId, { ...q, from: String(from), to: String(to), before: undefined });
    const rows = await ctx.db.execute<{ b: string; severity: string; n: number }>(sql`
      select floor(extract(epoch from ${s.events.ts}) * 1000 / ${step})::bigint as b, ${s.events.severity} as severity, count(*)::int as n
      from ${s.events} where ${cond} group by 1, 2 order by 1`);
    const out = new Map<number, Record<string, number>>();
    for (const r of rows) {
      const t = Number(r.b) * step;
      const cur = out.get(t) ?? { info: 0, warning: 0, error: 0, critical: 0 };
      cur[r.severity] = r.n;
      out.set(t, cur);
    }
    return { from, to, step, buckets: [...out.entries()].map(([t, v]) => ({ t, ...v })) };
  });
}
