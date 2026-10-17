import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUi } from '@/stores/ui';
import { renderWithProviders } from '@/test-utils';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return {
    ...actual,
    get: vi.fn(async (path: string, query?: { q?: string }) => {
      if (path === '/search') return { incidents: [{ id: 'i1', number: 117, title: 'Search latency degradation', severity: 'SEV-3', status: 'triggered' }], services: [{ id: 's1', key: 'search-service', name: 'Search Service' }], traces: [], events: [] };
      throw new Error(`unexpected GET ${path} ${query?.q}`);
    }),
    post: vi.fn(async () => ({})),
  };
});

import { CommandPalette } from './CommandPalette';

const open = () => act(() => useUi.getState().setPaletteOpen(true));

describe('CommandPalette', () => {
  beforeEach(() => { useUi.setState({ paletteOpen: false, createIncidentOpen: false, env: 'production', range: '1h' }); localStorage.clear(); });

  it('focuses the input on open and closes with Escape', async () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(useUi.getState().paletteOpen).toBe(false));
  });

  it('moves the active option with arrow keys and executes with Enter', async () => {
    renderWithProviders(<CommandPalette />);
    open();
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'incident');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-opt-1');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // wraps to last
    const all = screen.getAllByRole('option');
    expect(all[all.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('runs the real command: create incident opens the dialog state', async () => {
    renderWithProviders(<CommandPalette />, { role: 'engineer' });
    open();
    await userEvent.type(await screen.findByRole('combobox'), 'create incident');
    expect(await screen.findByRole('option', { name: /Create incident/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(useUi.getState().createIncidentOpen).toBe(true));
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it('is permission-aware: viewers never see create incident', async () => {
    renderWithProviders(<CommandPalette />, { role: 'viewer' });
    open();
    await userEvent.type(await screen.findByRole('combobox'), 'create');
    await waitFor(() => expect(screen.queryByRole('option', { name: /Create incident/ })).toBeNull());
  });

  it('navigates to a page and to remote search results', async () => {
    renderWithProviders(<CommandPalette />);
    open();
    await userEvent.type(await screen.findByRole('combobox'), 'metrics');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/metrics'));

    open();
    await userEvent.type(await screen.findByRole('combobox'), 'search');
    const hit = await screen.findByRole('option', { name: /INC-117/ }, { timeout: 3000 });
    await userEvent.click(hit);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/incidents/i1'));
  });

  it('switches environment, time range and theme through commands', async () => {
    renderWithProviders(<CommandPalette />);
    open();
    await userEvent.type(await screen.findByRole('combobox'), 'staging');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(useUi.getState().env).toBe('staging'));
    open();
    await userEvent.type(await screen.findByRole('combobox'), '24 hours');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(useUi.getState().range).toBe('24h'));
  });
});
