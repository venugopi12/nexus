import { and, desc, eq, ne, isNull, or } from 'drizzle-orm';
import { evaluateRule, shouldEmitAlert, type AlertCondition, type Severity } from '@nexus/shared';
import * as s from '../db/schema';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { createIncident } from './incidents';
import { orgRoom, type AppContext } from '../context';

/** Evaluates every enabled rule once. Called on an interval and directly from tests. */
export async function evaluateAllRules(ctx: AppContext, now = Date.now(), onlyOrgId?: string) {
  const rules = await ctx.db.select().from(s.alertRules).where(and(eq(s.alertRules.enabled, true), onlyOrgId ? eq(s.alertRules.orgId, onlyOrgId) : undefined));
  let emitted = 0;
  for (const rule of rules) {
    const info = await ctx.registry.org(rule.orgId);
    const model = await ctx.registry.model(rule.orgId, rule.environment);
    const targets = rule.serviceId ? info.rows.filter((r) => r.id === rule.serviceId) : info.rows;
    for (const svc of targets) {
      const from = now - rule.windowSec * 1000;
      const samples = (m: 'error_rate' | 'latency_ms' | 'request_rate', f: number, t: number) => model.samples(svc.key, m, f, t).map((x) => x.v);
      const result = evaluateRule(
        { condition: rule.condition as AlertCondition, threshold: rule.threshold, windowSec: rule.windowSec },
        {
          errorRate: samples('error_rate', from, now), latency: samples('latency_ms', from, now), requestRate: samples('request_rate', from, now),
          baselineRequestRate: samples('request_rate', from - 3600_000, now - 3600_000), health: model.health(svc.key, now, 60_000).status,
        },
      );
      const svcCond = svc.id ? eq(s.alerts.serviceId, svc.id) : isNull(s.alerts.serviceId);
      const [open] = await ctx.db.select().from(s.alerts).where(and(eq(s.alerts.ruleId, rule.id), svcCond, ne(s.alerts.status, 'resolved')));
      if (open && !result.firing) {
        await ctx.db.update(s.alerts).set({ status: 'resolved', resolvedAt: new Date(now) }).where(eq(s.alerts.id, open.id));
        continue;
      }
      if (open && result.firing) {
        await ctx.db.update(s.alerts).set({ value: result.value, detail: result.detail }).where(eq(s.alerts.id, open.id));
        continue;
      }
      const [last] = await ctx.db.select({ firedAt: s.alerts.firedAt }).from(s.alerts).where(and(eq(s.alerts.ruleId, rule.id), svcCond)).orderBy(desc(s.alerts.firedAt)).limit(1);
      if (!shouldEmitAlert({ firing: result.firing, hasOpenAlert: !!open, lastFiredAt: last?.firedAt.getTime() ?? null, now, cooldownSec: rule.cooldownSec })) continue;
      try {
        const [alert] = await ctx.db.insert(s.alerts).values({ orgId: rule.orgId, ruleId: rule.id, serviceId: svc.id, severity: rule.severity, status: 'firing', value: result.value, detail: result.detail, firedAt: new Date(now) }).returning();
        emitted++;
        ctx.bus.emit(orgRoom(rule.orgId), 'alert:fired', { id: alert!.id, ruleName: rule.name, severity: rule.severity as Severity });
        await notify(ctx, rule.orgId, { permission: 'alert:read' }, { kind: 'alert', title: `${rule.severity} alert · ${rule.name}`, body: `${svc.name}: ${result.detail}`, href: '/alerts' });
        await audit(ctx.db, { orgId: rule.orgId, actorId: null, action: 'alert.fired', resource: 'alert', resourceId: alert!.id, metadata: { rule: rule.name, service: svc.key } });
        if (rule.autoCreateIncident) await incidentFromAlert(ctx, rule.orgId, null, alert!.id);
      } catch (e) {
        // unique-index violation => another evaluator already opened this alert; safe to ignore
        if (!String((e as Error).message).includes('alerts_one_open')) ctx.log.error({ err: e }, 'alert insert failed');
      }
    }
    await ctx.db.update(s.alertRules).set({ lastEvaluatedAt: new Date(now) }).where(eq(s.alertRules.id, rule.id));
  }
  return emitted;
}

export async function incidentFromAlert(ctx: AppContext, orgId: string, actorId: string | null, alertId: string) {
  const [row] = await ctx.db
    .select({ a: s.alerts, ruleName: s.alertRules.name, env: s.alertRules.environment, svcName: s.services.name })
    .from(s.alerts).innerJoin(s.alertRules, eq(s.alertRules.id, s.alerts.ruleId)).leftJoin(s.services, eq(s.services.id, s.alerts.serviceId))
    .where(and(eq(s.alerts.id, alertId), eq(s.alerts.orgId, orgId)));
  if (!row) return null;
  if (row.a.incidentId) return row.a.incidentId;
  if (!row.a.serviceId) return null;
  const incident = await createIncident(ctx, orgId, actorId, {
    title: `${row.svcName ?? 'Service'}: ${row.ruleName}`.slice(0, 140),
    summary: `Created from alert. ${row.a.detail}`, severity: row.a.severity as Severity, environment: row.env as 'production',
    ownerId: null, responderIds: [], serviceIds: [row.a.serviceId], alertId,
  });
  return incident.id;
}

export function startEvaluator(ctx: AppContext) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await evaluateAllRules(ctx); } catch (e) { ctx.log.error({ err: e }, 'alert evaluation failed'); } finally { busy = false; }
  }, ctx.env.ALERT_EVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
void or;
