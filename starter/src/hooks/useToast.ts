import { create } from 'zustand';
import type { Toast, ToastType } from '../components/ui/Toast';

interface ToastState {
  toasts: Toast[];
  showToast: (type: ToastType, title: string, message?: string, options?: Partial<Toast>) => void;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

let nextToastId = 0;

/**
 * Toasts live in one shared store, so a toast raised by any component is rendered by the
 * single <ToastContainer> mounted in App. Auto-dismissal is handled by the toast itself.
 */
const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (type, title, message, options) => {
    nextToastId += 1;
    const toast: Toast = {
      id: `toast-${nextToastId}`,
      type,
      title,
      message,
      duration: type === 'error' ? 8000 : 5000,
      ...options,
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clearAllToasts: () => set({ toasts: [] }),
}));

export function useToast(): ToastState {
  return useToastStore();
}
