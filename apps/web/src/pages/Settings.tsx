import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import type { FlagDto } from '@nexus/shared';
import { get, patch, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toasts';
import { useFlags } from '@/lib/queries';
import { useAuth } from '@/features/auth/auth';
import { NAV_ITEMS } from '@/features/command/registry';
import { ErrorState, PageHeader, Panel, TableSkeleton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OrgSettings { id: string; name: string; slug: string; settings: { timezone?: string; retentionDays?: number; defaultEnvironment?: 'production' | 'staging' } }

function OrgForm() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/settings') });
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [ret, setRet] = useState(14);
  const [defEnv, setDefEnv] = useState<'production' | 'staging'>('production');
  useEffect(() => { if (q.data) { setName(q.data.name); setTz(q.data.settings.timezone ?? 'UTC'); setRet(q.data.settings.retentionDays ?? 14); setDefEnv(q.data.settings.defaultEnvironment ?? 'production'); } }, [q.data]);
  const save = useMutation({ mutationFn: () => patch('/settings', { name, settings: { timezone: tz, retentionDays: ret, defaultEnvironment: defEnv } }), onSuccess: () => { toast.success('Settings saved'); void qc.invalidateQueries({ queryKey: ['settings'] }); void qc.invalidateQueries({ queryKey: ['me'] }); }, onError: (e) => toast.error('Could not save', (e as Error).message) });
  const editable = can('settings:write');
  if (q.isLoading) return <TableSkeleton rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="space-y-1.5"><Label htmlFor="org-name">Organization name</Label><Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} /></div>
      <div className="space-y-1.5"><Label htmlFor="org-slug">Slug</Label><Input id="org-slug" value={q.data!.slug} disabled /></div>
      <div className="space-y-1.5"><Label htmlFor="org-tz">Timezone</Label><Input id="org-tz" value={tz} onChange={(e) => setTz(e.target.value)} disabled={!editable} /></div>
      <div className="space-y-1.5"><Label htmlFor="org-ret">Data retention (days)</Label><Input id="org-ret" type="number" min={1} max={90} value={ret} onChange={(e) => setRet(Number(e.target.value))} disabled={!editable} /></div>
      <div className="space-y-1.5"><Label>Default environment</Label><Select value={defEnv} onValueChange={(v) => setDefEnv(v as never)} disabled={!editable}><SelectTrigger className="w-full" aria-label="Default environment"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="staging">Staging</SelectItem></SelectContent></Select></div>
      <div className="flex items-end justify-end sm:col-span-2">{editable ? <Button type="submit" disabled={save.isPending}>Save changes</Button> : <p className="text-xs text-muted-foreground">Only admins can edit organization settings.</p>}</div>
    </form>
  );
}

function FlagRow({ flag }: { flag: FlagDto }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const env = useUi((s) => s.env);
  const orgOv = flag.overrides.find((o) => o.scope === 'org');
  const [enabled, setEnabled] = useState(orgOv?.enabled ?? flag.enabled);
  const [pct, setPct] = useState(orgOv?.rolloutPercent ?? flag.rolloutPercent);
  const [scope, setScope] = useState<'org' | 'environment'>('org');
  const m = useMutation({ mutationFn: () => put('/flags', { key: flag.key, scope, environment: scope === 'environment' ? env : undefined, enabled, rolloutPercent: pct }), onSuccess: () => { toast.success(`${flag.key} updated`); void qc.invalidateQueries({ queryKey: ['flags'] }); }, onError: (e) => toast.error('Could not update flag', (e as Error).message) });
  const [showHistory, setShowHistory] = useState(false);
  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-mono text-sm font-medium">{flag.key}</p><p className="text-xs text-muted-foreground">{flag.description}</p>
          <p className="mt-1 text-xs"><span className={cn('rounded-full px-2 py-0.5 font-medium', flag.resolved ? 'bg-ok-soft text-ok' : 'bg-muted text-muted-foreground')}>{flag.resolved ? 'On for you' : 'Off for you'}</span> <span className="text-subtle">global default: {flag.enabled ? `on @ ${flag.rolloutPercent}%` : 'off'}{flag.overrides.length ? ` · ${flag.overrides.length} override(s)` : ''}</span></p></div>
        <button className="text-xs text-primary hover:underline" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide' : 'Show'} history</button>
      </div>
      {can('flag:write') && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-2.5">
          <Select value={scope} onValueChange={(v) => setScope(v as never)}><SelectTrigger size="sm" className="w-[170px]" aria-label="Override scope"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="org">Organization override</SelectItem><SelectItem value="environment">{env} override</SelectItem></SelectContent></Select>
          <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} aria-label={`Enable ${flag.key}`} /> Enabled</label>
          <label className="flex items-center gap-2 text-sm">Rollout <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Rollout percent" className="w-28 accent-[var(--primary)]" /><span className="w-10 tabular">{pct}%</span></label>
          <Button size="sm" className="ml-auto" disabled={m.isPending} onClick={() => m.mutate()}>Apply</Button>
        </div>
      )}
      {showHistory && <ul className="space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">{flag.history.length ? flag.history.map((h, i) => <li key={i}><span className="font-mono">{fmtDateTime(h.at)}</span> · {h.actor} · {h.change}</li>) : <li>No changes recorded.</li>}</ul>}
    </li>
  );
}

export default function Settings() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const flags = useFlags();
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto max-w-4xl space-y-4">
      <motion.div variants={item}><PageHeader title="Settings" description="Organization preferences, feature flags and personal appearance." /></motion.div>
      <motion.div variants={item}><Panel title="Organization"><OrgForm /></Panel></motion.div>
      <motion.div variants={item}><Panel title="Appearance">
        <div className="flex gap-2" role="radiogroup" aria-label="Theme">
          {(['dark', 'light'] as const).map((t) => <button key={t} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={cn('flex h-16 w-32 flex-col items-center justify-center gap-1 rounded-xl border text-sm capitalize', theme === t ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/40')}>{t === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}{t}</button>)}
        </div>
      </Panel></motion.div>
      <motion.div variants={item}><Panel title="Feature flags" subtitle="Precedence: environment override › organization override › global default. Rollout uses deterministic user bucketing." bodyClassName="px-0 pb-0">
        {flags.isLoading ? <TableSkeleton rows={3} /> : flags.isError ? <ErrorState compact error={flags.error} onRetry={() => flags.refetch()} /> : <ul className="divide-y divide-border">{flags.data!.items.map((f) => <FlagRow key={f.key + JSON.stringify(f.overrides)} flag={f} />)}</ul>}
      </Panel></motion.div>
      <motion.div variants={item}><Panel title="Keyboard shortcuts">
        <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          <div className="flex justify-between"><dt>Command palette</dt><dd><span className="kbd">⌘/Ctrl</span> <span className="kbd">K</span></dd></div>
          <div className="flex justify-between"><dt>Create incident</dt><dd><span className="kbd">c</span></dd></div>
          <div className="flex justify-between"><dt>Toggle sidebar</dt><dd><span className="kbd">[</span></dd></div>
          {NAV_ITEMS.map((n) => <div key={n.to} className="flex justify-between"><dt>Go to {n.title}</dt><dd className="flex gap-1">{n.shortcut.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</dd></div>)}
        </dl>
      </Panel></motion.div>
      <motion.div variants={item}><Panel title="About this demo"><p className="text-sm text-muted-foreground">All telemetry — metrics, events, traces and faults — is generated by a deterministic simulator and labelled “Simulated” throughout the product. Incidents, alerts, audit logs, users and settings are real persisted data in PostgreSQL.</p></Panel></motion.div>
    </motion.div>
  );
}
