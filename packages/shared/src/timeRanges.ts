export const TIME_RANGES = [
  { key: '15m', label: 'Last 15 minutes', ms: 15 * 60_000 },
  { key: '1h', label: 'Last hour', ms: 60 * 60_000 },
  { key: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60_000 },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60_000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60_000 },
] as const;
export type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];
export const rangeMs = (key: string) => TIME_RANGES.find((r) => r.key === key)?.ms ?? 3_600_000;
