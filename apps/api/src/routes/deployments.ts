import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { deploymentSchema, type DeploymentDto } from '@nexus/shared';
import * as s from '../db/schema';
import { need, parse } from '../plugins';
import { badRequest } from '../lib/errors';
import { audit } from '../lib/audit';

export async function deploymentRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  app.get('/deployments', async (req) => {
    const a = need(req, 'deployment:read');
    const q = req.query as Record<string, string | undefined>;
    const where = [eq(s.deployments.orgId, a.orgId)];
    if (q.env) where.push(eq(s.deployments.environment, q.env));
    if (q.serviceId) where.push(eq(s.deployments.serviceId, q.serviceId));
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 25));
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.deployments).where(and(...where));
    const rows = await ctx.db.select({ d: s.deployments, name: s.services.name }).from(s.deployments).innerJoin(s.services, eq(s.services.id, s.deployments.serviceId)).where(and(...where)).orderBy(desc(s.deployments.deployedAt)).limit(pageSize).offset((page - 1) * pageSize);
    const items: DeploymentDto[] = rows.map(({ d, name }) => ({ id: d.id, serviceId: d.serviceId, serviceName: name, environment: d.environment, version: d.version, commit: d.commit, status: d.status as never, deployedBy: d.deployedBy, notes: d.notes, deployedAt: d.deployedAt.toISOString() }));
    return { items, total: n, page, pageSize };
  });

  app.post('/deployments', async (req, reply) => {
    const a = need(req, 'deployment:write');
    const body = parse(deploymentSchema, req.body);
    const [svc] = await ctx.db.select().from(s.services).where(and(eq(s.services.id, body.serviceId), eq(s.services.orgId, a.orgId)));
    if (!svc) throw badRequest('Service not found in this organization');
    const [row] = await ctx.db.insert(s.deployments).values({ orgId: a.orgId, serviceId: svc.id, environment: body.environment, version: body.version, commit: body.commit, status: 'succeeded', deployedBy: a.name, notes: body.notes, deployedAt: new Date() }).returning();
    await ctx.db.insert(s.events).values({ id: `evt_dep_${row!.id}`, orgId: a.orgId, environment: body.environment, serviceId: svc.id, ts: row!.deployedAt, type: 'deployment', severity: 'info', message: `Deployed ${body.version} (${body.commit})`, attributes: { version: body.version, commit: body.commit } }).onConflictDoNothing();
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'deployment.recorded', resource: 'deployment', resourceId: row!.id, metadata: { service: svc.key, version: body.version } });
    return reply.status(201).send({ id: row!.id });
  });
}
