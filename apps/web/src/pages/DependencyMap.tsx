import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'motion/react';
import { Crosshair, Eye, EyeOff, Maximize, Search, Siren } from 'lucide-react';
import type { IncidentDto, Paginated, ServiceStatusDto } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtMs, fmtPct, fmtRps } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { useFlag } from '@/lib/queries';
import { useLive } from '@/features/realtime/liveStore';
import { layeredLayout, reach } from '@/features/graph/layout';
import { Drawer } from '@/components/Overlay';
import { ErrorState, PageHeader, SeverityBadge, SimulatedTag, StatusBadge } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface GraphData { simulated: true; nodes: ServiceStatusDto[]; edges: { id: string; source: string; target: string }[]; inferredImpact: Record<string, string[]> }
type Role = 'selected' | 'upstream' | 'downstream' | null;
interface NodeData extends Record<string, unknown> { svc: ServiceStatusDto; role: Role; dim: boolean; inferred: string[]; declared: boolean; match: boolean }

const STATUS_BORDER = { healthy: 'var(--border-strong)', degraded: 'var(--warn)', unavailable: 'var(--crit)' } as const;

const ServiceNode = memo(function ServiceNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const { svc, role, dim, inferred, declared, match } = data;
  const live = useLive((s) => s.services[svc.key]);
  const m = live ?? svc;
  const atRisk = m.status === 'healthy' && inferred.length > 0;
  return (
    <div
      className={cn('w-[232px] rounded-xl border bg-card px-3 py-2.5 shadow-card transition-[opacity,box-shadow,border-color] duration-150', dim && 'opacity-25', selected && 'ring-2 ring-primary', role === 'upstream' && 'ring-2 ring-info/60', role === 'downstream' && 'ring-2 ring-violet/60', match && 'ring-2 ring-primary/60', atRisk && 'border-dashed')}
      style={{ borderColor: atRisk ? 'var(--warn)' : STATUS_BORDER[m.status], borderWidth: m.status === 'healthy' && !atRisk ? 1 : 1.5 }}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-border-strong" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{svc.name}</span>
        {svc.activeIncidentIds.length > 0 && <span title={`${svc.activeIncidentIds.length} active incident(s)`} className="flex shrink-0 items-center gap-1 rounded-full bg-crit-soft px-1.5 py-0.5 text-[10px] font-bold text-crit"><Siren className="size-3" />{svc.activeIncidentIds.length}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5"><StatusBadge status={m.status} className="px-1.5 text-[11px]" />{declared && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">declared</span>}{atRisk && <span title="Inferred from dependency graph — not measured on this service" className="rounded bg-warn-soft px-1 text-[10px] font-medium text-warn">inferred risk</span>}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] tabular text-muted-foreground">
        <span title="Error rate"><b className={cn('block text-xs font-medium', m.errorRate >= 2 ? 'text-crit' : 'text-foreground')}>{fmtPct(m.errorRate)}</b>errors</span>
        <span title="p95 latency"><b className="block text-xs font-medium text-foreground">{fmtMs(m.p95)}</b>p95</span>
        <span title="Requests per second"><b className="block text-xs font-medium text-foreground">{fmtRps(m.rps)}</b>req/s</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-border-strong" />
    </div>
  );
});
const nodeTypes = { service: ServiceNode };

function Details({ svc, inferred, onClose }: { svc: ServiceStatusDto; inferred: string[]; onClose?: () => void }) {
  const live = useLive((s) => s.services[svc.key]);
  const m = live ?? svc;
  const byKey = useMemo(() => new Map<string, string>(), []);
  void byKey; void onClose;
  return (
    <div className="space-y-4 p-4 text-sm">
      <div><div className="flex items-center gap-2"><h2 className="text-base font-semibold">{svc.name}</h2><StatusBadge status={m.status} /></div><p className="mt-1 text-muted-foreground">{svc.description}</p></div>
      <section aria-label="Measured"><p className="eyebrow mb-1.5">Measured (simulated telemetry)</p>
        <dl className="grid grid-cols-2 gap-2">{[['Error rate', fmtPct(m.errorRate)], ['p95 latency', fmtMs(m.p95)], ['p99 latency', fmtMs(m.p99)], ['Throughput', `${fmtRps(m.rps)} req/s`]].map(([k, v]) => <div key={k} className="rounded-lg bg-muted/50 p-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-semibold tabular">{v}</dd></div>)}</dl>
      </section>
      <section aria-label="Inferred"><p className="eyebrow mb-1.5">Inferred</p>
        {inferred.length ? <p className="rounded-lg border border-dashed border-warn/50 bg-warn-soft p-2.5 text-warn">Possible downstream impact from unhealthy dependencies: <b>{inferred.join(', ')}</b>. Derived from the call graph, not from this service’s own metrics.</p> : <p className="text-muted-foreground">No unhealthy dependencies detected.</p>}
      </section>
      <section><p className="eyebrow mb-1.5">Dependencies</p><p className="text-muted-foreground">Calls: {svc.dependsOn.length ? svc.dependsOn.join(', ') : '—'}</p><p className="text-muted-foreground">Called by: {svc.dependents.length ? svc.dependents.join(', ') : '—'}</p></section>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm"><Link to={`/services/${svc.id}`}>Service page</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to={`/traces?service=${svc.key}&status=error`}>Error traces</Link></Button>
        {svc.activeIncidentIds.map((id) => <Button key={id} asChild size="sm" variant="outline"><Link to={`/incidents/${id}`}><Siren /> Incident</Link></Button>)}
        <Button asChild size="sm" variant="ghost"><Link to={`/events?services=${svc.key}`}>Events</Link></Button>
      </div>
    </div>
  );
}

