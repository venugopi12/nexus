/**
 * Deterministic telemetry model.
 *
 * Every metric value is a pure function of (service, environment, timestamp, faults). The API's
 * metric endpoints, the live ticker, the alert evaluator and the seed script all call into this
 * module, so dashboards, incidents and events can never disagree about what happened.
 *
 * All data produced here is SIMULATED and labelled as such in the UI.
 */
import { gaussian, unit } from './prng';
import type { ServiceProfile } from './catalog';

export const SAMPLE_INTERVAL_MS = 15_000;

export type FaultKind = 'error_spike' | 'latency' | 'outage' | 'saturation';

export interface Fault {
  id: string;
  serviceKey: string;
  environment: string;
  kind: FaultKind;
  startMs: number;
  /** null when still ongoing */
  endMs: number | null;
  /** 0..1 */
  magnitude: number;
}

export const METRICS = [
  { key: 'request_rate', label: 'Request rate', unit: 'req/s', aggs: ['avg', 'min', 'max'] },
  { key: 'error_rate', label: 'Error rate', unit: '%', aggs: ['avg', 'min', 'max'] },
  { key: 'latency_ms', label: 'Request latency', unit: 'ms', aggs: ['avg', 'min', 'max', 'p50', 'p95', 'p99'] },
  { key: 'cpu', label: 'CPU utilisation', unit: '%', aggs: ['avg', 'min', 'max'] },
  { key: 'memory', label: 'Memory utilisation', unit: '%', aggs: ['avg', 'min', 'max'] },
] as const;
export type MetricKey = (typeof METRICS)[number]['key'];
export type Aggregation = 'avg' | 'min' | 'max' | 'p50' | 'p95' | 'p99';

const RAMP_MS = 90_000;

/** Strength (0..1) of one fault at time t, including a short ramp in and out. */
function faultStrength(f: Fault, t: number): number {
  if (t < f.startMs) return 0;
  const end = f.endMs ?? Infinity;
  const up = Math.min(1, (t - f.startMs) / RAMP_MS);
  const down = end === Infinity ? 1 : Math.min(1, Math.max(0, (end + RAMP_MS - t) / RAMP_MS));
  if (t > end + RAMP_MS) return 0;
  return f.magnitude * Math.min(up, down);
}

export interface ModelContext {
  orgSlug: string;
  environment: string;
  services: ServiceProfile[];
  faults: Fault[];
}

export interface Impact {
  error: number;
  latency: number;
  outage: number;
  saturation: number;
  /** true when the impact is only propagated from a dependency (inferred, not a direct fault) */
  inferredOnly: boolean;
}

export class SimModel {
  private byKey = new Map<string, ServiceProfile>();
  private faultsByService = new Map<string, Fault[]>();
  private impactCache = new Map<string, Impact>();

  constructor(public readonly ctx: ModelContext) {
    for (const s of ctx.services) this.byKey.set(s.key, s);
    for (const f of ctx.faults) {
      if (f.environment !== ctx.environment) continue;
      const arr = this.faultsByService.get(f.serviceKey) ?? [];
      arr.push(f);
      this.faultsByService.set(f.serviceKey, arr);
    }
  }

  /** Direct + propagated impact at time t (propagation is intentionally weaker than a direct fault). */
  impact(serviceKey: string, t: number, depth = 0): Impact {
    const cacheKey = `${serviceKey}@${t}`;
    const cached = this.impactCache.get(cacheKey);
    if (cached) return cached;
    const svc = this.byKey.get(serviceKey);
    const out: Impact = { error: 0, latency: 0, outage: 0, saturation: 0, inferredOnly: false };
    if (!svc || depth > 6) return out;
    for (const f of this.faultsByService.get(serviceKey) ?? []) {
      const k = faultStrength(f, t);
      if (k <= 0) continue;
      if (f.kind === 'error_spike') out.error = Math.max(out.error, k);
      if (f.kind === 'latency') out.latency = Math.max(out.latency, k);
      if (f.kind === 'outage') out.outage = Math.max(out.outage, k);
      if (f.kind === 'saturation') out.saturation = Math.max(out.saturation, k);
    }
    const direct = out.error + out.latency + out.outage + out.saturation > 0;
    let propErr = 0;
    let propLat = 0;
    for (const dep of svc.dependsOn) {
      const di = this.impact(dep, t, depth + 1);
      propErr = Math.max(propErr, 0.18 * Math.max(di.error, di.outage));
      propLat = Math.max(propLat, 0.35 * Math.max(di.latency, di.outage, di.saturation, di.error * 0.5));
    }
    out.error = Math.max(out.error, propErr);
    out.latency = Math.max(out.latency, propLat);
    out.inferredOnly = !direct && (propErr > 0 || propLat > 0);
    if (this.impactCache.size > 20000) this.impactCache.clear();
    this.impactCache.set(cacheKey, out);
    return out;
  }

