import { create } from 'zustand'
import { uuid } from '@/lib/uuid'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
  timeoutId?: ReturnType<typeof setTimeout>
}

const MAX_TOASTS = 25

interface ToastStore {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id' | 'timeoutId'>) => void
  removeToast: (id: string) => void
  clearAll: () => void
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = uuid()
    const duration = toast.duration ?? (toast.type === 'error' ? 5000 : 3000)

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (duration > 0) {
      timeoutId = setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }))
      }, duration)
    }

    set((state) => {
      let toasts = [...state.toasts, { ...toast, id, timeoutId }]
      // Cap queue size — remove oldest toasts beyond limit
      while (toasts.length > MAX_TOASTS) {
        const oldest = toasts[0]
        if (oldest.timeoutId) clearTimeout(oldest.timeoutId)
        toasts = toasts.slice(1)
      }
      return { toasts }
    })
  },

  removeToast: (id) => {
    const toast = get().toasts.find((t) => t.id === id)
    if (toast?.timeoutId) clearTimeout(toast.timeoutId)
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  clearAll: () => {
    const { toasts } = get()
    for (const t of toasts) {
      if (t.timeoutId) clearTimeout(t.timeoutId)
    }
    set({ toasts: [] })
  },
}))

// Convenience functions for common toast types
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'success', message, duration }),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'error', message, duration }),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'warning', message, duration }),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast({ type: 'info', message, duration }),
}
