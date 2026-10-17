import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDto } from '@nexus/shared';
import { backoffDelay } from './backoff';
import { EventBuffer, matchesFilter } from './eventBuffer';
import { LiveClient, type SocketLike } from './liveClient';

const ev = (id: string, ts: number, extra: Partial<EventDto> = {}): EventDto => ({
  id, ts, serviceKey: 'edge-gateway', serviceId: 's1', serviceName: 'Edge Gateway', type: 'app_error', severity: 'error', message: 'Timeout calling downstream', attributes: {}, environment: 'production', ...extra,
});

describe('backoffDelay', () => {
  it('grows exponentially, is capped, and stays within jitter bounds', () => {
    const max = (a: number) => backoffDelay(a, { base: 500, cap: 20000, random: () => 1 });
    const min = (a: number) => backoffDelay(a, { base: 500, cap: 20000, random: () => 0 });
    expect([0, 1, 2, 3].map(max)).toEqual([500, 1000, 2000, 4000]);
    expect(max(20)).toBe(20000);
    expect(min(5)).toBe(250);
    for (let a = 0; a < 10; a++) {
      const d = backoffDelay(a);
      expect(d).toBeGreaterThanOrEqual(250);
      expect(d).toBeLessThanOrEqual(20000);
    }
  });
});

describe('EventBuffer', () => {
  it('deduplicates re-delivered events', () => {
    const b = new EventBuffer(100);
    expect(b.push([ev('a', 1), ev('b', 2)])).toBe(2);
    expect(b.push([ev('b', 2), ev('c', 3)])).toBe(1);
    expect(b.snapshot().map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
  it('keeps newest-first ordering for out-of-order arrivals', () => {
    const b = new EventBuffer(100);
    b.push([ev('a', 10), ev('b', 30)]);
    b.push([ev('c', 20)]);
    expect(b.snapshot().map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
  it('is bounded and forgets evicted ids', () => {
    const b = new EventBuffer(3);
    b.push([ev('a', 1), ev('b', 2), ev('c', 3), ev('d', 4)]);
    expect(b.size).toBe(3);
    expect(b.snapshot().map((e) => e.id)).toEqual(['d', 'c', 'b']);
    expect(b.push([ev('a', 1)])).toBe(1); // evicted ids can be re-added
  });
});

describe('matchesFilter', () => {
  it('filters by text, type, severity, service and time', () => {
    const e = ev('x', 100);
    expect(matchesFilter(e, { q: 'timeout' })).toBe(true);
    expect(matchesFilter(e, { q: 'nope' })).toBe(false);
    expect(matchesFilter(e, { types: ['db_health'] })).toBe(false);
    expect(matchesFilter(e, { severities: ['error'], services: ['edge-gateway'] })).toBe(true);
    expect(matchesFilter(e, { from: 101 })).toBe(false);
    expect(matchesFilter(e, { to: 99 })).toBe(false);
  });
});

class FakeSocket implements SocketLike {
  connected = false;
  handlers = new Map<string, ((...a: never[]) => void)[]>();
  emitted: unknown[][] = [];
  closed = false;
  on(event: string, fn: (...a: never[]) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); return this; }
  emit(...args: unknown[]) { this.emitted.push(args); return this; }
  close() { this.closed = true; }
  fire(event: string, ...args: unknown[]) { (this.handlers.get(event) ?? []).forEach((f) => (f as (...a: unknown[]) => void)(...args)); }
}

describe('LiveClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const sockets: FakeSocket[] = [];
    const statuses: string[] = [];
    const delays: (number | null)[] = [];
    const batches: EventDto[][] = [];
    let recovered = 0;
    const client = new LiveClient({
      socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
      random: () => 1,
      handlers: {
        onStatus: (s, i) => { statuses.push(s); delays.push(i.nextRetryMs); },
        onEvents: (b) => batches.push(b),
        onMetrics: () => {},
        onRecovered: () => { recovered++; },
      },
    });
    return { client, sockets, statuses, delays, batches, recovered: () => recovered };
  };

  it('reconnects with exponentially increasing delays and resets after success', () => {
    const t = make();
    t.client.start('production');
    expect(t.statuses.at(-1)).toBe('connecting');
    t.sockets[0]!.fire('connect_error');
    expect(t.delays.at(-1)).toBe(500);
    vi.advanceTimersByTime(500);
    expect(t.sockets).toHaveLength(2);
    t.sockets[1]!.fire('connect_error');
    expect(t.delays.at(-1)).toBe(1000);
    vi.advanceTimersByTime(1000);
    t.sockets[2]!.fire('connect');
    expect(t.statuses.at(-1)).toBe('connected');
    expect(t.sockets[2]!.emitted[0]).toEqual(['subscribe', { env: 'production' }]);
    expect(t.recovered()).toBe(1 - 1 + 0); // first-ever connection is not a "recovery"
    t.sockets[2]!.fire('disconnect');
    expect(t.delays.at(-1)).toBe(500); // attempt counter was reset by the successful connect
    vi.advanceTimersByTime(500);
    t.sockets[3]!.fire('connect');
    expect(t.recovered()).toBe(1); // recovery hook fires so the app can refetch missed data
    t.client.stop();
  });

  it('batches rapid events into a single handler call', () => {
    const t = make();
    t.client.start('production');
    const s = t.sockets[0]!;
    s.fire('connect');
    s.fire('events:batch', { events: [ev('a', 1)] });
    s.fire('events:batch', { events: [ev('b', 2), ev('c', 3)] });
    expect(t.batches).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(3);
    t.client.stop();
  });

  it('flags stale data when heartbeats stop, and recovers when they resume', () => {
    const t = make();
    t.client.start('production');
    const s = t.sockets[0]!;
    s.fire('connect');
    vi.advanceTimersByTime(18_000);
    expect(t.statuses.at(-1)).toBe('stale');
    s.fire('heartbeat', 123);
    expect(t.statuses.at(-1)).toBe('connected');
    expect(s.emitted.some((e) => e[0] === 'heartbeat:ack')).toBe(true);
    t.client.stop();
  });

  it('forces a reconnect when the connection goes silent for too long', () => {
    const t = make();
    t.client.start('production');
    t.sockets[0]!.fire('connect');
    vi.advanceTimersByTime(40_000);
    expect(t.statuses).toContain('reconnecting');
    t.client.stop();
  });
});
