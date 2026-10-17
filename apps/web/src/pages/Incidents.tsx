import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { INCIDENT_STATUSES, SEVERITIES, type IncidentDto, type Paginated } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtDuration, timeAgo, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { item, stagger } from '@/lib/motion';
import { useUi } from '@/stores/ui';
import { useDebounced } from '@/hooks/useDebounced';
import { useUrlState } from '@/hooks/useUrlState';
import { Can } from '@/features/auth/auth';
import { EmptyState, ErrorState, IncidentStatusBadge, PageHeader, SeverityBadge, TableSkeleton } from '@/components/primitives';
import { Pagination } from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 15;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn('h-7 rounded-full border px-2.5 text-xs font-medium capitalize transition-colors', on ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/40')}>{children}</button>
  );
}

const toggleCsv = (csv: string, v: string) => { const s = new Set(csv ? csv.split(',') : []); s.has(v) ? s.delete(v) : s.add(v); return [...s].join(','); };

export default function Incidents() {
  const [f, set] = useUrlState({ q: '', status: '', severity: '', owner: '', sort: 'created', dir: 'desc', page: '1', active: '' });
  const env = useUi((s) => s.env);
  const navigate = useNavigate();
  const [text, setText] = useState(f.q);
  const debounced = useDebounced(text, 250);
  useEffect(() => { if (debounced !== f.q) set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = Number(f.page);

  const q = useQuery({
    queryKey: ['incidents', 'list', env, f],
    queryFn: () => get<Paginated<IncidentDto>>('/incidents', { env, q: f.q, status: f.status, severity: f.severity, owner: f.owner, sort: f.sort, dir: f.dir, page, pageSize: PAGE_SIZE, active: f.active || undefined }),
    placeholderData: (prev) => prev,
    refetchInterval: 20_000,
  });
  const sortBy = (col: string) => set(f.sort === col ? { dir: f.dir === 'asc' ? 'desc' : 'asc' } : { sort: col, dir: 'desc' });
  const SortIcon = ({ col }: { col: string }) => f.sort === col ? (f.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null;
  const hasFilters = !!(f.q || f.status || f.severity || f.owner || f.active);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}>
        <PageHeader title="Incidents" description="Track, coordinate and resolve incidents. Filters and sorting are saved in the URL." actions={<Can permission="incident:create"><Button onClick={() => useUi.getState().setCreateIncidentOpen(true)}><Plus /> Create incident</Button></Can>} />
      </motion.div>
      <motion.div variants={item} className="card">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by title or INC-number…" className="pl-8" aria-label="Search incidents" />
            </div>
            <Select value={f.owner || 'any'} onValueChange={(v) => set({ owner: v === 'any' ? '' : v })}>
              <SelectTrigger className="w-[150px]" aria-label="Owner"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="any">Any owner</SelectItem><SelectItem value="me">Owned by me</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem></SelectContent>
            </Select>
            <Select value={`${f.sort}:${f.dir}`} onValueChange={(v) => { const [sort, dir] = v.split(':'); set({ sort, dir }); }}>
              <SelectTrigger className="w-[170px]" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="created:desc">Newest first</SelectItem><SelectItem value="created:asc">Oldest first</SelectItem><SelectItem value="severity:asc">Severity (high → low)</SelectItem><SelectItem value="updated:desc">Recently updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip on={f.active === 'true'} onClick={() => set({ active: f.active === 'true' ? '' : 'true' })}>Active only</Chip>
            <span className="mx-1 h-4 w-px bg-border" />
            {SEVERITIES.map((s) => <Chip key={s} on={f.severity.split(',').includes(s)} onClick={() => set({ severity: toggleCsv(f.severity, s) })}>{s}</Chip>)}
            <span className="mx-1 h-4 w-px bg-border" />
            {INCIDENT_STATUSES.map((s) => <Chip key={s} on={f.status.split(',').includes(s)} onClick={() => set({ status: toggleCsv(f.status, s) })}>{s}</Chip>)}
            {hasFilters && <Button size="xs" variant="ghost" onClick={() => { setText(''); set({ q: '', status: '', severity: '', owner: '', active: '' }); }}>Clear all</Button>}
          </div>
        </div>

        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? (
          <EmptyState title={hasFilters ? 'No incidents match these filters' : 'No incidents yet'} description={hasFilters ? 'Try removing a filter.' : 'When something breaks, it will show up here.'} />
        ) : (
          <>
            {/* md+: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-24"><button className="inline-flex items-center gap-1" onClick={() => sortBy('severity')}>Severity <SortIcon col="severity" /></button></TableHead>
                  <TableHead>Incident</TableHead><TableHead>Status</TableHead><TableHead>Services</TableHead><TableHead>Owner</TableHead>
                  <TableHead className="text-right"><button className="inline-flex items-center gap-1" onClick={() => sortBy('created')}>Opened <SortIcon col="created" /></button></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {q.data!.items.map((i) => (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(`/incidents/${i.id}`)}>
                      <TableCell><SeverityBadge severity={i.severity} /></TableCell>
                      <TableCell className="max-w-md"><Link to={`/incidents/${i.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{i.title}</Link><span className="font-mono text-xs text-muted-foreground">INC-{i.number}</span>{i.commentCount ? <span className="ml-2 text-xs text-subtle">{i.commentCount} {i.commentCount === 1 ? 'comment' : 'comments'}</span> : null}</TableCell>
                      <TableCell><IncidentStatusBadge status={i.status} /></TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">{i.services.map((s) => s.name).join(', ')}</TableCell>
                      <TableCell>{i.owner ? <span className="flex items-center gap-2"><Avatar className="size-6"><AvatarFallback className="bg-accent text-[10px] text-accent-foreground">{initials(i.owner.name)}</AvatarFallback></Avatar><span className="hidden lg:inline">{i.owner.name}</span></span> : <span className="text-subtle">Unassigned</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground" title={new Date(i.createdAt).toLocaleString()}>{timeAgo(i.createdAt)}{i.resolvedAt && <span className="block text-xs text-subtle">{fmtDuration(new Date(i.resolvedAt).getTime() - new Date(i.createdAt).getTime())} to resolve</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* mobile: cards */}
            <ul className="divide-y divide-border md:hidden">
              {q.data!.items.map((i) => (
                <li key={i.id}>
                  <Link to={`/incidents/${i.id}`} className="block space-y-1.5 p-3.5 active:bg-accent/40">
                    <div className="flex items-center gap-2"><SeverityBadge severity={i.severity} /><IncidentStatusBadge status={i.status} /><span className="ml-auto font-mono text-xs text-muted-foreground">INC-{i.number}</span></div>
                    <p className="text-sm font-medium leading-snug">{i.title}</p>
                    <p className="text-xs text-muted-foreground">{i.services.map((s) => s.name).join(', ')}</p>
                    <p className="text-xs text-subtle">{i.owner?.name ?? 'Unassigned'} · {timeAgo(i.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data!.total} onPage={(p) => set({ page: String(p) }, { keepPage: true })} />
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
