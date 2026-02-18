'use client'

import { useToastStore, ToastType } from '@/stores/toast-store'

const toastStyles: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'bg-green-900/90',
    border: 'border-green-500',
    text: 'text-green-100',
    icon: '✓',
  },
  error: {
    bg: 'bg-red-900/90',
    border: 'border-red-500',
    text: 'text-red-100',
    icon: '✕',
  },
  warning: {
    bg: 'bg-yellow-900/90',
    border: 'border-yellow-500',
    text: 'text-yellow-100',
    icon: '⚠',
  },
  info: {
    bg: 'bg-blue-900/90',
    border: 'border-blue-500',
    text: 'text-blue-100',
    icon: 'ℹ',
  },
}

export function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)
  const removeToast = useToastStore(s => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md">
      {toasts.map((toast) => {
        const style = toastStyles[toast.type]
        return (
          <div
            key={toast.id}
            className={`
              ${style.bg} ${style.border} ${style.text}
              border rounded-lg px-4 py-3 shadow-lg backdrop-blur-sm
              flex items-center gap-3
              animate-in slide-in-from-right-5 fade-in duration-200
            `}
            role="alert"
          >
            <span className="text-lg font-bold">{style.icon}</span>
            <span className="flex-1 text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/60 hover:text-white transition-colors ml-2"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
