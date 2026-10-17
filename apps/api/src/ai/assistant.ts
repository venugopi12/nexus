import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { mean, percentile, type IncidentDetailDto } from '@nexus/shared';
import * as s from '../db/schema';
import type { AppContext } from '../context';

export type Confidence = 'observed' | 'correlated' | 'possible';
export interface Evidence { kind: 'metric' | 'event' | 'deployment' | 'trace' | 'service'; label: string; href?: string }
export interface Finding { id: string; confidence: Confidence; statement: string; evidence: Evidence[] }
export interface Analysis {
  provider: 'rule-based' | 'anthropic';
  providerNote?: string;
  generatedAt: string;
  causalStatus: 'unconfirmed';
  summary: string;
  findings: Finding[];
  disclaimer: string;
}

const median = (xs: number[]) => percentile(xs.filter((x) => Number.isFinite(x)), 50);

/**
 * Evidence-linked, rule-based analysis built only from observable telemetry (metrics, events,
 * deployments, traces). It never reads simulator ground truth (faults) and never states a root cause as fact.
 */
export async function analyzeIncident(ctx: AppContext, orgId: string, incident: IncidentDetailDto): Promise<Analysis> {
  const info = await ctx.registry.org(orgId);
  const model = await ctx.registry.model(orgId, incident.environment);
  const now = Date.now();
  const created = new Date(incident.createdAt).getTime();
  const end = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now;
  const from = created - 30 * 60_000;
  const affected = incident.services.map((x) => x.key);
  const profiles = new Map(info.profiles.map((p) => [p.key, p]));
  // affected + dependencies up to depth 2
  const scope = new Set(affected);
  let frontier = [...affected];
  for (let d = 0; d < 2; d++) {
    frontier = frontier.flatMap((k) => profiles.get(k)?.dependsOn ?? []).filter((k) => !scope.has(k));
    frontier.forEach((k) => scope.add(k));
  }
  const findings: Finding[] = [];
  const anomalies: { key: string; errPeak: number; errBase: number; latPeak: number; latBase: number; affected: boolean; onset: number }[] = [];
  for (const key of scope) {
    const base = { from: created - 6 * 3600_000, to: created - 60 * 60_000 };
    const step = 5 * 60_000;
    const errBase = median(model.series(key, 'error_rate', base.from, base.to, step, 'avg', 4).map((p) => p.v ?? 0));
    const latBase = median(model.series(key, 'latency_ms', base.from, base.to, step, 'p95', 4).map((p) => p.v ?? 0));
    const err = model.series(key, 'error_rate', from, end, step, 'avg').map((p) => p.v ?? 0);
    const lat = model.series(key, 'latency_ms', from, end, step, 'p95').map((p) => p.v ?? 0);
    const errPeak = Math.max(0, ...err);
    const latPeak = Math.max(0, ...lat);
    if (errPeak > Math.max(2, errBase * 3) || latPeak > latBase * 2) {
      const first = err.findIndex((v, i) => v > Math.max(2, errBase * 3) || (lat[i] ?? 0) > latBase * 2);
      anomalies.push({ key, errPeak, errBase, latPeak, latBase, affected: affected.includes(key), onset: from + Math.max(0, first) * step });
    }
  }
  for (const a of anomalies) {
    const name = profiles.get(a.key)?.name ?? a.key;
    const parts: string[] = [];
    if (a.errPeak > Math.max(2, a.errBase * 3)) parts.push(`error rate peaked at ${a.errPeak.toFixed(1)}% (baseline ≈ ${a.errBase.toFixed(2)}%)`);
    if (a.latPeak > a.latBase * 2) parts.push(`p95 latency peaked at ${a.latPeak.toFixed(0)} ms (baseline ≈ ${a.latBase.toFixed(0)} ms)`);
    findings.push({
      id: `metric-${a.key}`, confidence: 'observed',
      statement: `${name}${a.affected ? '' : ' (dependency)'}: ${parts.join('; ')} during the incident window.`,
      evidence: [{ kind: 'metric', label: `${name} metrics`, href: `/metrics?metric=${parts[0]?.startsWith('error') ? 'error_rate' : 'latency_ms'}&services=${a.key}&from=${from}&to=${end}&agg=${parts[0]?.startsWith('error') ? 'avg' : 'p95'}&env=${incident.environment}` }, { kind: 'service', label: name, href: `/services/${info.idByKey.get(a.key)}` }],
    });
  }
  // dependency candidates (earlier/stronger anomaly in a callee of an affected service)
  // A dependency is only a candidate if its anomaly began no later than the earliest affected service's (+1 step).
  const earliestAffected = Math.min(Infinity, ...anomalies.filter((a) => a.affected).map((a) => a.onset));
  const depAnoms = anomalies.filter((a) => !a.affected && a.onset <= earliestAffected + 5 * 60_000);
  if (depAnoms.length) {
    const names = depAnoms.map((a) => profiles.get(a.key)?.name ?? a.key);
    findings.push({
      id: 'dependency-candidate', confidence: 'possible',
      statement: `Possible contributing dependency: ${names.join(', ')} ${depAnoms.length > 1 ? 'show' : 'shows'} anomalies that began no later than the first affected service, and ${depAnoms.length > 1 ? 'are' : 'is'} called (directly or transitively) by affected services. Timing alignment is suggestive only. This is an inference from the dependency graph, not a confirmed cause.`,
      evidence: depAnoms.map((a) => ({ kind: 'service' as const, label: profiles.get(a.key)?.name ?? a.key, href: `/services/${info.idByKey.get(a.key)}` })),
    });
  }
  // deployments shortly before onset
  const scopeIds = [...scope].map((k) => info.idByKey.get(k)).filter(Boolean) as string[];
  const deploys = scopeIds.length
    ? await ctx.db.select({ d: s.deployments, name: s.services.name }).from(s.deployments).innerJoin(s.services, eq(s.services.id, s.deployments.serviceId)).where(and(eq(s.deployments.orgId, orgId), inArray(s.deployments.serviceId, scopeIds), gte(s.deployments.deployedAt, new Date(created - 90 * 60_000)), lte(s.deployments.deployedAt, new Date(created + 5 * 60_000))))
    : [];
  for (const { d, name } of deploys) {
    const mins = Math.round((created - d.deployedAt.getTime()) / 60_000);
    findings.push({
      id: `deploy-${d.id}`, confidence: 'correlated',
      statement: `${name} ${d.version} was deployed ${mins >= 0 ? `${mins} min before` : `${-mins} min after`} the incident was opened. Timing is correlated; causation is not established.`,
      evidence: [{ kind: 'deployment', label: `${name} ${d.version} (${d.commit})`, href: '/deployments' }],
    });
  }
  // events
  const evRows = scopeIds.length
    ? await ctx.db.select({ type: s.events.type, severity: s.events.severity, n: sql<number>`count(*)::int` }).from(s.events).where(and(eq(s.events.orgId, orgId), eq(s.events.environment, incident.environment), inArray(s.events.serviceId, scopeIds), gte(s.events.ts, new Date(from)), lte(s.events.ts, new Date(end)))).groupBy(s.events.type, s.events.severity)
    : [];
  const bad = evRows.filter((r) => r.severity === 'error' || r.severity === 'critical');
  if (bad.length) {
    const total = bad.reduce((a, r) => a + r.n, 0);
    const byType = new Map<string, number>();
    bad.forEach((r) => byType.set(r.type, (byType.get(r.type) ?? 0) + r.n));
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ty, n]) => `${n}× ${ty.replace('_', ' ')}`);
    findings.push({ id: 'events', confidence: 'observed', statement: `${total} error/critical events were recorded across affected services and their dependencies in the window (${top.join(', ')}).`, evidence: [{ kind: 'event', label: 'Open in Event Stream', href: `/events?from=${from}&to=${end}&severities=error,critical&services=${[...scope].join(',')}` }] });
  }
  // traces
  const tr = scopeIds.length
    ? await ctx.db.select({ traceId: s.traces.traceId, durationMs: s.traces.durationMs }).from(s.traces).where(and(eq(s.traces.orgId, orgId), eq(s.traces.environment, incident.environment), eq(s.traces.status, 'error'), gte(s.traces.startAt, new Date(from)), lte(s.traces.startAt, new Date(end)))).limit(200)
    : [];
  const relevant = tr.length;
  if (relevant) {
    findings.push({ id: 'traces', confidence: 'observed', statement: `${relevant} sampled error trace${relevant > 1 ? 's fall' : ' falls'} inside the window (median duration ${median(tr.map((t) => t.durationMs)).toFixed(0)} ms).`, evidence: tr.slice(0, 3).map((t) => ({ kind: 'trace' as const, label: t.traceId.slice(0, 12), href: `/traces/${t.traceId}` })) });
  }
  const durMin = Math.round((end - created) / 60_000);
  const summary = findings.length
    ? `${incident.severity} incident "${incident.title}" has been ${incident.resolvedAt ? 'resolved after' : 'open for'} ${durMin} min. Telemetry shows ${anomalies.length} anomalous service${anomalies.length === 1 ? '' : 's'} in scope and ${deploys.length} recent deployment${deploys.length === 1 ? '' : 's'}. No root cause is confirmed; the findings below are linked to the evidence they come from.`
    : `${incident.severity} incident "${incident.title}" has been ${incident.resolvedAt ? 'resolved after' : 'open for'} ${durMin} min. No metric, event, trace or deployment anomalies were found in the analysed window, so no explanation can be offered.`;
  const rb: Analysis = { provider: 'rule-based', generatedAt: new Date().toISOString(), causalStatus: 'unconfirmed', summary, findings, disclaimer: 'Generated from simulated telemetry. Findings marked "possible" or "correlated" are hypotheses, not confirmed causes.' };
  void mean;
  if (ctx.env.AI_PROVIDER === 'anthropic' && ctx.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ctx.env.AI_MODEL, max_tokens: 400,
          system: 'You summarise incident evidence for on-call engineers. Use ONLY the findings provided. Never invent metrics, services, or causes. Clearly separate observed facts from hypotheses, and never present a hypothesis as confirmed. Max 120 words.',
          messages: [{ role: 'user', content: JSON.stringify({ incident: { title: incident.title, severity: incident.severity, status: incident.status }, findings: findings.map((f) => ({ confidence: f.confidence, statement: f.statement })) }) }],
        }),
      });
      if (!res.ok) throw new Error(`provider returned ${res.status}`);
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
      if (!text) throw new Error('empty provider response');
      return { ...rb, provider: 'anthropic', summary: text };
    } catch (e) {
      return { ...rb, providerNote: `AI provider unavailable (${(e as Error).message}); showing rule-based summary.` };
    }
  }
  return rb;
}
