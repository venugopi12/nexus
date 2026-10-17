import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Clock, CornerDownLeft, FileSearch, Layers, Search, Server } from 'lucide-react';
import { get } from '@/lib/api';
import { dialog, overlay } from '@/lib/motion';
import { useRecents, useUi } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { SeverityBadge } from '@/components/primitives';
import { useDebounced } from '@/hooks/useDebounced';
import { useAuth } from '@/features/auth/auth';
import { buildCommands, searchCommands, type Command, type CommandContext } from './registry';
import { useCommandContext } from './useCommandContext';

interface SearchResults {
  incidents: { id: string; number: number; title: string; severity: 'SEV-1'; status: string }[];
  services: { id: string; key: string; name: string }[];
  traces: { traceId: string; rootOperation: string; durationMs: number }[];
  events: { id: string; message: string; type: string; severity: string; ts: number }[];
}

interface Item {
  id: string;
  group: string;
  title: ReactNode;
  subtitle?: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void | Promise<void>;
}

const GROUP_ORDER = ['Recent', 'Recent searches', 'Actions', 'Navigate', 'Incidents', 'Services', 'Traces', 'Events', 'Organization', 'Environment', 'Time range', 'Appearance'];

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 180);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const cctx = useCommandContext();
  const recents = useRecents();

  useEffect(() => { setQuery(''); setActive(0); }, [open]);

  const commands = useMemo(() => buildCommands(cctx), [cctx.user, cctx.theme, cctx.env, cctx.range]); // eslint-disable-line react-hooks/exhaustive-deps
  const remote = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => get<SearchResults>('/search', { q: debounced }, signal),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0); }, [setOpen]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const run = (c: Command): Item => ({
      id: c.id, group: c.group, title: c.title, shortcut: c.shortcut, icon: <ArrowRight className="size-4" />,
      run: async () => { close(); recents.addSearch(query.trim()); await c.run(cctx as CommandContext); },
    });
    const q = query.trim();
    if (!q) {
      recents.resources.slice(0, 5).forEach((r) => out.push({ id: `recent:${r.href}`, group: 'Recent', title: r.label, subtitle: r.kind, icon: <Clock className="size-4" />, run: () => { close(); navigate(r.href); } }));
      recents.searches.slice(0, 4).forEach((s) => out.push({ id: `rs:${s}`, group: 'Recent searches', title: s, icon: <Search className="size-4" />, run: () => setQuery(s) }));
      commands.filter((c) => c.group === 'Actions' || c.group === 'Navigate').forEach((c) => out.push(run(c)));
      return out;
    }
    searchCommands(commands, q).slice(0, 8).forEach((c) => out.push(run(c)));
    const r = remote.data;
    const go = (href: string, label: string, kind: 'incident' | 'service' | 'trace' | 'page', id: string) => () => {
      close(); recents.addSearch(q); recents.addResource({ id, kind, label, href }); navigate(href);
    };
    r?.incidents.forEach((i) => out.push({ id: `inc:${i.id}`, group: 'Incidents', title: <span className="flex items-center gap-2"><SeverityBadge severity={i.severity} />{`INC-${i.number} · ${i.title}`}</span>, subtitle: i.status, icon: <AlertTriangle className="size-4" />, run: go(`/incidents/${i.id}`, `INC-${i.number} ${i.title}`, 'incident', i.id) }));
    r?.services.forEach((s) => out.push({ id: `svc:${s.id}`, group: 'Services', title: s.name, subtitle: s.key, icon: <Server className="size-4" />, run: go(`/services/${s.id}`, s.name, 'service', s.id) }));
    r?.traces.forEach((t) => out.push({ id: `tr:${t.traceId}`, group: 'Traces', title: `${t.traceId.slice(0, 16)}… ${t.rootOperation}`, subtitle: `${Math.round(t.durationMs)} ms`, icon: <Layers className="size-4" />, run: go(`/traces/${t.traceId}`, t.rootOperation, 'trace', t.traceId) }));
    r?.events.forEach((e) => out.push({ id: `ev:${e.id}`, group: 'Events', title: e.message, subtitle: `${e.type} · ${e.severity}`, icon: <Activity className="size-4" />, run: () => { close(); recents.addSearch(q); navigate(`/events?q=${encodeURIComponent(e.message)}`); } }));
    return out;
  }, [commands, query, remote.data, recents.resources, recents.searches]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    items.forEach((i) => map.set(i.group, [...(map.get(i.group) ?? []), i]));
    // empty query: curated group order; with a query: groups ordered by their best-scoring item (insertion order)
    const keys = query.trim() ? [...map.keys()] : [...map.keys()].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
    // flat order must match the visual order for keyboard navigation
    const flat = keys.flatMap((k) => map.get(k)!);
    return { keys, map, flat };
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => { if (active >= grouped.flat.length) setActive(Math.max(0, grouped.flat.length - 1)); }, [grouped.flat.length, active]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = grouped.flat.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % Math.max(n, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + Math.max(n, 1)) % Math.max(n, 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); void grouped.flat[active]?.run(); }
  };

  const loading = remote.isFetching && query.trim().length >= 2;
  let idx = -1;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div variants={overlay} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[60] bg-black/60" />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[10vh] sm:pt-[14vh]">
              <Dialog.Content asChild forceMount aria-describedby={undefined} onOpenAutoFocus={(e) => { e.preventDefault(); (document.getElementById('palette-input') as HTMLInputElement | null)?.focus(); }}>
                <motion.div variants={dialog} initial="hidden" animate="show" exit="exit" className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-xl border border-border-strong bg-popover shadow-pop outline-none">
                  <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                  <div className="flex items-center gap-2 border-b border-border px-3.5">
                    <Search className="size-4 text-muted-foreground" aria-hidden />
                    <input
                      id="palette-input" autoComplete="off" spellCheck={false} role="combobox" aria-expanded aria-controls="palette-list" aria-autocomplete="list"
                      aria-activedescendant={grouped.flat[active] ? `palette-opt-${active}` : undefined}
                      value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
                      placeholder="Search incidents, services, traces, or run a command…"
                      className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
                    />
                    {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-border-strong border-t-primary" aria-label="Searching" />}
                    <span className="kbd">esc</span>
                  </div>
                  <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="max-h-[min(60dvh,420px)] overflow-y-auto p-1.5">
                    {grouped.flat.length === 0 && (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">{loading ? 'Searching…' : `No results for “${query}”`}</p>
                    )}
                    {grouped.keys.map((g) => (
                      <div key={g} role="group" aria-label={g}>
                        <p className="eyebrow px-2.5 pb-1 pt-2.5">{g}</p>
                        {grouped.map.get(g)!.map((it) => {
                          idx++;
                          const i = idx;
                          const on = i === active;
                          return (
                            <div
                              key={it.id} id={`palette-opt-${i}`} data-index={i} role="option" aria-selected={on}
                              onMouseMove={() => setActive(i)} onClick={() => void it.run()}
                              className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm', on ? 'bg-accent text-accent-foreground' : 'text-foreground')}
                            >
                              <span className={cn('text-muted-foreground', on && 'text-accent-foreground')}>{it.icon}</span>
                              <span className="min-w-0 flex-1 truncate">{it.title}</span>
                              {it.subtitle && <span className="shrink-0 text-xs text-muted-foreground">{it.subtitle}</span>}
                              {it.shortcut && <span className="hidden shrink-0 gap-1 sm:flex">{it.shortcut.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</span>}
                              {on && <CornerDownLeft className="size-3.5 shrink-0 opacity-60" aria-hidden />}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {remote.isError && <p className="px-3 py-2 text-xs text-crit">Search is unavailable right now.</p>}
                  </div>
                  <div className="flex items-center justify-between border-t border-border px-3.5 py-2 text-[11px] text-subtle">
                    <span className="flex items-center gap-3"><span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span><span><span className="kbd">↵</span> select</span></span>
                    <span className="flex items-center gap-1"><FileSearch className="size-3" /> {user.orgs.find((o) => o.id === user.orgId)?.name}</span>
                  </div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
