import { Suspense, lazy, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, X } from 'lucide-react';
import type { IncidentDetailDto, NotificationDto } from '@nexus/shared';
import { get, post } from '@/lib/api';
import { pageTransition, toast as toastVariants, listItem } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { toast, useToasts } from '@/stores/toasts';
import { useAuth } from '@/features/auth/auth';
import { CommandPalette } from '@/features/command/CommandPalette';
import { liveHooks, startLive, stopLive } from '@/features/realtime/liveStore';
import { Drawer, Modal } from '@/components/Overlay';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EmptyState } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
const CreateIncidentDialog = lazy(() => import('./CreateIncidentDialog'));
import { Logo, NavList, Sidebar } from './Sidebar';
import { EnvToggle, RangeSelect, ThemeToggle, Topbar } from './Topbar';
import { NAV } from './nav';

function NotificationCenter() {
  const open = useUi((s) => s.notificationsOpen);
  const setOpen = useUi((s) => s.setNotificationsOpen);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: NotificationDto[]; unread: number }>('/notifications'), enabled: open });
  const read = useMutation({
    mutationFn: (ids?: string[]) => post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <Drawer open={open} onOpenChange={setOpen} title="Notifications" description={q.data ? `${q.data.unread} unread` : undefined}>
      <div className="flex items-center justify-end border-b border-border px-4 py-2">
        <Button size="sm" variant="ghost" disabled={!q.data?.unread} onClick={() => read.mutate(undefined)}><CheckCheck /> Mark all read</Button>
      </div>
      {q.isLoading && <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
      {q.data && q.data.items.length === 0 && <EmptyState title="You’re all caught up" description="Alerts, mentions and incident updates appear here." />}
      <ul>
        <AnimatePresence initial={false}>
          {q.data?.items.map((n) => (
            <motion.li key={n.id} layout variants={listItem} initial="hidden" animate="show" exit="exit" className="overflow-hidden border-b border-border/60">
              <button
                className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-accent/40', !n.read && 'bg-accent/20')}
                onClick={() => { if (!n.read) read.mutate([n.id]); if (n.href) { setOpen(false); navigate(n.href); } }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-subtle">{timeAgo(n.createdAt)} · {n.kind}</span>
                </span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Drawer>
  );
}

function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout variants={toastVariants} initial="hidden" animate="show" exit="exit" role="status"
            className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-popover p-3 shadow-pop', t.tone === 'error' ? 'border-crit/40' : t.tone === 'success' ? 'border-ok/40' : t.tone === 'warning' ? 'border-warn/40' : 'border-border-strong')}>
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', t.tone === 'error' ? 'bg-crit' : t.tone === 'success' ? 'bg-ok' : t.tone === 'warning' ? 'bg-warn' : 'bg-primary')} />
            <div className="min-w-0 flex-1 cursor-default" onClick={() => { if (t.href) { navigate(t.href); dismiss(t.id); } }}>
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss"><X className="size-4" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MobileNav() {
  const open = useUi((s) => s.mobileNavOpen);
  const setOpen = useUi((s) => s.setMobileNavOpen);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname, setOpen]);
  return (
    <Drawer open={open} onOpenChange={setOpen} side="left" title="Navigation" hideTitle className="w-[min(86vw,300px)]">
      <div className="flex h-14 items-center border-b border-border px-4"><Logo /></div>
      <NavList onNavigate={() => setOpen(false)} />
      <div className="space-y-3 border-t border-border p-3">
        <p className="eyebrow">View</p>
        <EnvToggle mobile />
        <RangeSelect className="w-full" />
        <div className="flex items-center justify-between text-sm text-muted-foreground">Theme <ThemeToggle /></div>
      </div>
    </Drawer>
  );
}

function Shortcuts() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const chord = useRef<number>(0);
  useEffect(() => {
    const targets: Record<string, string> = { o: '/', i: '/incidents', s: '/services', m: '/metrics', t: '/traces', e: '/events', d: '/map', y: '/deployments', a: '/alerts', u: '/team', l: '/audit', ',': '/settings' };
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="combobox"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '[') { ui.setSidebarCollapsed(!ui.sidebarCollapsed); return; }
      if (e.key === 'c' && can('incident:create')) { e.preventDefault(); ui.setCreateIncidentOpen(true); return; }
      if (e.key === 'g') { chord.current = Date.now(); return; }
      if (Date.now() - chord.current < 1200 && targets[e.key]) { chord.current = 0; navigate(targets[e.key]!); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, can]);
  return null;
}

/** Wires realtime → React Query invalidation + toasts. Mounted once for the authenticated app. */
function RealtimeBridge() {
  const env = useUi((s) => s.env);
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    startLive(env);
  }, [env, user.orgId]);
  useEffect(() => () => stopLive(), [user.orgId]);
  useEffect(() => {
    const inc = (p: { id: string; kind: string }) => {
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      if (p.id) void qc.invalidateQueries({ queryKey: ['incident', p.id] });
    };
    const alert = (p: { id: string; ruleName: string; severity: string }) => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.warning(`${p.severity} alert fired`, p.ruleName, '/alerts');
    };
    const notif = (n: NotificationDto) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.kind !== 'alert') toast.info(n.title, n.body, n.href ?? undefined);
    };
    const recovered = () => { void qc.invalidateQueries(); toast.info('Reconnected', 'Live data restored — refreshed missed updates.'); };
    liveHooks.incident.add(inc); liveHooks.alert.add(alert); liveHooks.notification.add(notif as never); liveHooks.recovered.add(recovered);
    return () => { liveHooks.incident.delete(inc); liveHooks.alert.delete(alert); liveHooks.notification.delete(notif as never); liveHooks.recovered.delete(recovered); };
  }, [qc]);
  return null;
}

function PageFallback() {
  return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
}

export function AppShell() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[1] ?? '';
  const createOpen = useUi((s) => s.createIncidentOpen);
  const title = NAV.find((n) => n.to === `/${section}`)?.label ?? 'NEXUS';
  useEffect(() => { document.title = `${title} · NEXUS`; }, [title]);
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-w-0 flex-1 px-3 py-5 sm:px-5 lg:px-6">
          {/* keyed by first path segment: navigation between sections animates, detail<->param changes do not re-mount */}
          <motion.div key={section} {...pageTransition} className="mx-auto w-full max-w-[1600px]">
            <ErrorBoundary resetKey={pathname} label="page">
              <Suspense fallback={<PageFallback />}><Outlet /></Suspense>
            </ErrorBoundary>
          </motion.div>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      {createOpen && <Suspense fallback={null}><CreateIncidentDialog /></Suspense>}
      <NotificationCenter />
      <ToastViewport />
      <Shortcuts />
      <RealtimeBridge />
    </div>
  );
}
void Link;
