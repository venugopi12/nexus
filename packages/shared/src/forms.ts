/**
 * Declarative form schemas consumed by the web app's schema-driven form renderer.
 * Validation lives in zod (schemas.ts); this file only describes presentation + conditionals.
 */
import { SEVERITIES } from './incident';
import { ALERT_CONDITIONS } from './alerts';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'datetime'
  | 'checkbox'
  | 'switch'
  | 'user'
  | 'users'
  | 'service'
  | 'services';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  options?: FieldOption[];
  defaultValue?: unknown;
  /** Only shown when predicate over current values is true. Declarative to remain serialisable. */
  showWhen?: { field: string; equals?: unknown; notEquals?: unknown; in?: unknown[] };
  min?: number;
  max?: number;
  suffix?: string;
}

export interface FormSchemaDef {
  id: string;
  fields: FieldDef[];
}

const sevOptions = SEVERITIES.map((s) => ({ value: s, label: s }));

export const incidentForm: FormSchemaDef = {
  id: 'incident',
  fields: [
    { name: 'title', label: 'Title', type: 'text', placeholder: 'Checkout latency elevated in production', help: 'Short, specific, searchable.' },
    { name: 'severity', label: 'Severity', type: 'select', options: sevOptions, defaultValue: 'SEV-3', help: 'SEV-1 is a full outage with customer impact.' },
    { name: 'environment', label: 'Environment', type: 'select', options: [{ value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }], defaultValue: 'production' },
    { name: 'serviceIds', label: 'Affected services', type: 'services', help: 'Select every service customers may notice.' },
    { name: 'ownerId', label: 'Owner', type: 'user', help: 'Accountable for coordination and resolution.' },
    { name: 'responderIds', label: 'Responders', type: 'users', showWhen: { field: 'severity', in: ['SEV-1', 'SEV-2'] }, help: 'Required engagement for high severity incidents.' },
    { name: 'summary', label: 'Summary', type: 'textarea', placeholder: 'What is happening, and what do we know so far?' },
  ],
};

export const alertRuleForm: FormSchemaDef = {
  id: 'alertRule',
  fields: [
    { name: 'name', label: 'Rule name', type: 'text', placeholder: 'Checkout error rate high' },
    {
      name: 'condition',
      label: 'Condition',
      type: 'select',
      defaultValue: 'error_rate_above',
      options: ALERT_CONDITIONS.map((c) => ({
        value: c,
        label: { error_rate_above: 'Error rate above', latency_above: 'p95 latency above', health_change: 'Service health at or below', request_volume_anomaly: 'Request volume anomaly' }[c],
      })),
    },
    { name: 'serviceId', label: 'Service', type: 'service', help: 'Leave empty to apply to every service in the environment.' },
    { name: 'environment', label: 'Environment', type: 'select', defaultValue: 'production', options: [{ value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }] },
    { name: 'threshold', label: 'Threshold (% error rate)', type: 'number', defaultValue: 5, min: 0, suffix: '%', showWhen: { field: 'condition', equals: 'error_rate_above' } },
    { name: 'threshold', label: 'Threshold (ms)', type: 'number', defaultValue: 500, min: 0, suffix: 'ms', showWhen: { field: 'condition', equals: 'latency_above' } },
    { name: 'threshold', label: 'Health level (1 = degraded, 2 = unavailable)', type: 'number', defaultValue: 1, min: 1, max: 2, showWhen: { field: 'condition', equals: 'health_change' } },
    { name: 'threshold', label: 'Deviation from baseline (%)', type: 'number', defaultValue: 40, min: 1, max: 1000, suffix: '%', showWhen: { field: 'condition', equals: 'request_volume_anomaly' } },
    { name: 'windowSec', label: 'Evaluation window', type: 'number', defaultValue: 300, min: 60, max: 3600, suffix: 's', help: 'Seconds of data evaluated each cycle.' },
    { name: 'cooldownSec', label: 'Cooldown', type: 'number', defaultValue: 900, min: 60, suffix: 's', help: 'Minimum time before the same rule can alert again after resolving.' },
    { name: 'severity', label: 'Severity', type: 'select', defaultValue: 'SEV-3', options: sevOptions },
    { name: 'autoCreateIncident', label: 'Create incident automatically', type: 'switch', defaultValue: false, showWhen: { field: 'severity', in: ['SEV-1', 'SEV-2'] }, help: 'Only available for SEV-1 and SEV-2 rules.' },
    { name: 'enabled', label: 'Enabled', type: 'switch', defaultValue: true },
  ],
};
