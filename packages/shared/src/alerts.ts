import { percentile, mean } from './sim';

export const ALERT_CONDITIONS = ['error_rate_above', 'latency_above', 'health_change', 'request_volume_anomaly'] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export interface RuleLike {
  condition: AlertCondition;
  threshold: number;
  /** evaluation window in seconds */
  windowSec: number;
}

export interface EvalInput {
  /** error_rate percent samples in window */
  errorRate: number[];
  /** latency samples in ms in window */
  latency: number[];
  /** request rate samples in window */
  requestRate: number[];
  /** request rate samples for the preceding baseline window (same length ideally) */
  baselineRequestRate: number[];
  health: 'healthy' | 'degraded' | 'unavailable';
}

export interface EvalResult {
  firing: boolean;
  value: number;
  /** human-readable explanation of what was measured */
  detail: string;
}

/**
 * Pure rule evaluation.
 *  - error_rate_above: mean error % in window > threshold
 *  - latency_above: p95 latency (ms) in window > threshold
 *  - health_change: current health rank >= threshold (1=degraded, 2=unavailable)
 *  - request_volume_anomaly: |mean(window) - mean(baseline)| / mean(baseline) * 100 > threshold
 */
export function evaluateRule(rule: RuleLike, input: EvalInput): EvalResult {
  switch (rule.condition) {
    case 'error_rate_above': {
      const v = mean(input.errorRate);
      return { firing: input.errorRate.length > 0 && v > rule.threshold, value: v, detail: `mean error rate ${v.toFixed(2)}% over ${rule.windowSec}s (threshold ${rule.threshold}%)` };
    }
    case 'latency_above': {
      const v = percentile(input.latency, 95);
      return { firing: input.latency.length > 0 && v > rule.threshold, value: v, detail: `p95 latency ${v.toFixed(0)}ms over ${rule.windowSec}s (threshold ${rule.threshold}ms)` };
    }
    case 'health_change': {
      const rank = input.health === 'healthy' ? 0 : input.health === 'degraded' ? 1 : 2;
      return { firing: rank >= rule.threshold, value: rank, detail: `service health is ${input.health}` };
    }
    case 'request_volume_anomaly': {
      const base = mean(input.baselineRequestRate);
      const cur = mean(input.requestRate);
      const dev = base > 0 ? (Math.abs(cur - base) / base) * 100 : 0;
      return { firing: base > 0 && dev > rule.threshold, value: dev, detail: `request volume deviates ${dev.toFixed(1)}% from baseline (threshold ${rule.threshold}%)` };
    }
  }
}

/** Decides whether a firing evaluation should emit a new alert (dedupe + cooldown). */
export function shouldEmitAlert(opts: {
  firing: boolean;
  hasOpenAlert: boolean;
  lastFiredAt: number | null;
  now: number;
  cooldownSec: number;
}): boolean {
  if (!opts.firing) return false;
  if (opts.hasOpenAlert) return false; // sustained condition => no duplicates
  if (opts.lastFiredAt && opts.now - opts.lastFiredAt < opts.cooldownSec * 1000) return false;
  return true;
}
