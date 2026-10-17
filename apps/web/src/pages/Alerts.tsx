import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Check, Pencil, Plus, Siren, Trash2 } from 'lucide-react';
import { alertRuleForm, type AlertDto, type AlertRuleDto, type Paginated } from '@nexus/shared';
import { alertRuleSchema } from '@nexus/shared/schemas';
import { del, get, patch, post, put } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { toast } from '@/stores/toasts';
import { useUi } from '@/stores/ui';
import { useUrlState } from '@/hooks/useUrlState';
import { Can, useAuth } from '@/features/auth/auth';
import { Modal } from '@/components/Overlay';
import { SchemaForm } from '@/components/SchemaForm';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, PageHeader, SeverityBadge, TableSkeleton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const COND: Record<string, (r: AlertRuleDto) => string> = {
  error_rate_above: (r) => `Error rate > ${r.threshold}%`, latency_above: (r) => `p95 latency > ${r.threshold} ms`,
  health_change: (r) => `Health ≥ ${r.threshold === 2 ? 'unavailable' : 'degraded'}`, request_volume_anomaly: (r) => `Volume deviates > ${r.threshold}% from baseline`,
};

export default function Alerts() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const env = useUi((s) => s.env);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<AlertRuleDto | 'new' | null>(params.get('new') === '1' ? 'new' : null);
  useEffect(() => { if (params.get('new') === '1') { setEditing('new'); setParams({}, { replace: true }); } }, [params, setParams]);
  const [f, set] = useUrlState({ page: '1', tab: 'rules' });
  const page = Number(f.page);
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: () => get<{ items: AlertRuleDto[] }>('/alert-rules'), refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ['alerts', 'list', page], queryFn: () => get<Paginated<AlertDto>>('/alerts', { page, pageSize: 15 }), refetchInterval: 15_000, placeholderData: (p) => p });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['alert-rules'] }); void qc.invalidateQueries({ queryKey: ['alerts'] }); void qc.invalidateQueries({ queryKey: ['overview'] }); };

  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => patch(`/alert-rules/${v.id}/enabled`, { enabled: v.enabled }),
    onMutate: async (v) => { await qc.cancelQueries({ queryKey: ['alert-rules'] }); const prev = qc.getQueryData<{ items: AlertRuleDto[] }>(['alert-rules']); qc.setQueryData(['alert-rules'], prev && { items: prev.items.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)) }); return { prev }; },
    onError: (e, _v, ctx) => { qc.setQueryData(['alert-rules'], ctx?.prev); toast.error('Could not update rule', (e as Error).message); }, onSettled: refresh });
  const save = useMutation({ mutationFn: (v: unknown) => (editing && editing !== 'new' ? put(`/alert-rules/${editing.id}`, v) : post('/alert-rules', v)),
    onSuccess: () => { toast.success(editing === 'new' ? 'Rule created' : 'Rule updated'); setEditing(null); refresh(); }, onError: (e) => toast.error('Could not save rule', (e as Error).message) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/alert-rules/${id}`), onSuccess: () => { toast.success('Rule deleted'); refresh(); }, onError: (e) => toast.error('Could not delete', (e as Error).message) });
  const ack = useMutation({ mutationFn: (id: string) => post(`/alerts/${id}/ack`), onSuccess: () => { toast.success('Alert acknowledged'); refresh(); }, onError: (e) => toast.error('Could not acknowledge', (e as Error).message) });
  const toIncident = useMutation({ mutationFn: (id: string) => post<{ incidentId: string }>(`/alerts/${id}/incident`), onSuccess: (r) => { toast.success('Incident created from alert'); refresh(); void qc.invalidateQueries({ queryKey: ['incidents'] }); window.location.assign(`/incidents/${r.incidentId}`); }, onError: (e) => toast.error('Could not create incident', (e as Error).message) });

  const defaults = editing && editing !== 'new' ? { ...editing, serviceId: editing.serviceId } : { environment: env };
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Alert Rules" description="Rules are evaluated every 10 seconds against simulated telemetry. A sustained condition raises one alert; the same rule stays quiet until it resolves and its cooldown passes."
        actions={<Can permission="alert:write"><Button onClick={() => setEditing('new')}><Plus /> New rule</Button></Can>} /></motion.div>
      <motion.div variants={item}>
        <Tabs value={f.tab} onValueChange={(v) => set({ tab: v })}>
          <TabsList><TabsTrigger value="rules">Rules ({rules.data?.items.length ?? '…'})</TabsTrigger><TabsTrigger value="history">Alert history ({alerts.data?.total ?? '…'})</TabsTrigger></TabsList>
          <TabsContent value="rules" className="mt-3 card">
            {rules.isLoading ? <TableSkeleton /> : rules.isError ? <ErrorState error={rules.error} onRetry={() => rules.refetch()} /> : rules.data!.items.length === 0 ? <EmptyState title="No alert rules" description="Create a rule to be notified when error rate or latency crosses a threshold." /> : (
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead className="w-16">On</TableHead><TableHead>Rule</TableHead><TableHead className="hidden md:table-cell">Condition</TableHead><TableHead className="hidden sm:table-cell">Scope</TableHead><TableHead>Sev</TableHead><TableHead>State</TableHead><TableHead className="w-24 text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{rules.data!.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Switch checked={r.enabled} disabled={!can('alert:write')} onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })} aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`} /></TableCell>
                    <TableCell className="font-medium">{r.name}<span className="block text-xs font-normal text-muted-foreground md:hidden">{COND[r.condition]?.(r)}</span>{r.autoCreateIncident && <span className="text-[10px] uppercase tracking-wide text-primary">auto-incident</span>}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{COND[r.condition]?.(r)} <span className="text-xs">· {r.windowSec}s window · {Math.round(r.cooldownSec / 60)}m cooldown</span></TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{r.serviceName ?? 'All services'} · <span className="capitalize">{r.environment}</span></TableCell>
                    <TableCell><SeverityBadge severity={r.severity} /></TableCell>
                    <TableCell>{!r.enabled ? <span className="text-xs text-subtle">Disabled</span> : r.state === 'firing' ? <span className="rounded-full bg-crit-soft px-2 py-0.5 text-xs font-medium text-crit">Firing</span> : <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">OK</span>}</TableCell>
                    <TableCell className="text-right"><Can permission="alert:write"><Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => { if (confirm(`Delete rule “${r.name}”?`)) remove.mutate(r.id); }}><Trash2 /></Button></Can></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></div>
            )}
          </TabsContent>
          <TabsContent value="history" className="mt-3 card">
            {alerts.isLoading ? <TableSkeleton /> : alerts.isError ? <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} /> : alerts.data!.items.length === 0 ? <EmptyState title="No alerts yet" /> : (
              <>
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Alert</TableHead><TableHead>Sev</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Detail</TableHead><TableHead className="hidden sm:table-cell">Fired</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{alerts.data!.items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.ruleName}<span className="block text-xs font-normal text-muted-foreground">{a.serviceName ?? 'All services'}</span></TableCell>
                      <TableCell><SeverityBadge severity={a.severity} /></TableCell>
                      <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${a.status === 'firing' ? 'bg-crit-soft text-crit' : a.status === 'acknowledged' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>{a.status}</span></TableCell>
                      <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell" title={a.detail}>{a.detail}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell" title={fmtDateTime(a.firedAt)}>{timeAgo(a.firedAt)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {a.status === 'firing' && <Can permission="alert:ack"><Button size="xs" variant="outline" onClick={() => ack.mutate(a.id)}><Check /> Ack</Button></Can>}
                        {a.incidentId ? <Button asChild size="xs" variant="ghost"><Link to={`/incidents/${a.incidentId}`}>Incident</Link></Button> : a.status !== 'resolved' && a.serviceId ? <Can permission="incident:create"><Button size="xs" variant="ghost" onClick={() => toIncident.mutate(a.id)}><Siren /> Incident</Button></Can> : null}
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table></div>
                <Pagination page={page} pageSize={15} total={alerts.data!.total} onPage={(p) => set({ page: String(p) }, { keepPage: true })} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'New alert rule' : 'Edit alert rule'} description="Fields adapt to the selected condition." className="max-w-xl">
        {editing && <SchemaForm key={editing === 'new' ? 'new' : editing.id} schema={alertRuleForm} validator={alertRuleSchema as never} defaultValues={defaults as never} submitLabel={editing === 'new' ? 'Create rule' : 'Save changes'} submitting={save.isPending} onCancel={() => setEditing(null)} onSubmit={(v) => save.mutateAsync(v).then(() => undefined).catch(() => undefined)} />}
      </Modal>
    </motion.div>
  );
}
