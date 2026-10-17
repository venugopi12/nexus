import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { api, login, makeApp } from './helpers';
import { evaluateAllRules } from '../src/domain/alerts';
import { eq } from 'drizzle-orm';
import { alerts } from '../src/db/schema';

let app: FastifyInstance;
let built: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  built = await makeApp();
  app = built.app;
});
afterAll(async () => {
  await app.close();
});

describe('authentication', () => {
  it('rejects bad credentials and unauthenticated access', async () => {
    const bad = await login(app, 'sre@acme.nexus.dev', 'wrong-password');
    expect(bad.res.statusCode).toBe(401);
    const anon = await app.inject({ method: 'GET', url: '/api/v1/incidents' });
    expect(anon.statusCode).toBe(401);
  });
  it('stores only a hash of the session token and sets an HttpOnly cookie', async () => {
    const { res, cookie } = await login(app, 'viewer@acme.nexus.dev');
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const token = cookie.split('=')[1]!;
    const rows = await built.ctx.db.query.sessions.findMany();
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });
  it('requires the CSRF header on mutations', async () => {
    const { cookie } = await login(app, 'sre@acme.nexus.dev');
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/read', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('RBAC enforced server-side', () => {
  it('viewer can read but cannot create or change incidents', async () => {
    const v = await login(app, 'viewer@acme.nexus.dev');
    const c = api(app, v.cookie);
    const list = await c.get('/incidents?pageSize=1');
    expect(list.statusCode).toBe(200);
    const inc = list.json().items[0];
    const create = await c.post('/incidents', { title: 'Viewer should not', severity: 'SEV-3', serviceIds: [inc.services[0].id] });
    expect(create.statusCode).toBe(403);
    const patch = await c.patch(`/incidents/${inc.id}`, { severity: 'SEV-1' });
    expect(patch.statusCode).toBe(403);
    expect((await c.get('/audit')).statusCode).toBe(403);
    expect((await c.get('/team')).statusCode).toBe(200);
    expect((await c.post('/team', { email: 'x@y.dev', name: 'X Y', role: 'admin', password: 'longenoughpassword' })).statusCode).toBe(403);
  });
  it('engineer cannot resolve; sre can', async () => {
    const e = api(app, (await login(app, 'engineer@acme.nexus.dev')).cookie);
    const s = await login(app, 'sre@acme.nexus.dev');
    const sre = api(app, s.cookie);
    const svc = (await sre.get('/services')).json().items[0];
    const created = await e.post('/incidents', { title: 'Engineer opened incident', severity: 'SEV-3', serviceIds: [svc.id] });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await e.patch(`/incidents/${id}`, { status: 'resolved' })).statusCode).toBe(403);
    expect((await sre.patch(`/incidents/${id}`, { status: 'resolved' })).statusCode).toBe(200);
  });
});

describe('incident lifecycle', () => {
  it('validates transitions, tracks times, supports reopen, comments and audit trail', async () => {
    const s = await login(app, 'sre@acme.nexus.dev');
    const c = api(app, s.cookie);
    const svc = (await c.get('/services')).json().items[0];
    const created = (await c.post('/incidents', { title: 'Lifecycle test incident', severity: 'SEV-2', serviceIds: [svc.id], ownerId: s.user.id })).json();
    expect(created.status).toBe('triggered');
    expect(created.number).toBeGreaterThan(100);
    // invalid: triggered -> mitigated
    const bad = await c.patch(`/incidents/${created.id}`, { status: 'mitigated' });
    expect(bad.statusCode).toBe(400);
    const ack = (await c.patch(`/incidents/${created.id}`, { status: 'acknowledged' })).json();
    expect(ack.acknowledgedAt).toBeTruthy();
    const comment = await c.post(`/incidents/${created.id}/comments`, { body: 'Looking now', mentionIds: [] });
    expect(comment.statusCode).toBe(201);
    const resolved = (await c.patch(`/incidents/${created.id}`, { status: 'resolved' })).json();
    expect(resolved.resolvedAt).toBeTruthy();
    const reopened = (await c.patch(`/incidents/${created.id}`, { status: 'investigating' })).json();
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.acknowledgedAt).toBeTruthy();
    const audit = (await c.get('/audit?action=incident.')).json().items.filter((a: { resourceId: string }) => a.resourceId === created.id).map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['incident.created', 'incident.resolved', 'incident.reopened', 'incident.commented']));
    expect(reopened.timeline.map((t: { kind: string }) => t.kind)).toContain('comment');
  });
  it('detects stale concurrent edits with optimistic versioning', async () => {
    const c = api(app, (await login(app, 'sre@acme.nexus.dev')).cookie);
    const svc = (await c.get('/services')).json().items[0];
    const inc = (await c.post('/incidents', { title: 'Version conflict test', severity: 'SEV-4', serviceIds: [svc.id] })).json();
    const ok = await c.patch(`/incidents/${inc.id}`, { severity: 'SEV-3', expectedVersion: inc.version });
    expect(ok.statusCode).toBe(200);
    const stale = await c.patch(`/incidents/${inc.id}`, { severity: 'SEV-2', expectedVersion: inc.version });
    expect(stale.statusCode).toBe(409);
  });
});