  private diurnal(t: number): number {
    const d = new Date(t);
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    const day = d.getUTCDay();
    const weekly = day === 0 || day === 6 ? 0.82 : 1;
    return (1 + 0.38 * Math.sin(((h - 9) / 24) * 2 * Math.PI)) * weekly;
  }

  /** Aligns t down to the sampling grid. */
  static align(t: number): number {
    return Math.floor(t / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
  }

  sample(serviceKey: string, metric: MetricKey, tRaw: number): number {
    const svc = this.byKey.get(serviceKey);
    if (!svc) return 0;
    const t = SimModel.align(tRaw);
    const slot = t / SAMPLE_INTERVAL_MS;
    const seed = [this.ctx.orgSlug, this.ctx.environment, serviceKey];
    const envScale = this.ctx.environment === 'production' ? 1 : 0.18;
    const imp = this.impact(serviceKey, t);
    const n = gaussian(...seed, metric, slot);
    switch (metric) {
      case 'request_rate': {
        const v = svc.baseRps * envScale * this.diurnal(t) * (1 + 0.05 * n);
        return Math.max(0, v * (1 - 0.92 * imp.outage) * (1 - 0.15 * imp.error));
      }
      case 'error_rate': {
        const base = svc.baseErrorPct * (1 + 0.25 * n);
        const add = 55 * imp.error + 90 * imp.outage + 6 * imp.saturation + 3 * imp.latency;
        return clamp(Math.max(0, base) + add * (0.85 + 0.15 * unit(...seed, 'e', slot)), 0, 100);
      }
      case 'latency_ms': {
        const sigma = 0.32;
        const median =
          svc.baseLatencyMs * (0.9 + 0.2 * this.diurnal(t) * 0.5) *
          (1 + 7 * imp.latency + 4 * imp.saturation + 2 * imp.outage + 0.8 * imp.error);
        return Math.max(0.2, median * Math.exp(sigma * n));
      }
      case 'cpu': {
        const v = 28 + 14 * this.diurnal(t) + 3 * n + 55 * imp.saturation + 12 * imp.latency;
        return clamp(v, 1, 100);
      }
      case 'memory': {
        const v = 52 + 6 * Math.sin(t / 3_600_000 / 5) + 1.5 * n + 28 * imp.saturation;
        return clamp(v, 1, 100);
      }
    }
  }

  /** Raw samples between [from, to). */
  samples(serviceKey: string, metric: MetricKey, from: number, to: number, stride = 1) {
    const out: { t: number; v: number }[] = [];
    const step = SAMPLE_INTERVAL_MS * Math.max(1, Math.floor(stride));
    for (let t = Math.ceil(from / step) * step; t < to; t += step) {
      out.push({ t, v: this.sample(serviceKey, metric, t) });
    }
    return out;
  }

  /** Bucketed series. Percentiles are computed over raw samples in each bucket. */
  series(serviceKey: string, metric: MetricKey, from: number, to: number, stepMs: number, agg: Aggregation, stride = 1) {
    const out: { t: number; v: number | null }[] = [];
    const start = Math.floor(from / stepMs) * stepMs;
    for (let b = start; b < to; b += stepMs) {
      const raw = this.samples(serviceKey, metric, Math.max(b, from), Math.min(b + stepMs, to), stride);
      out.push({ t: b, v: raw.length ? aggregate(raw.map((r) => r.v), agg) : null });
    }
    return out;
  }

  /** Health from the trailing window. Thresholds are per-service so DBs and edges are judged fairly. */
  health(serviceKey: string, now: number, windowMs = 60_000): ServiceHealth {
    const svc = this.byKey.get(serviceKey)!;
    const from = now - windowMs;
    const lat = this.samples(serviceKey, 'latency_ms', from, now).map((x) => x.v);
    const err = this.samples(serviceKey, 'error_rate', from, now).map((x) => x.v);
    const rps = this.samples(serviceKey, 'request_rate', from, now).map((x) => x.v);
    const p95 = percentile(lat, 95);
    const errAvg = mean(err);
    const rpsAvg = mean(rps);
    const baseP95 = svc.baseLatencyMs * Math.exp(0.32 * 1.645) * 1.15;
    const imp = this.impact(serviceKey, now - 15000);
    let status: HealthStatus = 'healthy';
    if (errAvg >= 20 || imp.outage > 0.6) status = 'unavailable';
    else if (errAvg >= 2 || p95 >= baseP95 * 2) status = 'degraded';
    return {
      serviceKey,
      status,
      errorRate: errAvg,
      p50: percentile(lat, 50),
      p95,
      p99: percentile(lat, 99),
      avgLatency: mean(lat),
      rps: rpsAvg,
      inferredOnly: status === 'healthy' ? false : imp.inferredOnly,
      atRisk: status === 'healthy' && imp.inferredOnly,
    };
  }
}

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';
export interface ServiceHealth {
  serviceKey: string;
  status: HealthStatus;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  avgLatency: number;
  rps: number;
  /** degradation is only propagated from a dependency (inferred) */
  inferredOnly: boolean;
  /** healthy by own metrics, but a dependency is faulted (inferred risk) */
  atRisk: boolean;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Nearest-rank percentile. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[clamp(rank - 1, 0, sorted.length - 1)] as number;
}

export function aggregate(xs: number[], agg: Aggregation): number {
  switch (agg) {
    case 'avg':
      return mean(xs);
    case 'min':
      return Math.min(...xs);
    case 'max':
      return Math.max(...xs);
    case 'p50':
      return percentile(xs, 50);
    case 'p95':
      return percentile(xs, 95);
    case 'p99':
      return percentile(xs, 99);
  }
}

/** Stride (in 15s sample units) that keeps heavy queries bounded to roughly `budget` samples per series. */
export function strideFor(rangeMs: number, budget = 3000): number {
  return Math.max(1, Math.ceil(rangeMs / SAMPLE_INTERVAL_MS / budget));
}

/** Picks a bucket size so a range renders ~120 points. */
export function autoStepMs(rangeMs: number): number {
  const target = rangeMs / 120;
  const steps = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400].map((s) => s * 1000);
  return steps.find((s) => s >= target) ?? 86400_000;
}

