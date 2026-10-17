import { hash32 } from './prng';

export interface FlagRule {
  enabled: boolean;
  /** 0-100 */
  rolloutPercent: number;
}

/** Deterministic 0-99 bucket for a (flag, subject) pair; stable across processes. */
export function bucketFor(flagKey: string, subjectId: string): number {
  return hash32(`${flagKey}:${subjectId}`) % 100;
}

export interface FlagResolutionInput {
  base: FlagRule;
  orgOverride?: Partial<FlagRule> | null;
  envOverride?: Partial<FlagRule> | null;
}

/** Precedence: environment override > organization override > global default. */
export function resolveFlag(flagKey: string, subjectId: string, input: FlagResolutionInput) {
  const rule: FlagRule = {
    ...input.base,
    ...stripUndef(input.orgOverride),
    ...stripUndef(input.envOverride),
  };
  if (!rule.enabled) return false;
  if (rule.rolloutPercent >= 100) return true;
  if (rule.rolloutPercent <= 0) return false;
  return bucketFor(flagKey, subjectId) < rule.rolloutPercent;
}

function stripUndef<T extends object>(o?: T | null): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
