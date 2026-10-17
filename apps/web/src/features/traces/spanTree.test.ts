import { describe, expect, it } from 'vitest';
import type { SpanDto } from '@nexus/shared';
import { buildSpanRows } from './spanTree';

const sp = (spanId: string, parentId: string | null, start: number, dur: number, status: 'ok' | 'error' = 'ok'): SpanDto => ({ spanId, parentId, serviceKey: 's', operation: 'op', startOffsetMs: start, durationMs: dur, status, attributes: {} });

describe('buildSpanRows', () => {
  const spans = [sp('root', null, 0, 100), sp('b', 'root', 40, 30), sp('a', 'root', 5, 30), sp('a1', 'a', 10, 10)];
  it('orders depth-first with children sorted by start time', () => {
    const { rows } = buildSpanRows(spans);
    expect(rows.map((r) => r.spanId)).toEqual(['root', 'a', 'a1', 'b']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
  });
  it('computes self time as duration minus merged child intervals', () => {
    const { all } = buildSpanRows(spans);
    const by = Object.fromEntries(all.map((r) => [r.spanId, r]));
    expect(by.root!.selfMs).toBe(100 - 30 - 30);
    expect(by.a!.selfMs).toBe(20);
    expect(by.b!.selfMs).toBe(30);
  });
  it('total equals the latest span end and reports containment violations', () => {
    expect(buildSpanRows(spans).totalMs).toBe(100);
    expect(buildSpanRows(spans).violations).toEqual([]);
    const bad = buildSpanRows([sp('r', null, 0, 10), sp('c', 'r', 5, 20)]);
    expect(bad.violations).toHaveLength(1);
  });
  it('hides descendants of collapsed spans and keeps orphans at the root', () => {
    expect(buildSpanRows(spans, new Set(['a'])).rows.map((r) => r.spanId)).toEqual(['root', 'a', 'b']);
    expect(buildSpanRows([sp('x', 'missing', 0, 5)]).rows).toHaveLength(1);
  });
});