function Graph() {
  const env = useUi((s) => s.env);
  const animateEdges = useFlag('graph-edge-animation');
  const [params, setParams] = useSearchParams();
  const rf = useReactFlow();
  const mobile = !useMediaQuery('(min-width: 1024px)');
  const q = useQuery({ queryKey: ['graph', env], queryFn: () => get<GraphData>('/graph', { env }), refetchInterval: 15_000 });
  const incidents = useQuery({ queryKey: ['incidents', 'active-list'], queryFn: () => get<Paginated<IncidentDto>>('/incidents', { active: true, pageSize: 20, env }) });
  const [selected, setSelected] = useState<string | null>(params.get('focus'));
  const [search, setSearch] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues'>('all');
  const [incidentId, setIncidentId] = useState<string>('');

  const data = q.data;
  const positions = useMemo(() => data ? layeredLayout(data.nodes.map((n) => n.key), data.edges) : new Map(), [data?.nodes.length, data?.edges.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeList = useMemo(() => data?.edges ?? [], [data]);
  const upstream = useMemo(() => (selected ? reach(selected, edgeList, 'up') : new Set<string>()), [selected, edgeList]);
  const downstream = useMemo(() => (selected ? reach(selected, edgeList, 'down') : new Set<string>()), [selected, edgeList]);
  const incident = incidents.data?.items.find((i) => i.id === incidentId);
  const declared = useMemo(() => new Set(incident?.services.map((s) => s.key) ?? []), [incident]);
  // inferred impact from an incident = every transitive caller of a declared service
  const incidentInferred = useMemo(() => { const s = new Set<string>(); declared.forEach((k) => reach(k, edgeList, 'up').forEach((u) => s.add(u))); declared.forEach((k) => s.delete(k)); return s; }, [declared, edgeList]);

  const visible = useCallback((n: ServiceStatusDto) => {
    if (statusFilter === 'issues' && n.status === 'healthy' && !n.atRisk && !data?.inferredImpact[n.key]) return false;
    if (focusMode && selected) return n.key === selected || upstream.has(n.key) || downstream.has(n.key);
    return true;
  }, [statusFilter, focusMode, selected, upstream, downstream, data]);

  const nodes = useMemo<Node<NodeData>[]>(() => (data?.nodes ?? []).filter(visible).map((svc) => {
    const role: Role = selected === svc.key ? 'selected' : upstream.has(svc.key) ? 'upstream' : downstream.has(svc.key) ? 'downstream' : null;
    const hasHighlight = !!selected || !!incident;
    const match = !!search && `${svc.name} ${svc.key}`.toLowerCase().includes(search.toLowerCase());
    const incidentRelated = declared.has(svc.key) || incidentInferred.has(svc.key);
    const dim = (!!selected && !role) || (!selected && !!incident && !incidentRelated) || (!!search && !match && !hasHighlight);
    const inferred = [...new Set([...(data?.inferredImpact[svc.key] ?? []), ...(incident && incidentInferred.has(svc.key) ? [...declared] : [])])];
    return { id: svc.key, type: 'service', position: positions.get(svc.key) ?? { x: 0, y: 0 }, data: { svc, role, dim, inferred, declared: declared.has(svc.key), match }, selected: selected === svc.key };
  }), [data, visible, selected, upstream, downstream, search, incident, declared, incidentInferred, positions]);

  const shown = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo<Edge[]>(() => edgeList.filter((e) => shown.has(e.source) && shown.has(e.target)).map((e) => {
    const target = data!.nodes.find((n) => n.key === e.target)!;
    const onPath = !!selected && ((e.source === selected || upstream.has(e.source) || downstream.has(e.source)) && (e.target === selected || upstream.has(e.target) || downstream.has(e.target)));
    const inferredEdge = target.status !== 'healthy' && data!.nodes.find((n) => n.key === e.source)!.status === 'healthy';
    const color = onPath ? (upstream.has(e.source) || e.target === selected ? 'var(--info)' : 'var(--violet)') : target.status === 'unavailable' ? 'var(--crit)' : target.status === 'degraded' ? 'var(--warn)' : 'var(--border-strong)';
    return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', animated: animateEdges && (onPath || target.status !== 'healthy'), markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      style: { stroke: color, strokeWidth: onPath ? 2 : 1.25, strokeDasharray: inferredEdge ? '5 4' : undefined, opacity: selected && !onPath ? 0.12 : 1 } };
  }), [edgeList, shown, selected, upstream, downstream, data, animateEdges]);

  const select = useCallback((k: string | null) => { setSelected(k); setParams((p) => { const n = new URLSearchParams(p); k ? n.set('focus', k) : n.delete('focus'); return n; }, { replace: true }); }, [setParams]);
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 350 }), 60); return () => clearTimeout(t); }, [data?.nodes.length, focusMode, statusFilter, rf]);
  useEffect(() => { if (selected && !focusMode) rf.fitView({ nodes: [{ id: selected }, ...[...upstream, ...downstream].map((id) => ({ id }))], padding: 0.3, duration: 400 }); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const selSvc = selected ? data?.nodes.find((n) => n.key === selected) : undefined;
  const selInferred = selSvc ? data?.inferredImpact[selSvc.key] ?? [] : [];

  if (q.isLoading) return <Skeleton className="h-[70dvh] w-full" />;
  if (q.isError || !data) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-0 flex-1 basis-44"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a service…" className="h-9 pl-8" aria-label="Find service" /></div>
        <Select value={incidentId || 'none'} onValueChange={(v) => { setIncidentId(v === 'none' ? '' : v); setSelected(null); }}>
          <SelectTrigger className="w-[min(100%,230px)]" aria-label="Highlight incident"><SelectValue placeholder="Highlight incident" /></SelectTrigger>
          <SelectContent><SelectItem value="none">No incident highlight</SelectItem>{incidents.data?.items.map((i) => <SelectItem key={i.id} value={i.id}>INC-{i.number} · {i.title.slice(0, 34)}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant={statusFilter === 'issues' ? 'secondary' : 'outline'} aria-pressed={statusFilter === 'issues'} onClick={() => setStatusFilter(statusFilter === 'issues' ? 'all' : 'issues')}>Issues only</Button>
        <Button size="sm" variant={focusMode ? 'secondary' : 'outline'} aria-pressed={focusMode} disabled={!selected} onClick={() => setFocusMode(!focusMode)}>{focusMode ? <EyeOff /> : <Eye />} Focus</Button>
        <Button size="sm" variant="outline" onClick={() => rf.fitView({ padding: 0.15, duration: 350 })}><Maximize /> Fit</Button>
        {selected && <Button size="sm" variant="ghost" onClick={() => select(null)}><Crosshair /> Clear</Button>}
      </div>
      {incident && <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm"><SeverityBadge severity={incident.severity} className="mr-2" /><b>Measured:</b> {incident.services.map((s) => s.name).join(', ')} declared affected. <b className="ml-1 text-warn">Inferred:</b> {incidentInferred.size ? `${incidentInferred.size} caller service(s) may be impacted via the dependency graph (dashed).` : 'no further callers.'}</p>}

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="card relative h-[min(70dvh,680px)] min-h-[420px] overflow-hidden" data-testid="graph-canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={useUi.getState().theme} minZoom={0.2} maxZoom={1.6} fitView proOptions={{ hideAttribution: true }}
            nodesDraggable nodesConnectable={false} elementsSelectable panOnScroll={false} zoomOnPinch panOnDrag
            onNodeClick={(_, n) => select(n.id)} onPaneClick={() => select(null)}>
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--chart-grid)" />
            <Controls showInteractive={false} position="bottom-left" />
            {!mobile && <MiniMap pannable zoomable nodeColor={(n) => STATUS_BORDER[(n.data as NodeData).svc.status]} maskColor="rgb(0 0 0 / 0.5)" className="!bg-surface-1" style={{ width: 130, height: 84 }} />}
          </ReactFlow>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border bg-popover/90 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-ok/60" />measured</span>
            <span><span className="mr-1 inline-block h-2 w-3 rounded-sm border border-dashed border-warn" />inferred</span>
            <span><span className="mr-1 inline-block h-0.5 w-3 bg-info align-middle" />callers</span>
            <span><span className="mr-1 inline-block h-0.5 w-3 bg-violet align-middle" />dependencies</span>
          </div>
        </div>
        {!mobile && <aside className="card hidden max-h-[min(70dvh,680px)] overflow-y-auto lg:block" aria-label="Service details">{selSvc ? <Details svc={selSvc} inferred={selInferred} /> : <div className="p-6 text-sm text-muted-foreground"><p className="font-medium text-foreground">Select a service</p><p className="mt-1">Click a node to highlight its callers (blue) and dependencies (violet), see measured metrics, and jump to incidents and traces.</p></div>}</aside>}
      </div>
      {mobile && <Drawer open={!!selSvc} onOpenChange={(o) => !o && select(null)} title={selSvc?.name ?? 'Service'} description="Dependency details">{selSvc && <Details svc={selSvc} inferred={selInferred} />}</Drawer>}
    </div>
  );
}

export default function DependencyMap() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader title="Service Dependency Map" meta={<SimulatedTag />} description="Directed call graph (caller → callee). Node values are measured from telemetry; dashed outlines mark impact that is only inferred from dependencies." />
      <ReactFlowProvider><Graph /></ReactFlowProvider>
    </motion.div>
  );
}