/* ------------------------------------------------------------------ events */

export const EVENT_TYPES = [
  'app_error',
  'latency_anomaly',
  'infra_warning',
  'deployment',
  'db_health',
  'auth_failure',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface SimEvent {
  id: string;
  ts: number;
  serviceKey: string;
  type: EventType;
  severity: EventSeverity;
  message: string;
  attributes: Record<string, string | number>;
}

export const EVENT_BUCKET_MS = 10_000;

const MESSAGES: Record<EventType, string[]> = {
  app_error: [
    'Unhandled exception in request handler',
    'Upstream returned 502 Bad Gateway',
    'Timeout calling downstream dependency',
    'Serialization failure on response payload',
    'Circuit breaker opened for dependency',
  ],
  latency_anomaly: [
    'p99 latency exceeded rolling baseline',
    'Slow request detected (> 3x median)',
    'Queue wait time above SLO',
  ],
  infra_warning: [
    'Container memory above 85% of limit',
    'Pod restarted (OOMKilled)',
    'Node CPU throttling detected',
    'Disk usage above 80% on volume',
  ],
  deployment: ['Deployment rollout progressing', 'Canary promoted to 100%', 'Rollback initiated'],
  db_health: [
    'Replication lag above 2s',
    'Connection pool near saturation',
    'Slow query exceeded 500ms',
    'Lock wait timeout on hot row',
  ],
  auth_failure: [
    'Repeated failed logins from single IP',
    'Token validation failed: signature mismatch',
    'Expired session token presented',
    'Rate limit applied to credential stuffing pattern',
  ],
};

const SEVERITY_BY_TYPE: Record<EventType, EventSeverity[]> = {
  app_error: ['error', 'error', 'critical'],
  latency_anomaly: ['warning', 'warning', 'error'],
  infra_warning: ['warning', 'warning', 'error'],
  deployment: ['info'],
  db_health: ['warning', 'warning', 'error'],
  auth_failure: ['warning', 'info', 'error'],
};

function typesFor(svc: ServiceProfile): { type: EventType; w: number }[] {
  const base: { type: EventType; w: number }[] = [
    { type: 'app_error', w: 3 },
    { type: 'latency_anomaly', w: 2 },
    { type: 'infra_warning', w: 2 },
  ];
  if (svc.kind === 'database') return [{ type: 'db_health', w: 6 }, { type: 'infra_warning', w: 2 }, { type: 'latency_anomaly', w: 1 }];
  if (svc.key.startsWith('auth') || svc.kind === 'edge') base.push({ type: 'auth_failure', w: 3 });
  return base;
}

/** Deterministic events for one service within one 10s bucket. Same input => same ids. */
export function eventsForBucket(model: SimModel, svc: ServiceProfile, bucketStart: number): SimEvent[] {
  const { orgSlug, environment } = model.ctx;
  const mid = bucketStart + EVENT_BUCKET_MS / 2;
  const imp = model.impact(svc.key, mid);
  const stress = imp.error * 2.2 + imp.latency * 1.4 + imp.outage * 3 + imp.saturation * 1.2;
  const tierWeight = svc.kind === 'database' ? 0.6 : 1;
  const envScale = environment === 'production' ? 1 : 0.35;
  const lambda = (0.026 * tierWeight * (0.6 + svc.baseRps / 2400) + stress * 1.6) * envScale;
  const events: SimEvent[] = [];
  const count = poisson(lambda, unit(orgSlug, environment, svc.key, 'cnt', bucketStart));
  for (let i = 0; i < count; i++) {
    const r = (k: string) => unit(orgSlug, environment, svc.key, k, bucketStart, i);
    const options = typesFor(svc);
    const total = options.reduce((a, o) => a + o.w, 0);
    let x = r('type') * total;
    let type: EventType = options[0]!.type;
    for (const o of options) {
      if ((x -= o.w) <= 0) {
        type = o.type;
        break;
      }
    }
    // under stress shift towards errors
    if (stress > 0.4 && r('shift') < 0.6) type = svc.kind === 'database' ? 'db_health' : 'app_error';
    const sevs = SEVERITY_BY_TYPE[type];
    let severity = sevs[Math.floor(r('sev') * sevs.length)]!;
    if (stress > 0.8 && type !== 'deployment' && r('esc') < 0.5) severity = 'critical';
    const msgs = MESSAGES[type];
    const ts = bucketStart + Math.floor(r('off') * EVENT_BUCKET_MS);
    events.push({
      id: `evt_${hexId(orgSlug, environment, svc.key, bucketStart, i)}`,
      ts,
      serviceKey: svc.key,
      type,
      severity,
      message: msgs[Math.floor(r('msg') * msgs.length)]!,
      attributes: {
        region: ['us-east-1', 'us-west-2', 'eu-west-1'][Math.floor(r('reg') * 3)]!,
        pod: `${svc.key}-${Math.floor(r('pod') * 6)}`,
        traceHint: Math.floor(r('trace') * 600),
      },
    });
  }
  return events;
}

function poisson(lambda: number, u: number): number {
  // inverse transform; lambda is small except under heavy faults
  let k = 0;
  let p = Math.exp(-lambda);
  let cdf = p;
  while (u > cdf && k < 40) {
    k++;
    p *= lambda / k;
    cdf += p;
  }
  return k;
}

function hexId(...parts: (string | number)[]): string {
  const a = Math.floor(unit(...parts, 'x1') * 0xffffffff).toString(16).padStart(8, '0');
  const b = Math.floor(unit(...parts, 'x2') * 0xffffffff).toString(16).padStart(8, '0');
  return a + b;
}
