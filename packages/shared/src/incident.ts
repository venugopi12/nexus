export const SEVERITIES = ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'triggered',
  'acknowledged',
  'investigating',
  'mitigated',
  'resolved',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Validated lifecycle. `resolved -> investigating` is the "reopen" transition. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  triggered: ['acknowledged', 'investigating', 'resolved'],
  acknowledged: ['investigating', 'mitigated', 'resolved'],
  investigating: ['mitigated', 'resolved'],
  mitigated: ['investigating', 'resolved'],
  resolved: ['investigating'],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export function isReopen(from: IncidentStatus, to: IncidentStatus): boolean {
  return from === 'resolved' && to === 'investigating';
}

export interface IncidentTimes {
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}

/** Applies timestamp bookkeeping for a transition. Pure, so it can be unit-tested. */
export function applyTransitionTimes(
  times: IncidentTimes,
  from: IncidentStatus,
  to: IncidentStatus,
  now: Date,
): IncidentTimes {
  const next = { ...times };
  if (!next.acknowledgedAt && to !== 'triggered') next.acknowledgedAt = now;
  if (to === 'resolved') next.resolvedAt = now;
  if (isReopen(from, to)) next.resolvedAt = null;
  return next;
}

export const minutesBetween = (a: Date | string, b: Date | string) =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);