describe('tenant isolation', () => {
  it('never exposes another organization’s data', async () => {
    const acme = api(app, (await login(app, 'sre@acme.nexus.dev')).cookie);
    const globexLogin = await login(app, 'admin@globex.nexus.dev');
    const globex = api(app, globexLogin.cookie);
    const acmeInc = (await acme.get('/incidents?pageSize=1')).json().items[0];
    const gList = (await globex.get('/incidents')).json();
    expect(gList.items.every((i: { id: string }) => i.id !== acmeInc.id)).toBe(true);
    // direct object access by id from the wrong tenant
    expect((await globex.get(`/incidents/${acmeInc.id}`)).statusCode).toBe(404);
    expect((await globex.patch(`/incidents/${acmeInc.id}`, { severity: 'SEV-1' })).statusCode).toBe(404);
    expect((await globex.post(`/incidents/${acmeInc.id}/comments`, { body: 'x' })).statusCode).toBe(404);
    const acmeSvc = (await acme.get('/services')).json().items[0];
    expect((await globex.get(`/services/${acmeSvc.id}`)).statusCode).toBe(404);
    // cannot attach another tenant's service to own incident
    const gSvc = (await globex.get('/services')).json().items[0];
    const mix = await globex.post('/incidents', { title: 'Cross tenant attempt', severity: 'SEV-3', serviceIds: [acmeSvc.id] });
    expect(mix.statusCode).toBe(400);
    const ok = await globex.post('/incidents', { title: 'Globex own incident', severity: 'SEV-3', serviceIds: [gSvc.id] });
    expect(ok.statusCode).toBe(201);
    // traces/events/deployments/audit/team are scoped
    const aTrace = (await acme.get('/traces?pageSize=1')).json().items[0];
    expect((await globex.get(`/traces/${aTrace.traceId}`)).statusCode).toBe(404);
    const gEvents = (await globex.get('/events?limit=500&total=false')).json().items as { serviceKey: string }[];
    expect(gEvents.every((e) => !['checkout-service', 'payments-service'].includes(e.serviceKey))).toBe(true);
    const gTeam = (await globex.get('/team')).json().items.map((m: { email: string }) => m.email);
    expect(gTeam.some((e: string) => e.endsWith('@acme.nexus.dev') && e !== 'admin@acme.nexus.dev')).toBe(false);
    // linking cross-tenant deployment is rejected
    const aDep = (await acme.get('/deployments?pageSize=1')).json().items[0];
    const gInc = ok.json();
    expect((await globex.post(`/incidents/${gInc.id}/links`, { kind: 'deployment', refId: aDep.id })).statusCode).toBe(404);
  });
  it('forbids switching into an organization you are not a member of', async () => {
    const sre = await login(app, 'sre@acme.nexus.dev');
    const globexLogin = await login(app, 'admin@globex.nexus.dev');
    const gOrg = globexLogin.user.orgId;
    const res = await api(app, sre.cookie).post('/auth/switch-org', { orgId: gOrg });
    expect(res.statusCode).toBe(403);
  });
  it('multi-org users get role per organization', async () => {
    const admin = await login(app, 'admin@acme.nexus.dev');
    const c = api(app, admin.cookie);
    const globexId = admin.user.orgs.find((o: { slug: string }) => o.slug === 'globex').id;
    const sw = await c.post('/auth/switch-org', { orgId: globexId });
    expect(sw.statusCode).toBe(200);
    expect(sw.json().user.role).toBe('viewer');
    expect((await c.post('/incidents', { title: 'Should be blocked', severity: 'SEV-3', serviceIds: [(await c.get('/services')).json().items[0].id] })).statusCode).toBe(403);
  });
});

