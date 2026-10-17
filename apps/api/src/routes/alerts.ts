import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { alertRuleSchema, type AlertDto, type AlertRuleDto } from '@nexus/shared';
import * as s from '../db/schema';
import { need, parse } from '../plugins';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { incidentFromAlert } from '../domain/alerts';


const uuid = z.string().uuid();

export async function alertRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  async function validateRule(orgId: string, input: z.infer<typeof alertRuleSchema>) {
    if (input.serviceId) {
      const [svc] = await ctx.db.select({ id: s.services.id }).from(s.services).where(and(eq(s.services.id, input.serviceId), eq(s.services.orgId, orgId)));
      if (!svc) throw badRequest('Service not found in this organization');
    }
    if (input.autoCreateIncident && !['SEV-1', 'SEV-2'].includes(input.severity)) throw badRequest('Auto-create incident requires SEV-1 or SEV-2');
    if (input.condition === 'health_change' && ![1, 2].includes(input.threshold)) throw badRequest('Health threshold must be 1 or 2');
    if (input.autoCreateIncident && !input.serviceId && input.condition !== 'health_change') throw badRequest('Auto-create on all services is only supported for health rules');
  }

  const ruleDto = async (orgId: string): Promise<AlertRuleDto[]> => {
    const rows = await ctx.db.select({ r: s.alertRules, name: s.services.name }).from(s.alertRules).leftJoin(s.services, eq(s.services.id, s.alertRules.serviceId)).where(eq(s.alertRules.orgId, orgId)).orderBy(s.alertRules.name);
    const open = await ctx.db.select({ ruleId: s.alerts.ruleId }).from(s.alerts).where(and(eq(s.alerts.orgId, orgId), inArray(s.alerts.status, ['firing', 'acknowledged'])));
    return rows.map(({ r, name }) => ({ id: r.id, name: r.name, condition: r.condition, serviceId: r.serviceId, serviceName: name, environment: r.environment, threshold: r.threshold, windowSec: r.windowSec, cooldownSec: r.cooldownSec, severity: r.severity as never, autoCreateIncident: r.autoCreateIncident, enabled: r.enabled, state: open.some((o) => o.ruleId === r.id) ? 'firing' : 'ok', lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null }));
  };

  app.get('/alert-rules', async (req) => {
    const a = need(req, 'alert:read');
    return { items: await ruleDto(a.orgId) };
  });

  app.post('/alert-rules', async (req, reply) => {
    const a = need(req, 'alert:write');
    const input = parse(alertRuleSchema, req.body);
    await validateRule(a.orgId, input);
    const [row] = await ctx.db.insert(s.alertRules).values({ orgId: a.orgId, ...input }).returning();
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'alert_rule.created', resource: 'alert_rule', resourceId: row!.id, metadata: { name: input.name } });
    return reply.status(201).send({ id: row!.id });
  });

  app.put('/alert-rules/:id', async (req) => {
    const a = need(req, 'alert:write');
    const id = parse(uuid, (req.params as { id: string }).id);
    const input = parse(alertRuleSchema, req.body);
    await validateRule(a.orgId, input);
    const [row] = await ctx.db.update(s.alertRules).set(input).where(and(eq(s.alertRules.id, id), eq(s.alertRules.orgId, a.orgId))).returning();
    if (!row) throw notFound('Alert rule');
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'alert_rule.updated', resource: 'alert_rule', resourceId: id, metadata: { name: input.name, enabled: input.enabled } });
    return { id };
  });

  app.patch('/alert-rules/:id/enabled', async (req) => {
    const a = need(req, 'alert:write');
    const id = parse(uuid, (req.params as { id: string }).id);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const [row] = await ctx.db.update(s.alertRules).set({ enabled }).where(and(eq(s.alertRules.id, id), eq(s.alertRules.orgId, a.orgId))).returning();
    if (!row) throw notFound('Alert rule');
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: enabled ? 'alert_rule.enabled' : 'alert_rule.disabled', resource: 'alert_rule', resourceId: id });
    return { id, enabled };
  });

  app.delete('/alert-rules/:id', async (req, reply) => {
    const a = need(req, 'alert:write');
    const id = parse(uuid, (req.params as { id: string }).id);
    const res = await ctx.db.delete(s.alertRules).where(and(eq(s.alertRules.id, id), eq(s.alertRules.orgId, a.orgId))).returning({ id: s.alertRules.id });
    if (!res.length) throw notFound('Alert rule');
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'alert_rule.deleted', resource: 'alert_rule', resourceId: id });
    return reply.status(204).send();
  });

  app.get('/alerts', async (req) => {
    const a = need(req, 'alert:read');
    const q = req.query as Record<string, string | undefined>;
    const where = [eq(s.alerts.orgId, a.orgId)];
    if (q.status) where.push(inArray(s.alerts.status, q.status.split(',')));
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.alerts).where(and(...where));
    const rows = await ctx.db.select({ a: s.alerts, ruleName: s.alertRules.name, svcName: s.services.name }).from(s.alerts).innerJoin(s.alertRules, eq(s.alertRules.id, s.alerts.ruleId)).leftJoin(s.services, eq(s.services.id, s.alerts.serviceId)).where(and(...where)).orderBy(desc(s.alerts.firedAt)).limit(pageSize).offset((page - 1) * pageSize);
    const items: AlertDto[] = rows.map(({ a: x, ruleName, svcName }) => ({ id: x.id, ruleId: x.ruleId, ruleName, serviceName: svcName, serviceId: x.serviceId, severity: x.severity as never, status: x.status as never, value: x.value, detail: x.detail, firedAt: x.firedAt.toISOString(), acknowledgedAt: x.acknowledgedAt?.toISOString() ?? null, resolvedAt: x.resolvedAt?.toISOString() ?? null, incidentId: x.incidentId }));
    return { items, total: n, page, pageSize };
  });

  app.post('/alerts/:id/ack', async (req) => {
    const a = need(req, 'alert:ack');
    const id = parse(uuid, (req.params as { id: string }).id);
    const [row] = await ctx.db.update(s.alerts).set({ status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: a.userId }).where(and(eq(s.alerts.id, id), eq(s.alerts.orgId, a.orgId), eq(s.alerts.status, 'firing'))).returning();
    if (!row) throw badRequest('Alert is not in a firing state');
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'alert.acknowledged', resource: 'alert', resourceId: id });
    return { id };
  });

  app.post('/alerts/:id/incident', async (req, reply) => {
    const a = need(req, 'incident:create');
    need(req, 'alert:read');
    const id = parse(uuid, (req.params as { id: string }).id);
    const incidentId = await incidentFromAlert(ctx, a.orgId, a.userId, id);
    if (!incidentId) throw badRequest('Alert cannot be converted (no service, or not found)');
    return reply.status(201).send({ incidentId });
  });
}
