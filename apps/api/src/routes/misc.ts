import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { flagUpsertSchema, inviteMemberSchema, resolveFlag, roleChangeSchema, type AuditDto, type FlagDto, type NotificationDto } from '@nexus/shared';
import * as s from '../db/schema';
import { authed, need, parse } from '../plugins';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors';
import { audit } from '../lib/audit';
import { hashPassword } from '../lib/password';
import { notify } from '../lib/notify';

const uuid = z.string().uuid();

export async function miscRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /* ------------------------------------------------------------- team */
  app.get('/team', async (req) => {
    const a = need(req, 'team:read');
    const rows = await ctx.db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.memberships.role, joinedAt: s.memberships.createdAt }).from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId)).where(eq(s.memberships.orgId, a.orgId)).orderBy(s.users.name);
    return { items: rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() })) };
  });

  app.post('/team', async (req, reply) => {
    const a = need(req, 'team:write');
    const input = parse(inviteMemberSchema, req.body);
    const email = input.email.toLowerCase();
    const [existing] = await ctx.db.select().from(s.users).where(eq(s.users.email, email));
    let userId = existing?.id;
    if (existing) {
      const [m] = await ctx.db.select().from(s.memberships).where(and(eq(s.memberships.userId, existing.id), eq(s.memberships.orgId, a.orgId)));
      if (m) throw conflict('User is already a member of this organization');
    } else {
      const [u] = await ctx.db.insert(s.users).values({ email, name: input.name, passwordHash: await hashPassword(input.password) }).returning();
      userId = u!.id;
    }
    await ctx.db.insert(s.memberships).values({ userId: userId!, orgId: a.orgId, role: input.role });
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'member.added', resource: 'membership', resourceId: userId!, metadata: { email, role: input.role } });
    return reply.status(201).send({ id: userId });
  });

  app.patch('/team/:userId', async (req) => {
    const a = need(req, 'team:write');
    const userId = parse(uuid, (req.params as { userId: string }).userId);
    const { role } = parse(roleChangeSchema, req.body);
    const [cur] = await ctx.db.select().from(s.memberships).where(and(eq(s.memberships.userId, userId), eq(s.memberships.orgId, a.orgId)));
    if (!cur) throw notFound('Member');
    if (cur.role === 'admin' && role !== 'admin') {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.memberships).where(and(eq(s.memberships.orgId, a.orgId), eq(s.memberships.role, 'admin')));
      if (n <= 1) throw badRequest('An organization must keep at least one admin');
    }
    await ctx.db.update(s.memberships).set({ role }).where(and(eq(s.memberships.userId, userId), eq(s.memberships.orgId, a.orgId)));
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'member.role_changed', resource: 'membership', resourceId: userId, metadata: { from: cur.role, to: role } });
    return { userId, role };
  });

  app.delete('/team/:userId', async (req, reply) => {
    const a = need(req, 'team:write');
    const userId = parse(uuid, (req.params as { userId: string }).userId);
    if (userId === a.userId) throw badRequest('You cannot remove yourself');
    const [cur] = await ctx.db.select().from(s.memberships).where(and(eq(s.memberships.userId, userId), eq(s.memberships.orgId, a.orgId)));
    if (!cur) throw notFound('Member');
    await ctx.db.delete(s.memberships).where(and(eq(s.memberships.userId, userId), eq(s.memberships.orgId, a.orgId)));
    await ctx.db.delete(s.sessions).where(and(eq(s.sessions.userId, userId), eq(s.sessions.orgId, a.orgId)));
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'member.removed', resource: 'membership', resourceId: userId, metadata: { role: cur.role } });
    return reply.status(204).send();
  });

  /* ------------------------------------------------------------- audit */
  app.get('/audit', async (req) => {
    const a = need(req, 'audit:read');
    const q = req.query as Record<string, string | undefined>;
    const where = [eq(s.auditLogs.orgId, a.orgId)];
    if (q.action) where.push(ilike(s.auditLogs.action, `${q.action}%`));
    if (q.q) where.push(or(ilike(s.auditLogs.action, `%${q.q}%`), ilike(s.auditLogs.resource, `%${q.q}%`))!);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Number(q.pageSize ?? 30));
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.auditLogs).where(and(...where));
    const rows = await ctx.db.select({ l: s.auditLogs, name: s.users.name, email: s.users.email }).from(s.auditLogs).leftJoin(s.users, eq(s.users.id, s.auditLogs.actorId)).where(and(...where)).orderBy(desc(s.auditLogs.at)).limit(pageSize).offset((page - 1) * pageSize);
    const items: AuditDto[] = rows.map(({ l, name, email }) => ({ id: l.id, at: l.at.toISOString(), actor: l.actorId ? { id: l.actorId, name: name ?? 'Unknown', email: email ?? '' } : null, action: l.action, resource: l.resource, resourceId: l.resourceId, metadata: l.metadata }));
    return { items, total: n, page, pageSize };
  });

  /* ------------------------------------------------------------- flags */
  const flagsFor = async (orgId: string, userId: string, env: string): Promise<FlagDto[]> => {
    const flags = await ctx.db.select().from(s.featureFlags).orderBy(s.featureFlags.key);
    const overrides = await ctx.db.select().from(s.flagOverrides).where(eq(s.flagOverrides.orgId, orgId));
    const history = await ctx.db.select().from(s.flagHistory).where(or(sql`${s.flagHistory.orgId} is null`, eq(s.flagHistory.orgId, orgId))).orderBy(desc(s.flagHistory.at)).limit(200);
    return flags.map((f) => {
      const ov = overrides.filter((o) => o.flagKey === f.key);
      const org = ov.find((o) => !o.environment);
      const envOv = ov.find((o) => o.environment === env);
      return {
        key: f.key, description: f.description, enabled: f.enabled, rolloutPercent: f.rolloutPercent,
        resolved: resolveFlag(f.key, userId, { base: { enabled: f.enabled, rolloutPercent: f.rolloutPercent }, orgOverride: org && { enabled: org.enabled, rolloutPercent: org.rolloutPercent }, envOverride: envOv && { enabled: envOv.enabled, rolloutPercent: envOv.rolloutPercent } }),
        overrides: ov.map((o) => ({ scope: o.environment ? 'environment' : 'org', environment: o.environment, enabled: o.enabled, rolloutPercent: o.rolloutPercent })),
        history: history.filter((h) => h.flagKey === f.key).map((h) => ({ at: h.at.toISOString(), actor: h.actor, change: h.change })),
      };
    });
  };
  app.get('/flags', async (req) => {
    const a = need(req, 'flag:read');
    return { items: await flagsFor(a.orgId, a.userId, (req.query as Record<string, string>).env ?? 'production') };
  });
  app.put('/flags', async (req) => {
    const a = need(req, 'flag:write');
    const input = parse(flagUpsertSchema, req.body);
    const [flag] = await ctx.db.select().from(s.featureFlags).where(eq(s.featureFlags.key, input.key));
    if (!flag) throw notFound('Flag');
    if (input.scope === 'global') throw forbidden('Global flag defaults are managed by the platform, not tenants');
    if (input.scope === 'environment' && !input.environment) throw badRequest('environment is required for environment scope');
    const environment = input.scope === 'environment' ? input.environment! : null;
    const existing = await ctx.db.select().from(s.flagOverrides).where(and(eq(s.flagOverrides.flagKey, input.key), eq(s.flagOverrides.orgId, a.orgId), environment ? eq(s.flagOverrides.environment, environment) : sql`${s.flagOverrides.environment} is null`));
    if (existing[0]) await ctx.db.update(s.flagOverrides).set({ enabled: input.enabled, rolloutPercent: input.rolloutPercent }).where(eq(s.flagOverrides.id, existing[0].id));
    else await ctx.db.insert(s.flagOverrides).values({ flagKey: input.key, orgId: a.orgId, environment, enabled: input.enabled, rolloutPercent: input.rolloutPercent });
    const change = `${environment ? `Env override (${environment})` : 'Org override'}: ${input.enabled ? 'enabled' : 'disabled'} @ ${input.rolloutPercent}%`;
    await ctx.db.insert(s.flagHistory).values({ flagKey: input.key, orgId: a.orgId, actor: a.name, change });
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'flag.changed', resource: 'feature_flag', resourceId: input.key, metadata: { change } });
    return { items: await flagsFor(a.orgId, a.userId, 'production') };
  });

  /* ------------------------------------------------------------- notifications */
  app.get('/notifications', async (req) => {
    const a = authed(req);
    const rows = await ctx.db.select().from(s.notifications).where(and(eq(s.notifications.userId, a.userId), eq(s.notifications.orgId, a.orgId))).orderBy(desc(s.notifications.createdAt)).limit(50);
    const items: NotificationDto[] = rows.map((r) => ({ id: r.id, kind: r.kind as never, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString(), read: r.read }));
    return { items, unread: items.filter((i) => !i.read).length };
  });
  app.post('/notifications/read', async (req) => {
    const a = authed(req);
    const { ids } = parse(z.object({ ids: z.array(uuid).optional() }), req.body ?? {});
    await ctx.db.update(s.notifications).set({ read: true }).where(and(eq(s.notifications.userId, a.userId), eq(s.notifications.orgId, a.orgId), ids?.length ? inArray(s.notifications.id, ids) : undefined));
    return { ok: true };
  });

  /* ------------------------------------------------------------- settings */
  app.get('/settings', async (req) => {
    const a = need(req, 'settings:read');
    const [org] = await ctx.db.select().from(s.organizations).where(eq(s.organizations.id, a.orgId));
    return { id: org!.id, name: org!.name, slug: org!.slug, settings: org!.settings };
  });
  app.patch('/settings', async (req) => {
    const a = need(req, 'settings:write');
    const body = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), settings: z.object({ timezone: z.string().max(60).optional(), retentionDays: z.number().int().min(1).max(90).optional(), defaultEnvironment: z.enum(['production', 'staging']).optional() }).optional() }), req.body);
    const [org] = await ctx.db.select().from(s.organizations).where(eq(s.organizations.id, a.orgId));
    const next = { ...org!.settings, ...(body.settings ?? {}) };
    await ctx.db.update(s.organizations).set({ name: body.name ?? org!.name, settings: next }).where(eq(s.organizations.id, a.orgId));
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'settings.updated', resource: 'organization', resourceId: a.orgId, metadata: { changed: Object.keys(body.settings ?? {}).concat(body.name ? ['name'] : []) } });
    return { ok: true };
  });

  /* ------------------------------------------------------------- global search */
  app.get('/search', async (req) => {
    const a = need(req, 'incident:read');
    const q = String((req.query as Record<string, string>).q ?? '').trim();
    if (q.length < 2) return { incidents: [], services: [], traces: [], events: [] };
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const num = q.replace(/^inc-?/i, '');
    const [incidents, svcs, traces, evs] = await Promise.all([
      ctx.db.select({ id: s.incidents.id, number: s.incidents.number, title: s.incidents.title, severity: s.incidents.severity, status: s.incidents.status }).from(s.incidents).where(and(eq(s.incidents.orgId, a.orgId), or(ilike(s.incidents.title, like), /^\d+$/.test(num) ? eq(s.incidents.number, Number(num)) : undefined))).orderBy(desc(s.incidents.createdAt)).limit(5),
      ctx.db.select({ id: s.services.id, key: s.services.key, name: s.services.name }).from(s.services).where(and(eq(s.services.orgId, a.orgId), or(ilike(s.services.name, like), ilike(s.services.key, like)))).limit(5),
      /^[a-f0-9]{4,}$/i.test(q) ? ctx.db.select({ traceId: s.traces.traceId, rootOperation: s.traces.rootOperation, durationMs: s.traces.durationMs }).from(s.traces).where(and(eq(s.traces.orgId, a.orgId), ilike(s.traces.traceId, `${q}%`))).limit(5) : Promise.resolve([]),
      ctx.db.select({ id: s.events.id, message: s.events.message, type: s.events.type, severity: s.events.severity, ts: s.events.ts }).from(s.events).where(and(eq(s.events.orgId, a.orgId), ilike(s.events.message, like))).orderBy(desc(s.events.ts)).limit(5),
    ]);
    return { incidents, services: svcs, traces, events: evs.map((e) => ({ ...e, ts: e.ts.getTime() })) };
  });

  app.get('/orgs/current', async (req) => {
    const a = authed(req);
    const [org] = await ctx.db.select().from(s.organizations).where(eq(s.organizations.id, a.orgId));
    return { id: org!.id, slug: org!.slug, name: org!.name };
  });
  void notify;
}
