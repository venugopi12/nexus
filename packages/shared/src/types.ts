import type { Role, Permission } from './permissions';
import type { IncidentStatus, Severity } from './incident';
import type { HealthStatus, SimEvent } from './sim';
import type { ServiceKind } from './catalog';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: Role;
  permissions: Permission[];
  orgs: OrgSummary[];
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface ServiceDto {
  id: string;
  key: string;
  name: string;
  kind: ServiceKind;
  team: string;
  tier: number;
  description: string;
  dependsOn: string[];
  dependents: string[];
}

export interface ServiceStatusDto extends ServiceDto {
  status: HealthStatus;
  errorRate: number;
  p95: number;
  p99: number;
  avgLatency: number;
  rps: number;
  inferredOnly: boolean;
  atRisk: boolean;
  activeIncidentIds: string[];
}

export interface IncidentDto {
  id: string;
  number: number;
  title: string;
  summary: string;
  severity: Severity;
  status: IncidentStatus;
  environment: string;
  owner: UserRef | null;
  responders: UserRef[];
  services: { id: string; key: string; name: string }[];
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  createdBy: UserRef | null;
  commentCount?: number;
}

export interface IncidentDetailDto extends IncidentDto {
  notes: string;
  links: { id: string; kind: 'event' | 'trace' | 'deployment'; refId: string; label: string }[];
  timeline: TimelineEntry[];
  version: number;
}

export interface TimelineEntry {
  id: string;
  kind: 'created' | 'status' | 'severity' | 'owner' | 'comment' | 'note' | 'link' | 'services' | 'responders' | 'alert';
  at: string;
  actor: UserRef | null;
  body: string;
  meta?: Record<string, unknown>;
}

export type EventDto = Omit<SimEvent, 'ts'> & { ts: number; serviceId: string | null; environment: string; serviceName: string };

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MetricSeries {
  serviceKey: string;
  serviceName: string;
  metric: string;
  agg: string;
  points: { t: number; v: number | null }[];
}

export interface OverviewDto {
  simulated: true;
  now: number;
  range: { from: number; to: number; stepMs: number };
  totals: {
    rps: number;
    errorRate: number;
    avgLatency: number;
    p95: number;
    p99: number;
    healthy: number;
    degraded: number;
    unavailable: number;
    health: HealthStatus;
    score: number;
  };
  series: {
    throughput: { t: number; v: number | null }[];
    errorRate: { t: number; v: number | null }[];
    avg: { t: number; v: number | null }[];
    p95: { t: number; v: number | null }[];
    p99: { t: number; v: number | null }[];
  };
  incidentsBySeverity: Record<Severity, number>;
  activeAlerts: number;
}

export interface TraceSummary {
  traceId: string;
  rootService: string;
  rootOperation: string;
  startMs: number;
  durationMs: number;
  spanCount: number;
  errorCount: number;
  status: 'ok' | 'error';
  services: string[];
}

export interface SpanDto {
  spanId: string;
  parentId: string | null;
  serviceKey: string;
  operation: string;
  startOffsetMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number>;
}

export interface TraceDetail extends TraceSummary {
  spans: SpanDto[];
  incidentIds: string[];
}

export interface NotificationDto {
  id: string;
  kind: 'alert' | 'incident' | 'mention' | 'system';
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  condition: string;
  serviceId: string | null;
  serviceName: string | null;
  environment: string;
  threshold: number;
  windowSec: number;
  cooldownSec: number;
  severity: Severity;
  autoCreateIncident: boolean;
  enabled: boolean;
  state: 'ok' | 'firing';
  lastEvaluatedAt: string | null;
}

export interface AlertDto {
  id: string;
  ruleId: string;
  ruleName: string;
  serviceName: string | null;
  serviceId: string | null;
  severity: Severity;
  status: 'firing' | 'acknowledged' | 'resolved';
  value: number;
  detail: string;
  firedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  incidentId: string | null;
}

export interface DeploymentDto {
  id: string;
  serviceId: string;
  serviceName: string;
  environment: string;
  version: string;
  commit: string;
  status: 'succeeded' | 'rolled_back' | 'in_progress';
  deployedBy: string;
  notes: string;
  deployedAt: string;
}

export interface AuditDto {
  id: string;
  at: string;
  actor: UserRef | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
}

export interface FlagDto {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  resolved: boolean;
  overrides: { scope: 'org' | 'environment'; environment: string | null; enabled: boolean; rolloutPercent: number }[];
  history: { at: string; actor: string; change: string }[];
}

/* Socket.IO contract */
export interface ServerToClientEvents {
  'events:batch': (batch: { events: EventDto[]; seq: number }) => void;
  'metrics:tick': (tick: { t: number; env: string; services: Record<string, { status: HealthStatus; errorRate: number; p95: number; rps: number; avgLatency: number; p99: number }> }) => void;
  'incident:changed': (payload: { id: string; kind: 'created' | 'updated'; number: number }) => void;
  'alert:fired': (payload: { id: string; ruleName: string; severity: Severity }) => void;
  'notification:new': (n: NotificationDto) => void;
  heartbeat: (t: number) => void;
}
export interface ClientToServerEvents {
  subscribe: (p: { env: string }, ack?: (r: { ok: boolean }) => void) => void;
  'heartbeat:ack': (t: number) => void;
}
