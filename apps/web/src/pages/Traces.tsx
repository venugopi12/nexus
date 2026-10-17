import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Search } from 'lucide-react';
import type { Paginated, TraceSummary } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtMs, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { item, stagger } from '@/lib/motion';
import { useServiceIndex } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { useDebounced } from '@/hooks/useDebounced';
import { useUrlState } from '@/hooks/useUrlState';
import { EmptyState, ErrorState, PageHeader, SimulatedTag, TableSkeleton } from '@/components/primitives';
import { Pagination } from '@/components/Pagination';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE = 20;

export default function Traces() {
  const env = useUi((s) => s.env);
  const navigate = useNavigate();
  const { list: services, byKey } = useServiceIndex();
  const [f, set] = useUrlState({ q: '', service: '', status: '', min: '', max: '', sort: 'recent', page: '1' });
  const [text, setText] = useState(f.q);
  const debounced = useDebounced(text, 250);
  useEffect(() => { if (debounced !== f.q) set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = Number(f.page);
  const q = useQuery({
    queryKey: ['traces', env, f],
    queryFn: () => get<Paginated<TraceSummary> & { simulated: true }>('/traces', { env, q: f.q, service: f.service, status: f.status, minDuration: f.min, maxDuration: f.max, sort: f.sort === 'duration' ? 'duration' : undefined, page, pageSize: PAGE }),
    placeholderData: (p) => p,
  });
  const maxDur = Math.max(1, ...(q.data?.items.map((t) => t.durationMs) ?? [1]));

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Distributed Traces" meta={<SimulatedTag />} description="Search sampled traces by ID, service, duration or status, then open a waterfall to inspect span timing." /></motion.div>
      <motion.div variants={item} className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" /><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Trace ID (hex prefix)…" className="pl-8 font-mono" aria-label="Trace ID" /></div>
          <Select value={f.service || 'any'} onValueChange={(v) => set({ service: v === 'any' ? '' : v })}><SelectTrigger className="w-[180px]" aria-label="Service"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any service</SelectItem>{services.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent></Select>
          <Select value={f.status || 'any'} onValueChange={(v) => set({ status: v === 'any' ? '' : v })}><SelectTrigger className="w-[120px]" aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any status</SelectItem><SelectItem value="ok">OK</SelectItem><SelectItem value="error">Error</SelectItem></SelectContent></Select>
          <Input type="number" inputMode="numeric" min={0} placeholder="Min ms" value={f.min} onChange={(e) => set({ min: e.target.value })} className="w-24" aria-label="Minimum duration (ms)" />
          <Input type="number" inputMode="numeric" min={0} placeholder="Max ms" value={f.max} onChange={(e) => set({ max: e.target.value })} className="w-24" aria-label="Maximum duration (ms)" />
          <Select value={f.sort} onValueChange={(v) => set({ sort: v })}><SelectTrigger className="w-[130px]" aria-label="Sort"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Most recent</SelectItem><SelectItem value="duration">Slowest</SelectItem></SelectContent></Select>
        </div>
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? <EmptyState title="No traces match" description="Loosen the filters or widen the duration range." /> : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Trace</TableHead><TableHead className="hidden sm:table-cell">Root service</TableHead><TableHead className="text-right">Spans</TableHead><TableHead className="w-48">Duration</TableHead><TableHead className="hidden md:table-cell">Status</TableHead><TableHead className="hidden text-right lg:table-cell">Started</TableHead></TableRow></TableHeader>
                <TableBody>{q.data!.items.map((t) => (
                  <TableRow key={t.traceId} className="cursor-pointer" onClick={() => navigate(`/traces/${t.traceId}`)}>
                    <TableCell><Link to={`/traces/${t.traceId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs hover:underline">{t.traceId.slice(0, 16)}…</Link><span className="block text-sm">{t.rootOperation}</span></TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{byKey.get(t.rootService)?.name ?? t.rootService}</TableCell>
                    <TableCell className="text-right tabular">{t.spanCount}{t.errorCount > 0 && <span className="ml-1 text-crit">({t.errorCount} err)</span>}</TableCell>
                    <TableCell><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', t.status === 'error' ? 'bg-crit' : 'bg-primary')} style={{ width: `${Math.max(2, (t.durationMs / maxDur) * 100)}%` }} /></div><span className="w-16 text-right text-xs tabular">{fmtMs(t.durationMs)}</span></div></TableCell>
                    <TableCell className="hidden md:table-cell"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', t.status === 'error' ? 'bg-crit-soft text-crit' : 'bg-ok-soft text-ok')}>{t.status === 'error' ? 'Error' : 'OK'}</span></TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground lg:table-cell">{fmtDateTime(t.startMs)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={q.data!.total} onPage={(p) => set({ page: String(p) }, { keepPage: true })} />
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
