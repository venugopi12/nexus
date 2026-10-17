import { and, eq } from 'drizzle-orm';
import {
  CATALOGS, SimModel, type Fault, type FaultKind, type ServiceProfile,
} from '@nexus/shared';
import type { Db } from '../db/client';
import { faults, organizations, serviceDeps, services } from '../db/schema';

export interface OrgInfo {
  orgId: string;
  slug: string;
  profiles: ServiceProfile[];
  rows: { id: string; key: string; name: string; kind: string; team: string; tier: number; description: string; config: Record<string, Record<string, string | number | boolean>> }[];
  idByKey: Map<string, string>;
  keyById: Map<string, string>;
}

/** Builds and caches SimModels per (org, environment); invalidated when faults change. */
export class SimRegistry {
  private orgs = new Map<string, OrgInfo>();
  private models = new Map<string, { model: SimModel; at: number }>();
  constructor(private db: Db, private ttlMs = 5000) {}

  async org(orgId: string): Promise<OrgInfo> {
    const hit = this.orgs.get(orgId);
    if (hit) return hit;
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) throw new Error(`unknown org ${orgId}`);
    const rows = await this.db.select().from(services).where(eq(services.orgId, orgId));
    const deps = await this.db.select().from(serviceDeps).where(eq(serviceDeps.orgId, orgId));
    const keyById = new Map(rows.map((r) => [r.id, r.key]));
    const catalog = CATALOGS.find((c) => c.slug === org.slug);
    const profiles: ServiceProfile[] = rows.map((r) => {
      const base = catalog?.services.find((s) => s.key === r.key);
      const dependsOn = deps.filter((d) => d.fromId === r.id).map((d) => keyById.get(d.toId)!).filter(Boolean);
      return base
        ? { ...base, dependsOn }
        : { key: r.key, name: r.name, kind: r.kind as ServiceProfile['kind'], team: r.team, tier: r.tier as 1 | 2 | 3, baseRps: 100, baseLatencyMs: 50, baseErrorPct: 0.2, dependsOn, description: r.description };
    });
    const info: OrgInfo = {
      orgId, slug: org.slug, profiles,
      rows: rows.map((r) => ({ id: r.id, key: r.key, name: r.name, kind: r.kind, team: r.team, tier: r.tier, description: r.description, config: r.config })),
      idByKey: new Map(rows.map((r) => [r.key, r.id])),
      keyById,
    };
    this.orgs.set(orgId, info);
    return info;
  }

  async model(orgId: string, environment: string): Promise<SimModel> {
    const k = `${orgId}:${environment}`;
    const hit = this.models.get(k);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.model;
    const info = await this.org(orgId);
    const rows = await this.db.select().from(faults).where(and(eq(faults.orgId, orgId), eq(faults.environment, environment)));
    const list: Fault[] = rows.map((f) => ({
      id: f.id,
      serviceKey: info.keyById.get(f.serviceId) ?? '',
      environment: f.environment,
      kind: f.kind as FaultKind,
      startMs: f.startAt.getTime(),
      endMs: f.endAt ? f.endAt.getTime() : null,
      magnitude: f.magnitude,
    }));
    const model = new SimModel({ orgSlug: info.slug, environment, services: info.profiles, faults: list });
    this.models.set(k, { model, at: Date.now() });
    return model;
  }

  invalidate(orgId?: string) {
    if (!orgId) return this.models.clear();
    for (const k of this.models.keys()) if (k.startsWith(orgId)) this.models.delete(k);
  }
  invalidateOrgInfo(orgId: string) {
    this.orgs.delete(orgId);
    this.invalidate(orgId);
  }
}
