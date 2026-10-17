import { Fragment } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronDown, ChevronRight, LogOut, Menu, Moon, RefreshCw, Search, Sun, WifiOff } from 'lucide-react';
import { TIME_RANGES, type NotificationDto, type SessionUser, type TimeRangeKey } from '@nexus/shared';
import { get, post } from '@/lib/api';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { useCrumbStore } from '@/stores/crumb';
import { toast } from '@/stores/toasts';
import { useAuth, meKey } from '@/features/auth/auth';
import { retryLive, useLive } from '@/features/realtime/liveStore';
import { SimulatedTag } from '@/components/primitives';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CRUMBS } from './nav';

function Breadcrumbs() {
  const { pathname } = useLocation();
  const leaf = useCrumbStore((s) => s.label);
  const parts = pathname.split('/').filter(Boolean);
  const first = parts[0] ?? '';
  const crumbs: { label: string; to?: string }[] = [{ label: 'NEXUS', to: '/' }];
  if (first) crumbs.push({ label: CRUMBS[first] ?? first, to: parts.length > 1 ? `/${first}` : undefined });
  else crumbs.push({ label: 'Overview' });
  if (parts.length > 1) crumbs.push({ label: leaf ?? '…' });
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink items-center gap-1 text-sm xl:flex">
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
          {c.to ? <Link to={c.to} className="truncate text-muted-foreground hover:text-foreground">{c.label}</Link> : <span aria-current="page" className="max-w-56 truncate font-medium">{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}

function ConnectionPill() {
  const status = useLive((s) => s.status);
  const attempt = useLive((s) => s.attempt);
  const nextRetry = useLive((s) => s.nextRetryMs);
  const map = {
    connected: { dot: 'bg-ok', label: 'Live', tip: 'Connected — receiving real-time updates' },
    connecting: { dot: 'bg-warn', label: 'Connecting', tip: 'Establishing realtime connection…' },
    reconnecting: { dot: 'bg-warn', label: 'Reconnecting', tip: `Connection lost. Attempt ${attempt}${nextRetry ? `, retrying in ${(nextRetry / 1000).toFixed(1)}s` : ''}.` },
    stale: { dot: 'bg-warn', label: 'Stale', tip: 'Connected, but no data has arrived recently. Values may be out of date.' },
    offline: { dot: 'bg-crit', label: 'Offline', tip: 'Your device is offline. Data shown may be stale.' },
  } as const;
  const m = map[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={status !== 'connected' ? retryLive : undefined} aria-label={`Connection: ${m.label}`} className="flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground hover:bg-accent/50">
          <span className={cn('size-1.5 rounded-full', m.dot, status === 'connected' && 'animate-pulse-dot text-ok')} />
          <span className="hidden sm:inline">{m.label}</span>
          {status !== 'connected' && (status === 'offline' ? <WifiOff className="size-3" /> : <RefreshCw className="size-3" />)}
        </button>
      </TooltipTrigger>
      <TooltipContent>{m.tip}</TooltipContent>
    </Tooltip>
  );
}

export function EnvToggle({ mobile }: { mobile?: boolean }) {
  const env = useUi((s) => s.env);
  const setEnv = useUi((s) => s.setEnv);
  return (
    <div role="radiogroup" aria-label="Environment" className={cn('relative h-8 items-center rounded-lg border border-border bg-surface-2 p-0.5', mobile ? 'inline-flex' : 'hidden sm:flex')}>
      {(['production', 'staging'] as const).map((e) => (
        <button key={e} role="radio" aria-checked={env === e} onClick={() => setEnv(e)} className={cn('relative h-7 rounded-md px-2.5 text-xs font-medium capitalize', env === e ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {env === e && <motion.span layoutId={mobile ? 'env-pill-m' : 'env-pill'} transition={spring.indicator} className="absolute inset-0 rounded-md bg-card shadow-xs ring-1 ring-border-strong" />}
          <span className="relative">{e === 'production' ? 'Prod' : 'Staging'}</span>
        </button>
      ))}
    </div>
  );
}

function OrgSwitcher() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const current = user.orgs.find((o) => o.id === user.orgId)!;
  const switchOrg = async (id: string) => {
    if (id === user.orgId) return;
    try {
      const res = await post<{ user: SessionUser }>('/auth/switch-org', { orgId: id });
      qc.clear();
      qc.setQueryData(meKey, res.user);
      navigate('/');
      toast.success(`Switched to ${res.user.orgs.find((o) => o.id === id)?.name}`);
    } catch (e) { toast.error('Could not switch organization', (e as Error).message); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 px-2" aria-label="Switch organization">
          <span className="grid size-5 place-items-center rounded bg-gradient-to-br from-primary to-violet text-[10px] font-bold text-white">{current.name[0]}</span>
          <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">{current.name}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="eyebrow">Organizations</DropdownMenuLabel>
        {user.orgs.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => void switchOrg(o.id)} className="gap-2">
            <span className="grid size-5 place-items-center rounded bg-accent text-[10px] font-bold text-accent-foreground">{o.name[0]}</span>
            <span className="flex-1">{o.name}</span>
            <span className="text-xs capitalize text-muted-foreground">{o.role}</span>
            {o.id === user.orgId && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RangeSelect({ className }: { className?: string }) {
  const range = useUi((s) => s.range);
  const setRange = useUi((s) => s.setRange);
  return (
    <Select value={range} onValueChange={(v) => setRange(v as TimeRangeKey)}>
      <SelectTrigger size="sm" className={cn('h-8 w-[148px]', className)} aria-label="Time range"><SelectValue /></SelectTrigger>
      <SelectContent align="end">{TIME_RANGES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ rotate: -60, opacity: 0, scale: 0.7 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 60, opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }}>
              {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </motion.span>
          </AnimatePresence>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  );
}

export function NotificationBell() {
  const setOpen = useUi((s) => s.setNotificationsOpen);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: NotificationDto[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Button variant="ghost" size="icon-sm" className="relative" onClick={() => setOpen(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
      <Bell className="size-4" />
      <AnimatePresence>
        {unread > 0 && (
          <motion.span key="b" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.snappy} className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await post('/auth/logout');
    qc.clear();
    qc.setQueryData(meKey, null);
    navigate('/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-offset-2" aria-label="User menu">
          <Avatar className="size-8"><AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(user.name)}</AvatarFallback></Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
          <p className="mt-1 inline-block rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">{user.role}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/team')}>Team & access</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} variant="destructive"><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const setMobile = useUi((s) => s.setMobileNavOpen);
  const setPalette = useUi((s) => s.setPaletteOpen);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-sm sm:px-5">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobile(true)} aria-label="Open navigation"><Menu className="size-5" /></Button>
      <OrgSwitcher />
      <span className="hidden h-5 w-px bg-border lg:block" />
      <Breadcrumbs />
      <div className="flex-1" />
      <button onClick={() => setPalette(true)} aria-label="Open command palette"
        className="hidden h-8 w-48 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-subtle hover:border-border-strong lg:flex xl:w-72">
        <Search className="size-3.5" /> <span className="flex-1 truncate whitespace-nowrap text-left">Search or run a command…</span>
        <span className="kbd">{isMac ? '⌘' : 'Ctrl'}</span><span className="kbd">K</span>
      </button>
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setPalette(true)} aria-label="Search"><Search className="size-4" /></Button>
      <SimulatedTag className="hidden 2xl:inline-flex" />
      <EnvToggle />
      <div className="hidden sm:block"><RangeSelect /></div>
      <ConnectionPill />
      <div className="hidden sm:block"><ThemeToggle /></div>
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
