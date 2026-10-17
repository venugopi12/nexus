import { create } from 'zustand';
import { TIME_RANGES, type TimeRangeKey } from '@nexus/shared';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

export type Theme = 'dark' | 'light';
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem('nexus-theme', theme); } catch { /* noop */ }
}

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  paletteOpen: boolean;
  notificationsOpen: boolean;
  createIncidentOpen: boolean;
  theme: Theme;
  env: 'production' | 'staging';
  range: TimeRangeKey;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileNavOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setNotificationsOpen: (v: boolean) => void;
  setCreateIncidentOpen: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setEnv: (e: 'production' | 'staging') => void;
  setRange: (r: TimeRangeKey) => void;
}

const initialTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export const useUi = create<UiState>((set) => ({
  sidebarCollapsed: read('nexus-sidebar', false),
  mobileNavOpen: false,
  paletteOpen: false,
  notificationsOpen: false,
  createIncidentOpen: false,
  theme: typeof document === 'undefined' ? 'dark' : initialTheme(),
  env: read('nexus-env', 'production'),
  range: read<TimeRangeKey>('nexus-range', '1h'),
  setSidebarCollapsed: (v) => { write('nexus-sidebar', v); set({ sidebarCollapsed: v }); },
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setNotificationsOpen: (v) => set({ notificationsOpen: v }),
  setCreateIncidentOpen: (v) => set({ createIncidentOpen: v }),
  setTheme: (t) => { applyTheme(t); set({ theme: t }); },
  setEnv: (e) => { write('nexus-env', e); set({ env: e }); },
  setRange: (r) => { if (TIME_RANGES.some((x) => x.key === r)) { write('nexus-range', r); set({ range: r }); } },
}));

/* ------------------------------------------------------------------ recents */
interface Recent { id: string; kind: 'incident' | 'service' | 'trace' | 'page'; label: string; href: string; at: number }
interface RecentState {
  searches: string[];
  resources: Recent[];
  addSearch: (q: string) => void;
  addResource: (r: Omit<Recent, 'at'>) => void;
  clear: () => void;
}
export const useRecents = create<RecentState>((set, get) => ({
  searches: read('nexus-recent-searches', []),
  resources: read('nexus-recent-resources', []),
  addSearch: (q) => {
    const next = [q, ...get().searches.filter((s) => s !== q)].slice(0, 6);
    write('nexus-recent-searches', next);
    set({ searches: next });
  },
  addResource: (r) => {
    const next = [{ ...r, at: Date.now() }, ...get().resources.filter((x) => x.href !== r.href)].slice(0, 8);
    write('nexus-recent-resources', next);
    set({ resources: next });
  },
  clear: () => { write('nexus-recent-searches', []); write('nexus-recent-resources', []); set({ searches: [], resources: [] }); },
}));
