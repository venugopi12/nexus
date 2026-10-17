import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ServiceStatusDto } from '@nexus/shared';
import * as s from '../db/schema';
import { need, parse } from '../plugins';
import { notFound, badRequest } from '../lib/errors';
import { audit } from '../lib/audit';
import type { AppContext } from '../context';

export async function serviceStatuses(ctx: AppContext, orgId: string, env: string): Promise<ServiceStatusDto[]> {
  const info = await ctx.registry.org(orgId);
  const model = await ctx.registry.model(orgId, env);
  const now = Date.now();
  const deps = await ctx.db.select().from(s.serviceDeps).where(eq(s.serviceDeps.orgId, orgId));
  const active = await ctx.db
    .select({ incidentId: s.incidentServices.incidentId, serviceId: s.incidentServices.serviceId })
    .from(s.incidentServices).innerJoin(s.incidents, eq(s.incidents.id, s.incidentServices.incidentId))
    .where(and(eq(s.incidents.orgId, orgId), eq(s.incidents.environment, env), ne(s.incidents.status, 'resolved')));
  return info.rows.map((r) => {
    const h = model.health(r.key, now);
    return {
      id: r.id, key: r.key, name: r.name, kind: r.kind as never, team: r.team, tier: r.tier, description: r.description,
      dependsOn: deps.filter((d) => d.fromId === r.id).map((d) => info.keyById.get(d.toId)!),
      dependents: deps.filter((d) => d.toId === r.id).map((d) => info.keyById.get(d.fromId)!),
      status: h.status, errorRate: h.errorRate, p95: h.p95, p99: h.p99, avgLatency: h.avgLatency, rps: h.rps, inferredOnly: h.inferredOnly, atRisk: h.atRisk,
      activeIncidentIds: active.filter((x) => x.serviceId === r.id).map((x) => x.incidentId),
    };
  });
}

export async function serviceRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get('/services', async (req) => {
    const a = need(req, 'service:read');
    const q = req.query as Record<string, string | undefined>;
    return { simulated: true, items: await serviceStatuses(ctx, a.orgId, q.env ?? 'production') };
  });

  app.get('/services/:id', async (req) => {
    const a = need(req, 'service:read');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const env = (req.query as Record<string, string>).env ?? 'production';
    const all = await serviceStatuses(ctx, a.orgId, env);
    const svc = all.find((x) => x.id === id);
    if (!svc) throw notFound('Service');
    const [row] = await ctx.db.select().from(s.services).where(and(eq(s.services.id, id), eq(s.services.orgId, a.orgId)));
    const incidentIds = await ctx.db.select({ id: s.incidentServices.incidentId }).from(s.incidentServices).where(eq(s.incidentServices.serviceId, id));
    const incidents = incidentIds.length
      ? await ctx.db.select({ id: s.incidents.id, number: s.incidents.number, title: s.incidents.title, severity: s.incidents.severity, status: s.incidents.status, createdAt: s.incidents.createdAt }).from(s.incidents).where(and(eq(s.incidents.orgId, a.orgId), inArray(s.incidents.id, incidentIds.map((i) => i.id)))).orderBy(desc(s.incidents.createdAt)).limit(10)
      : [];
    const deployments = await ctx.db.select().from(s.deployments).where(and(eq(s.deployments.orgId, a.orgId), eq(s.deployments.serviceId, id))).orderBy(desc(s.deployments.deployedAt)).limit(8);
    const rules = await ctx.db.select().from(s.alertRules).where(and(eq(s.alertRules.orgId, a.orgId), sql`(${s.alertRules.serviceId} = ${id} or ${s.alertRules.serviceId} is null)`));
    return {
      simulated: true,
      service: svc,
      config: row!.config,
      upstream: all.filter((x) => svc.dependsOn.includes(x.key)),
      downstream: all.filter((x) => svc.dependents.includes(x.key)),
      incidents: incidents.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
      deployments: deployments.map((d) => ({ id: d.id, version: d.version, commit: d.commit, status: d.status, environment: d.environment, deployedBy: d.deployedBy, deployedAt: d.deployedAt.toISOString() })),
      alertRules: rules.map((r) => ({ id: r.id, name: r.name, severity: r.severity, enabled: r.enabled, condition: r.condition, threshold: r.threshold })),
    };
  });

  app.patch('/services/:id/config', async (req) => {
    const a = need(req, 'service:write');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const body = parse(
      z.object({ environment: z.enum(['production', 'staging']), values: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean()])) }),
      req.body,
    );
    const [row] = await ctx.db.select().from(s.services).where(and(eq(s.services.id, id), eq(s.services.orgId, a.orgId)));
    if (!row) throw notFound('Service');
    if (Object.keys(body.values).length > 20) throw badRequest('Too many config keys');
    const next = { ...row.config, [body.environment]: { ...(row.config[body.environment] ?? {}), ...body.values } };
    await ctx.db.update(s.services).set({ config: next }).where(eq(s.services.id, id));
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'service.config_changed', resource: 'service', resourceId: id, metadata: { environment: body.environment, keys: Object.keys(body.values) } });
    return { config: next };
  });

  /** Dependency graph: measured status per node + explicit inferred-impact annotations. */
  app.get('/graph', async (req) => {
    const a = need(req, 'service:read');
    const env = (req.query as Record<string, string>).env ?? 'production';
    const nodes = await serviceStatuses(ctx, a.orgId, env);
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const edges = nodes.flatMap((n) => n.dependsOn.map((to) => ({ id: `${n.key}->${to}`, source: n.key, target: to })));
    // inferred: walk upstream (callers) from every unhealthy node; mark callers as potentially impacted
    const impactedBy: Record<string, string[]> = {};
    for (const n of nodes) {
      if (n.status === 'healthy' && !n.atRisk) continue;
      if (n.inferredOnly) continue; // only root-cause candidates (own metrics, not propagated)
      const stack = [...n.dependents];
      const seen = new Set<string>();
      while (stack.length) {
        const k = stack.pop()!;
        if (seen.has(k)) continue;
        seen.add(k);
        (impactedBy[k] ??= []).push(n.key);
        stack.push(...(byKey.get(k)?.dependents ?? []));
      }
    }
    return { simulated: true, nodes, edges, inferredImpact: impactedBy };
  });
}
