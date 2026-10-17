import { describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@nexus/shared';
import { buildCommands, scoreMatch, searchCommands, type CommandContext } from './registry';

const user = (role: SessionUser['role']): SessionUser => ({
  id: 'u', email: 'u@x.dev', name: 'U', orgId: 'o1', role, permissions: [],
  orgs: [{ id: 'o1', slug: 'acme', name: 'Acme', role }, { id: 'o2', slug: 'globex', name: 'Globex', role }],
});
const ctx = (role: SessionUser['role']): CommandContext => ({
  user: user(role), theme: 'dark', env: 'production', range: '1h',
  navigate: vi.fn(), setTheme: vi.fn(), setEnv: vi.fn(), setRange: vi.fn(), switchOrg: vi.fn(), openCreateIncident: vi.fn(), openNotifications: vi.fn(), logout: vi.fn(),
});

describe('command registry', () => {
  it('is permission-aware', () => {
    expect(buildCommands(ctx('viewer')).some((c) => c.id === 'incident:create')).toBe(false);
    expect(buildCommands(ctx('engineer')).some((c) => c.id === 'incident:create')).toBe(true);
    expect(buildCommands(ctx('engineer')).some((c) => c.id === 'alerts:new')).toBe(false);
    expect(buildCommands(ctx('sre')).some((c) => c.id === 'alerts:new')).toBe(true);
  });
  it('only offers switching to other orgs / envs / ranges', () => {
    const ids = buildCommands(ctx('admin')).map((c) => c.id);
    expect(ids).toContain('org:o2');
    expect(ids).not.toContain('org:o1');
    expect(ids).toContain('env:staging');
    expect(ids).not.toContain('env:production');
    expect(ids).not.toContain('range:1h');
    expect(ids).toContain('range:24h');
  });
  it('executes the real action, separated from search', async () => {
    const c = ctx('admin');
    const cmds = buildCommands(c);
    await cmds.find((x) => x.id === 'nav:/traces')!.run(c);
    expect(c.navigate).toHaveBeenCalledWith('/traces');
    await cmds.find((x) => x.id === 'theme:toggle')!.run(c);
    expect(c.setTheme).toHaveBeenCalledWith('light');
    await cmds.find((x) => x.id === 'org:o2')!.run(c);
    expect(c.switchOrg).toHaveBeenCalledWith('o2');
    await cmds.find((x) => x.id === 'range:24h')!.run(c);
    expect(c.setRange).toHaveBeenCalledWith('24h');
  });
  it('ranks by match quality and matches keywords', () => {
    const cmds = buildCommands(ctx('admin'));
    expect(searchCommands(cmds, 'trac')[0]!.id).toBe('nav:/traces');
    expect(searchCommands(cmds, 'logout')[0]!.id).toBe('auth:logout');
    expect(searchCommands(cmds, 'dark mode')[0]!.id).toBe('theme:toggle');
    expect(searchCommands(cmds, 'zzzzqq')).toHaveLength(0);
    expect(scoreMatch('inc', 'Incidents')).toBeGreaterThan(scoreMatch('inc', 'Go to Metrics Explorer incident'));
  });
});
