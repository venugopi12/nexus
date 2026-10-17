import { memo, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';
import type { AlertDto, DeploymentDto, EventDto, IncidentDto, OverviewDto, Paginated, ServiceStatusDto, Severity } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtMs, fmtPct, fmtRps, fmtTime, timeAgo, fmtDuration } from '@/lib/format';
import { item, listItem, stagger } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useServiceIndex, useTimeWindow } from '@/lib/queries';
import { useLive } from '@/features/realtime/liveStore';
import { MetricTile } from '@/components/MetricTile';
import { TimeSeriesChart, type TimeWindow } from '@/components/TimeSeriesChart';
import { ChartSkeleton, EmptyState, ErrorState, IncidentStatusBadge, PageHeader, Panel, SeverityBadge, SimulatedTag, StatusBadge, StatusDot, TableSkeleton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SEV_KEYS: Severity[] = ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'];

/** One row subscribes to exactly one service's live slice → a metric tick re-renders rows, not the page. */
const ServiceRow = memo(function ServiceRow({ svc, selected, onSelect }: { svc: ServiceStatusDto; selected: boolean; onSelect: (key: string) => void }) {
  const live = useLive((s) => s.services[svc.key]);
  const m = live ?? svc;
  return (
    <TableRow className={cn('cursor-pointer', selected && 'bg-accent/50')} onClick={() => onSelect(svc.key)} aria-selected={selected}>
      <TableCell className="py-2"><div className="flex items-center gap-2"><StatusDot status={m.status} /><Link to={`/services/${svc.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:underline">{svc.name}</Link></div></TableCell>
      <TableCell className="hidden py-2 sm:table-cell"><StatusBadge status={m.status} atRisk={svc.atRisk && m.status === 'healthy'} /></TableCell>
      <TableCell className="py-2 text-right tabular">{fmtRps(m.rps)}</TableCell>
      <TableCell className={cn('py-2 text-right tabular', m.errorRate >= 2 && 'text-crit')}>{fmtPct(m.errorRate)}</TableCell>
      <TableCell className="py-2 text-right tabular">{fmtMs(m.p95)}</TableCell>
    </TableRow>
  );
});

function SeverityBreakdown({ data }: { data: OverviewDto['incidentsBySeverity'] }) {
  const total = SEV_KEYS.reduce((a, k) => a + data[k], 0);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${total} active incidents`}>
        {SEV_KEYS.map((k) => data[k] > 0 && <motion.div key={k} layout style={{ flexGrow: data[k] }} className={cn('mr-px last:mr-0', k === 'SEV-1' ? 'bg-crit' : k === 'SEV-2' ? 'bg-warn' : k === 'SEV-3' ? 'bg-primary' : 'bg-subtle')} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {SEV_KEYS.map((k) => (
          <li key={k}><Link to={`/incidents?severity=${k}&active=true`} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50"><SeverityBadge severity={k} /><span className="tabular font-semibold">{data[k]}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}

function LiveFeed({ window: sel, services, onClear }: { window: TimeWindow | null; services: string[]; onClear: () => void }) {
  const live = useLive((s) => s.events);
  const status = useLive((s) => s.status);
  const env = useTimeWindow().env;
  const hist = useQuery({
    queryKey: ['events', 'feed', env, sel?.from, sel?.to, services.join(',')],
    queryFn: () => get<{ items: EventDto[]; total: number }>('/events', { env, from: sel?.from, to: sel?.to, services: services.join(','), limit: 40, total: false }),
    refetchInterval: sel ? false : 30_000,
  });
  const rows = useMemo(() => {
    if (sel) return hist.data?.items ?? [];
    const liveFiltered = services.length ? live.filter((e) => services.includes(e.serviceKey)) : live;
    const seen = new Set(liveFiltered.map((e) => e.id));
    return [...liveFiltered, ...(hist.data?.items ?? []).filter((e) => !seen.has(e.id))].slice(0, 40);
  }, [live, hist.data, sel, services]);
  return (
    <Panel title="Live event feed" subtitle={sel ? `Filtered to ${fmtTime(sel.from, false)}–${fmtTime(sel.to, false)}` : status === 'connected' ? 'Streaming' : 'Not streaming — showing last known'}
      actions={<>{sel && <Button size="xs" variant="outline" onClick={onClear}><X /> Clear</Button>}<Button asChild size="xs" variant="ghost"><Link to="/events">Open <ArrowUpRight /></Link></Button></>} bodyClassName="px-0 pb-0">
      {hist.isLoading && !rows.length ? <TableSkeleton rows={5} /> : hist.isError && !rows.length ? <ErrorState compact error={hist.error} onRetry={() => hist.refetch()} /> : rows.length === 0 ? <EmptyState title="No events" description="Nothing matches the current filters." /> : (
        <ul className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
          <AnimatePresence initial={false}>
            {rows.map((e) => (
              <motion.li key={e.id} layout="position" variants={listItem} initial="hidden" animate="show" className="flex items-start gap-2.5 px-4 py-2 text-xs">
                <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', e.severity === 'critical' || e.severity === 'error' ? 'bg-crit' : e.severity === 'warning' ? 'bg-warn' : 'bg-subtle')} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{e.message}</span><span className="text-subtle">{e.serviceName} · {e.type.replace('_', ' ')}</span></span>
                <span className="shrink-0 font-mono text-subtle">{fmtTime(e.ts)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

export default function Overview() {
  const w = useTimeWindow(15_000);
  const navigate = useNavigate();
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [sel, setSel] = useState<TimeWindow | null>(null);

  const overview = useQuery({
    queryKey: ['overview', w.env, w.range, w.to, serviceFilter.join(',')],
    queryFn: () => get<OverviewDto>('/overview', { env: w.env, from: w.from, to: w.to, services: serviceFilter.join(',') }),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const incidents = useQuery({ queryKey: ['incidents', 'recent', w.env], queryFn: () => get<Paginated<IncidentDto>>('/incidents', { env: w.env, pageSize: 6, sort: 'created' }), refetchInterval: 20_000 });
  const deployments = useQuery({ queryKey: ['deployments', 'recent', w.env], queryFn: () => get<Paginated<DeploymentDto>>('/deployments', { env: w.env, pageSize: 5 }), refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ['alerts', 'active'], queryFn: () => get<Paginated<AlertDto>>('/alerts', { status: 'firing,acknowledged', pageSize: 6 }), refetchInterval: 15_000 });
  const svcQ = useServiceIndex();
  const svcAll = useQuery({ queryKey: ['services', w.env], queryFn: () => get<{ items: ServiceStatusDto[] }>('/services', { env: w.env }), refetchInterval: 15_000 });

  const o = overview.data;
  const t = o?.totals;
  const spark = (k: keyof OverviewDto['series']) => o?.series[k].map((p) => p.v);
  const toggleService = useCallback((key: string) => setServiceFilter((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])), []);
  const onBrush = useCallback(([from, to]: [number, number]) => setSel({ from, to }), []);
  const windows = useMemo<TimeWindow[]>(() => (sel ? [sel] : []), [sel]);

  const latencySeries = useMemo(() => o ? [
    { name: 'p99', points: o.series.p99 }, { name: 'p95', points: o.series.p95 }, { name: 'avg', points: o.series.avg },
  ] : [], [o]);
  const errSeries = useMemo(() => o ? [{ name: 'Error rate', points: o.series.errorRate, area: true }] : [], [o]);
  const tputSeries = useMemo(() => o ? [{ name: 'Throughput', points: o.series.throughput, area: true }] : [], [o]);
  const sortedServices = useMemo(() => [...(svcAll.data?.items ?? [])].sort((a, b) => ['unavailable', 'degraded', 'healthy'].indexOf(a.status) - ['unavailable', 'degraded', 'healthy'].indexOf(b.status) || a.name.localeCompare(b.name)), [svcAll.data]);
  void svcQ;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={item}>
        <PageHeader title="Overview" meta={<SimulatedTag />}
          description={<>System health for <b className="font-medium text-foreground capitalize">{w.env}</b>. Click a service row to filter charts and events; drag across the latency chart to inspect a window.</>}
          actions={serviceFilter.length > 0 ? <Button size="sm" variant="outline" onClick={() => setServiceFilter([])}><X /> {serviceFilter.length} service filter{serviceFilter.length > 1 ? 's' : ''}</Button> : undefined} />
      </motion.div>

      {overview.isError && !o ? <div className="card"><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></div> : (
        <motion.div variants={stagger} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="System health" value={t?.score} format={(n) => `${Math.round(n)}`} unit="/ 100" tone={t?.health === 'healthy' ? 'ok' : t?.health === 'degraded' ? 'warn' : 'crit'}
            hint={t ? `${t.healthy} healthy · ${t.degraded} degraded · ${t.unavailable} down` : undefined} />
          <MetricTile label="Throughput" value={t?.rps} format={fmtRps} unit="req/s" sparkline={spark('throughput')} />
          <MetricTile label="Error rate" value={t?.errorRate} format={(n) => fmtPct(n)} sparkline={spark('errorRate')} tone={t && t.errorRate >= 2 ? 'crit' : t && t.errorRate >= 1 ? 'warn' : 'default'} />
          <MetricTile label="Avg latency" value={t?.avgLatency} format={fmtMs} sparkline={spark('avg')} />
          <MetricTile label="p95 latency" value={t?.p95} format={fmtMs} sparkline={spark('p95')} />
          <MetricTile label="p99 latency" value={t?.p99} format={fmtMs} sparkline={spark('p99')} />
        </motion.div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <motion.div variants={item} className="xl:col-span-2">
          <Panel title="Latency" subtitle="avg · p95 · p99 across user-facing services — drag to select a window" actions={sel ? <Button size="xs" variant="outline" onClick={() => setSel(null)}><X /> Clear selection</Button> : undefined}>
            {overview.isLoading ? <ChartSkeleton height={240} /> : overview.isError ? <ErrorState compact error={overview.error} onRetry={() => overview.refetch()} /> :
              <TimeSeriesChart series={latencySeries} format={fmtMs} height={240} from={o!.range.from} to={o!.range.to} windows={windows} onBrush={onBrush} ariaLabel="Latency over time" />}
          </Panel>
        </motion.div>
        <motion.div variants={item}>
          <Panel title="Active incidents" actions={<Button asChild size="xs" variant="ghost"><Link to="/incidents?active=true">All <ArrowUpRight /></Link></Button>}>
            {overview.isLoading ? <ChartSkeleton height={120} /> : o ? <SeverityBreakdown data={o.incidentsBySeverity} /> : <ErrorState compact error={overview.error} />}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Active alerts</span>
              <Link to="/alerts" className="tabular font-semibold hover:underline">{o?.activeAlerts ?? '—'}</Link>
            </div>
          </Panel>
        </motion.div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <motion.div variants={item}><Panel title="Request throughput" subtitle="ingress services, req/s">
          {overview.isLoading ? <ChartSkeleton height={170} /> : overview.isError ? <ErrorState compact error={overview.error} /> : <TimeSeriesChart series={tputSeries} format={fmtRps} height={170} from={o!.range.from} to={o!.range.to} windows={windows} ariaLabel="Throughput over time" />}
        </Panel></motion.div>
        <motion.div variants={item}><Panel title="Error rate" subtitle="request-weighted, %">
          {overview.isLoading ? <ChartSkeleton height={170} /> : overview.isError ? <ErrorState compact error={overview.error} /> : <TimeSeriesChart series={errSeries} format={(v) => fmtPct(v)} height={170} from={o!.range.from} to={o!.range.to} windows={windows} ariaLabel="Error rate over time" yMin={0} />}
        </Panel></motion.div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <motion.div variants={item} className="xl:col-span-2">
          <Panel title="Service health" subtitle="Live values stream in every 2s" actions={<Button asChild size="xs" variant="ghost"><Link to="/services">All services <ArrowUpRight /></Link></Button>} bodyClassName="px-0 pb-0">
            {svcAll.isLoading ? <TableSkeleton /> : svcAll.isError ? <ErrorState compact error={svcAll.error} onRetry={() => svcAll.refetch()} /> : (
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>Service</TableHead><TableHead className="hidden sm:table-cell">Status</TableHead><TableHead className="text-right">Req/s</TableHead><TableHead className="text-right">Errors</TableHead><TableHead className="text-right">p95</TableHead></TableRow></TableHeader>
                  <TableBody>{sortedServices.map((s) => <ServiceRow key={s.id} svc={s} selected={serviceFilter.includes(s.key)} onSelect={toggleService} />)}</TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </motion.div>
        <motion.div variants={item}><LiveFeed window={sel} services={serviceFilter} onClear={() => setSel(null)} /></motion.div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={item} className="lg:col-span-2">
          <Panel title="Recent incidents" subtitle="Timeline of latest activity" bodyClassName="px-0 pb-0">
            {incidents.isLoading ? <TableSkeleton rows={4} /> : incidents.isError ? <ErrorState compact error={incidents.error} onRetry={() => incidents.refetch()} /> : incidents.data!.items.length === 0 ? <EmptyState title="No incidents" description="Nothing to see — a quiet system." /> : (
              <ol className="relative ml-6 border-l border-border pb-3 pr-4">
                {incidents.data!.items.map((i) => (
                  <li key={i.id} className="relative py-2.5 pl-5">
                    <span className={cn('absolute -left-[5px] top-[18px] size-2.5 rounded-full ring-4 ring-card', i.status === 'resolved' ? 'bg-ok' : i.severity === 'SEV-1' ? 'bg-crit' : 'bg-warn')} />
                    <button onClick={() => navigate(`/incidents/${i.id}`)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
                      <SeverityBadge severity={i.severity} /><span className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">INC-{i.number} · {i.title}</span>
                      <IncidentStatusBadge status={i.status} />
                    </button>
                    <p className="mt-0.5 text-xs text-muted-foreground">{i.services.map((s) => s.name).join(', ')} · opened {timeAgo(i.createdAt)}{i.resolvedAt ? ` · resolved in ${fmtDuration(new Date(i.resolvedAt).getTime() - new Date(i.createdAt).getTime())}` : ''}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </motion.div>
        <div className="space-y-4">
          <motion.div variants={item}><Panel title="Active alerts" actions={<Button asChild size="xs" variant="ghost"><Link to="/alerts">View <ArrowUpRight /></Link></Button>} bodyClassName="px-0 pb-0">
            {alerts.isLoading ? <TableSkeleton rows={3} /> : alerts.isError ? <ErrorState compact error={alerts.error} onRetry={() => alerts.refetch()} /> : alerts.data!.items.length === 0 ? <EmptyState title="No active alerts" /> : (
              <ul className="divide-y divide-border/60">{alerts.data!.items.map((a) => (
                <li key={a.id} className="flex items-start gap-2 px-4 py-2.5"><SeverityBadge severity={a.severity} className="mt-0.5" /><div className="min-w-0 flex-1"><p className="truncate text-sm">{a.ruleName}</p><p className="truncate text-xs text-muted-foreground">{a.serviceName} · {timeAgo(a.firedAt)}</p></div></li>
              ))}</ul>
            )}
          </Panel></motion.div>
          <motion.div variants={item}><Panel title="Recent deployments" actions={<Button asChild size="xs" variant="ghost"><Link to="/deployments">All <ArrowUpRight /></Link></Button>} bodyClassName="px-0 pb-0">
            {deployments.isLoading ? <TableSkeleton rows={3} /> : deployments.isError ? <ErrorState compact error={deployments.error} onRetry={() => deployments.refetch()} /> : deployments.data!.items.length === 0 ? <EmptyState title="No deployments" /> : (
              <ul className="divide-y divide-border/60">{deployments.data!.items.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{d.serviceName} <span className="font-mono text-xs text-muted-foreground">{d.version}</span></p><p className="truncate text-xs text-muted-foreground">{d.deployedBy} · {timeAgo(d.deployedAt)}</p></div>{d.status !== 'succeeded' && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">{d.status.replace('_', ' ')}</span>}</li>
              ))}</ul>
            )}
          </Panel></motion.div>
        </div>
      </div>
    </motion.div>
  );
}
