import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  applyTransitionTimes, canTransition, isReopen, type CreateIncidentInput, type IncidentDetailDto, type IncidentDto,
  type IncidentStatus, type Severity, type TimelineEntry, type UpdateIncidentInput, type UserRef,
} from '@nexus/shared';
import * as s from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { notify } from '../lib/notify';
import { orgRoom, type AppContext } from '../context';

const SEV_ORDER = sql`CASE ${s.incidents.severity} WHEN 'SEV-1' THEN 1 WHEN 'SEV-2' THEN 2 WHEN 'SEV-3' THEN 3 ELSE 4 END`;

export interface IncidentFilters {
  status?: string[];
  severity?: string[];
  environment?: string;
  q?: string;
  owner?: string; // user id | 'unassigned'
  serviceId?: string;
  active?: boolean;
  sort?: 'created' | 'updated' | 'severity' | 'number';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

async function userRefs(ctx: AppContext, ids: string[]): Promise<Map<string, UserRef>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await ctx.db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(inArray(s.users.id, uniq));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function toDtos(ctx: AppContext, rows: (typeof s.incidents.$inferSelect)[]): Promise<IncidentDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [svcRows, respRows, commentRows] = await Promise.all([
    ctx.db.select({ incidentId: s.incidentServices.incidentId, id: s.services.id, key: s.services.key, name: s.services.name }).from(s.incidentServices).innerJoin(s.services, eq(s.services.id, s.incidentServices.serviceId)).where(inArray(s.incidentServices.incidentId, ids)),
    ctx.db.select().from(s.incidentResponders).where(inArray(s.incidentResponders.incidentId, ids)),
    ctx.db.select({ incidentId: s.incidentTimeline.incidentId, n: sql<number>`count(*)::int` }).from(s.incidentTimeline).where(and(inArray(s.incidentTimeline.incidentId, ids), eq(s.incidentTimeline.kind, 'comment'))).groupBy(s.incidentTimeline.incidentId),
  ]);
  const refs = await userRefs(ctx, [...rows.flatMap((r) => [r.ownerId ?? '', r.createdBy ?? '']), ...respRows.map((r) => r.userId)]);
  return rows.map((r) => ({
    id: r.id, number: r.number, title: r.title, summary: r.summary, severity: r.severity as Severity, status: r.status as IncidentStatus, environment: r.environment,
    owner: r.ownerId ? refs.get(r.ownerId) ?? null : null,
    responders: respRows.filter((x) => x.incidentId === r.id).map((x) => refs.get(x.userId)).filter(Boolean) as UserRef[],
    services: svcRows.filter((x) => x.incidentId === r.id).map(({ id, key, name }) => ({ id, key, name })),
    createdAt: r.createdAt.toISOString(), acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null, resolvedAt: r.resolvedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy ? refs.get(r.createdBy) ?? null : null,
    commentCount: commentRows.find((c) => c.incidentId === r.id)?.n ?? 0,
  }));
}

export async function listIncidents(ctx: AppContext, orgId: string, f: IncidentFilters) {
  const where: (SQL | undefined)[] = [eq(s.incidents.orgId, orgId)];
  if (f.status?.length) where.push(inArray(s.incidents.status, f.status));
  if (f.active) where.push(ne(s.incidents.status, 'resolved'));
  if (f.severity?.length) where.push(inArray(s.incidents.severity, f.severity));
  if (f.environment) where.push(eq(s.incidents.environment, f.environment));
  if (f.owner === 'unassigned') where.push(sql`${s.incidents.ownerId} is null`);
  else if (f.owner) where.push(eq(s.incidents.ownerId, f.owner));
  if (f.serviceId) where.push(sql`exists (select 1 from ${s.incidentServices} x where x.incident_id = ${s.incidents.id} and x.service_id = ${f.serviceId})`);
  if (f.q) {
    const num = f.q.replace(/^inc-?/i, '');
    where.push(or(ilike(s.incidents.title, `%${f.q}%`), /^\d+$/.test(num) ? eq(s.incidents.number, Number(num)) : undefined));
  }
  const cond = and(...where);
  const dir = f.dir === 'asc' ? asc : desc;
  const orderCol = f.sort === 'severity' ? SEV_ORDER : f.sort === 'updated' ? s.incidents.updatedAt : f.sort === 'number' ? s.incidents.number : s.incidents.createdAt;
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 20));
  const page = Math.max(1, f.page ?? 1);
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.incidents).where(cond);
  const rows = await ctx.db.select().from(s.incidents).where(cond).orderBy(dir(orderCol), desc(s.incidents.number)).limit(pageSize).offset((page - 1) * pageSize);
  return { items: await toDtos(ctx, rows), total: n, page, pageSize };
}

