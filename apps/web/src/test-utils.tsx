import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Role, SessionUser } from '@nexus/shared';
import { ROLE_PERMISSIONS } from '@nexus/shared';
import { AuthProvider } from '@/features/auth/auth';

export const makeUser = (role: Role = 'sre'): SessionUser => ({
  id: 'u1', email: 'u@acme.dev', name: 'Test User', orgId: 'o1', role, permissions: [...ROLE_PERMISSIONS[role]],
  orgs: [{ id: 'o1', slug: 'acme', name: 'Acme Cloud', role }, { id: 'o2', slug: 'globex', name: 'Globex', role }],
});

export function LocationProbe() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname}{l.search}</div>;
}

export function renderWithProviders(ui: ReactElement, opts: { role?: Role; route?: string; authed?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const user = makeUser(opts.role);
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>
        {opts.authed === false ? children : <AuthProvider user={user}>{children}</AuthProvider>}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, user, ...render(wrap(ui)) };
}
export { Routes, Route };
