import { z } from 'zod';
import { ROLES } from './permissions';
import { INCIDENT_STATUSES, SEVERITIES } from './incident';
import { ALERT_CONDITIONS } from './alerts';
import { ENVIRONMENTS } from './catalog';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const environmentSchema = z.enum(ENVIRONMENTS);
export const severitySchema = z.enum(SEVERITIES);
export const statusSchema = z.enum(INCIDENT_STATUSES);
export const roleSchema = z.enum(ROLES);

export const createIncidentSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(140),
  summary: z.string().trim().max(4000).default(''),
  severity: severitySchema,
  environment: environmentSchema.default('production'),
  ownerId: z.string().uuid().nullable().optional(),
  responderIds: z.array(z.string().uuid()).max(20).default([]),
  serviceIds: z.array(z.string().uuid()).min(1, 'Select at least one affected service').max(30),
  alertId: z.string().uuid().optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z
  .object({
    status: statusSchema.optional(),
    severity: severitySchema.optional(),
    ownerId: z.string().uuid().nullable().optional(),
    responderIds: z.array(z.string().uuid()).max(20).optional(),
    serviceIds: z.array(z.string().uuid()).min(1).max(30).optional(),
    title: z.string().trim().min(5).max(140).optional(),
    summary: z.string().trim().max(4000).optional(),
    notes: z.string().max(20000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(4000),
  mentionIds: z.array(z.string().uuid()).max(20).default([]),
});

export const linkSchema = z.object({
  kind: z.enum(['event', 'trace', 'deployment']),
  refId: z.string().min(1).max(100),
});

export const alertRuleSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(100),
  condition: z.enum(ALERT_CONDITIONS),
  serviceId: z.string().uuid().nullable().default(null),
  environment: environmentSchema.default('production'),
  threshold: z.coerce.number().min(0).max(100000),
  windowSec: z.coerce.number().int().min(60).max(3600).default(300),
  cooldownSec: z.coerce.number().int().min(60).max(86400).default(900),
  severity: severitySchema.default('SEV-3'),
  autoCreateIncident: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;

export const deploymentSchema = z.object({
  serviceId: z.string().uuid(),
  environment: environmentSchema,
  version: z.string().trim().min(1).max(60),
  commit: z.string().trim().min(4).max(40),
  notes: z.string().max(1000).default(''),
});

export const flagUpsertSchema = z.object({
  key: z.string().regex(/^[a-z0-9_.-]+$/),
  scope: z.enum(['global', 'org', 'environment']),
  environment: environmentSchema.optional(),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(80),
  role: roleSchema,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export const roleChangeSchema = z.object({ role: roleSchema });

export const rangeQuerySchema = z.object({
  env: environmentSchema.default('production'),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  range: z.string().default('1h'),
});

export { TIME_RANGES, rangeMs, type TimeRangeKey } from './timeRanges';
