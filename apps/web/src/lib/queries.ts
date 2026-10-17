import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { rangeMs, type ServiceStatusDto, type UserRef, type FlagDto } from '@nexus/shared';
import { get } from '@/lib/api';
import { useUi } from '@/stores/ui';

/** Re-renders on an interval; value is the interval-aligned "now" so query keys stay stable between ticks. */
export function useNowTick(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / intervalMs) * intervalMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / intervalMs) * intervalMs), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useTimeWindow(intervalMs = 15_000) {
  const env = useUi((s) => s.env);
  const range = useUi((s) => s.range);
  const now = useNowTick(intervalMs);
  return useMemo(() => ({ env, range, to: now, from: now - rangeMs(range) }), [env, range, now]);
}

export function useServices() {
  const env = useUi((s) => s.env);
  return useQuery({
    queryKey: ['services', env],
    queryFn: () => get<{ items: ServiceStatusDto[]; simulated: true }>('/services', { env }),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useServiceIndex() {
  const { data } = useServices();
  return useMemo(() => {
    const byId = new Map<string, ServiceStatusDto>();
    const byKey = new Map<string, ServiceStatusDto>();
    data?.items.forEach((s) => { byId.set(s.id, s); byKey.set(s.key, s); });
    return { list: data?.items ?? [], byId, byKey };
  }, [data]);
}

export function useTeam() {
  return useQuery({
    queryKey: ['team'],
    queryFn: () => get<{ items: (UserRef & { role: string; joinedAt: string })[] }>('/team'),
    staleTime: 5 * 60_000,
  });
}

export function useFlags() {
  const env = useUi((s) => s.env);
  return useQuery({ queryKey: ['flags', env], queryFn: () => get<{ items: FlagDto[] }>('/flags', { env }), staleTime: 60_000 });
}
export function useFlag(key: string): boolean {
  const { data } = useFlags();
  return data?.items.find((f) => f.key === key)?.resolved ?? false;
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
