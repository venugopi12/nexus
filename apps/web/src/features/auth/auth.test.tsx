import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { Can, RequireAuth } from './auth';
import { Route, Routes, renderWithProviders } from '@/test-utils';

const getMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, get: (...a: unknown[]) => getMock(...a) };
});

const tree = (
  <Routes>
    <Route path="/login" element={<p>login page</p>} />
    <Route path="/secret" element={<RequireAuth><p>secret content</p></RequireAuth>} />
  </Routes>
);

describe('RequireAuth', () => {
  it('redirects anonymous users to /login', async () => {
    getMock.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'Authentication required'));
    renderWithProviders(tree, { route: '/secret', authed: false });
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
    expect(screen.queryByText('secret content')).toBeNull();
  });
  it('renders protected content for a valid session', async () => {
    getMock.mockResolvedValueOnce({ user: { id: 'u', email: 'a@b.c', name: 'A', orgId: 'o', role: 'sre', permissions: [], orgs: [{ id: 'o', slug: 'x', name: 'X', role: 'sre' }] } });
    renderWithProviders(tree, { route: '/secret', authed: false });
    expect(await screen.findByText('secret content')).toBeInTheDocument();
  });
  it('shows a retry affordance on server errors instead of leaking content', async () => {
    getMock.mockRejectedValueOnce(new ApiError(500, 'internal', 'boom'));
    renderWithProviders(tree, { route: '/secret', authed: false });
    expect(await screen.findByText(/retry/i)).toBeInTheDocument();
    expect(screen.queryByText('secret content')).toBeNull();
  });
});

describe('<Can>', () => {
  it('renders children only when the permission is held', () => {
    renderWithProviders(<><Can permission="incident:create"><p>can create</p></Can><Can permission="audit:read" fallback={<p>no audit</p>}><p>audit</p></Can></>, { role: 'engineer' });
    expect(screen.getByText('can create')).toBeInTheDocument();
    expect(screen.getByText('no audit')).toBeInTheDocument();
  });
});
