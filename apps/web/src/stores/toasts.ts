import { create } from 'zustand';

export interface Toast { id: string; title: string; description?: string; tone: 'default' | 'success' | 'error' | 'warning'; href?: string }
interface ToastState { toasts: Toast[]; push: (t: Omit<Toast, 'id'>, ttl?: number) => void; dismiss: (id: string) => void }

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttl = 5000) => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'success' }),
  error: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'error' }, 7000),
  info: (title: string, description?: string, href?: string) => useToasts.getState().push({ title, description, tone: 'default', href }),
  warning: (title: string, description?: string, href?: string) => useToasts.getState().push({ title, description, tone: 'warning', href }),
};
