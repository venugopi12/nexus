import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { can, type Permission, type SessionUser } from '@nexus/shared';
import { ApiError, get, onUnauthorized } from '@/lib/api';

interface AuthValue { user: SessionUser; can: (p: Permission) => boolean }
const Ctx = createContext<AuthValue | null>(null);

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return (await get<{ user: SessionUser }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function AuthProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const value: AuthValue = { user, can: (p) => can(user.role, p) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside of AuthProvider');
  return v;
}

/** Route guard: renders children only for an authenticated session, otherwise redirects to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError, refetch } = useMe();
  const qc = useQueryClient();
  const loc = useLocation();
  useEffect(() => {
    const off = onUnauthorized(() => qc.setQueryData(meKey, null));
    return () => { off(); };
  }, [qc]);
  if (isLoading) return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">Loading session…</div>;
  if (isError) return <div className="grid min-h-dvh place-items-center text-sm"><button className="underline" onClick={() => refetch()}>Couldn’t reach the server — retry</button></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <AuthProvider user={user}>{children}</AuthProvider>;
}

/** Hides UI for users lacking a permission. Server still enforces — this is UX only. */
export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { can: ok } = useAuth();
  return <>{ok(permission) ? children : fallback}</>;
}
