import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Download, GitCompare, RotateCcw, ZoomIn, X } from 'lucide-react';
import { METRICS, TIME_RANGES, rangeMs, type EventDto, type MetricSeries } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtMs, fmtPct, fmtRps, fmtTime, fmtDateTime } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { seriesColor } from '@/lib/chartTheme';
import { useNowTick, useServiceIndex } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { useUrlState } from '@/hooks/useUrlState';
import { MultiSelect } from '@/components/SchemaForm';
import { TimeSeriesChart, type TimeWindow } from '@/components/TimeSeriesChart';
import { ChartSkeleton, EmptyState, ErrorState, PageHeader, Panel, SimulatedTag } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const FORMATS: Record<string, (v: number) => string> = {
  request_rate: fmtRps, error_rate: (v) => fmtPct(v), latency_ms: fmtMs, cpu: (v) => `${v.toFixed(0)}%`, memory: (v) => `${v.toFixed(0)}%`,
};
const toLocalInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function toCsv(series: MetricSeries[]): string {
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const header = ['timestamp_iso', ...series.map((s) => `"${s.serviceName.replace(/"/g, '""')} (${s.metric}/${s.agg})"`)];
  const lookup = series.map((s) => new Map(s.points.map((p) => [p.t, p.v])));
  const rows = times.map((t) => [new Date(t).toISOString(), ...lookup.map((m) => { const v = m.get(t); return v === null || v === undefined ? '' : String(Number(v.toFixed(4))); })].join(','));
  return [header.join(','), ...rows].join('\n');
}