export async function getIncident(ctx: AppContext, orgId: string, id: string): Promise<IncidentDetailDto> {
  const [row] = await ctx.db.select().from(s.incidents).where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, orgId)));
  if (!row) throw notFound('Incident');
  const [dto] = await toDtos(ctx, [row]);
  const [tl, links] = await Promise.all([
    ctx.db.select().from(s.incidentTimeline).where(eq(s.incidentTimeline.incidentId, id)).orderBy(asc(s.incidentTimeline.at)),
    ctx.db.select().from(s.incidentLinks).where(eq(s.incidentLinks.incidentId, id)),
  ]);
  const refs = await userRefs(ctx, tl.map((t) => t.actorId ?? ''));
  const timeline: TimelineEntry[] = tl.map((t) => ({ id: t.id, kind: t.kind as TimelineEntry['kind'], at: t.at.toISOString(), actor: t.actorId ? refs.get(t.actorId) ?? null : null, body: t.body, meta: t.meta }));
  return { ...dto!, notes: row.notes, version: row.version, timeline, links: links.map((l) => ({ id: l.id, kind: l.kind as 'event', refId: l.refId, label: l.label })) };
}

async function assertServicesInOrg(ctx: AppContext, orgId: string, ids: string[]) {
  const rows = await ctx.db.select({ id: s.services.id }).from(s.services).where(and(eq(s.services.orgId, orgId), inArray(s.services.id, ids)));
  if (rows.length !== new Set(ids).size) throw badRequest('One or more services do not belong to this organization');
}
async function assertUsersInOrg(ctx: AppContext, orgId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const rows = await ctx.db.select({ id: s.memberships.userId }).from(s.memberships).where(and(eq(s.memberships.orgId, orgId), inArray(s.memberships.userId, uniq)));
  if (rows.length !== uniq.length) throw badRequest('One or more users are not members of this organization');
}

export async function createIncident(ctx: AppContext, orgId: string, actorId: string | null, input: CreateIncidentInput) {
  await assertServicesInOrg(ctx, orgId, input.serviceIds);
  await assertUsersInOrg(ctx, orgId, [...input.responderIds, ...(input.ownerId ? [input.ownerId] : [])]);
  const created = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
    const [{ next } = { next: 1 }] = await tx.select({ next: sql<number>`coalesce(max(${s.incidents.number}), 100) + 1` }).from(s.incidents).where(eq(s.incidents.orgId, orgId));
    const now = new Date();
    const [row] = await tx.insert(s.incidents).values({
      orgId, number: next, title: input.title, summary: input.summary, severity: input.severity, status: 'triggered', environment: input.environment,
      ownerId: input.ownerId ?? null, createdBy: actorId, createdAt: now, updatedAt: now,
    }).returning();
    const id = row!.id;
    await tx.insert(s.incidentServices).values(input.serviceIds.map((serviceId) => ({ incidentId: id, serviceId })));
    if (input.responderIds.length) await tx.insert(s.incidentResponders).values([...new Set(input.responderIds)].map((userId) => ({ incidentId: id, userId })));
    await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind: 'created', actorId, body: `Incident opened as ${input.severity}`, meta: { severity: input.severity }, at: now });
    if (input.ownerId) await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind: 'owner', actorId, body: 'Owner assigned at creation', meta: { ownerId: input.ownerId }, at: now });
    if (input.alertId) {
      await tx.update(s.alerts).set({ incidentId: id }).where(and(eq(s.alerts.id, input.alertId), eq(s.alerts.orgId, orgId)));
      await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind: 'alert', actorId, body: 'Created from alert', meta: { alertId: input.alertId }, at: now });
    }
    await audit(tx, { orgId, actorId, action: 'incident.created', resource: 'incident', resourceId: id, metadata: { number: next, severity: input.severity } });
    return row!;
  });
  ctx.bus.emit(orgRoom(orgId), 'incident:changed', { id: created.id, kind: 'created', number: created.number });
  await notify(ctx, orgId, { permission: 'incident:read' }, { kind: 'incident', title: `${input.severity} · ${input.title}`, body: 'New incident opened', href: `/incidents/${created.id}` });
  return getIncident(ctx, orgId, created.id);
}

