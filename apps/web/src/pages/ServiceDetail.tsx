import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Siren } from 'lucide-react';
import type { MetricSeries, ServiceStatusDto } from '@nexus/shared';
import { get, patch } from '@/lib/api';
import { fmtMs, fmtPct, fmtRps, timeAgo, fmtDateTime } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { useTimeWindow } from '@/lib/queries';
import { useCrumb } from '@/stores/crumb';
import { useRecents, useUi } from '@/stores/ui';
import { toast } from '@/stores/toasts';
import { useLive } from '@/features/realtime/liveStore';
import { Can } from '@/features/auth/auth';
import { MetricTile } from '@/components/MetricTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { ChartSkeleton, EmptyState, ErrorState, IncidentStatusBadge, Panel, SeverityBadge, SimulatedTag, StatusBadge, StatusDot } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect } from 'react';

interface Detail {
  service: ServiceStatusDto;
  config: Record<string, Record<string, string | number | boolean>>;
  upstream: ServiceStatusDto[];
  downstream: ServiceStatusDto[];
  incidents: { id: string; number: number; title: string; severity: 'SEV-1'; status: 'triggered'; createdAt: string }[];
  deployments: { id: string; version: string; commit: string; status: string; environment: string; deployedBy: string; deployedAt: string }[];
  alertRules: { id: string; name: string; severity: 'SEV-1'; enabled: boolean; condition: string; threshold: number }[];
}

function useSeries(key: string | undefined, metric: string, agg: string, w: { env: string; from: number; to: number }) {
  return useQuery({
    enabled: !!key,
    queryKey: ['svc-metric', key, metric, agg, w.env, w.from, w.to],
    queryFn: () => get<{ series: MetricSeries[] }>('/metrics/query', { metric, services: key, env: w.env, from: w.from, to: w.to, agg }),
    refetchInterval: 30_000,
    placeholderData: (p) => p,
  });
}

function ConfigEditor({ id, env, values }: { id: string; env: string; values: Record<string, string | number | boolean> }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [env, values]);
  const m = useMutation({
    mutationFn: () => patch(`/services/${id}/config`, { environment: env, values: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof values[k] === 'number' ? Number(v) : typeof values[k] === 'boolean' ? v === 'true' : v])) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['service', id] }); toast.success('Configuration saved'); setDraft({}); },
    onError: (e) => toast.error('Could not save', (e as Error).message),
  });
  return (
    <div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(values).map(([k, v]) => (
          <div key={k}><dt className="eyebrow mb-1">{k}</dt>
            <dd><Can permission="service:write" fallback={<span className="font-mono text-sm">{String(v)}</span>}>
              <Input aria-label={k} className="h-8 font-mono text-sm" value={draft[k] ?? String(v)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </Can></dd></div>
        ))}
      </dl>
      <Can permission="service:write"><div className="mt-4 flex justify-end"><Button size="sm" disabled={!Object.keys(draft).length || m.isPending} onClick={() => m.mutate()}>Save {env} configuration</Button></div></Can>
    </div>
  );
}