export default function MetricsExplorer() {
  const env = useUi((s) => s.env);
  const { list: services } = useServiceIndex();
  const now = useNowTick(30_000);
  const [f, set] = useUrlState({ metric: 'latency_ms', agg: 'p95', services: 'edge-gateway,checkout-service', range: '1h', from: '', to: '', compare: '' });
  const [sel, setSel] = useState<TimeWindow | null>(null);

  const metric = METRICS.find((m) => m.key === f.metric) ?? METRICS[2];
  const agg = (metric.aggs as readonly string[]).includes(f.agg) ? f.agg : metric.aggs[0];
  const absolute = !!(f.from && f.to);
  const to = absolute ? Number(f.to) : now;
  const from = absolute ? Number(f.from) : now - rangeMs(f.range);
  const keys = f.services.split(',').filter(Boolean);

  const q = useQuery({
    queryKey: ['metrics', env, f.metric, agg, keys.join(','), from, to, f.compare],
    enabled: keys.length > 0,
    queryFn: () => get<{ series: MetricSeries[]; unit: string; step: number; sampledEvery: number }>('/metrics/query', { metric: f.metric, services: keys.join(','), env, from, to, agg, compare: f.compare ? 'true' : undefined }),
    placeholderData: (p) => p,
  });
  const events = useQuery({
    queryKey: ['metrics-events', env, keys.join(','), sel?.from ?? from, sel?.to ?? to],
    queryFn: () => get<{ items: EventDto[]; total: number }>('/events', { env, from: sel?.from ?? from, to: sel?.to ?? to, services: keys.join(','), limit: 30 }),
  });

  const series = useMemo(() => (q.data?.series ?? []).map((s, i) => {
    const cmp = s.serviceName.endsWith('(previous period)');
    const baseIdx = keys.indexOf(s.serviceKey);
    return { name: s.serviceName, points: s.points, color: seriesColor(baseIdx >= 0 ? baseIdx : i), dashed: cmp, area: keys.length === 1 && !cmp };
  }), [q.data, keys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = FORMATS[f.metric] ?? ((v: number) => v.toFixed(2));
  const onBrush = useCallback(([a, b]: [number, number]) => setSel({ from: a, to: b, tone: 'selection' }), []);
  const windows = useMemo(() => (sel ? [sel] : []), [sel]);

  const exportCsv = () => {
    if (!q.data) return;
    const blob = new Blob([toCsv(q.data.series)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-${f.metric}-${agg}-${new Date(from).toISOString().slice(0, 16)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Metrics Explorer" meta={<SimulatedTag />} description="Query any metric across services. Drag on the chart to select an interval — related events below follow the selection. Query state lives in the URL, so it is shareable." /></motion.div>
      <motion.div variants={item} className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr_auto]">
        <label className="space-y-1"><span className="eyebrow">Metric</span>
          <Select value={f.metric} onValueChange={(v) => { const m = METRICS.find((x) => x.key === v)!; set({ metric: v, agg: (m.aggs as readonly string[]).includes(f.agg) ? f.agg : m.aggs[0] }); }}>
            <SelectTrigger className="w-full" aria-label="Metric"><SelectValue /></SelectTrigger><SelectContent>{METRICS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label} ({m.unit})</SelectItem>)}</SelectContent>
          </Select></label>
        <label className="space-y-1"><span className="eyebrow">Aggregation</span>
          <Select value={agg} onValueChange={(v) => set({ agg: v })}><SelectTrigger className="w-full" aria-label="Aggregation"><SelectValue /></SelectTrigger><SelectContent>{metric.aggs.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        </label>
        <div className="space-y-1 sm:col-span-2 lg:col-span-1"><span className="eyebrow">Services (max 8)</span>
          <MultiSelect id="mx-services" value={keys} onChange={(v) => set({ services: v.slice(0, 8).join(',') })} options={services.map((s) => ({ value: s.key, label: s.name, hint: s.kind }))} placeholder="Select services…" /></div>
        <div className="flex items-end gap-2">
          <Button variant={f.compare ? 'secondary' : 'outline'} aria-pressed={!!f.compare} onClick={() => set({ compare: f.compare ? '' : '1' })}><GitCompare /> Compare</Button>
          <Button variant="outline" onClick={exportCsv} disabled={!q.data}><Download /> CSV</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2 lg:col-span-4">
          {TIME_RANGES.map((r) => <button key={r.key} aria-pressed={!absolute && f.range === r.key} onClick={() => { set({ range: r.key, from: '', to: '' }); setSel(null); }} className={cn('h-7 rounded-full border px-2.5 text-xs', !absolute && f.range === r.key ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/40')}>{r.key}</button>)}
          <span className="mx-1 text-xs text-subtle">or absolute</span>
          <Input type="datetime-local" aria-label="From" className="h-7 w-[185px] text-xs" value={toLocalInput(from)} onChange={(e) => e.target.value && set({ from: String(new Date(e.target.value).getTime()), to: String(absolute ? to : now) })} />
          <Input type="datetime-local" aria-label="To" className="h-7 w-[185px] text-xs" value={toLocalInput(to)} onChange={(e) => e.target.value && set({ to: String(new Date(e.target.value).getTime()), from: String(absolute ? from : now - rangeMs(f.range)) })} />
          {absolute && <Button size="xs" variant="ghost" onClick={() => { set({ from: '', to: '' }); setSel(null); }}><RotateCcw /> Reset zoom</Button>}
        </div>
      </motion.div>

      <motion.div variants={item}>
        <Panel title={`${metric.label} · ${agg}`} subtitle={q.data ? `${fmtDateTime(from)} → ${fmtDateTime(to)} · ${Math.round(q.data.step / 1000)}s buckets${q.data.sampledEvery > 15 ? ` · sampled every ${q.data.sampledEvery}s` : ''}` : undefined}
          actions={sel ? <><Button size="xs" variant="outline" onClick={() => { set({ from: String(sel.from), to: String(sel.to) }); setSel(null); }}><ZoomIn /> Zoom to selection</Button><Button size="xs" variant="ghost" onClick={() => setSel(null)} aria-label="Clear selection"><X /></Button></> : undefined}>
          {keys.length === 0 ? <EmptyState title="Select at least one service" /> : q.isLoading ? <ChartSkeleton height={340} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
            <TimeSeriesChart ariaLabel={`${metric.label} ${agg} over time`} series={series} format={fmt} height={340} from={from} to={to} windows={windows} onBrush={onBrush} yMin={f.metric === 'error_rate' || f.metric === 'request_rate' ? 0 : undefined} />}
          {f.compare && <p className="mt-2 text-xs text-muted-foreground">Dashed lines show the immediately preceding period of equal length, shifted onto the current time axis.</p>}
          {['p50', 'p95', 'p99'].includes(agg) && <p className="mt-1 text-xs text-subtle">Percentiles are computed over raw 15-second samples inside each bucket (nearest-rank).</p>}
        </Panel>
      </motion.div>

      <motion.div variants={item} className="mt-4">
        <Panel title="Related events" subtitle={sel ? `Selected ${fmtTime(sel.from)} – ${fmtTime(sel.to)}` : 'Whole visible range'} actions={<Button asChild size="xs" variant="outline"><Link to={`/events?from=${sel?.from ?? from}&to=${sel?.to ?? to}&services=${keys.join(',')}`}>Open in Event Stream</Link></Button>} bodyClassName="px-0 pb-0">
          {events.isLoading ? <ChartSkeleton height={120} /> : events.isError ? <ErrorState compact error={events.error} /> : events.data!.items.length === 0 ? <EmptyState title="No events in this interval" /> : (
            <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">{events.data!.items.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm"><span className={cn('size-1.5 shrink-0 rounded-full', e.severity === 'critical' || e.severity === 'error' ? 'bg-crit' : e.severity === 'warning' ? 'bg-warn' : 'bg-subtle')} /><span className="min-w-0 flex-1 truncate">{e.message}</span><span className="hidden text-xs text-muted-foreground sm:inline">{e.serviceName}</span><span className="font-mono text-xs text-subtle">{fmtTime(e.ts)}</span></li>
            ))}</ul>
          )}
          {events.data && events.data.total > 30 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Showing 30 of {events.data.total.toLocaleString()} events.</p>}
        </Panel>
      </motion.div>
    </motion.div>
  );
}
