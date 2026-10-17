import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, AlertTriangle, CheckCircle2, GitBranch, MessageSquare, Pencil, RotateCcw, Rocket, Send, UserPlus, Link2, Siren } from 'lucide-react';
import {
  INCIDENT_TRANSITIONS, SEVERITIES, minutesBetween, type DeploymentDto, type EventDto, type IncidentDetailDto, type IncidentStatus, type MetricSeries, type Paginated, type Severity, type TimelineEntry,
} from '@nexus/shared';
import { ApiError, get, patch, post } from '@/lib/api';
import { fmtDuration, fmtMs, fmtPct, fmtTime, timeAgo, initials, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listItem } from '@/lib/motion';
import { toast } from '@/stores/toasts';
import { useCrumb } from '@/stores/crumb';
import { useRecents } from '@/stores/ui';
import { useServiceIndex, useTeam, useFlag } from '@/lib/queries';
import { Can, useAuth } from '@/features/auth/auth';
import { AiPanel } from '@/features/incidents/AiPanel';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { ChartSkeleton, EmptyState, ErrorState, IncidentStatusBadge, Panel, SeverityBadge, SimulatedTag, StatusDot } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const TRANSITION_LABEL: Record<IncidentStatus, string> = { triggered: 'Re-trigger', acknowledged: 'Acknowledge', investigating: 'Start investigating', mitigated: 'Mark mitigated', resolved: 'Resolve' };