export async function updateIncident(ctx: AppContext, orgId: string, actorId: string, id: string, patch: UpdateIncidentInput, opts: { expectedVersion?: number; canResolve: boolean }) {
  if (patch.serviceIds) await assertServicesInOrg(ctx, orgId, patch.serviceIds);
  await assertUsersInOrg(ctx, orgId, [...(patch.responderIds ?? []), ...(patch.ownerId ? [patch.ownerId] : [])]);
  const actorName = (await userRefs(ctx, [actorId])).get(actorId)?.name ?? 'Someone';
  await ctx.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.incidents).where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, orgId))).for('update');
    if (!cur) throw notFound('Incident');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== cur.version) {
      throw conflict('Incident was modified by someone else', { currentVersion: cur.version });
    }
    const now = new Date();
    const set: Partial<typeof s.incidents.$inferInsert> = { updatedAt: now, version: cur.version + 1 };
    const log = async (kind: string, body: string, meta: Record<string, unknown> = {}) => {
      await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind, actorId, body, meta, at: now });
    };
    if (patch.status && patch.status !== cur.status) {
      const from = cur.status as IncidentStatus;
      if (!canTransition(from, patch.status)) throw badRequest(`Invalid transition ${from} → ${patch.status}`, { allowed: [] });
      if (patch.status === 'resolved' && !opts.canResolve) throw forbidden('Missing permission: incident:resolve');
      const times = applyTransitionTimes({ createdAt: cur.createdAt, acknowledgedAt: cur.acknowledgedAt, resolvedAt: cur.resolvedAt }, from, patch.status, now);
      set.status = patch.status;
      set.acknowledgedAt = times.acknowledgedAt;
      set.resolvedAt = times.resolvedAt;
      await log('status', isReopen(from, patch.status) ? `${actorName} reopened the incident` : `Status changed from ${from} to ${patch.status}`, { from, to: patch.status });
      await audit(tx, { orgId, actorId, action: isReopen(from, patch.status) ? 'incident.reopened' : patch.status === 'resolved' ? 'incident.resolved' : 'incident.status_changed', resource: 'incident', resourceId: id, metadata: { from, to: patch.status } });
    }
    if (patch.severity && patch.severity !== cur.severity) {
      set.severity = patch.severity;
      await log('severity', `Severity changed from ${cur.severity} to ${patch.severity}`, { from: cur.severity, to: patch.severity });
      await audit(tx, { orgId, actorId, action: 'incident.severity_changed', resource: 'incident', resourceId: id, metadata: { from: cur.severity, to: patch.severity } });
    }
    if (patch.ownerId !== undefined && patch.ownerId !== cur.ownerId) {
      set.ownerId = patch.ownerId;
      const ref = patch.ownerId ? (await userRefs(ctx, [patch.ownerId])).get(patch.ownerId) : null;
      await log('owner', ref ? `Assigned owner ${ref.name}` : 'Owner removed', { ownerId: patch.ownerId });
      await audit(tx, { orgId, actorId, action: 'incident.owner_changed', resource: 'incident', resourceId: id, metadata: { ownerId: patch.ownerId } });
      if (patch.ownerId && patch.ownerId !== actorId) await notify(ctx, orgId, { userIds: [patch.ownerId] }, { kind: 'incident', title: `You own INC-${cur.number}`, body: cur.title, href: `/incidents/${id}` });
    }
    if (patch.responderIds) {
      await tx.delete(s.incidentResponders).where(eq(s.incidentResponders.incidentId, id));
      const uniq = [...new Set(patch.responderIds)];
      if (uniq.length) await tx.insert(s.incidentResponders).values(uniq.map((userId) => ({ incidentId: id, userId })));
      await log('responders', `Responders updated (${uniq.length})`);
    }
    if (patch.serviceIds) {
      await tx.delete(s.incidentServices).where(eq(s.incidentServices.incidentId, id));
      await tx.insert(s.incidentServices).values([...new Set(patch.serviceIds)].map((serviceId) => ({ incidentId: id, serviceId })));
      await log('services', `Affected services updated (${patch.serviceIds.length})`);
    }
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.summary !== undefined) set.summary = patch.summary;
    if (patch.notes !== undefined && patch.notes !== cur.notes) {
      set.notes = patch.notes;
      await log('note', 'Investigation notes updated');
    }
    await tx.update(s.incidents).set(set).where(eq(s.incidents.id, id));
  });
  ctx.bus.emit(orgRoom(orgId), 'incident:changed', { id, kind: 'updated', number: 0 });
  return getIncident(ctx, orgId, id);
}

