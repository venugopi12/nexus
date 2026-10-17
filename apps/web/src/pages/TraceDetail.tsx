import { memo, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'motion/react';
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import type { IncidentDto, Paginated, TraceDetail as TraceDetailDto } from '@nexus/shared';
import { get, post } from '@/lib/api';
import { fmtMs, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { seriesColor } from '@/lib/chartTheme';
import { useServiceIndex } from '@/lib/queries';
import { useCrumb } from '@/stores/crumb';
import { useRecents } from '@/stores/ui';
import { toast } from '@/stores/toasts';
import { Can } from '@/features/auth/auth';
import { buildSpanRows, type SpanRow } from '@/features/traces/spanTree';
import { Drawer } from '@/components/Overlay';
import { ErrorState, Panel, SeverityBadge, SimulatedTag } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect } from 'react';

const ROW_H = 30;

const Row = memo(function Row({ r, total, color, name, selected, collapsed, onSelect, onToggle, style }: {
  r: SpanRow; total: number; color: string; name: string; selected: boolean; collapsed: boolean; onSelect: (id: string) => void; onToggle: (id: string) => void; style: React.CSSProperties;
}) {
  const left = (r.startOffsetMs / total) * 100;
  const width = Math.max(0.4, (r.durationMs / total) * 100);
  return (
    <div style={style} role="row" aria-selected={selected} onClick={() => onSelect(r.spanId)} className={cn('absolute inset-x-0 flex cursor-pointer items-center border-b border-border/40 text-xs hover:bg-accent/30', selected && 'bg-accent/50')}>
      <div className="flex w-[42%] min-w-0 items-center gap-1 pr-2 sm:w-[34%]" style={{ paddingLeft: 8 + r.depth * 14 }}>
        {r.hasChildren ? <button aria-label={collapsed ? 'Expand' : 'Collapse'} className="grid size-4 place-items-center text-muted-foreground" onClick={(e) => { e.stopPropagation(); onToggle(r.spanId); }}>{collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</button> : <span className="size-4" />}
        <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="truncate font-medium">{name}</span>
        <span className="hidden truncate text-subtle md:inline">{r.operation.split('.').slice(1).join('.') || r.operation}</span>
      </div>
      <div className="relative h-full flex-1">
        <div className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-sm', r.status === 'error' && 'ring-1 ring-crit')} style={{ left: `${left}%`, width: `${width}%`, background: r.status === 'error' ? 'var(--crit)' : color, opacity: r.status === 'error' ? 0.9 : 0.75 }} />
        <span className="absolute top-1/2 -translate-y-1/2 pl-1 font-mono text-[10px] text-muted-foreground" style={{ left: `${Math.min(left + width, 88)}%` }}>{fmtMs(r.durationMs)}</span>
      </div>
    </div>
  );
});

export default function TraceDetail() {
  const { traceId = '' } = useParams();
  const { byKey } = useServiceIndex();
  const q = useQuery({ queryKey: ['trace', traceId], queryFn: () => get<TraceDetailDto & { simulated: true }>(`/traces/${traceId}`) });
  const t = q.data;
  useCrumb(t ? `${t.traceId.slice(0, 10)}…` : null);
  useEffect(() => { if (t) useRecents.getState().addResource({ id: t.traceId, kind: 'trace', label: `${t.rootOperation} ${t.traceId.slice(0, 8)}`, href: `/traces/${t.traceId}` }); }, [t?.traceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const tree = useMemo(() => buildSpanRows(t?.spans ?? [], collapsed), [t, collapsed]);
  const colorOf = useMemo(() => { const keys = [...new Set((t?.spans ?? []).map((s) => s.serviceKey))]; return (k: string) => seriesColor(keys.indexOf(k)); }, [t]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: tree.rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const incidents = useQuery({ enabled: !!t && t.incidentIds.length > 0, queryKey: ['trace-incidents', traceId], queryFn: async () => (await Promise.all(t!.incidentIds.map((id) => get<IncidentDto>(`/incidents/${id}`)))) });
  const sel = selected ? tree.all.find((r) => r.spanId === selected) : null;
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const link = useMutation({ mutationFn: (incidentId: string) => post(`/incidents/${incidentId}/links`, { kind: 'trace', refId: traceId }), onSuccess: () => toast.success('Trace linked to incident'), onError: (e) => toast.error('Could not link', (e as Error).message) });
  const active = useQuery({ queryKey: ['incidents', 'active-list'], queryFn: () => get<Paginated<IncidentDto>>('/incidents', { active: true, pageSize: 20 }) });

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-96" /></div>;
  if (q.isError || !t) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const slowest = [...tree.all].sort((a, b) => b.selfMs - a.selfMs)[0];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-semibold tracking-tight">{t.rootOperation}</h1><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', t.status === 'error' ? 'bg-crit-soft text-crit' : 'bg-ok-soft text-ok')}>{t.status === 'error' ? `Error · ${t.errorCount} spans` : 'OK'}</span><SimulatedTag /></div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{t.traceId}</p>
        </div>
        <Can permission="incident:update">
          {active.data && active.data.items.length > 0 && (
            <select aria-label="Link trace to incident" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value="" onChange={(e) => e.target.value && link.mutate(e.target.value)}>
              <option value="">Link to incident…</option>{active.data.items.map((i) => <option key={i.id} value={i.id}>INC-{i.number} · {i.title.slice(0, 40)}</option>)}
            </select>
          )}
        </Can>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Duration', fmtMs(t.durationMs)], ['Spans', String(t.spanCount)], ['Services', String(t.services.length)], ['Started', fmtDateTime(t.startMs)]].map(([k, v]) => <div key={k} className="card p-3.5"><p className="eyebrow">{k}</p><p className="mt-1 text-lg font-semibold tabular">{v}</p></div>)}
      </div>
      {tree.violations.length > 0 && <p role="alert" className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Timing anomaly: {tree.violations.length} span(s) fall outside their parent.</p>}

      <Panel title="Waterfall" subtitle={`${tree.rows.length} of ${tree.all.length} spans visible · click a span for details${slowest ? ` · highest self-time: ${slowest.serviceKey} (${fmtMs(slowest.selfMs)})` : ''}`} bodyClassName="px-0 pb-0">
        <div role="table" aria-label="Span waterfall">
          <div className="flex border-b border-border text-[10px] text-subtle" role="row"><div className="w-[42%] px-3 py-1.5 sm:w-[34%]">Service</div><div className="relative h-6 flex-1">{ticks.map((k) => <span key={k} className="absolute top-1.5 -translate-x-1/2 font-mono first:translate-x-0 last:-translate-x-full" style={{ left: `${k * 100}%` }}>{fmtMs(tree.totalMs * k)}</span>)}</div></div>
          <div ref={parentRef} className="max-h-[560px] overflow-y-auto" style={{ contain: 'strict', height: Math.min(560, tree.rows.length * ROW_H + 2) }}>
            <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
              {virt.getVirtualItems().map((v) => {
                const r = tree.rows[v.index]!;
                return <Row key={r.spanId} r={r} total={tree.totalMs || 1} color={colorOf(r.serviceKey)} name={byKey.get(r.serviceKey)?.name ?? r.serviceKey} selected={selected === r.spanId} collapsed={collapsed.has(r.spanId)} onSelect={setSelected} onToggle={toggle} style={{ height: ROW_H, transform: `translateY(${v.start}px)` }} />;
              })}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Services in this trace"><ul className="space-y-1.5">{t.services.map((k) => { const s = byKey.get(k); return <li key={k} className="flex items-center gap-2 text-sm"><span className="size-2.5 rounded-sm" style={{ background: colorOf(k) }} />{s ? <Link to={`/services/${s.id}`} className="hover:underline">{s.name}</Link> : k}<span className="ml-auto font-mono text-xs text-muted-foreground">{tree.all.filter((r) => r.serviceKey === k).length} spans</span></li>; })}</ul></Panel>
        <Panel title="Related incidents" subtitle="Linked, or overlapping in time on these services">
          {t.incidentIds.length === 0 ? <p className="text-sm text-muted-foreground">No related incidents.</p> : incidents.isLoading ? <Skeleton className="h-16" /> : <ul className="space-y-2">{incidents.data?.map((i) => <li key={i.id}><Link to={`/incidents/${i.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"><SeverityBadge severity={i.severity} /><span className="truncate">INC-{i.number} · {i.title}</span></Link></li>)}</ul>}
        </Panel>
      </div>

      <Drawer open={!!sel} onOpenChange={(o) => !o && setSelected(null)} title="Span details" description={sel ? `${byKey.get(sel.serviceKey)?.name ?? sel.serviceKey}` : undefined}>
        {sel && (
          <div className="space-y-4 p-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              {[['Operation', sel.operation], ['Status', sel.status], ['Start offset', fmtMs(sel.startOffsetMs)], ['Duration', fmtMs(sel.durationMs)], ['Self time', fmtMs(sel.selfMs)], ['% of trace', `${((sel.durationMs / (tree.totalMs || 1)) * 100).toFixed(1)}%`]].map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className={cn('mt-0.5 break-words', k === 'Status' && sel.status === 'error' && 'font-medium text-crit')}>{v}</dd></div>)}
            </dl>
            <div><p className="eyebrow mb-1.5">Attributes</p><dl className="space-y-1 rounded-lg bg-muted/50 p-3 font-mono text-xs">{Object.entries(sel.attributes).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}</dl></div>
            <div className="flex flex-wrap gap-2">
              {byKey.get(sel.serviceKey) && <Button asChild size="sm" variant="outline"><Link to={`/services/${byKey.get(sel.serviceKey)!.id}`}>Go to service</Link></Button>}
              {byKey.get(sel.serviceKey)?.activeIncidentIds[0] && <Button asChild size="sm" variant="outline"><Link to={`/incidents/${byKey.get(sel.serviceKey)!.activeIncidentIds[0]}`}><Link2 /> Active incident</Link></Button>}
            </div>
          </div>
        )}
      </Drawer>
    </motion.div>
  );
}
