export const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));
export const fmtCompact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}
export const fmtPct = (n: number, d = 2) => `${n.toFixed(n >= 10 ? 1 : d)}%`;
export const fmtRps = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}k` : n.toFixed(n >= 100 ? 0 : 1));

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
export function timeAgo(input: string | number | Date, now = Date.now()): string {
  const t = new Date(input).getTime();
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return diff <= 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const fmtTime = (t: number | string | Date, seconds = true) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });
export const fmtDateTime = (t: number | string | Date) =>
  new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtFullTime = (t: number | string | Date) =>
  `${new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${fmtTime(t)}.${String(new Date(t).getMilliseconds()).padStart(3, '0')}`;

export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
