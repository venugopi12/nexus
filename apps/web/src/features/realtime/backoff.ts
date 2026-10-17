export interface BackoffOptions { base?: number; cap?: number; random?: () => number }

/** Exponential backoff with "full jitter" (AWS architecture blog): delay ∈ [floor, min(cap, base·2^attempt)]. */
export function backoffDelay(attempt: number, { base = 500, cap = 20_000, random = Math.random }: BackoffOptions = {}): number {
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt));
  const floor = Math.min(250, ceiling);
  return Math.round(floor + random() * (ceiling - floor));
}