export async function addComment(ctx: AppContext, orgId: string, actorId: string, id: string, body: string, mentionIds: string[]) {
  const [inc] = await ctx.db.select().from(s.incidents).where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, orgId)));
  if (!inc) throw notFound('Incident');
  await assertUsersInOrg(ctx, orgId, mentionIds);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind: 'comment', actorId, body, meta: { mentionIds } });
    await tx.update(s.incidents).set({ updatedAt: new Date() }).where(eq(s.incidents.id, id));
    await audit(tx, { orgId, actorId, action: 'incident.commented', resource: 'incident', resourceId: id, metadata: { mentions: mentionIds.length } });
  });
  const others = mentionIds.filter((m) => m !== actorId);
  if (others.length) await notify(ctx, orgId, { userIds: others }, { kind: 'mention', title: `You were mentioned on INC-${inc.number}`, body: body.slice(0, 140), href: `/incidents/${id}` });
  ctx.bus.emit(orgRoom(orgId), 'incident:changed', { id, kind: 'updated', number: inc.number });
  return getIncident(ctx, orgId, id);
}

export async function addLink(ctx: AppContext, orgId: string, actorId: string, id: string, kind: 'event' | 'trace' | 'deployment', refId: string) {
  const [inc] = await ctx.db.select().from(s.incidents).where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, orgId)));
  if (!inc) throw notFound('Incident');
  // validate the referenced resource belongs to the same org
  let label = '';
  if (kind === 'event') {
    const [e] = await ctx.db.select().from(s.events).where(and(eq(s.events.id, refId), eq(s.events.orgId, orgId)));
    if (!e) throw notFound('Event');
    label = `${e.type} · ${e.message}`;
  } else if (kind === 'trace') {
    const [t] = await ctx.db.select().from(s.traces).where(and(eq(s.traces.traceId, refId), eq(s.traces.orgId, orgId)));
    if (!t) throw notFound('Trace');
    label = `${t.rootOperation} · ${Math.round(t.durationMs)}ms`;
  } else {
    const [d] = await ctx.db.select().from(s.deployments).where(and(eq(s.deployments.id, refId), eq(s.deployments.orgId, orgId)));
    if (!d) throw notFound('Deployment');
    label = `${d.version} · ${d.commit}`;
  }
  await ctx.db.transaction(async (tx) => {
    await tx.insert(s.incidentLinks).values({ incidentId: id, orgId, kind, refId, label }).onConflictDoNothing();
    await tx.insert(s.incidentTimeline).values({ incidentId: id, orgId, kind: 'link', actorId, body: `Linked ${kind}: ${label}`, meta: { kind, refId } });
    await audit(tx, { orgId, actorId, action: 'incident.linked', resource: 'incident', resourceId: id, metadata: { kind, refId } });
  });
  return getIncident(ctx, orgId, id);
}
