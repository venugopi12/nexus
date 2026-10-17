import { useEffect } from 'react';
import { create } from 'zustand';

interface CrumbState { label: string | null; set: (l: string | null) => void }
export const useCrumbStore = create<CrumbState>((set) => ({ label: null, set: (label) => set({ label }) }));

/** Detail pages call this to name their breadcrumb leaf (e.g. "INC-117"). */
export function useCrumb(label: string | null | undefined) {
  const set = useCrumbStore((s) => s.set);
  useEffect(() => {
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}
