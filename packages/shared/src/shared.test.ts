import { describe, expect, it } from 'vitest';
import {
  ACME, SimModel, canTransition, applyTransitionTimes, bucketFor, resolveFlag, evaluateRule,
  shouldEmitAlert, can, percentile, eventsForBucket, aggregate, type Fault,
} from './index';

const T0 = Date.UTC(2026, 0, 14, 12, 0, 0);
const model = (faults: Fault[] = []) =>
  new SimModel({ orgSlug: 'acme', environment: 'production', services: ACME.services, faults });

describe('incident state machine', () => {
  it('allows the documented transitions only', () => {
    expect(canTransition('triggered', 'acknowledged')).toBe(true);
    expect(canTransition('resolved', 'investigating')).toBe(true);
    expect(canTransition('resolved', 'mitigated')).toBe(false);
    expect(canTransition('triggered', 'mitigated')).toBe(false);
  });
  it('tracks ack and resolve times, clears resolvedAt on reopen', () => {
    const created = new Date(T0);
    const t = { createdAt: created, acknowledgedAt: null, resolvedAt: null } as const;
    let cur: { createdAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null } = { ...t };
    cur = applyTransitionTimes(cur, 'triggered', 'acknowledged', new Date(T0 + 60000));
    expect(cur.acknowledgedAt).toEqual(new Date(T0 + 60000));
    cur = applyTransitionTimes(cur, 'acknowledged', 'resolved', new Date(T0 + 120000));
    expect(cur.resolvedAt).toEqual(new Date(T0 + 120000));
    cur = applyTransitionTimes(cur, 'resolved', 'investigating', new Date(T0 + 180000));
    expect(cur.resolvedAt).toBeNull();
    expect(cur.acknowledgedAt).toEqual(new Date(T0 + 60000));
  });
});

describe('permissions', () => {
  it('viewer is read-only; admin can do everything', () => {
    expect(can('viewer', 'incident:read')).toBe(true);
    expect(can('viewer', 'incident:create')).toBe(false);
    expect(can('engineer', 'incident:resolve')).toBe(false);
    expect(can('sre', 'incident:resolve')).toBe(true);
    expect(can('admin', 'team:write')).toBe(true);
    expect(can(undefined, 'incident:read')).toBe(false);
  });
});

describe('feature flags', () => {
  it('buckets deterministically in [0,100)', () => {
    const b = bucketFor('ai', 'user-1');
    expect(b).toBe(bucketFor('ai', 'user-1'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
  it('applies env > org > global precedence and rollout', () => {
    const base = { enabled: true, rolloutPercent: 100 };
    expect(resolveFlag('f', 'u', { base, orgOverride: { enabled: false } })).toBe(false);
    expect(resolveFlag('f', 'u', { base, orgOverride: { enabled: false }, envOverride: { enabled: true } })).toBe(true);
    expect(resolveFlag('f', 'u', { base: { enabled: true, rolloutPercent: 0 } })).toBe(false);
    let on = 0;
    for (let i = 0; i < 2000; i++) if (resolveFlag('f', `u${i}`, { base: { enabled: true, rolloutPercent: 30 } })) on++;
    expect(on / 2000).toBeGreaterThan(0.25);
    expect(on / 2000).toBeLessThan(0.35);
  });
});

describe('simulation model', () => {
  it('is deterministic', () => {
    const a = model().series('checkout-service', 'latency_ms', T0, T0 + 3600000, 60000, 'p95');
    const b = model().series('checkout-service', 'latency_ms', T0, T0 + 3600000, 60000, 'p95');
    expect(a).toEqual(b);
  });
  it('faults degrade the target and weakly propagate to dependents', () => {
    const f: Fault = { id: 'f', serviceKey: 'payments-db', environment: 'production', kind: 'outage', startMs: T0, endMs: null, magnitude: 1 };
    const m = model([f]);
    const t = T0 + 10 * 60000;
    expect(m.health('payments-db', t).status).toBe('unavailable');
    const payments = m.health('payments-service', t);
    expect(payments.errorRate).toBeGreaterThan(model().health('payments-service', t).errorRate);
    expect(m.health('user-db', t).status).toBe('healthy');
  });
  it('percentile aggregation follows nearest-rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(aggregate([1, 5, 3], 'max')).toBe(5);
  });
  it('events are deterministic with stable ids', () => {
    const m = model();
    const svc = ACME.services[0]!;
    let a = 0;
    for (let b = T0; b < T0 + 6 * 3600_000; b += 10000) {
      const x = eventsForBucket(m, svc, b);
      expect(x).toEqual(eventsForBucket(m, svc, b));
      a += x.length;
    }
    expect(a).toBeGreaterThan(0);
  });
});

describe('alert evaluation', () => {
  const input = { errorRate: [6, 7, 8], latency: [100, 120], requestRate: [100], baselineRequestRate: [100], health: 'healthy' as const };
  it('evaluates thresholds', () => {
    expect(evaluateRule({ condition: 'error_rate_above', threshold: 5, windowSec: 300 }, input).firing).toBe(true);
    expect(evaluateRule({ condition: 'error_rate_above', threshold: 9, windowSec: 300 }, input).firing).toBe(false);
    expect(evaluateRule({ condition: 'latency_above', threshold: 110, windowSec: 300 }, input).firing).toBe(true);
    expect(evaluateRule({ condition: 'request_volume_anomaly', threshold: 30, windowSec: 300 }, { ...input, requestRate: [40] }).firing).toBe(true);
    expect(evaluateRule({ condition: 'health_change', threshold: 1, windowSec: 60 }, { ...input, health: 'degraded' }).firing).toBe(true);
  });
  it('dedupes sustained conditions and honours cooldown', () => {
    const base = { firing: true, hasOpenAlert: false, lastFiredAt: null as number | null, now: 1_000_000, cooldownSec: 600 };
    expect(shouldEmitAlert(base)).toBe(true);
    expect(shouldEmitAlert({ ...base, hasOpenAlert: true })).toBe(false);
    expect(shouldEmitAlert({ ...base, lastFiredAt: 1_000_000 - 300_000 })).toBe(false);
    expect(shouldEmitAlert({ ...base, lastFiredAt: 1_000_000 - 700_000 })).toBe(true);
    expect(shouldEmitAlert({ ...base, firing: false })).toBe(false);
  });
});
