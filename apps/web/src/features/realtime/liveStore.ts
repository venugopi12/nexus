import { create } from 'zustand';
import { io } from 'socket.io-client';
import type { EventDto, HealthStatus } from '@nexus/shared';
import { EventBuffer } from './eventBuffer';
import { LiveClient, type ConnectionStatus } from './liveClient';

export interface LiveService { status: HealthStatus; errorRate: number; p95: number; p99: number; rps: number; avgLatency: number }

interface LiveState {
  status: ConnectionStatus;
  attempt: number;
  nextRetryMs: number | null;
  lastTickAt: number;
  /** per-service live snapshot; components subscribe to a single key to avoid page-wide rerenders */
  services: Record<string, LiveService>;
  /** newest-first, bounded */
  events: EventDto[];
  paused: boolean;
  heldCount: number;
  eventVersion: number;
  recoveries: number;
}

export const useLive = create<LiveState>(() => ({
  status: 'connecting', attempt: 0, nextRetryMs: null, lastTickAt: 0, services: {}, events: [], paused: false, heldCount: 0, eventVersion: 0, recoveries: 0,
}));

const live = new EventBuffer(5000);
const held = new EventBuffer(5000);
let client: LiveClient | null = null;
let currentEnv = '';
const newEventListeners = new Set<(events: EventDto[]) => void>();
export const onLiveEvents = (fn: (e: EventDto[]) => void) => { newEventListeners.add(fn); return () => newEventListeners.delete(fn); };
const extra = {
  incident: new Set<(p: { id: string; kind: string; number: number }) => void>(),
  alert: new Set<(p: { id: string; ruleName: string; severity: string }) => void>(),
  notification: new Set<(n: never) => void>(),
  recovered: new Set<() => void>(),
};
export const liveHooks = extra;

export function startLive(env: string) {
  if (client) {
    if (env !== currentEnv) {
      currentEnv = env;
      live.clear(); held.clear();
      useLive.setState({ events: [], heldCount: 0, services: {}, eventVersion: 0 });
      client.setEnv(env);
    }
    return;
  }
  currentEnv = env;
  client = new LiveClient({
    socketFactory: () => io({ withCredentials: true, reconnection: false, transports: ['websocket', 'polling'], timeout: 8000 }) as never,
    handlers: {
      onStatus: (status, info) => useLive.setState({ status, attempt: info.attempt, nextRetryMs: info.nextRetryMs }),
      onEvents: (batch) => {
        const paused = useLive.getState().paused;
        newEventListeners.forEach((fn) => fn(batch));
        if (paused) {
          held.push(batch);
          useLive.setState({ heldCount: held.size });
        } else if (live.push(batch)) {
          useLive.setState((s) => ({ events: live.snapshot().slice(), eventVersion: s.eventVersion + 1 }));
        }
      },
      onMetrics: (t) => useLive.setState((s) => {
        // keep object identity for services whose values did not change so selectors do not fire
        const next: Record<string, LiveService> = {};
        for (const [k, v] of Object.entries(t.services)) {
          const prev = s.services[k];
          next[k] = prev && prev.status === v.status && Math.abs(prev.rps - v.rps) < 0.01 && Math.abs(prev.p95 - v.p95) < 0.01 && Math.abs(prev.errorRate - v.errorRate) < 0.001 ? prev : v;
        }
        return { services: next, lastTickAt: t.t };
      }),
      onIncident: (p) => extra.incident.forEach((f) => f(p)),
      onAlert: (p) => extra.alert.forEach((f) => f(p)),
      onNotification: (n) => extra.notification.forEach((f) => f(n as never)),
      onRecovered: () => { useLive.setState((s) => ({ recoveries: s.recoveries + 1 })); extra.recovered.forEach((f) => f()); },
    },
  });
  client.start(env);
}

export function stopLive() {
  client?.stop();
  client = null;
  currentEnv = '';
  live.clear(); held.clear();
  useLive.setState({ events: [], heldCount: 0, services: {}, status: 'connecting', paused: false });
}

export function retryLive() { client?.retryNow(); }

export function setPaused(paused: boolean) {
  if (paused === useLive.getState().paused) return;
  if (!paused) {
    // resume: merge everything received while paused
    if (held.size) live.push(held.snapshot().slice());
    held.clear();
    useLive.setState((s) => ({ paused, heldCount: 0, events: live.snapshot().slice(), eventVersion: s.eventVersion + 1 }));
  } else {
    useLive.setState({ paused });
  }
}

export function clearLive() {
  live.clear(); held.clear();
  useLive.setState({ events: [], heldCount: 0 });
}

/** Staleness: connected but no data recently, or not connected. */
export const selectIsStale = (s: LiveState) => s.status !== 'connected';