const KIND_ICON: Record<TimelineEntry['kind'], React.ReactNode> = {
  created: <Siren className="size-3.5" />, status: <CheckCircle2 className="size-3.5" />, severity: <AlertTriangle className="size-3.5" />, owner: <UserPlus className="size-3.5" />,
  comment: <MessageSquare className="size-3.5" />, note: <Pencil className="size-3.5" />, link: <Link2 className="size-3.5" />, services: <Activity className="size-3.5" />, responders: <UserPlus className="size-3.5" />, alert: <AlertTriangle className="size-3.5" />,
};

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative ml-3 space-y-0 border-l border-border">
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.li key={e.id} layout="position" variants={listItem} initial="hidden" animate="show" exit="exit" className="relative pb-4 pl-6">
            <span className={cn('absolute -left-[13px] top-0 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground', e.kind === 'comment' && 'text-primary')}>{KIND_ICON[e.kind]}</span>
            {e.kind === 'comment' ? (
              <div className="rounded-lg border border-border bg-surface-2/60 p-3">
                <p className="text-xs text-muted-foreground"><b className="font-medium text-foreground">{e.actor?.name ?? 'System'}</b> · {timeAgo(e.at)} <span className="text-subtle">· {fmtDateTime(e.at)}</span></p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{e.body}</p>
              </div>
            ) : (
              <p className="pt-0.5 text-sm"><span className="text-foreground">{e.body}</span> <span className="text-xs text-muted-foreground">· {e.actor?.name ?? 'System'} · {fmtDateTime(e.at)}</span></p>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function CommentBox({ incidentId }: { incidentId: string }) {
  const qc = useQueryClient();
  const team = useTeam();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => post<IncidentDetailDto>(`/incidents/${incidentId}/comments`, { body, mentionIds: Object.values(mentions).filter((id) => body.includes(`@${[...Object.entries(mentions)].find(([, v]) => v === id)?.[0]}`)) }),
    onSuccess: (data) => { qc.setQueryData(['incident', incidentId], data); setBody(''); setMentions({}); },
    onError: (e) => toast.error('Comment failed', (e as Error).message),
  });
  const tail = /@([\w.]*)$/.exec(body);
  const suggestions = tail ? (team.data?.items ?? []).filter((u) => u.name.toLowerCase().replace(/\s+/g, '').includes(tail[1]!.toLowerCase())).slice(0, 5) : [];
  return (
    <div className="relative">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment… use @ to mention a teammate" rows={3} aria-label="Comment"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) m.mutate(); }} />
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mention suggestions" className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-border-strong bg-popover shadow-pop">
          {suggestions.map((u) => (
            <li key={u.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => { const handle = u.name.replace(/\s+/g, ''); setBody(body.replace(/@[\w.]*$/, `@${handle} `)); setMentions({ ...mentions, [handle]: u.id }); }}>
              <Avatar className="size-5"><AvatarFallback className="text-[9px]">{initials(u.name)}</AvatarFallback></Avatar>{u.name}<span className="ml-auto text-xs text-muted-foreground">{u.role}</span></button></li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between"><span className="text-xs text-subtle">⌘/Ctrl + Enter to send</span><Button size="sm" disabled={!body.trim() || m.isPending} onClick={() => m.mutate()}><Send /> Comment</Button></div>
    </div>
  );
}

export default function IncidentDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const team = useTeam();
  const { list: services } = useServiceIndex();
  const aiOn = useFlag('ai-assistant');
  const [notes, setNotes] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['incident', id], queryFn: () => get<IncidentDetailDto>(`/incidents/${id}`), refetchInterval: 20_000 });
  const inc = q.data;
  useCrumb(inc ? `INC-${inc.number}` : null);
  useEffect(() => { if (inc) useRecents.getState().addResource({ id: inc.id, kind: 'incident', label: `INC-${inc.number} ${inc.title}`, href: `/incidents/${inc.id}` }); }, [inc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Optimistic update with rollback: apply locally, send, restore the snapshot on failure. */
  const update = useMutation({
    mutationFn: (patchBody: Record<string, unknown>) => patch<IncidentDetailDto>(`/incidents/${id}`, { ...patchBody, expectedVersion: inc?.version }),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['incident', id] });
      const prev = qc.getQueryData<IncidentDetailDto>(['incident', id]);
      if (prev) {
        const owner = p.ownerId !== undefined ? (team.data?.items.find((u) => u.id === p.ownerId) ?? null) : prev.owner;
        qc.setQueryData<IncidentDetailDto>(['incident', id], { ...prev, ...(p.status ? { status: p.status as IncidentStatus } : {}), ...(p.severity ? { severity: p.severity as Severity } : {}), owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['incident', id], ctx.prev);
      if (e instanceof ApiError && e.status === 409) { toast.warning('Someone else just changed this incident', 'Your change was not applied — reloaded the latest.'); void qc.invalidateQueries({ queryKey: ['incident', id] }); }
      else toast.error('Update failed — change reverted', (e as Error).message);
    },
    onSuccess: (data) => { qc.setQueryData(['incident', id], data); void qc.invalidateQueries({ queryKey: ['incidents'] }); void qc.invalidateQueries({ queryKey: ['overview'] }); },
  });

  const window = useMemo(() => {
    if (!inc) return null;
    const from = new Date(inc.createdAt).getTime() - 30 * 60_000;
    const end = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now();
    return { from, to: end + Math.max(10 * 60_000, (end - from) * 0.15), start: new Date(inc.createdAt).getTime(), end };
  }, [inc?.createdAt, inc?.resolvedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = inc?.services.slice(0, 3).map((s) => s.key).join(',') ?? '';
  const errM = useQuery({ enabled: !!inc && !!window, queryKey: ['incident-metrics', id, 'err', keys], queryFn: () => get<{ series: MetricSeries[] }>('/metrics/query', { metric: 'error_rate', services: keys, env: inc!.environment, from: window!.from, to: Math.min(window!.to, Date.now()), agg: 'avg' }) });
  const latM = useQuery({ enabled: !!inc && !!window, queryKey: ['incident-metrics', id, 'lat', keys], queryFn: () => get<{ series: MetricSeries[] }>('/metrics/query', { metric: 'latency_ms', services: keys, env: inc!.environment, from: window!.from, to: Math.min(window!.to, Date.now()), agg: 'p95' }) });
  const evQ = useQuery({ enabled: !!inc && !!window, queryKey: ['incident-events', id, keys], queryFn: () => get<{ items: EventDto[]; total: number }>('/events', { env: inc!.environment, from: window!.from, to: Math.min(window!.to, Date.now()), services: keys, severities: 'error,critical', limit: 12, total: true }) });
  const depQ = useQuery({ enabled: !!inc, queryKey: ['incident-deploys', id], queryFn: () => get<Paginated<DeploymentDto>>('/deployments', { env: inc!.environment, pageSize: 60 }) });

  const link = useMutation({
    mutationFn: (b: { kind: 'event' | 'trace' | 'deployment'; refId: string }) => post<IncidentDetailDto>(`/incidents/${id}/links`, b),
    onSuccess: (d) => { qc.setQueryData(['incident', id], d); toast.success('Linked to incident'); },
    onError: (e) => toast.error('Could not link', (e as Error).message),
  });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" /></div>;
  if (q.isError || !inc) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;

  const allowed = INCIDENT_TRANSITIONS[inc.status];
  const canUpdate = can('incident:update');
  const relatedDeploys = (depQ.data?.items ?? []).filter((d) => inc.services.some((s) => s.id === d.serviceId) && new Date(d.deployedAt).getTime() > window!.from - 60 * 60_000 && new Date(d.deployedAt).getTime() < window!.end);
  const tta = inc.acknowledgedAt ? minutesBetween(inc.createdAt, inc.acknowledgedAt) * 60_000 : null;
  const ttr = inc.resolvedAt ? minutesBetween(inc.createdAt, inc.resolvedAt) * 60_000 : null;
  const windows = window ? [{ from: window.start, to: window.end, tone: 'incident' as const }] : [];
  const notesValue = notes ?? inc.notes;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={inc.severity} /><IncidentStatusBadge status={inc.status} /><span className="font-mono text-xs text-muted-foreground">INC-{inc.number}</span><span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{inc.environment}</span></div>
          <h1 className="mt-1.5 text-xl font-semibold leading-snug tracking-tight">{inc.title}</h1>
          {inc.summary && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{inc.summary}</p>}
        </div>
        <Can permission="incident:update">
          <div className="flex flex-wrap items-center gap-2">
            {allowed.map((to) => {
              const blocked = to === 'resolved' && !can('incident:resolve');
              const reopen = inc.status === 'resolved' && to === 'investigating';
              const btn = (
                <Button key={to} size="sm" variant={to === 'resolved' ? 'default' : 'outline'} disabled={update.isPending || blocked} onClick={() => update.mutate({ status: to })}>
                  {reopen ? <RotateCcw /> : to === 'resolved' ? <CheckCircle2 /> : null}{reopen ? 'Reopen' : TRANSITION_LABEL[to]}
                </Button>
              );
              return blocked ? <Tooltip key={to}><TooltipTrigger asChild><span>{btn}</span></TooltipTrigger><TooltipContent>Requires the SRE or Admin role</TooltipContent></Tooltip> : btn;
            })}
          </div>
        </Can>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Tabs defaultValue="timeline">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="timeline">Timeline</TabsTrigger><TabsTrigger value="telemetry">Telemetry</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="evidence">Evidence ({inc.links.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-3">
              <Panel title="Activity & audit trail" subtitle="Every status, owner and severity change is recorded">
                <div className="space-y-5">
                  <Timeline entries={inc.timeline} />
                  <Can permission="incident:comment"><CommentBox incidentId={inc.id} /></Can>
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="telemetry" className="mt-3 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="Error rate" subtitle="Affected services · shaded = incident window" actions={<SimulatedTag />}>
                  {errM.isLoading ? <ChartSkeleton height={190} /> : errM.isError ? <ErrorState compact error={errM.error} /> : <TimeSeriesChart ariaLabel="Error rate during incident" height={190} series={errM.data!.series.map((s) => ({ name: s.serviceName, points: s.points }))} format={(v) => fmtPct(v)} windows={windows} from={window!.from} to={Math.min(window!.to, Date.now())} />}
                </Panel>
                <Panel title="p95 latency" subtitle="Affected services" actions={<SimulatedTag />}>
                  {latM.isLoading ? <ChartSkeleton height={190} /> : latM.isError ? <ErrorState compact error={latM.error} /> : <TimeSeriesChart ariaLabel="Latency during incident" height={190} series={latM.data!.series.map((s) => ({ name: s.serviceName, points: s.points }))} format={fmtMs} windows={windows} from={window!.from} to={Math.min(window!.to, Date.now())} />}
                </Panel>
              </div>
              <Panel title="Error events in window" subtitle={evQ.data ? `${evQ.data.total.toLocaleString()} error/critical events on affected services` : undefined}
                actions={<Button asChild size="xs" variant="outline"><Link to={`/events?from=${window!.from}&to=${Math.min(window!.to, Date.now())}&severities=error,critical&services=${keys}`}>Open in stream</Link></Button>} bodyClassName="px-0 pb-0">
                {evQ.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : evQ.isError ? <ErrorState compact error={evQ.error} /> : evQ.data!.items.length === 0 ? <EmptyState title="No error events in this window" /> : (
                  <ul className="divide-y divide-border/60">
                    {evQ.data!.items.map((e) => (
                      <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <span className={cn('size-1.5 shrink-0 rounded-full', e.severity === 'critical' ? 'bg-crit' : 'bg-warn')} />
                        <span className="min-w-0 flex-1"><span className="block truncate">{e.message}</span><span className="text-xs text-muted-foreground">{e.serviceName} · {fmtTime(e.ts)}</span></span>
                        <Can permission="incident:update"><Button size="xs" variant="ghost" disabled={inc.links.some((l) => l.refId === e.id)} onClick={() => link.mutate({ kind: 'event', refId: e.id })}><Link2 /> {inc.links.some((l) => l.refId === e.id) ? 'Linked' : 'Link'}</Button></Can>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Related deployments" subtitle="On affected services, up to 1h before onset" bodyClassName="px-0 pb-0">
                {depQ.isLoading ? <div className="p-4"><Skeleton className="h-16" /></div> : relatedDeploys.length === 0 ? <EmptyState title="No related deployments" /> : (
                  <ul className="divide-y divide-border/60">{relatedDeploys.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><Rocket className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="font-medium">{d.serviceName}</span> <span className="font-mono text-xs text-muted-foreground">{d.version} · {d.commit}</span><span className="block text-xs text-muted-foreground">{d.deployedBy} · {fmtDateTime(d.deployedAt)}</span></span>
                      <Can permission="incident:update"><Button size="xs" variant="ghost" disabled={inc.links.some((l) => l.refId === d.id)} onClick={() => link.mutate({ kind: 'deployment', refId: d.id })}><Link2 /> {inc.links.some((l) => l.refId === d.id) ? 'Linked' : 'Link'}</Button></Can></li>
                  ))}</ul>
                )}
              </Panel>
            </TabsContent>

            <TabsContent value="notes" className="mt-3">
              <Panel title="Investigation notes" subtitle="Markdown-style plain text. Changes appear in the audit trail.">
                <Textarea rows={12} value={notesValue} disabled={!canUpdate} onChange={(e) => setNotes(e.target.value)} aria-label="Investigation notes" className="font-mono text-[13px]" placeholder="Hypotheses, commands run, findings…" />
                <Can permission="incident:update"><div className="mt-3 flex justify-end"><Button size="sm" disabled={notes === null || notes === inc.notes || update.isPending} onClick={() => update.mutate({ notes: notesValue }, { onSuccess: () => { setNotes(null); toast.success('Notes saved'); } })}>Save notes</Button></div></Can>
              </Panel>
            </TabsContent>

            <TabsContent value="evidence" className="mt-3">
              <Panel title="Linked evidence" subtitle="Events, traces and deployments attached to this incident" bodyClassName="px-0 pb-0">
                {inc.links.length === 0 ? <EmptyState title="Nothing linked yet" description="Link error events or deployments from the Telemetry tab, or a trace from its detail page." /> : (
                  <ul className="divide-y divide-border/60">{inc.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">{l.kind === 'deployment' ? <Rocket className="size-3.5" /> : l.kind === 'trace' ? <GitBranch className="size-3.5" /> : <Activity className="size-3.5" />}</span>
                      <span className="min-w-0 flex-1"><span className="text-xs uppercase tracking-wide text-muted-foreground">{l.kind}</span><span className="block truncate">{l.label || l.refId}</span></span>
                      {l.kind === 'trace' && <Button asChild size="xs" variant="outline"><Link to={`/traces/${l.refId}`}>Open</Link></Button>}
                      {l.kind === 'deployment' && <Button asChild size="xs" variant="outline"><Link to="/deployments">View</Link></Button>}
                    </li>
                  ))}</ul>
                )}
              </Panel>
            </TabsContent>
          </Tabs>
          {aiOn && can('ai:use') && <AiPanel incidentId={inc.id} />}
        </div>

        <aside className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-3.5 text-sm">
              <div><dt className="eyebrow mb-1">Severity</dt><dd>
                <Select value={inc.severity} disabled={!canUpdate || update.isPending} onValueChange={(v) => update.mutate({ severity: v })}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Severity"><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></dd></div>
              <div><dt className="eyebrow mb-1">Owner</dt><dd>
                <Select value={inc.owner?.id ?? '__none__'} disabled={!canUpdate || update.isPending} onValueChange={(v) => update.mutate({ ownerId: v === '__none__' ? null : v })}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Owner"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">Unassigned</SelectItem>{team.data?.items.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select></dd></div>
              <div><dt className="eyebrow mb-1">Responders</dt><dd className="flex flex-wrap gap-1.5">{inc.responders.length ? inc.responders.map((r) => <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"><Avatar className="size-4"><AvatarFallback className="text-[8px]">{initials(r.name)}</AvatarFallback></Avatar>{r.name}</span>) : <span className="text-muted-foreground">None</span>}</dd></div>
              <div><dt className="eyebrow mb-1">Affected services</dt><dd className="space-y-1">{inc.services.map((s) => { const live = services.find((x) => x.id === s.id); return <Link key={s.id} to={`/services/${s.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50">{live && <StatusDot status={live.status} />}<span className="truncate">{s.name}</span></Link>; })}</dd></div>
            </dl>
          </Panel>
          <Panel title="Response metrics">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="eyebrow">Opened</dt><dd className="mt-0.5" title={new Date(inc.createdAt).toLocaleString()}>{timeAgo(inc.createdAt)}</dd></div>
              <div><dt className="eyebrow">Time to acknowledge</dt><dd className="mt-0.5 tabular">{tta !== null ? fmtDuration(tta) : <span className="text-crit">Not acknowledged</span>}</dd></div>
              <div><dt className="eyebrow">Time to resolve</dt><dd className="mt-0.5 tabular">{ttr !== null ? fmtDuration(ttr) : 'Open'}</dd></div>
              <div><dt className="eyebrow">Open duration</dt><dd className="mt-0.5 tabular">{fmtDuration((inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : Date.now()) - new Date(inc.createdAt).getTime())}</dd></div>
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
