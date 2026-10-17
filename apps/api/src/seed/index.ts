import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  ACME, GLOBEX, ENVIRONMENTS, SimModel, eventsForBucket, EVENT_BUCKET_MS, mulberry32,
  canTransition, type Fault, type FaultKind, type OrgCatalog, type Severity,
} from '@nexus/shared';
import { createDb, schema as s } from '../db/client';
import { runMigrations } from '../db/migrate';
import { hashPassword } from '../lib/password';
import { buildTrace } from '../sim/traces';
import { env } from '../env';

const DAY = 86_400_000;
const MIN = 60_000;
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function seed(url = env.DATABASE_URL, opts: { quiet?: boolean; eventDays?: number } = {}) {
  const log = (...a: unknown[]) => !opts.quiet && console.log('[seed]', ...a);
  await runMigrations(url);
  const { db, client } = createDb(url, 4);
  // wipe (idempotent re-seed)
  await db.execute(sql`TRUNCATE organizations, users, feature_flags RESTART IDENTITY CASCADE`);
  const now = Math.floor(Date.now() / 15000) * 15000;
  const rng = mulberry32(20260114);
  const pw = await hashPassword(env.SEED_PASSWORD);

  /* ---------------------------------------------------------------- orgs, users */
  const orgs = new Map<string, { id: string; cat: OrgCatalog }>();
  for (const cat of [ACME, GLOBEX]) {
    const [o] = await db.insert(s.organizations).values({ slug: cat.slug, name: cat.name, settings: { timezone: 'UTC', retentionDays: 14, defaultEnvironment: 'production' } }).returning();
    orgs.set(cat.slug, { id: o!.id, cat });
  }
  const U = (email: string, name: string) => ({ id: randomUUID(), email, name, passwordHash: pw });
  const users = {
    admin: U('admin@acme.nexus.dev', 'Avery Admin'),
    sre: U('sre@acme.nexus.dev', 'Sam Reyes'),
    engineer: U('engineer@acme.nexus.dev', 'Eli Chen'),
    viewer: U('viewer@acme.nexus.dev', 'Vera Park'),
    priya: U('priya@acme.nexus.dev', 'Priya Nair'),
    marcus: U('marcus@acme.nexus.dev', 'Marcus Webb'),
    globex: U('admin@globex.nexus.dev', 'Gina Globex'),
    gsre: U('sre@globex.nexus.dev', 'Gus Sorensen'),
  };
  await db.insert(s.users).values(Object.values(users));
  const acme = orgs.get('acme')!;
  const globex = orgs.get('globex')!;
  await db.insert(s.memberships).values([
    { userId: users.admin.id, orgId: acme.id, role: 'admin' },
    { userId: users.admin.id, orgId: globex.id, role: 'viewer' },
    { userId: users.sre.id, orgId: acme.id, role: 'sre' },
    { userId: users.engineer.id, orgId: acme.id, role: 'engineer' },
    { userId: users.viewer.id, orgId: acme.id, role: 'viewer' },
    { userId: users.priya.id, orgId: acme.id, role: 'engineer' },
    { userId: users.marcus.id, orgId: acme.id, role: 'sre' },
    { userId: users.globex.id, orgId: globex.id, role: 'admin' },
    { userId: users.gsre.id, orgId: globex.id, role: 'sre' },
  ]);
  const acmeUsers = [users.admin, users.sre, users.engineer, users.priya, users.marcus];

  /* ---------------------------------------------------------------- services */
  const svcId = new Map<string, Map<string, string>>(); // slug -> key -> id
  for (const { id: orgId, cat } of orgs.values()) {
    const map = new Map<string, string>();
    const rows = cat.services.map((sv) => ({
      id: randomUUID(), orgId, key: sv.key, name: sv.name, kind: sv.kind, team: sv.team, tier: sv.tier, description: sv.description,
      config: {
        production: { replicas: sv.tier === 1 ? 8 : 4, cpuLimit: '2000m', memoryLimit: '4Gi', logLevel: 'info', autoscaling: true },
        staging: { replicas: 1, cpuLimit: '500m', memoryLimit: '1Gi', logLevel: 'debug', autoscaling: false },
      },
    }));
    await db.insert(s.services).values(rows);
    rows.forEach((r) => map.set(r.key, r.id));
    svcId.set(cat.slug, map);
    const deps = cat.services.flatMap((sv) => sv.dependsOn.map((d) => ({ orgId, fromId: map.get(sv.key)!, toId: map.get(d)! })));
    await db.insert(s.serviceDeps).values(deps);
  }

  /* ---------------------------------------------------------------- faults + incidents (acme) */
  const faultRows: (typeof s.faults.$inferInsert)[] = [];
  const mkFault = (orgId: string, slug: string, environment: string, key: string, kind: FaultKind, startMs: number, endMs: number | null, magnitude: number, cause: string) => {
    const f = { id: randomUUID(), orgId, environment, serviceId: svcId.get(slug)!.get(key)!, kind, startAt: new Date(startMs), endAt: endMs ? new Date(endMs) : null, magnitude, cause };
    faultRows.push(f);
    return f;
  };

  interface PlannedIncident { fault: (typeof faultRows)[number]; key: string; kind: FaultKind; startMs: number; endMs: number | null; mag: number; status: string; deployBefore: boolean }
  const planned: PlannedIncident[] = [];
  const acmeKeys = ACME.services.filter((x) => x.kind !== 'cache').map((x) => x.key);

  // Ongoing, hand-authored scenarios (anchor the demo)
  const ongoing: [string, FaultKind, number, number, string, string][] = [
    ['payments-db', 'saturation', 41, 0.75, 'Connection pool saturation after schema migration', 'investigating'],
    ['search-service', 'latency', 13, 0.55, 'Index shard rebalancing slowing queries', 'triggered'],
  ];
  for (const [key, kind, minsAgo, mag, cause, status] of ongoing) {
    const f = mkFault(acme.id, 'acme', 'production', key, kind, now - minsAgo * MIN, null, mag, cause);
    planned.push({ fault: f, key, kind, startMs: now - minsAgo * MIN, endMs: null, mag, status, deployBefore: key === 'payments-db' });
  }
  // Recently mitigated
  {
    const f = mkFault(acme.id, 'acme', 'production', 'edge-gateway', 'error_spike', now - 4 * 60 * MIN, now - 215 * MIN, 0.8, 'Bad certificate rotation on two edge nodes');
    planned.push({ fault: f, key: 'edge-gateway', kind: 'error_spike', startMs: now - 240 * MIN, endMs: now - 215 * MIN, mag: 0.8, status: 'resolved', deployBefore: false });
  }
  // Historical
  const kinds: FaultKind[] = ['error_spike', 'latency', 'saturation', 'outage'];
  for (let d = 0; d < 14; d++) {
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const key = acmeKeys[Math.floor(rng() * acmeKeys.length)]!;
      const kind = kinds[Math.floor(rng() * kinds.length)]!;
      const startMs = now - d * DAY - Math.floor((0.4 + rng() * 0.55) * DAY) ;
      if (startMs > now - 6 * 60 * MIN) continue;
      const dur = (8 + Math.floor(rng() * 80)) * MIN;
      const mag = Math.round((0.35 + rng() * 0.65) * 100) / 100;
      const f = mkFault(acme.id, 'acme', 'production', key, kind, startMs, startMs + dur, mag, 'Simulated fault injection');
      const hasIncident = rng() < 0.75 && mag > 0.45;
      if (hasIncident) planned.push({ fault: f, key, kind, startMs, endMs: startMs + dur, mag, status: 'resolved', deployBefore: rng() < 0.3 });
    }
  }
  // staging + globex faults without incidents
  mkFault(acme.id, 'acme', 'staging', 'checkout-service', 'latency', now - 3 * 60 * MIN, now - 150 * MIN, 0.6, 'Load test');
  mkFault(globex.id, 'globex', 'production', 'ledger-db', 'latency', now - 9 * 60 * MIN, now - 7 * 60 * MIN, 0.6, 'Vacuum contention');
  mkFault(globex.id, 'globex', 'production', 'reports-service', 'error_spike', now - 25 * MIN, null, 0.5, 'Report job crash loop');
  await db.insert(s.faults).values(faultRows);

  /* ---------------------------------------------------------------- deployments */
  const depRows: (typeof s.deployments.$inferInsert)[] = [];
  const versions = new Map<string, number>();
  const mkDeploy = (orgId: string, slug: string, environment: string, key: string, at: number, by: string, status = 'succeeded', notes = '') => {
    const n = (versions.get(`${slug}:${key}`) ?? 10) + 1;
    versions.set(`${slug}:${key}`, n);
    const row = { id: randomUUID(), orgId, serviceId: svcId.get(slug)!.get(key)!, environment, version: `v2.${n}.0`, commit: Math.floor(rng() * 0xfffffff).toString(16).padStart(7, '0'), status, deployedBy: by, notes, deployedAt: new Date(at) };
    depRows.push(row);
    return row;
  };
  const deployForIncident = new Map<(typeof faultRows)[number], (typeof depRows)[number]>();
  for (const p of planned.sort((a, b) => a.startMs - b.startMs)) {
    if (p.deployBefore) {
      const svcKey = p.key.endsWith('-db') ? p.key.replace('-db', '-service').replace('payments-service', 'payments-service') : p.key;
      const target = ACME.services.some((x) => x.key === svcKey) ? svcKey : p.key;
      deployForIncident.set(p.fault, mkDeploy(acme.id, 'acme', 'production', target, p.startMs - 9 * MIN, acmeUsers[Math.floor(rng() * acmeUsers.length)]!.name, 'succeeded', p.key === 'payments-db' ? 'Adds ledger_entries index migration' : 'Routine release'));
    }
  }
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < 2; i++) {
      const key = ACME.services.filter((x) => x.kind === 'service')[Math.floor(rng() * 10)]!.key;
      const at = now - d * DAY - Math.floor(rng() * 0.9 * DAY) - 20 * MIN;
      mkDeploy(acme.id, 'acme', rng() < 0.7 ? 'production' : 'staging', key, at, acmeUsers[Math.floor(rng() * acmeUsers.length)]!.name, rng() < 0.08 ? 'rolled_back' : 'succeeded');
    }
  }
  for (const key of ['ledger-service', 'api-front', 'reports-service']) mkDeploy(globex.id, 'globex', 'production', key, now - Math.floor(rng() * 5 * DAY), users.gsre.name);
  await db.insert(s.deployments).values(depRows);

  /* ---------------------------------------------------------------- incidents */
  const sevFor = (key: string, mag: number): Severity => {
    const tier = ACME.services.find((x) => x.key === key)!.tier;
    if (mag > 0.85 && tier === 1) return 'SEV-1';
    if (mag > 0.6 && tier <= 2) return 'SEV-2';
    return mag > 0.45 ? 'SEV-3' : 'SEV-4';
  };
  const titleFor = (key: string, kind: FaultKind) => {
    const n = ACME.services.find((x) => x.key === key)!.name;
    return { error_spike: `${n} elevated 5xx error rate`, latency: `${n} latency degradation`, outage: `${n} unavailable`, saturation: `${n} resource saturation` }[kind];
  };
  const comments = [
    'Looking at the dashboards now — error budget burning fast.',
    'Rolled back the canary, watching recovery.',
    'Confirmed customer impact on checkout; status page updated.',
    'Correlates with the deploy ~10 minutes before onset.',
    'Scaling replicas up while we investigate root cause.',
    'Metrics are recovering. Keeping this open for 15 minutes of observation.',
  ];
  const sorted = planned.sort((a, b) => a.startMs - b.startMs);
  let number = 100;
  const incRows: (typeof s.incidents.$inferInsert)[] = [];
  const tl: (typeof s.incidentTimeline.$inferInsert)[] = [];
  const incSvc: (typeof s.incidentServices.$inferInsert)[] = [];
  const incResp: (typeof s.incidentResponders.$inferInsert)[] = [];
  const links: (typeof s.incidentLinks.$inferInsert)[] = [];
  const incidentOfFault = new Map<string, string>();
  for (const p of sorted) {
    const model = new SimModel({ orgSlug: 'acme', environment: 'production', services: ACME.services, faults: [] });
    void model;
    const id = randomUUID();
    incidentOfFault.set(p.fault.id!, id);
    const owner = acmeUsers[1 + Math.floor(rng() * 4)]!;
    const createdAt = p.startMs + (3 + Math.floor(rng() * 4)) * MIN;
    const ackAt = createdAt + (2 + Math.floor(rng() * 8)) * MIN;
    const sev = sevFor(p.key, p.mag);
    const resolvedAt = p.endMs ? p.endMs + (2 + Math.floor(rng() * 6)) * MIN : null;
    const status = p.status;
    const acknowledged = status !== 'triggered';
    const dependents = ACME.services.filter((x) => x.dependsOn.includes(p.key)).map((x) => x.key);
    const affected = [p.key, ...dependents.slice(0, 2)];
    const stamp = (at: number, kind: string, actor: string | null, body: string, meta: Record<string, unknown> = {}) =>
      tl.push({ incidentId: id, orgId: acme.id, kind, actorId: actor, body, meta, at: new Date(at) });
    incRows.push({
      id, orgId: acme.id, number: ++number, title: titleFor(p.key, p.kind), summary: `${p.fault.cause}. Detected by automated alert rules; simulated telemetry shows ${p.kind.replace('_', ' ')} on ${p.key}.`,
      severity: sev, status, environment: 'production', ownerId: acknowledged ? owner.id : null, createdBy: users.sre.id, notes: status === 'resolved' ? '## Findings\n- Impact window matched the simulated fault.\n- Follow-up: add saturation alert earlier.' : '',
      version: 1, createdAt: new Date(createdAt), acknowledgedAt: acknowledged ? new Date(ackAt) : null, resolvedAt: status === 'resolved' && resolvedAt ? new Date(resolvedAt) : null, updatedAt: new Date(Math.min(now, resolvedAt ?? now - MIN)),
    });
    affected.forEach((k) => incSvc.push({ incidentId: id, serviceId: svcId.get('acme')!.get(k)! }));
    if (acknowledged) incResp.push({ incidentId: id, userId: owner.id });
    stamp(createdAt, 'created', users.sre.id, `Incident opened as ${sev}`, { severity: sev });
    stamp(createdAt + 20_000, 'alert', null, `Alert fired: ${p.key} ${p.kind.replace('_', ' ')}`);
    if (acknowledged) {
      stamp(ackAt, 'status', owner.id, 'Status changed from triggered to acknowledged', { from: 'triggered', to: 'acknowledged' });
      stamp(ackAt + 90_000, 'owner', owner.id, `Assigned owner ${owner.name}`);
      stamp(ackAt + 4 * MIN, 'comment', owner.id, comments[Math.floor(rng() * comments.length)]!);
    }
    if (status === 'investigating') stamp(ackAt + 6 * MIN, 'status', owner.id, 'Status changed from acknowledged to investigating', { from: 'acknowledged', to: 'investigating' });
    if (status === 'resolved' && resolvedAt) {
      stamp(ackAt + 8 * MIN, 'status', owner.id, 'Status changed from acknowledged to investigating', { from: 'acknowledged', to: 'investigating' });
      stamp(resolvedAt - MIN, 'comment', owner.id, comments[Math.floor(rng() * comments.length)]!);
      stamp(resolvedAt, 'status', owner.id, 'Status changed from investigating to resolved', { from: 'investigating', to: 'resolved' });
    }
    const dep = deployForIncident.get(p.fault);
    if (dep) {
      links.push({ incidentId: id, orgId: acme.id, kind: 'deployment', refId: dep.id!, label: `${dep.version} · ${dep.commit}` });
      stamp(createdAt + 2 * MIN, 'link', owner.id, `Linked deployment ${dep.version}`, { kind: 'deployment' });
    }
  }
  await db.insert(s.incidents).values(incRows);
  await db.insert(s.incidentServices).values(incSvc);
  if (incResp.length) await db.insert(s.incidentResponders).values(incResp);
  await db.insert(s.incidentTimeline).values(tl);
  if (links.length) await db.insert(s.incidentLinks).values(links);
  log(`incidents: ${incRows.length}, faults: ${faultRows.length}, deployments: ${depRows.length}`);

  /* ---------------------------------------------------------------- alert rules + history */
  const sv = (k: string) => svcId.get('acme')!.get(k)!;
  const rule = (orgId: string, name: string, condition: string, serviceId: string | null, threshold: number, windowSec: number, severity: string, auto = false, environment = 'production') =>
    ({ id: randomUUID(), orgId, name, condition, serviceId, environment, threshold, windowSec, cooldownSec: 900, severity, autoCreateIncident: auto, enabled: true });
  const rules = [
    rule(acme.id, 'Checkout error rate above 5%', 'error_rate_above', sv('checkout-service'), 5, 300, 'SEV-2'),
    rule(acme.id, 'Payments p95 latency above 600ms', 'latency_above', sv('payments-service'), 600, 300, 'SEV-2'),
    rule(acme.id, 'Any service unavailable', 'health_change', null, 2, 120, 'SEV-1', true),
    rule(acme.id, 'Edge request volume anomaly', 'request_volume_anomaly', sv('edge-gateway'), 45, 300, 'SEV-3'),
    rule(acme.id, 'Search p95 latency above 450ms', 'latency_above', sv('search-service'), 450, 300, 'SEV-3'),
    rule(acme.id, 'Database error rate above 3%', 'error_rate_above', null, 3, 300, 'SEV-2'),
    rule(globex.id, 'Ledger error rate above 4%', 'error_rate_above', svcId.get('globex')!.get('ledger-service')!, 4, 300, 'SEV-2'),
  ];
  await db.insert(s.alertRules).values(rules);
  const alertRows = sorted.slice(0, -2).filter((_, i) => i % 1 === 0).map((p) => ({
    id: randomUUID(), orgId: acme.id, ruleId: rules[p.kind === 'latency' ? 1 : 0]!.id, serviceId: sv(p.key), severity: sevFor(p.key, p.mag), status: 'resolved',
    value: 5 + p.mag * 20, detail: `Simulated ${p.kind.replace('_', ' ')} on ${p.key} (history)`, firedAt: new Date(p.startMs + 2 * MIN), resolvedAt: new Date((p.endMs ?? now) + 2 * MIN), incidentId: incidentOfFault.get(p.fault.id!) ?? null,
  }));
  if (alertRows.length) await db.insert(s.alerts).values(alertRows);

  /* ---------------------------------------------------------------- flags, notifications, audit */
  await db.insert(s.featureFlags).values([
    { key: 'ai-assistant', description: 'AI incident analysis panel (rule-based fallback when no provider is configured).', enabled: true, rolloutPercent: 100 },
    { key: 'graph-edge-animation', description: 'Animate edge activity on the service dependency graph.', enabled: true, rolloutPercent: 100 },
    { key: 'trace-compare', description: 'Experimental: compare two traces side by side.', enabled: true, rolloutPercent: 35 },
  ]);
  await db.insert(s.flagOverrides).values([{ flagKey: 'ai-assistant', orgId: globex.id, environment: null, enabled: false, rolloutPercent: 100 }]);
  await db.insert(s.flagHistory).values([
    { flagKey: 'ai-assistant', orgId: null, actor: 'system', change: 'Created flag (enabled, 100%)', at: new Date(now - 10 * DAY) },
    { flagKey: 'ai-assistant', orgId: globex.id, actor: 'Gina Globex', change: 'Org override: disabled', at: new Date(now - 3 * DAY) },
    { flagKey: 'trace-compare', orgId: null, actor: 'system', change: 'Created flag (enabled, 35%)', at: new Date(now - 6 * DAY) },
  ]);
  const active = sorted.filter((p) => !p.endMs);
  await db.insert(s.notifications).values(
    acmeUsers.flatMap((u) => active.map((p) => ({ orgId: acme.id, userId: u.id, kind: 'incident', title: `${sevFor(p.key, p.mag)} · ${titleFor(p.key, p.kind)}`, body: p.fault.cause, href: `/incidents/${incidentOfFault.get(p.fault.id!)}`, read: false, createdAt: new Date(p.startMs + 5 * MIN) }))),
  );
  await db.insert(s.auditLogs).values([
    { orgId: acme.id, actorId: users.admin.id, action: 'org.seeded', resource: 'organization', resourceId: acme.id, metadata: { note: 'Deterministic demo seed' }, at: new Date(now - 14 * DAY) },
    { orgId: acme.id, actorId: users.admin.id, action: 'member.role_changed', resource: 'membership', resourceId: users.marcus.id, metadata: { from: 'engineer', to: 'sre' }, at: new Date(now - 5 * DAY) },
    { orgId: globex.id, actorId: users.globex.id, action: 'org.seeded', resource: 'organization', resourceId: globex.id, metadata: {}, at: new Date(now - 14 * DAY) },
  ]);

  /* ---------------------------------------------------------------- traces */
  const allFaults: Fault[] = faultRows.map((f) => ({ id: f.id!, serviceKey: [...svcId.get(f.orgId === acme.id ? 'acme' : 'globex')!.entries()].find(([, v]) => v === f.serviceId)![0], environment: f.environment, kind: f.kind as FaultKind, startMs: f.startAt.getTime(), endMs: f.endAt ? f.endAt.getTime() : null, magnitude: f.magnitude }));
  const traceRows: (typeof s.traces.$inferInsert)[] = [];
  const spanRows: (typeof s.spans.$inferInsert)[] = [];
  const traceTargets: [typeof acme, string, string, number][] = [[acme, 'acme', 'production', 520], [acme, 'acme', 'staging', 50], [globex, 'globex', 'production', 120]];
  for (const [o, slug, environment, count] of traceTargets) {
    const model = new SimModel({ orgSlug: slug, environment, services: o.cat.services, faults: allFaults.filter((f) => o.cat.services.some((x) => x.key === f.serviceKey)) });
    for (let i = 0; i < count; i++) {
      const startMs = now - Math.floor(((count - i) / count) * DAY) + Math.floor(rng() * 60_000);
      const t = buildTrace(model, slug, environment, startMs, i);
      traceRows.push({ traceId: t.traceId, orgId: o.id, environment, rootService: t.rootService, rootOperation: t.rootOperation, startAt: new Date(startMs), durationMs: t.durationMs, spanCount: t.spans.length, errorCount: t.errorCount, status: t.status, services: t.services });
      t.spans.forEach((sp) => spanRows.push({ traceId: t.traceId, ...sp }));
    }
  }
  await db.insert(s.traces).values(traceRows);
  for (const c of chunk(spanRows, 2000)) await db.insert(s.spans).values(c);
  log(`traces: ${traceRows.length}, spans: ${spanRows.length}`);

  /* ---------------------------------------------------------------- events (50k+) */
  const days = opts.eventDays ?? 14;
  let total = 0;
  for (const [o, slug] of [[acme, 'acme'], [globex, 'globex']] as const) {
    for (const environment of ENVIRONMENTS) {
      const model = new SimModel({ orgSlug: slug, environment, services: o.cat.services, faults: allFaults.filter((f) => o.cat.services.some((x) => x.key === f.serviceKey)) });
      let batch: (typeof s.events.$inferInsert)[] = [];
      const flush = async () => {
        for (const c of chunk(batch, 3000)) await db.insert(s.events).values(c).onConflictDoNothing();
        total += batch.length;
        batch = [];
      };
      const startBucket = Math.floor((now - days * DAY) / EVENT_BUCKET_MS) * EVENT_BUCKET_MS;
      for (let b = startBucket; b <= now; b += EVENT_BUCKET_MS) {
        for (const svc of o.cat.services) {
          for (const e of eventsForBucket(model, svc, b)) {
            if (e.ts > now) continue;
            batch.push({ id: e.id, orgId: o.id, environment, serviceId: svcId.get(slug)!.get(svc.key)!, ts: new Date(e.ts), type: e.type, severity: e.severity, message: e.message, attributes: e.attributes });
          }
        }
        if (batch.length > 20000) await flush();
      }
      await flush();
    }
  }
  // deployment events mirroring deployments table
  const deployEvents = depRows.map((d) => ({ id: `evt_dep_${d.id}`, orgId: d.orgId, environment: d.environment, serviceId: d.serviceId, ts: d.deployedAt as Date, type: 'deployment', severity: 'info', message: `Deployed ${d.version} (${d.commit})`, attributes: { version: d.version, commit: d.commit } }));
  await db.insert(s.events).values(deployEvents).onConflictDoNothing();
  total += deployEvents.length;
  log(`events: ${total}`);
  await client.end();
  log('done. demo password:', env.SEED_PASSWORD);
}

if (process.argv[1]?.endsWith('seed/index.ts') || process.argv[1]?.endsWith('dist/seed.js')) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
