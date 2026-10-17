import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Pause, Play, RefreshCw, Search, Trash2, WifiOff, X } from 'lucide-react';
import { EVENT_TYPES, type EventDto } from '@nexus/shared';
import { get } from '@/lib/api';
import { fmtFullTime, fmtDateTime, fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { item, stagger } from '@/lib/motion';
import { useServiceIndex } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { clearLive, onLiveEvents, retryLive, setPaused, useLive } from '@/features/realtime/liveStore';
import { matchesFilter, type EventFilter } from '@/features/realtime/eventBuffer';
import { HISTORY_PAGE, useEventHistory } from '@/features/realtime/useEventHistory';
import { useDebounced } from '@/hooks/useDebounced';
import { useUrlState } from '@/hooks/useUrlState';
import { MultiSelect } from '@/components/SchemaForm';
import { Drawer } from '@/components/Overlay';
import { ErrorState, PageHeader, SimulatedTag } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ROW = 34;
const SEV_DOT: Record<string, string> = { critical: 'bg-crit', error: 'bg-crit/80', warning: 'bg-warn', info: 'bg-subtle' };
const csv = (v: string) => (v ? v.split(',') : []);

function Histogram({ env, params, onPick }: { env: string; params: Record<string, string | undefined>; onPick: (from: number, to: number) => void }) {
  const to = Date.now();
  const from = params.from ? Number(params.from) : to - 6 * 3600_000;
  const end = params.to ? Number(params.to) : to;
  const q = useQuery({ queryKey: ['event-hist', env, params, Math.floor(to / 60_000)], queryFn: () => get<{ step: number; buckets: ({ t: number; info: number; warning: number; error: number; critical: number })[] }>('/events/histogram', { ...params, env, from, to: end, buckets: 72 }), staleTime: 30_000 });
  const b = q.data?.buckets ?? [];
  const max = Math.max(1, ...b.map((x) => x.info + x.warning + x.error + x.critical));
  return (
    <div className="flex h-12 items-end gap-px" role="img" aria-label="Event volume histogram — click a bar to filter to that interval">
      {b.map((x) => {
        const tot = x.info + x.warning + x.error + x.critical;
        const h = (tot / max) * 100;
        return (
          <button key={x.t} title={`${fmtDateTime(x.t)} · ${tot} events`} onClick={() => onPick(x.t, x.t + (q.data?.step ?? 60_000))} className="group flex h-full min-w-px flex-1 flex-col justify-end">
            <span className="flex w-full flex-col-reverse overflow-hidden rounded-[1px] opacity-80 transition-opacity group-hover:opacity-100" style={{ height: `${h}%` }}>
              <span className="bg-subtle" style={{ flexGrow: x.info }} /><span className="bg-warn" style={{ flexGrow: x.warning }} /><span className="bg-crit/80" style={{ flexGrow: x.error }} /><span className="bg-crit" style={{ flexGrow: x.critical }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function EventStream() {
  const env = useUi((s) => s.env);
  const { list: services, byKey } = useServiceIndex();
  const [f, set] = useUrlState({ q: '', types: '', severities: '', services: '', from: '', to: '' });
  const [text, setText] = useState(f.q);
  const dq = useDebounced(text, 250);
  useEffect(() => { if (dq !== f.q) set({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(f.q); }, [f.q]);

  const live = useLive((s) => s.events);
  const status = useLive((s) => s.status);
  const attempt = useLive((s) => s.attempt);
  const paused = useLive((s) => s.paused);
  const held = useLive((s) => s.heldCount);
  const recoveries = useLive((s) => s.recoveries);
  const [snapshot, setSnapshot] = useState(() => Date.now());
  useEffect(() => { setSnapshot(Date.now()); }, [env, recoveries]);
  const [selected, setSelected] = useState<EventDto | null>(null);

  // events/sec over a 10s sliding window (counted at the batch boundary, outside React state)
  const [rate, setRate] = useState(0);
  const stamps = useRef<number[]>([]);
  useEffect(() => {
    const off = onLiveEvents((b) => { const t = Date.now(); b.forEach(() => stamps.current.push(t)); });
    const iv = setInterval(() => { const cut = Date.now() - 10_000; stamps.current = stamps.current.filter((x) => x > cut); setRate(stamps.current.length / 10); }, 1000);
    return () => { off(); clearInterval(iv); };
  }, []);

  const filter: EventFilter = useMemo(() => ({ q: f.q || undefined, types: csv(f.types), severities: csv(f.severities), services: csv(f.services), from: f.from ? Number(f.from) : undefined, to: f.to ? Number(f.to) : undefined }), [f]);
  const hasTimeBound = !!(f.from || f.to);
  const liveRows = useMemo(() => (hasTimeBound && filter.to && filter.to < snapshot ? [] : live.filter((e) => e.ts > snapshot && matchesFilter(e, filter))), [live, filter, snapshot, hasTimeBound]);
  const hist = useEventHistory({ env, q: f.q, types: f.types, severities: f.severities, services: f.services, from: f.from, to: f.to }, snapshot);
  const total = liveRows.length + (hist.total ?? 0);

  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => ROW, overscan: 20 });
  const items = virt.getVirtualItems();
  const [first, last] = [items[0]?.index ?? 0, items[items.length - 1]?.index ?? 0];
  useEffect(() => { for (let i = first; i <= last; i += HISTORY_PAGE / 2) hist.ensureRow(Math.max(0, i - liveRows.length)); hist.ensureRow(Math.max(0, last - liveRows.length)); }, [first, last, liveRows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowAt = (i: number): EventDto | undefined => (i < liveRows.length ? liveRows[i] : hist.getRow(i - liveRows.length));
  const active = Object.values(f).some(Boolean);
  const stale = status !== 'connected';

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col">
      <motion.div variants={item}><PageHeader title="Event Stream" meta={<SimulatedTag />} description={<>Virtualized view over {fmtInt(hist.total ?? 0)} stored events plus a bounded live buffer. Only visible rows are rendered.</>} /></motion.div>

      {stale && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          <WifiOff className="size-4" /> {status === 'stale' ? 'No data received recently — rows may be out of date.' : status === 'offline' ? 'You are offline — showing the last known events.' : `Connection lost — reconnecting (attempt ${attempt}). Showing the last known events; missed events will be restored on reconnect.`}
          <Button size="xs" variant="outline" className="ml-auto" onClick={retryLive}><RefreshCw /> Retry now</Button>
        </motion.div>
      )}

      <motion.div variants={item} className="card">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle" /><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search messages, services, types…" className="pl-8" aria-label="Search events" /></div>
            <div className="w-44"><MultiSelect id="ev-types" value={csv(f.types)} onChange={(v) => set({ types: v.join(',') })} options={EVENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))} placeholder="All types" /></div>
            <div className="w-44"><MultiSelect id="ev-sev" value={csv(f.severities)} onChange={(v) => set({ severities: v.join(',') })} options={['info', 'warning', 'error', 'critical'].map((t) => ({ value: t, label: t }))} placeholder="All severities" /></div>
            <div className="w-52"><MultiSelect id="ev-svc" value={csv(f.services)} onChange={(v) => set({ services: v.join(',') })} options={services.map((s) => ({ value: s.key, label: s.name }))} placeholder="All services" /></div>
          </div>
          <Histogram env={env} params={{ q: f.q, types: f.types, severities: f.severities, services: f.services }} onPick={(a, b) => set({ from: String(a), to: String(b) })} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Button size="sm" variant={paused ? 'default' : 'outline'} onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? <><Play /> Resume{held ? ` (${held} new)` : ''}</> : <><Pause /> Pause</>}</Button>
            <Button size="sm" variant="outline" onClick={() => { clearLive(); setSnapshot(Date.now()); }}><RefreshCw /> Jump to latest</Button>
            <Button size="sm" variant="ghost" onClick={clearLive} aria-label="Clear live buffer"><Trash2 /></Button>
            {hasTimeBound && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-accent-foreground">{fmtDateTime(Number(f.from))} → {fmtDateTime(Number(f.to))}<button aria-label="Clear time filter" onClick={() => set({ from: '', to: '' })}><X className="size-3" /></button></span>}
            {active && <Button size="xs" variant="ghost" onClick={() => { setText(''); set({ q: '', types: '', severities: '', services: '', from: '', to: '' }); }}>Clear filters</Button>}
            <span className="ml-auto flex items-center gap-3"><span className="tabular">{fmtInt(total)} events</span><span className={cn('tabular', status === 'connected' ? 'text-ok' : 'text-warn')}>{status === 'connected' ? `${rate.toFixed(1)}/s live` : status}</span></span>
          </div>
        </div>

        <div role="table" aria-label="Events" aria-rowcount={total}>
          <div role="row" className="grid grid-cols-[88px_1fr] border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-subtle sm:grid-cols-[128px_92px_88px_1fr] xl:grid-cols-[150px_100px_100px_160px_1fr]"><span>Time</span><span className="hidden sm:block">Type</span><span className="hidden sm:block">Severity</span><span className="hidden xl:block">Service</span><span>Message</span></div>
          <div ref={parentRef} className="h-[min(62dvh,640px)] overflow-y-auto" style={{ contain: 'strict' }}>
            {hist.error && !hist.total ? <ErrorState error={hist.error} onRetry={hist.retry} /> : total === 0 && hist.total !== null ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No events match the current filters.</p>
            ) : (
              <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
                {items.map((v) => {
                  const e = rowAt(v.index);
                  const isLive = v.index < liveRows.length;
                  return (
                    <div key={v.key} role="row" aria-rowindex={v.index + 1} style={{ height: ROW, transform: `translateY(${v.start}px)` }} onClick={() => e && setSelected(e)}
                      className={cn('absolute inset-x-0 grid cursor-pointer grid-cols-[88px_1fr] items-center gap-2 border-b border-border/40 px-3 text-xs hover:bg-accent/30 sm:grid-cols-[128px_92px_88px_1fr] xl:grid-cols-[150px_100px_100px_160px_1fr]', isLive && 'bg-primary/[0.04]')}>
                      {e ? (
                        <>
                          <span className="font-mono text-muted-foreground">{fmtFullTime(e.ts).split(' ').slice(-1)[0]}<span className="hidden sm:inline"> {fmtFullTime(e.ts).split(' ').slice(0, 2).join(' ')}</span></span>
                          <span className="hidden truncate capitalize sm:block">{e.type.replace('_', ' ')}</span>
                          <span className="hidden items-center gap-1.5 capitalize sm:flex"><span className={cn('size-1.5 rounded-full', SEV_DOT[e.severity])} />{e.severity}</span>
                          <span className="hidden truncate text-muted-foreground xl:block">{e.serviceName}</span>
                          <span className="flex min-w-0 items-center gap-1.5"><span className={cn('size-1.5 shrink-0 rounded-full sm:hidden', SEV_DOT[e.severity])} /><span className="truncate">{e.message}</span></span>
                        </>
                      ) : <span className="col-span-full h-3 w-2/3 animate-pulse rounded bg-muted" aria-label="Loading row" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title="Event details" description={selected ? selected.id : undefined}>
        {selected && (
          <div className="space-y-4 p-4 text-sm">
            <p className="text-base font-medium leading-snug">{selected.message}</p>
            <dl className="grid grid-cols-2 gap-3">
              {[['Time', fmtFullTime(selected.ts)], ['Type', selected.type.replace('_', ' ')], ['Severity', selected.severity], ['Environment', selected.environment]].map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-0.5 capitalize">{v}</dd></div>)}
            </dl>
            <div><p className="eyebrow mb-1.5">Attributes</p><dl className="space-y-1 rounded-lg bg-muted/50 p-3 font-mono text-xs">{Object.entries(selected.attributes).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}</dl></div>
            <div className="flex flex-wrap gap-2">
              {byKey.get(selected.serviceKey) && <Button asChild size="sm" variant="outline"><Link to={`/services/${byKey.get(selected.serviceKey)!.id}`}>{selected.serviceName}</Link></Button>}
              {byKey.get(selected.serviceKey)?.activeIncidentIds[0] && <Button asChild size="sm" variant="outline"><Link to={`/incidents/${byKey.get(selected.serviceKey)!.activeIncidentIds[0]}`}>Active incident</Link></Button>}
            </div>
          </div>
        )}
      </Drawer>
    </motion.div>
  );
}
