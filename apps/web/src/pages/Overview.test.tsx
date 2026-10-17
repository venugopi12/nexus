import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test-utils';

const getMock = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, get: (...a: unknown[]) => getMock(...a) };
});
vi.mock('@/components/TimeSeriesChart', () => ({ TimeSeriesChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

import Overview from './Overview';

const overview = {
  simulated: true, now: 1, range: { from: 0, to: 1, stepMs: 1 },
  totals: { rps: 2400, errorRate: 0.3, avgLatency: 120, p95: 400, p99: 900, healthy: 15, degraded: 2, unavailable: 1, health: 'unavailable', score: 71 },
  series: { throughput: [], errorRate: [], avg: [], p95: [], p99: [] }, incidentsBySeverity: { 'SEV-1': 1, 'SEV-2': 0, 'SEV-3': 2, 'SEV-4': 0 }, activeAlerts: 3,
};
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 10 });

describe('Overview states', () => {
  it('shows independent skeleton/loading states while queries are pending', () => {
    getMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<Overview />);
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it('renders data and isolates a failing panel from healthy ones', async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path === '/overview') return overview;
      if (path === '/incidents') return page([{ id: 'i1', number: 9, title: 'Checkout down', severity: 'SEV-1', status: 'triggered', services: [{ id: 's', key: 'c', name: 'Checkout' }], createdAt: new Date().toISOString(), resolvedAt: null }]);
      if (path === '/deployments') throw new Error('deployments backend exploded');
      if (path === '/alerts') return page([]);
      if (path === '/services') return { items: [] };
      if (path === '/events') return { items: [], total: 0 };
      throw new Error(path);
    });
    renderWithProviders(<Overview />);
    expect(await screen.findByText('71')).toBeInTheDocument();
    expect(await screen.findByText(/INC-9 · Checkout down/)).toBeInTheDocument();
    expect(await screen.findByText('deployments backend exploded')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Latency over time' })).toBeInTheDocument();
  });

  it('shows an error state with retry when the main overview query fails', async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path === '/overview') throw new Error('overview unavailable');
      if (path === '/services') return { items: [] };
      if (path === '/events') return { items: [], total: 0 };
      return page([]);
    });
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getAllByText('overview unavailable').length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
  });
});
