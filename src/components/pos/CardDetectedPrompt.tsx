'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/utils'
import type { CardDetection } from '@/hooks/useCardListener'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CardDetectedPromptProps {
  detection: CardDetection | null // null = hidden
  hasOrderOnScreen: boolean
  onOpenTab: (detectionId: string) => void
  onSaveCard: (detectionId: string) => void
  onViewTab: (detectionId: string, orderId: string) => void
  onDismiss: (detectionId: string) => void
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 20_000

// ─── Inline Icons ───────────────────────────────────────────────────────────

function CardIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H5a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cardLabel(card: CardDetection['card']): string {
  const brand = card.brand ?? 'Card'
  const last4 = card.last4 ? `••${card.last4}` : ''
  return `${brand} ${last4}`.trim()
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PromptButton({
  label,
  variant = 'secondary',
  onClick,
}: {
  label: string
  variant?: 'primary' | 'secondary' | 'ghost'
  onClick: () => void
}) {
  const styles: Record<string, string> = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500/50',
    secondary: 'bg-white/10 hover:bg-white/15 text-white border-white/10',
    ghost: 'bg-transparent hover:bg-white/5 text-slate-400 border-transparent',
  }

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${styles[variant]}`}
    >
      {label}
    </button>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CardDetectedPrompt({
  detection,
  hasOrderOnScreen,
  onOpenTab,
  onSaveCard,
  onViewTab,
  onDismiss,
}: CardDetectedPromptProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss after 20s
  useEffect(() => {
    if (!detection) return

    timerRef.current = setTimeout(() => {
      onDismiss(detection.detectionId)
    }, AUTO_DISMISS_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [detection, onDismiss])

  // Report prompt shown (best-effort)
  useEffect(() => {
    if (!detection) return
    fetch(`/api/card-detections/${detection.detectionId}/prompt-event`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'shown' }),
    }).catch(() => {})
  }, [detection])

  return (
    <AnimatePresence>
      {detection && (
        <motion.div
          key={detection.detectionId}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] w-[420px] max-w-[calc(100vw-32px)]"
        >
          <div className="bg-slate-800/95 backdrop-blur-lg border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-4">
            {/* ── Header row ── */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex-shrink-0">
                <CardIcon />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {cardLabel(detection.card)}
                </div>
                <div className="text-xs text-slate-400">
                  {detection.card.entryMethod === 'tap' ? 'Contactless' :
                   detection.card.entryMethod === 'insert' ? 'Chip' :
                   detection.card.entryMethod === 'swipe' ? 'Swipe' : 'Card detected'}
                  {detection.card.walletType && ` · ${detection.card.walletType === 'apple_pay' ? 'Apple Pay' : 'Google Pay'}`}
                </div>
              </div>
              <button
                onClick={() => onDismiss(detection.detectionId)}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
              >
                <XIcon />
              </button>
            </div>

            {/* ── Body: varies by match kind + hasOrderOnScreen ── */}
            {hasOrderOnScreen ? (
              <FlowB detection={detection} onOpenTab={onOpenTab} onSaveCard={onSaveCard} onViewTab={onViewTab} onDismiss={onDismiss} />
            ) : (
              <FlowA detection={detection} onOpenTab={onOpenTab} onViewTab={onViewTab} onDismiss={onDismiss} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Flow A: No Order on Screen ─────────────────────────────────────────────

function FlowA({
  detection,
  onOpenTab,
  onViewTab,
  onDismiss,
}: {
  detection: CardDetection
  onOpenTab: (id: string) => void
  onViewTab: (id: string, orderId: string) => void
  onDismiss: (id: string) => void
}) {
  const { match } = detection
  const did = detection.detectionId

  if (match.kind === 'open_tab_found' && match.orderId) {
    return (
      <>
        <p className="text-xs text-slate-300 mb-3">
          has Tab #{match.orderNumber} open
          {match.amount != null && <span className="text-emerald-400 font-semibold"> ({formatCurrency(match.amount / 100)})</span>}
        </p>
        <div className="flex items-center gap-2">
          <PromptButton label="View Existing Tab" variant="primary" onClick={() => onViewTab(did, match.orderId!)} />
          <PromptButton label="Start New Tab" onClick={() => onOpenTab(did)} />
          <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
        </div>
      </>
    )
  }

  if (match.kind === 'ambiguous' && match.tabs?.length) {
    return (
      <>
        <p className="text-xs text-slate-300 mb-2">Multiple open tabs found:</p>
        <div className="space-y-1 mb-3 max-h-[96px] overflow-y-auto">
          {match.tabs.slice(0, 3).map(tab => (
            <button
              key={tab.orderId}
              onClick={() => onViewTab(did, tab.orderId)}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white transition-colors"
            >
              <span>Tab #{tab.orderNumber}</span>
              <span className="text-emerald-400 font-medium">{formatCurrency(tab.amount / 100)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
        </div>
      </>
    )
  }

  // no_open_tab (default)
  return (
    <>
      <p className="text-xs text-slate-300 mb-3">New Customer</p>
      <div className="flex items-center gap-2">
        <PromptButton label="Start New Tab" variant="primary" onClick={() => onOpenTab(did)} />
        <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
      </div>
    </>
  )
}

// ─── Flow B: Order on Screen ────────────────────────────────────────────────

function FlowB({
  detection,
  onOpenTab,
  onSaveCard,
  onViewTab,
  onDismiss,
}: {
  detection: CardDetection
  onOpenTab: (id: string) => void
  onSaveCard: (id: string) => void
  onViewTab: (id: string, orderId: string) => void
  onDismiss: (id: string) => void
}) {
  const { match } = detection
  const did = detection.detectionId

  if (match.kind === 'open_tab_found' && match.orderId) {
    return (
      <>
        <p className="text-xs text-slate-300 mb-3">
          has Tab #{match.orderNumber}
          {match.amount != null && <span className="text-emerald-400 font-semibold"> ({formatCurrency(match.amount / 100)})</span>}
        </p>
        <div className="flex items-center gap-2">
          <PromptButton label="Use for This Order" variant="primary" onClick={() => onSaveCard(did)} />
          <PromptButton label="View Existing Tab" onClick={() => onViewTab(did, match.orderId!)} />
          <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
        </div>
      </>
    )
  }

  if (match.kind === 'ambiguous' && match.tabs?.length) {
    return (
      <>
        <p className="text-xs text-slate-300 mb-2">Multiple open tabs found:</p>
        <div className="space-y-1 mb-3 max-h-[96px] overflow-y-auto">
          {match.tabs.slice(0, 3).map(tab => (
            <button
              key={tab.orderId}
              onClick={() => onViewTab(did, tab.orderId)}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white transition-colors"
            >
              <span>Tab #{tab.orderNumber}</span>
              <span className="text-emerald-400 font-medium">{formatCurrency(tab.amount / 100)}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mb-2">Select a tab above to view it. &quot;Use for This Order&quot; is blocked until one tab is selected.</p>
        <div className="flex items-center gap-2">
          <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
        </div>
      </>
    )
  }

  // no_open_tab
  return (
    <>
      <p className="text-xs text-slate-300 mb-3">detected</p>
      <div className="flex items-center gap-2">
        <PromptButton label="Start New Tab" variant="primary" onClick={() => onOpenTab(did)} />
        <PromptButton label="Save Card" onClick={() => onSaveCard(did)} />
        <PromptButton label="Dismiss" variant="ghost" onClick={() => onDismiss(did)} />
      </div>
    </>
  )
}
