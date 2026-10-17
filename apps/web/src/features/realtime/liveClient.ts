import type { EventDto, ServerToClientEvents } from '@nexus/shared';
import { backoffDelay } from './backoff';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'stale' | 'offline';

/** Minimal surface of a socket.io-client Socket that we rely on (makes the client unit-testable). */
export interface SocketLike {
  connected: boolean;
  on(event: string, fn: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  close(): unknown;
}

export interface LiveHandlers {
  onStatus(status: ConnectionStatus, info: { attempt: number; nextRetryMs: number | null }): void;
  onEvents(events: EventDto[]): void;
  onMetrics(tick: Parameters<ServerToClientEvents['metrics:tick']>[0]): void;
  onIncident?(p: Parameters<ServerToClientEvents['incident:changed']>[0]): void;
  onAlert?(p: Parameters<ServerToClientEvents['alert:fired']>[0]): void;
  onNotification?(n: Parameters<ServerToClientEvents['notification:new']>[0]): void;
  /** Called after a successful *re*connect so the app can refetch anything it missed. */
  onRecovered?(): void;
}

export interface LiveClientOptions {
  socketFactory: () => SocketLike;
  handlers: LiveHandlers;
  staleAfterMs?: number;
  deadAfterMs?: number;
  random?: () => number;
  now?: () => number;
  /** batching window for socket events before they are handed to React */
  flushMs?: number;
}

/**
 * Owns the realtime connection lifecycle: connect, heartbeat watchdog, stale detection,
 * reconnect with exponential backoff + jitter, batching of high-frequency events.
 */
export class LiveClient {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pending: EventDto[] = [];
  private lastMessageAt = 0;
  private status: ConnectionStatus = 'connecting';
  private stopped = true;
  private hadConnection = false;
  private env = 'production';
  private readonly o: Required<Omit<LiveClientOptions, 'handlers' | 'socketFactory'>> & Pick<LiveClientOptions, 'handlers' | 'socketFactory'>;

  constructor(opts: LiveClientOptions) {
    this.o = { staleAfterMs: 15_000, deadAfterMs: 35_000, random: Math.random, now: Date.now, flushMs: 250, ...opts };
  }

  start(env: string) {
    this.env = env;
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => this.checkHealth(), 3000);
  }

  setEnv(env: string) {
    this.env = env;
    this.socket?.emit('subscribe', { env });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    clearTimeout(this.flushTimer);
    this.pending = [];
    this.teardown();
  }

  /** Visible for tests / manual "retry now" button. */
  retryNow() {
    clearTimeout(this.retryTimer);
    this.teardown();
    this.connect();
  }

  private setStatus(s: ConnectionStatus, nextRetryMs: number | null = null) {
    this.status = s;
    this.o.handlers.onStatus(s, { attempt: this.attempt, nextRetryMs });
  }

  private connect() {
    if (this.stopped) return;
    this.setStatus(this.hadConnection ? 'reconnecting' : 'connecting');
    const socket = this.o.socketFactory();
    this.socket = socket;
    const h = this.o.handlers;
    const touch = () => { this.lastMessageAt = this.o.now(); if (this.status === 'stale') this.setStatus('connected'); };

    socket.on('connect', () => {
      const recovered = this.hadConnection;
      this.attempt = 0;
      this.hadConnection = true;
      this.lastMessageAt = this.o.now();
      socket.emit('subscribe', { env: this.env });
      this.setStatus('connected');
      if (recovered) h.onRecovered?.();
    });
    socket.on('disconnect', () => this.scheduleReconnect());
    socket.on('connect_error', () => this.scheduleReconnect());
    socket.on('heartbeat', ((t: number) => { touch(); socket.emit('heartbeat:ack', t); }) as never);
    socket.on('events:batch', ((b: { events: EventDto[] }) => { touch(); this.enqueue(b.events); }) as never);
    socket.on('metrics:tick', ((t: Parameters<LiveHandlers['onMetrics']>[0]) => { touch(); h.onMetrics(t); }) as never);
    socket.on('incident:changed', ((p: never) => h.onIncident?.(p)) as never);
    socket.on('alert:fired', ((p: never) => h.onAlert?.(p)) as never);
    socket.on('notification:new', ((n: never) => h.onNotification?.(n)) as never);
  }

  private enqueue(events: EventDto[]) {
    this.pending.push(...events);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const batch = this.pending;
      this.pending = [];
      if (batch.length) this.o.handlers.onEvents(batch);
    }, this.o.flushMs);
  }

  private teardown() {
    const s = this.socket;
    this.socket = null;
    try { s?.close(); } catch { /* noop */ }
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    this.teardown();
    const delay = backoffDelay(this.attempt, { random: this.o.random });
    this.attempt++;
    this.setStatus(navigator.onLine === false ? 'offline' : 'reconnecting', delay);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private checkHealth() {
    if (this.stopped || this.status === 'connecting' || this.retryTimer) return;
    const idle = this.o.now() - this.lastMessageAt;
    if (this.status === 'connected' && idle > this.o.staleAfterMs) this.setStatus('stale');
    if (idle > this.o.deadAfterMs) this.scheduleReconnect();
  }
}
