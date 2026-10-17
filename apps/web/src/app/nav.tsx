import { Activity, BellRing, Boxes, GitBranch, LayoutDashboard, LineChart, Network, Rocket, ScrollText, Settings, Siren, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '@nexus/shared';

export interface NavEntry { to: string; label: string; icon: LucideIcon; end?: boolean; group: 'Operate' | 'Observe' | 'Manage'; permission?: Permission }

export const NAV: NavEntry[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true, group: 'Operate' },
  { to: '/incidents', label: 'Incidents', icon: Siren, group: 'Operate' },
  { to: '/alerts', label: 'Alert Rules', icon: BellRing, group: 'Operate' },
  { to: '/deployments', label: 'Deployments', icon: Rocket, group: 'Operate' },
  { to: '/services', label: 'Services', icon: Boxes, group: 'Observe' },
  { to: '/map', label: 'Dependency Map', icon: Network, group: 'Observe' },
  { to: '/metrics', label: 'Metrics Explorer', icon: LineChart, group: 'Observe' },
  { to: '/traces', label: 'Traces', icon: GitBranch, group: 'Observe' },
  { to: '/events', label: 'Event Stream', icon: Activity, group: 'Observe' },
  { to: '/team', label: 'Team & Access', icon: Users, group: 'Manage' },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, group: 'Manage', permission: 'audit:read' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Manage' },
];

export const CRUMBS: Record<string, string> = {
  '': 'Overview', incidents: 'Incidents', services: 'Services', metrics: 'Metrics Explorer', traces: 'Distributed Traces', events: 'Event Stream',
  map: 'Dependency Map', deployments: 'Deployments', alerts: 'Alert Rules', team: 'Team & Access', audit: 'Audit Logs', settings: 'Settings',
};
