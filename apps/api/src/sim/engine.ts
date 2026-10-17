import { and, desc, eq, sql } from 'drizzle-orm';
import { ENVIRONMENTS, EVENT_BUCKET_MS, eventsForBucket, unit, type EventDto } from '@nexus/shared';
import * as s from '../db/schema';
import { envRoom, type AppContext } from '../context';

const CHAOS_SLOT_MS = 20 * 60_000;
const CHAOS_KINDS = ['error_spike', 'latency', 'saturation', 'latency', 'error_spike', 'outage'] as const;

/**
 * Live simulation loop. Pure functions of wall-clock time (see @nexus/shared sim), so a restart
 * regenerates identical events (same ids) and never produces duplicates.
 */
export class SimEngine {
  private timer?: NodeJS.Timeout;
  private last = new Map<string, number>();
  private seq = 0;
  private running = false;

  constructor(private ctx: AppContext) {}

  /** Positions each (org, env) cursor at `at`, or at the newest persisted event (max 6h back) when omitted. */
  async primeCursors(at?: number) {
    const orgs = await this.ctx.db.select().from(s.organizations);
    for (const o of orgs) {
      for (const env of ENVIRONMENTS) {
        if (at !== undefined) {
          this.last.set(`${o.id}:${env}`, at);
          continue;
        }
        const [row] = await this.ctx.db.select({ ts: sql<Date | null>`max(${s.events.ts})` }).from(s.events).where(and(eq(s.events.orgId, o.id), eq(s.events.environment, env)));
        const maxTs = row?.ts ? new Date(row.ts).getTime() : Date.now();
        // catch up at most 6h silently so a long outage does not flood sockets
        this.last.set(`${o.id}:${env}`, Math.max(maxTs, Date.now() - 6 * 3600_000));
      }
    }
  }

  async start() {
    await this.primeCursors();
    this.timer = setInterval(() => void this.tick(), this.ctx.env.SIM_TICK_MS);
    this.timer.unref();
    await this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.ctx.db.select().from(s.organizations);
      for (const o of orgs) {
        if (this.ctx.env.SIM_CHAOS === 'on') await this.chaos(o.id, o.slug, now);
        for (const env of ENVIRONMENTS) await this.tickOrg(o.id, env, now);
      }
    } catch (e) {
      this.ctx.log.error({ err: e }, 'sim tick failed');
    } finally {
      this.running = false;
    }
  }

  private async tickOrg(orgId: string, env: string, now: number) {
    const info = await this.ctx.registry.org(orgId);
    const model = await this.ctx.registry.model(orgId, env);
    const key = `${orgId}:${env}`;
    const lastTs = this.last.get(key) ?? now;
    const batch: (typeof s.events.$inferInsert)[] = [];
    const dtos: EventDto[] = [];
    const startBucket = Math.floor(lastTs / EVENT_BUCKET_MS) * EVENT_BUCKET_MS;
    for (let b = startBucket; b <= now; b += EVENT_BUCKET_MS) {
      for (const svc of info.profiles) {
        for (const e of eventsForBucket(model, svc, b)) {
          if (e.ts <= lastTs || e.ts > now) continue;
          const serviceId = info.idByKey.get(svc.key)!;
          batch.push({ id: e.id, orgId, environment: env, serviceId, ts: new Date(e.ts), type: e.type, severity: e.severity, message: e.message, attributes: e.attributes });
          dtos.push({ ...e, serviceId, serviceName: svc.name, environment: env });
        }
      }
    }
    this.last.set(key, now);
    const room = envRoom(orgId, env);
    if (batch.length) {
      for (let i = 0; i < batch.length; i += 2000) await this.ctx.db.insert(s.events).values(batch.slice(i, i + 2000)).onConflictDoNothing();
      dtos.sort((a, b) => a.ts - b.ts);
      // live emit is capped; larger gaps are catch-up and are fetched via REST instead
      if (dtos.length <= 400) this.ctx.bus.emit(room, 'events:batch', { events: dtos, seq: ++this.seq });
    }
    const services: Record<string, unknown> = {};
    for (const p of info.profiles) {
      const h = model.health(p.key, now);
      services[p.key] = { status: h.status, errorRate: h.errorRate, p95: h.p95, p99: h.p99, rps: h.rps, avgLatency: h.avgLatency };
    }
    this.ctx.bus.emit(room, 'metrics:tick', { t: now, env, services });
  }

  /** Deterministic chaos: whether/what/when is a pure function of the 20-minute slot, so it is idempotent. */
  private async chaos(orgId: string, slug: string, now: number) {
    const slot = Math.floor(now / CHAOS_SLOT_MS);
    if (unit('chaos', slug, slot, 'go') > 0.3) return;
    const info = await this.ctx.registry.org(orgId);
    const candidates = info.profiles.filter((p) => p.kind !== 'cache' && p.tier <= 2);
    if (!candidates.length) return;
    const svc = candidates[Math.floor(unit('chaos', slug, slot, 'svc') * candidates.length)]!;
    const kind = CHAOS_KINDS[Math.floor(unit('chaos', slug, slot, 'kind') * CHAOS_KINDS.length)]!;
    const start = slot * CHAOS_SLOT_MS + Math.floor((1 + unit('chaos', slug, slot, 'off') * 4) * 60_000);
    if (now < start) return;
    const end = start + Math.floor((6 + unit('chaos', slug, slot, 'dur') * 6) * 60_000);
    const magnitude = Math.round((0.5 + unit('chaos', slug, slot, 'mag') * 0.5) * 100) / 100;
    const inserted = await this.ctx.db.insert(s.faults).values({
      orgId, environment: 'production', serviceId: info.idByKey.get(svc.key)!, kind, startAt: new Date(start), endAt: new Date(end), magnitude, cause: 'Chaos injection (simulated)', chaosKey: `${orgId}:${slot}`,
    }).onConflictDoNothing().returning({ id: s.faults.id });
    if (inserted.length) {
      this.ctx.registry.invalidate(orgId);
      this.ctx.log.info({ svc: svc.key, kind, magnitude }, 'chaos fault injected');
    }
  }
}
void desc;
