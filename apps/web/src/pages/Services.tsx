import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import type { ServiceStatusDto } from '@nexus/shared';
import { fmtMs, fmtPct, fmtRps } from '@/lib/format';
import { cn } from '@/lib/utils';
import { item, stagger } from '@/lib/motion';
import { useServices } from '@/lib/queries';
import { useLive } from '@/features/realtime/liveStore';
import { useUrlState } from '@/hooks/useUrlState';
import { EmptyState, ErrorState, PageHeader, SimulatedTag, StatusBadge, TableSkeleton } from '@/components/primitives';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KINDS = ['edge', 'service', 'database', 'cache', 'queue'];
const RANK = { unavailable: 0, degraded: 1, healthy: 2 } as const;

const Row = memo(function Row({ s }: { s: ServiceStatusDto }) {
  const live = useLive((st) => st.services[s.key]);
  const m = live ?? s;
  return (
    <TableRow>
      <TableCell><Link to={`/services/${s.id}`} className="font-medium hover:underline">{s.name}</Link><span className="block font-mono text-xs text-muted-foreground">{s.key}</span></TableCell>
      <TableCell><StatusBadge status={m.status} atRisk={s.atRisk && m.status === 'healthy'} /></TableCell>
      <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{s.kind}</TableCell>
      <TableCell className="hidden text-muted-foreground lg:table-cell">{s.team}</TableCell>
      <TableCell className="text-right tabular">{fmtRps(m.rps)}</TableCell>
      <TableCell className={cn('text-right tabular', m.errorRate >= 2 && 'text-crit')}>{fmtPct(m.errorRate)}</TableCell>
      <TableCell className="text-right tabular">{fmtMs(m.p95)}</TableCell>
      <TableCell className="hidden text-right tabular text-muted-foreground xl:table-cell">{s.dependsOn.length}↓ {s.dependents.length}↑</TableCell>
      <TableCell className="hidden text-right sm:table-cell">{s.activeIncidentIds.length ? <Link to={`/incidents?active=true&q=${encodeURIComponent(s.name)}`} className="rounded-full bg-crit-soft px-2 py-0.5 text-xs font-semibold text-crit">{s.activeIncidentIds.length} active</Link> : <span className="text-subtle">—</span>}</TableCell>
    </TableRow>
  );
});

export default function Services() {
  const q = useServices();
  const [f, set] = useUrlState({ q: '', kind: '', status: '', sort: 'status', dir: 'asc' });
  const [text, setText] = useState(f.q);
  const rows = useMemo(() => {
    let list = q.data?.items ?? [];
    if (f.q) list = list.filter((s) => `${s.name} ${s.key} ${s.team}`.toLowerCase().includes(f.q.toLowerCase()));
    if (f.kind) list = list.filter((s) => s.kind === f.kind);
    if (f.status) list = list.filter((s) => s.status === f.status);
    const dir = f.dir === 'asc' ? 1 : -1;
    const cmp: Record<string, (a: ServiceStatusDto, b: ServiceStatusDto) => number> = {
      status: (a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name), rps: (a, b) => a.rps - b.rps, errors: (a, b) => a.errorRate - b.errorRate, p95: (a, b) => a.p95 - b.p95,
    };
    return [...list].sort((a, b) => dir * (cmp[f.sort] ?? cmp.status!)(a, b));
  }, [q.data, f]);
  const head = (key: string, label: string, cls = '') => (
    <TableHead className={cls}><button className="inline-flex items-center gap-1" onClick={() => set(f.sort === key ? { dir: f.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' })}>{label}{f.sort === key && (f.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button></TableHead>
  );
  const counts = useMemo(() => ({ healthy: 0, degraded: 0, unavailable: 0, ...Object.fromEntries(['healthy', 'degraded', 'unavailable'].map((st) => [st, (q.data?.items ?? []).filter((s) => s.status === st).length])) }), [q.data]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Services" meta={<SimulatedTag />} description="Every service in this environment with live health. Select a service for charts, dependencies, deployments and configuration." /></motion.div>
      <motion.div variants={item} className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" /><Input value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value }); }} placeholder="Filter by name, key or team…" className="pl-8" aria-label="Filter services" /></div>
          <div className="flex flex-wrap gap-1.5">
            {(['healthy', 'degraded', 'unavailable'] as const).map((st) => (
              <button key={st} aria-pressed={f.status === st} onClick={() => set({ status: f.status === st ? '' : st })} className={cn('h-8 rounded-full border px-3 text-xs capitalize', f.status === st ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/40')}>{st} <b className="tabular ml-1">{counts[st]}</b></button>
            ))}
            <select aria-label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value })} className="h-8 rounded-full border border-border bg-transparent px-3 text-xs capitalize text-muted-foreground"><option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </div>
        </div>
        {q.isLoading ? <TableSkeleton rows={8} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState title="No services match" description="Adjust your filters." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>{head('name', 'Service')}{head('status', 'Status')}<TableHead className="hidden md:table-cell">Kind</TableHead><TableHead className="hidden lg:table-cell">Team</TableHead>{head('rps', 'Req/s', 'text-right')}{head('errors', 'Errors', 'text-right')}{head('p95', 'p95', 'text-right')}<TableHead className="hidden text-right xl:table-cell">Deps</TableHead><TableHead className="hidden text-right sm:table-cell">Incidents</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((s) => <Row key={s.id} s={s} />)}</TableBody>
            </Table>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
