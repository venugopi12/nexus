import { TIME_RANGES, can, type Permission, type SessionUser, type TimeRangeKey } from '@nexus/shared';

export type CommandGroup = 'Navigate' | 'Actions' | 'Organization' | 'Environment' | 'Time range' | 'Appearance';

/** Everything a command may need to *execute*. Search never touches this. */
export interface CommandContext {
  user: SessionUser;
  theme: 'dark' | 'light';
  env: string;
  range: TimeRangeKey;
  navigate: (to: string) => void;
  setTheme: (t: 'dark' | 'light') => void;
  setEnv: (e: 'production' | 'staging') => void;
  setRange: (r: TimeRangeKey) => void;
  switchOrg: (orgId: string) => Promise<void> | void;
  openCreateIncident: () => void;
  openNotifications: () => void;
  logout: () => Promise<void> | void;
}

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords?: string[];
  shortcut?: string;
  /** hidden from the palette when the user lacks it (server still enforces) */
  permission?: Permission;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export const NAV_ITEMS = [
  { to: '/', title: 'Overview', keywords: ['dashboard', 'home'], shortcut: 'g o' },
  { to: '/incidents', title: 'Incidents', keywords: ['sev', 'outage', 'on-call'], shortcut: 'g i' },
  { to: '/services', title: 'Services', keywords: ['catalog', 'health'], shortcut: 'g s' },
  { to: '/metrics', title: 'Metrics Explorer', keywords: ['charts', 'latency', 'query'], shortcut: 'g m' },
  { to: '/traces', title: 'Distributed Traces', keywords: ['spans', 'waterfall'], shortcut: 'g t' },
  { to: '/events', title: 'Event Stream', keywords: ['logs', 'live'], shortcut: 'g e' },
  { to: '/map', title: 'Service Dependency Map', keywords: ['graph', 'topology'], shortcut: 'g d' },
  { to: '/deployments', title: 'Deployments', keywords: ['releases', 'rollout'], shortcut: 'g y' },
  { to: '/alerts', title: 'Alert Rules', keywords: ['alerting', 'notifications', 'rules'], shortcut: 'g a' },
  { to: '/team', title: 'Team & Access', keywords: ['rbac', 'members', 'roles'], shortcut: 'g u' },
  { to: '/audit', title: 'Audit Logs', keywords: ['history', 'compliance'], shortcut: 'g l' },
  { to: '/settings', title: 'Settings', keywords: ['preferences', 'flags', 'organization'], shortcut: 'g ,' },
] as const;

export function buildCommands(ctx: CommandContext): Command[] {
  const cmds: Command[] = [];
  for (const n of NAV_ITEMS) {
    cmds.push({ id: `nav:${n.to}`, title: `Go to ${n.title}`, group: 'Navigate', keywords: [...n.keywords], shortcut: n.shortcut, run: (c) => c.navigate(n.to) });
  }
  cmds.push(
    { id: 'incident:create', title: 'Create incident', group: 'Actions', keywords: ['new', 'declare', 'open incident'], shortcut: 'c', permission: 'incident:create', run: (c) => c.openCreateIncident() },
    { id: 'alerts:new', title: 'Create alert rule', group: 'Actions', keywords: ['new rule'], permission: 'alert:write', run: (c) => c.navigate('/alerts?new=1') },
    { id: 'deploy:record', title: 'Record deployment', group: 'Actions', keywords: ['release'], permission: 'deployment:write', run: (c) => c.navigate('/deployments?new=1') },
    { id: 'notifications:open', title: 'Open notifications', group: 'Actions', keywords: ['inbox', 'bell', 'alerts'], run: (c) => c.openNotifications() },
    { id: 'settings:open', title: 'Open settings', group: 'Actions', keywords: ['preferences'], run: (c) => c.navigate('/settings') },
    { id: 'auth:logout', title: 'Sign out', group: 'Actions', keywords: ['logout', 'log out'], run: (c) => c.logout() },
  );
  for (const o of ctx.user.orgs) {
    if (o.id === ctx.user.orgId) continue;
    cmds.push({ id: `org:${o.id}`, title: `Switch organization to ${o.name}`, group: 'Organization', keywords: ['tenant', 'workspace', o.slug], run: (c) => c.switchOrg(o.id) });
  }
  for (const e of ['production', 'staging'] as const) {
    if (e === ctx.env) continue;
    cmds.push({ id: `env:${e}`, title: `Switch environment to ${e[0]!.toUpperCase()}${e.slice(1)}`, group: 'Environment', keywords: ['env', e], run: (c) => c.setEnv(e) });
  }
  for (const r of TIME_RANGES) {
    if (r.key === ctx.range) continue;
    cmds.push({ id: `range:${r.key}`, title: `Set time range: ${r.label}`, group: 'Time range', keywords: ['window', r.key], run: (c) => c.setRange(r.key) });
  }
  cmds.push({
    id: 'theme:toggle', title: `Switch to ${ctx.theme === 'dark' ? 'light' : 'dark'} theme`, group: 'Appearance', keywords: ['dark mode', 'light mode', 'theme', 'toggle'],
    run: (c) => c.setTheme(c.theme === 'dark' ? 'light' : 'dark'),
  });
  return cmds.filter((c) => !c.permission || can(ctx.user.role, c.permission));
}

/* ------------------------------------------------------------------ search (pure) */

/** Higher is better; 0 means no match. Prefix > word-prefix > substring > in-order subsequence. */
export function scoreMatch(query: string, text: string, keywords: string[] = []): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const best = (hay: string, weight: number) => {
    const h = hay.toLowerCase();
    if (h === q) return 100 * weight;
    if (h.startsWith(q)) return 80 * weight;
    if (h.split(/[\s:/_-]+/).some((w) => w.startsWith(q))) return 60 * weight;
    if (h.includes(q)) return 40 * weight;
    const tokens = q.split(/\s+/);
    if (tokens.length > 1 && tokens.every((t) => h.includes(t))) return 30 * weight;
    let i = 0;
    for (const ch of h) if (ch === q[i]) i++;
    if (i === q.length && q.length >= 3) return 15 * weight;
    return 0;
  };
  return Math.max(best(text, 1), ...keywords.map((k) => best(k, 0.6)));
}

export function searchCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((c) => ({ c, s: scoreMatch(query, c.title, c.keywords) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
