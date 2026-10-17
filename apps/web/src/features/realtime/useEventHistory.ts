import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventDto } from '@nexus/shared';
import { get } from '@/lib/api';

export const HISTORY_PAGE = 100;

export interface HistoryFilters { env: string; q?: string; types?: string; severities?: string; services?: string; from?: string; to?: string }

/**
 * Sparse, page-addressable view over potentially 100k+ rows. Only pages near the viewport are fetched;
 * `before` pins the result set to a snapshot so row indices stay stable while new events stream in.
 */
export function useEventHistory(filters: HistoryFilters, snapshot: number) {
  const key = JSON.stringify([filters, snapshot]);
  const [, bump] = useState(0);
  const store = useRef({ key, total: null as number | null, pages: new Map<number, EventDto[]>(), inflight: new Set<number>(), error: null as unknown });
  if (store.current.key !== key) store.current = { key, total: null, pages: new Map(), inflight: new Set(), error: null };

  const ensure = useCallback((page: number) => {
    const s = store.current;
    if (s.pages.has(page) || s.inflight.has(page)) return;
    s.inflight.add(page);
    const k = s.key;
    get<{ items: EventDto[]; total: number }>('/events', { ...filters, before: snapshot, limit: HISTORY_PAGE, offset: page * HISTORY_PAGE, total: page === 0 ? undefined : false })
      .then((r) => {
        if (store.current.key !== k) return;
        store.current.pages.set(page, r.items);
        if (page === 0) store.current.total = r.total;
        store.current.inflight.delete(page);
        bump((n) => n + 1);
      })
      .catch((e) => {
        if (store.current.key !== k) return;
        store.current.error = e;
        store.current.inflight.delete(page);
        bump((n) => n + 1);
      });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ensure(0); }, [ensure]);
  const retry = useCallback(() => { store.current.error = null; store.current.inflight.clear(); ensure(0); bump((n) => n + 1); }, [ensure]);

  return {
    total: store.current.total,
    error: store.current.error,
    getRow: (i: number): EventDto | undefined => store.current.pages.get(Math.floor(i / HISTORY_PAGE))?.[i % HISTORY_PAGE],
    ensureRow: (i: number) => ensure(Math.floor(i / HISTORY_PAGE)),
    retry,
  };
}
