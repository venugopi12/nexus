import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '@/lib/api';
import { useAuth } from '@/features/auth/auth';
import { meKey } from '@/features/auth/auth';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toasts';
import type { CommandContext } from './registry';
import type { SessionUser } from '@nexus/shared';

export function useCommandContext(): CommandContext {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const theme = useUi((s) => s.theme);
  const env = useUi((s) => s.env);
  const range = useUi((s) => s.range);
  return useMemo<CommandContext>(() => ({
    user, theme, env, range, navigate,
    setTheme: (t) => useUi.getState().setTheme(t),
    setEnv: (e) => { useUi.getState().setEnv(e); toast.info(`Environment: ${e}`); },
    setRange: (r) => useUi.getState().setRange(r),
    switchOrg: async (orgId) => {
      const res = await post<{ user: SessionUser }>('/auth/switch-org', { orgId });
      qc.clear();
      qc.setQueryData(meKey, res.user);
      navigate('/');
      toast.success(`Switched to ${res.user.orgs.find((o) => o.id === orgId)?.name ?? 'organization'}`);
    },
    openCreateIncident: () => useUi.getState().setCreateIncidentOpen(true),
    openNotifications: () => useUi.getState().setNotificationsOpen(true),
    logout: async () => {
      await post('/auth/logout');
      qc.clear();
      qc.setQueryData(meKey, null);
      navigate('/login');
    },
  }), [user, theme, env, range, navigate, qc]);
}
