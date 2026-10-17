import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, commentSchema, createIncidentSchema, linkSchema, updateIncidentSchema } from '@nexus/shared';
import { need, parse } from '../plugins';
import { addComment, addLink, createIncident, getIncident, listIncidents, updateIncident } from '../domain/incidents';

const csv = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);

export async function incidentRoutes(app: FastifyInstance) {
  app.get('/incidents', async (req) => {
    const a = need(req, 'incident:read');
    const q = req.query as Record<string, string | undefined>;
    return listIncidents(app.ctx, a.orgId, {
      status: csv(q.status), severity: csv(q.severity), environment: q.env, q: q.q,
      owner: q.owner === 'me' ? a.userId : q.owner, serviceId: q.serviceId, active: q.active === 'true',
      sort: q.sort as never, dir: q.dir as never, page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 20,
    });
  });

  app.post('/incidents', async (req, reply) => {
    const a = need(req, 'incident:create');
    const input = parse(createIncidentSchema, req.body);
    const created = await createIncident(app.ctx, a.orgId, a.userId, input);
    return reply.status(201).send(created);
  });

  app.get('/incidents/:id', async (req) => {
    const a = need(req, 'incident:read');
    return getIncident(app.ctx, a.orgId, parse(z.string().uuid(), (req.params as { id: string }).id));
  });

  app.patch('/incidents/:id', async (req) => {
    const a = need(req, 'incident:update');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const body = req.body as Record<string, unknown>;
    const expectedVersion = typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined;
    const { expectedVersion: _ev, ...rest } = body ?? {};
    const patch = parse(updateIncidentSchema, rest);
    return updateIncident(app.ctx, a.orgId, a.userId, id, patch, { expectedVersion, canResolve: can(a.role, 'incident:resolve') });
  });

  app.post('/incidents/:id/comments', async (req, reply) => {
    const a = need(req, 'incident:comment');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const body = parse(commentSchema, req.body);
    return reply.status(201).send(await addComment(app.ctx, a.orgId, a.userId, id, body.body, body.mentionIds));
  });

  app.post('/incidents/:id/links', async (req, reply) => {
    const a = need(req, 'incident:update');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const body = parse(linkSchema, req.body);
    return reply.status(201).send(await addLink(app.ctx, a.orgId, a.userId, id, body.kind, body.refId));
  });
}
