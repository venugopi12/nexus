import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ChevronRight, Search, ShieldAlert } from 'lucide-react';
import type { AuditDto, Paginated } from '@nexus/shared';
import { get, ApiError } from '@/lib/api';
import { fmtFullTime, initials } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useDebounced } from '@/hooks/useDebounced';
import { useUrlState } from '@/hooks/useUrlState';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/primitives';
import { Pagination } from '@/components/Pagination';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE = 25;
const GROUPS = ['', 'incident.', 'alert', 'auth.', 'member.', 'flag.', 'service.', 'settings.'];

export default function Audit() {
  const [f, set] = useUrlState({ q: '', action: '', page: '1' });
  const [text, setText] = useState(f.q);
  const dq = useDebounced(text, 250);
  useEffect(() => { if (dq !== f.q) set({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const page = Number(f.page);
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => get<Paginated<AuditDto>>('/audit', { q: f.q, action: f.action, page, pageSize: PAGE }), placeholderData: (p) => p, retry: false });
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Audit Logs" description="Immutable record of sensitive operations in this organization: sign-ins, incident changes, role changes, flag changes and more." /></motion.div>
      <motion.div variants={item} className="card">
        {forbidden ? <EmptyState icon={<ShieldAlert className="size-5" />} title="You don’t have access to audit logs" description="Audit logs require the SRE or Admin role." /> : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" /><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search action or resource…" className="pl-8" aria-label="Search audit logs" /></div>
              <div className="flex flex-wrap gap-1.5">{GROUPS.map((g) => <button key={g} aria-pressed={f.action === g} onClick={() => set({ action: g })} className={cn('h-8 rounded-full border px-3 text-xs', f.action === g ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/40')}>{g ? g.replace('.', '') : 'All'}</button>)}</div>
            </div>
            {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? <EmptyState title="No audit entries" /> : (
              <>
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead className="w-8" /><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead className="hidden md:table-cell">Resource</TableHead></TableRow></TableHeader>
                  <TableBody>{q.data!.items.map((a) => (
                    <Fragment key={a.id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                        <TableCell><ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open === a.id && 'rotate-90')} /></TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtFullTime(a.at)}</TableCell>
                        <TableCell>{a.actor ? <span className="flex items-center gap-2"><Avatar className="size-6"><AvatarFallback className="text-[10px]">{initials(a.actor.name)}</AvatarFallback></Avatar>{a.actor.name}</span> : <span className="text-subtle">System</span>}</TableCell>
                        <TableCell><span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{a.action}</span></TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{a.resource}{a.resourceId && <span className="ml-1 font-mono text-xs text-subtle">{a.resourceId.slice(0, 8)}</span>}</TableCell>
                      </TableRow>
                      {open === a.id && <TableRow><TableCell /><TableCell colSpan={4}><pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">{JSON.stringify({ resourceId: a.resourceId, ...a.metadata }, null, 2)}</pre></TableCell></TableRow>}
                    </Fragment>
                  ))}</TableBody>
                </Table></div>
                <Pagination page={page} pageSize={PAGE} total={q.data!.total} onPage={(p) => set({ page: String(p) }, { keepPage: true })} />
              </>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
