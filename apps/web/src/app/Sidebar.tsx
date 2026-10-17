import { NavLink } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { get } from '@/lib/api';
import { spring } from '@/lib/motion';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/features/auth/auth';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV, type NavEntry } from './nav';

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c7bff" /><stop offset="1" stopColor="#a855f7" /></linearGradient></defs>
        <rect width="32" height="32" rx="8" fill="var(--surface-2)" stroke="var(--border-strong)" />
        <path d="M9 23V9l14 14V9" fill="none" stroke="url(#lg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!collapsed && <span className="text-[15px] font-semibold tracking-[0.14em]">NEXUS</span>}
    </div>
  );
}

function useActiveCount() {
  return useQuery({ queryKey: ['incidents', 'active-count'], queryFn: () => get<{ total: number }>('/incidents', { active: true, pageSize: 1 }), refetchInterval: 20_000, select: (d) => d.total });
}

export function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  const { data: active } = useActiveCount();
  const groups = ['Operate', 'Observe', 'Manage'] as const;
  return (
    <nav aria-label="Primary" className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
      {groups.map((g) => (
        <div key={g}>
          {!collapsed && <p className="eyebrow px-2.5 pb-1.5">{g}</p>}
          <ul className="space-y-0.5">
            {NAV.filter((n) => n.group === g && (!n.permission || can(n.permission))).map((n) => <NavItem key={n.to} entry={n} collapsed={collapsed} badge={n.to === '/incidents' && active ? active : undefined} onNavigate={onNavigate} />)}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavItem({ entry, collapsed, badge, onNavigate }: { entry: NavEntry; collapsed?: boolean; badge?: number; onNavigate?: () => void }) {
  const Icon = entry.icon;
  const link = (
    <NavLink to={entry.to} end={entry.end} onClick={onNavigate} aria-label={collapsed ? entry.label : undefined}
      className={({ isActive }) => cn('group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground', isActive && 'text-foreground', collapsed && 'justify-center px-0')}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-active" transition={spring.indicator} className="absolute inset-0 rounded-lg bg-accent ring-1 ring-primary/20" />}
          {isActive && <motion.span layoutId="nav-bar" transition={spring.indicator} className="absolute -left-2 top-2 h-5 w-0.5 rounded-full bg-primary" />}
          <Icon className={cn('relative size-4 shrink-0', isActive && 'text-primary')} />
          {!collapsed && <span className="relative flex-1 truncate">{entry.label}</span>}
          {!collapsed && badge ? <span className="relative rounded-full bg-crit-soft px-1.5 py-0.5 text-[10px] font-semibold text-crit tabular">{badge}</span> : null}
          {collapsed && badge ? <span className="absolute right-2 top-1.5 size-1.5 rounded-full bg-crit" /> : null}
        </>
      )}
    </NavLink>
  );
  return (
    <li>
      {collapsed ? (
        <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{entry.label}</TooltipContent></Tooltip>
      ) : link}
    </li>
  );
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const setCollapsed = useUi((s) => s.setSidebarCollapsed);
  return (
    <motion.aside
      initial={false} animate={{ width: collapsed ? 64 : 244 }} transition={spring.soft}
      className="sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface-1 md:flex"
      aria-label="Sidebar"
    >
      <div className={cn('flex h-14 items-center border-b border-border px-4', collapsed && 'justify-center px-0')}><Logo collapsed={collapsed} /></div>
      <NavList collapsed={collapsed} />
      <div className="border-t border-border p-2">
        <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
          className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground', collapsed && 'justify-center px-0')}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <><span className="flex-1 text-left">Collapse</span><span className="kbd">[</span></>}
        </button>
      </div>
    </motion.aside>
  );
}
