import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().defaultRandom();

export const organizations = pgTable('organizations', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').$type<'admin' | 'sre' | 'engineer' | 'viewer'>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});

export const services = pgTable(
  'services',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    team: text('team').notNull(),
    tier: integer('tier').notNull(),
    description: text('description').notNull().default(''),
    config: jsonb('config').$type<Record<string, Record<string, string | number | boolean>>>().notNull().default({}),
  },
  (t) => [uniqueIndex('services_org_key').on(t.orgId, t.key)],
);

export const serviceDeps = pgTable(
  'service_deps',
  {
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    fromId: uuid('from_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    toId: uuid('to_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
);

export const faults = pgTable(
  'faults',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at'),
    magnitude: doublePrecision('magnitude').notNull(),
    cause: text('cause').notNull().default(''),
    chaosKey: text('chaos_key').unique(),
  },
  (t) => [index('faults_org_env').on(t.orgId, t.environment)],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    ts: ts('ts').notNull(),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    attributes: jsonb('attributes').$type<Record<string, string | number>>().notNull().default({}),
  },
  (t) => [
    index('events_org_env_ts').on(t.orgId, t.environment, t.ts.desc()),
    index('events_service_ts').on(t.serviceId, t.ts.desc()),
  ],
);

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    severity: text('severity').notNull(),
    status: text('status').notNull(),
    environment: text('environment').notNull().default('production'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
    resolvedAt: ts('resolved_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('incidents_org_number').on(t.orgId, t.number),
    index('incidents_org_status').on(t.orgId, t.status, t.createdAt.desc()),
  ],
);

export const incidentServices = pgTable(
  'incident_services',
  {
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.serviceId] })],
);

export const incidentResponders = pgTable(
  'incident_responders',
  {
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.userId] })],
);

export const incidentTimeline = pgTable(
  'incident_timeline',
  {
    id: id(),
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('timeline_incident_at').on(t.incidentId, t.at)],
);

export const incidentLinks = pgTable(
  'incident_links',
  {
    id: id(),
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    refId: text('ref_id').notNull(),
    label: text('label').notNull().default(''),
  },
  (t) => [uniqueIndex('incident_links_unique').on(t.incidentId, t.kind, t.refId)],
);

export const traces = pgTable(
  'traces',
  {
    traceId: text('trace_id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull(),
    rootService: text('root_service').notNull(),
    rootOperation: text('root_operation').notNull(),
    startAt: ts('start_at').notNull(),
    durationMs: doublePrecision('duration_ms').notNull(),
    spanCount: integer('span_count').notNull(),
    errorCount: integer('error_count').notNull(),
    status: text('status').notNull(),
    services: jsonb('services').$type<string[]>().notNull().default([]),
  },
  (t) => [index('traces_org_start').on(t.orgId, t.environment, t.startAt.desc())],
);

export const spans = pgTable(
  'spans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    traceId: text('trace_id').notNull().references(() => traces.traceId, { onDelete: 'cascade' }),
    spanId: text('span_id').notNull(),
    parentId: text('parent_id'),
    serviceKey: text('service_key').notNull(),
    operation: text('operation').notNull(),
    startOffsetMs: doublePrecision('start_offset_ms').notNull(),
    durationMs: doublePrecision('duration_ms').notNull(),
    status: text('status').notNull(),
    attributes: jsonb('attributes').$type<Record<string, string | number>>().notNull().default({}),
  },
  (t) => [index('spans_trace').on(t.traceId)],
);

export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull(),
    version: text('version').notNull(),
    commit: text('commit').notNull(),
    status: text('status').notNull(),
    deployedBy: text('deployed_by').notNull(),
    notes: text('notes').notNull().default(''),
    deployedAt: ts('deployed_at').notNull(),
  },
  (t) => [index('deployments_org_at').on(t.orgId, t.deployedAt.desc())],
);

export const alertRules = pgTable('alert_rules', {
  id: id(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  condition: text('condition').notNull(),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
  environment: text('environment').notNull(),
  threshold: doublePrecision('threshold').notNull(),
  windowSec: integer('window_sec').notNull(),
  cooldownSec: integer('cooldown_sec').notNull(),
  severity: text('severity').notNull(),
  autoCreateIncident: boolean('auto_create_incident').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  lastEvaluatedAt: ts('last_evaluated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    severity: text('severity').notNull(),
    status: text('status').notNull(),
    value: doublePrecision('value').notNull(),
    detail: text('detail').notNull(),
    firedAt: ts('fired_at').notNull(),
    acknowledgedAt: ts('acknowledged_at'),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    incidentId: uuid('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('alerts_org_fired').on(t.orgId, t.firedAt.desc()),
    // at most one open alert per rule+service: sustained conditions never duplicate
    uniqueIndex('alerts_one_open')
      .on(t.ruleId, sql`coalesce(${t.serviceId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.status} <> 'resolved'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href'),
    read: boolean('read').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user').on(t.userId, t.orgId, t.createdAt.desc())],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_org_at').on(t.orgId, t.at.desc())],
);

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(false),
  rolloutPercent: integer('rollout_percent').notNull().default(100),
});

export const flagOverrides = pgTable(
  'flag_overrides',
  {
    id: id(),
    flagKey: text('flag_key').notNull().references(() => featureFlags.key, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    environment: text('environment'),
    enabled: boolean('enabled').notNull(),
    rolloutPercent: integer('rollout_percent').notNull().default(100),
  },
  (t) => [
    uniqueIndex('flag_override_unique').on(t.flagKey, t.orgId, sql`coalesce(${t.environment}, '')`),
  ],
);

export const flagHistory = pgTable('flag_history', {
  id: id(),
  flagKey: text('flag_key').notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(),
  change: text('change').notNull(),
  at: ts('at').notNull().defaultNow(),
});