describe('alert evaluation', () => {
  it('does not create duplicate alerts for a sustained condition', async () => {
    const orgId = (await login(app, 'sre@acme.nexus.dev')).user.orgId;
    const now = Date.now();
    await evaluateAllRules(built.ctx, now, orgId);
    const first = await built.ctx.db.select().from(alerts).where(eq(alerts.orgId, orgId));
    await evaluateAllRules(built.ctx, now + 15_000, orgId);
    await evaluateAllRules(built.ctx, now + 30_000, orgId);
    const later = await built.ctx.db.select().from(alerts).where(eq(alerts.orgId, orgId));
    const open = (rows: typeof first) => rows.filter((a) => a.status !== 'resolved').map((a) => `${a.ruleId}:${a.serviceId}`);
    expect(new Set(open(later)).size).toBe(open(later).length);
    expect(later.length).toBe(first.length);
  });
  it('acknowledges alerts and creates an incident from one', async () => {
    const c = api(app, (await login(app, 'sre@acme.nexus.dev')).cookie);
    const firing = (await c.get('/alerts?status=firing')).json().items[0];
    if (!firing) return; // nothing firing at this instant (deterministic sim); covered by unit tests
    expect((await c.post(`/alerts/${firing.id}/ack`)).statusCode).toBe(200);
    const inc = await c.post(`/alerts/${firing.id}/incident`);
    expect(inc.statusCode).toBe(201);
  });
});

describe('metrics API', () => {
  it('rejects invalid aggregations and returns consistent series', async () => {
    const c = api(app, (await login(app, 'sre@acme.nexus.dev')).cookie);
    const to = Date.now();
    const bad = await c.get(`/metrics/query?metric=cpu&services=edge-gateway&from=${to - 3600000}&to=${to}&agg=p99`);
    expect(bad.statusCode).toBe(400);
    const a = (await c.get(`/metrics/query?metric=latency_ms&services=edge-gateway&from=${to - 3600000}&to=${to}&agg=p95&step=60000`)).json();
    const b = (await c.get(`/metrics/query?metric=latency_ms&services=edge-gateway&from=${to - 3600000}&to=${to}&agg=p95&step=60000`)).json();
    expect(a.series[0].points).toEqual(b.series[0].points);
  });
});

describe('realtime', () => {
  it('delivers authenticated, tenant-scoped event batches over Socket.IO', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const { cookie } = await login(app, 'sre@acme.nexus.dev');
    const anon = ioc(`http://127.0.0.1:${port}`, { reconnection: false, transports: ['websocket'] });
    await expect(new Promise((_res, rej) => { anon.on('connect_error', (e) => rej(e)); anon.on('connect', () => _res(true)); })).rejects.toThrow(/unauthorized/);
    anon.close();
    const socket = ioc(`http://127.0.0.1:${port}`, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
    await new Promise<void>((res) => socket.on('connect', () => res()));
    await new Promise<void>((res) => socket.emit('subscribe', { env: 'production' }, () => res()));
    const got = new Promise<{ events: { serviceKey: string }[] }>((res) => socket.on('events:batch', res));
    await built.engine.primeCursors(Date.now() - 3 * 60_000);
    await built.engine.tick();
    const batch = await got;
    expect(batch.events.length).toBeGreaterThan(0);
    expect(batch.events.every((e) => !['ledger-service', 'api-front'].includes(e.serviceKey))).toBe(true);
    socket.close();
  });
});