export default function ServiceDetail() {
  const { id = '' } = useParams();
  const w = useTimeWindow(30_000);
  const q = useQuery({ queryKey: ['service', id, w.env], queryFn: () => get<Detail>(`/services/${id}`, { env: w.env }), refetchInterval: 20_000 });
  const svc = q.data?.service;
  useCrumb(svc?.name);
  useEffect(() => { if (svc) useRecents.getState().addResource({ id: svc.id, kind: 'service', label: svc.name, href: `/services/${svc.id}` }); }, [svc?.id, svc?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useLive((s) => (svc ? s.services[svc.key] : undefined));
  const rps = useSeries(svc?.key, 'request_rate', 'avg', w);
  const err = useSeries(svc?.key, 'error_rate', 'avg', w);
  const lat = useSeries(svc?.key, 'latency_ms', 'p95', w);
  const lat50 = useSeries(svc?.key, 'latency_ms', 'p50', w);
  const lat99 = useSeries(svc?.key, 'latency_ms', 'p99', w);
  const cpu = useSeries(svc?.key, 'cpu', 'avg', w);
  const m = live ?? svc;
  const latSeries = useMemo(() => lat.data && lat50.data && lat99.data ? [{ name: 'p99', points: lat99.data.series[0]!.points }, { name: 'p95', points: lat.data.series[0]!.points }, { name: 'p50', points: lat50.data.series[0]!.points }] : [], [lat.data, lat50.data, lat99.data]);
  const [cfgEnv, setCfgEnv] = useState<'production' | 'staging'>(w.env);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-72" /></div>;
  if (q.isError || !svc || !m) return <div className="card"><ErrorState error={q.error ?? new Error('Not found')} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const chart = (r: typeof rps, name: string, fmt: (v: number) => string, area = true) => r.isLoading ? <ChartSkeleton height={180} /> : r.isError ? <ErrorState compact error={r.error} onRetry={() => r.refetch()} /> : <TimeSeriesChart ariaLabel={name} height={180} from={w.from} to={w.to} format={fmt} series={[{ name, points: r.data!.series[0]!.points, area }]} />;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.header variants={item} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-xl font-semibold tracking-tight">{svc.name}</h1><StatusBadge status={m.status} atRisk={svc.atRisk && m.status === 'healthy'} /><SimulatedTag /></div>
          <p className="mt-1 text-sm text-muted-foreground">{svc.description}</p>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="font-mono">{svc.key}</span><span className="capitalize">{svc.kind}</span><span>Team {svc.team}</span><span>Tier {svc.tier}</span><span className="capitalize">{w.env}</span></p>
          {svc.atRisk && <p className="mt-2 max-w-xl rounded-md bg-warn-soft px-3 py-1.5 text-xs text-warn">Inferred: this service’s own metrics look healthy, but a dependency is degraded. This is propagated from the dependency graph, not a measured fault.</p>}
        </div>
        <div className="flex gap-2"><Button asChild variant="outline" size="sm"><Link to={`/map?focus=${svc.key}`}>View in map</Link></Button><Can permission="incident:create"><Button size="sm" onClick={() => useUi.getState().setCreateIncidentOpen(true)}><Siren /> Declare incident</Button></Can></div>
      </motion.header>

      <motion.div variants={stagger} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricTile label="Throughput" value={m.rps} format={fmtRps} unit="req/s" sparkline={rps.data?.series[0]?.points.map((p) => p.v)} />
        <MetricTile label="Error rate" value={m.errorRate} format={(n) => fmtPct(n)} tone={m.errorRate >= 20 ? 'crit' : m.errorRate >= 2 ? 'warn' : 'default'} sparkline={err.data?.series[0]?.points.map((p) => p.v)} />
        <MetricTile label="Avg latency" value={m.avgLatency} format={fmtMs} />
        <MetricTile label="p95" value={m.p95} format={fmtMs} sparkline={lat.data?.series[0]?.points.map((p) => p.v)} />
        <MetricTile label="p99" value={m.p99} format={fmtMs} />
      </motion.div>

      <motion.div variants={item} className="grid gap-4 md:grid-cols-2">
        <Panel title="Traffic" subtitle="requests per second">{chart(rps, 'Throughput', fmtRps)}</Panel>
        <Panel title="Error trend" subtitle="error rate %">{chart(err, 'Error rate', (v) => fmtPct(v))}</Panel>
        <Panel title="Latency" subtitle="p50 · p95 · p99">{lat.isLoading ? <ChartSkeleton height={180} /> : <TimeSeriesChart ariaLabel="Latency" height={180} from={w.from} to={w.to} format={fmtMs} series={latSeries} />}</Panel>
        <Panel title="CPU utilisation" subtitle="percent">{chart(cpu, 'CPU', (v) => `${v.toFixed(0)}%`)}</Panel>
      </motion.div>

      <motion.div variants={item}>
        <Tabs defaultValue="incidents">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto"><TabsTrigger value="incidents">Incidents ({d.incidents.length})</TabsTrigger><TabsTrigger value="deps">Dependencies</TabsTrigger><TabsTrigger value="deploys">Deployments ({d.deployments.length})</TabsTrigger><TabsTrigger value="alerts">Alert rules ({d.alertRules.length})</TabsTrigger><TabsTrigger value="config">Configuration</TabsTrigger></TabsList>
          <TabsContent value="incidents" className="mt-3"><Panel bodyClassName="px-0 pb-0 pt-0">
            {d.incidents.length === 0 ? <EmptyState title="No incidents" description="This service has no recorded incidents." /> : <ul className="divide-y divide-border/60">{d.incidents.map((i) => (
              <li key={i.id}><Link to={`/incidents/${i.id}`} className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-accent/40"><SeverityBadge severity={i.severity} /><span className="min-w-0 flex-1 truncate text-sm font-medium">INC-{i.number} · {i.title}</span><IncidentStatusBadge status={i.status} /><span className="text-xs text-muted-foreground">{timeAgo(i.createdAt)}</span></Link></li>
            ))}</ul>}
          </Panel></TabsContent>
          <TabsContent value="deps" className="mt-3"><div className="grid gap-4 md:grid-cols-2">
            {[['Depends on (downstream calls)', d.upstream], ['Called by (upstream callers)', d.downstream]].map(([title, list]) => (
              <Panel key={title as string} title={title as string} bodyClassName="px-0 pb-0">
                {(list as ServiceStatusDto[]).length === 0 ? <EmptyState title="None" /> : <ul className="divide-y divide-border/60">{(list as ServiceStatusDto[]).map((s) => <li key={s.id}><Link to={`/services/${s.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent/40"><StatusDot status={s.status} /><span className="flex-1 text-sm">{s.name}</span><span className="text-xs text-muted-foreground tabular">{fmtPct(s.errorRate)} · {fmtMs(s.p95)}</span></Link></li>)}</ul>}
              </Panel>
            ))}</div></TabsContent>
          <TabsContent value="deploys" className="mt-3"><Panel bodyClassName="px-0 pb-0 pt-0">
            {d.deployments.length === 0 ? <EmptyState title="No deployments" /> : <ul className="divide-y divide-border/60">{d.deployments.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"><span className="font-mono">{x.version}</span><span className="font-mono text-xs text-muted-foreground">{x.commit}</span><span className="rounded border border-border px-1.5 text-[10px] uppercase text-muted-foreground">{x.environment}</span><span className="flex-1 text-xs text-muted-foreground">{x.deployedBy}</span>{x.status !== 'succeeded' && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">{x.status.replace('_', ' ')}</span>}<span className="text-xs text-muted-foreground">{fmtDateTime(x.deployedAt)}</span></li>)}</ul>}
          </Panel></TabsContent>
          <TabsContent value="alerts" className="mt-3"><Panel bodyClassName="px-0 pb-0 pt-0">
            {d.alertRules.length === 0 ? <EmptyState title="No alert rules apply" /> : <ul className="divide-y divide-border/60">{d.alertRules.map((r) => <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><SeverityBadge severity={r.severity} /><span className="flex-1">{r.name}</span><span className="text-xs text-muted-foreground">{r.enabled ? 'Enabled' : 'Disabled'}</span></li>)}</ul>}
            <div className="border-t border-border p-3"><Button asChild size="sm" variant="outline"><Link to="/alerts">Manage alert rules</Link></Button></div>
          </Panel></TabsContent>
          <TabsContent value="config" className="mt-3"><Panel title="Environment configuration" actions={<div role="radiogroup" aria-label="Config environment" className="flex gap-1">{(['production', 'staging'] as const).map((e) => <button key={e} role="radio" aria-checked={cfgEnv === e} onClick={() => setCfgEnv(e)} className={`h-7 rounded-md px-2.5 text-xs capitalize ${cfgEnv === e ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/40'}`}>{e}</button>)}</div>}>
            <ConfigEditor id={svc.id} env={cfgEnv} values={d.config[cfgEnv] ?? {}} />
          </Panel></TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}
