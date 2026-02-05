'use client'

interface OrderPanelActionsProps {
  hasItems: boolean
  hasPendingItems: boolean
  isSending?: boolean
  onSend?: () => void
  onPay?: () => void
  onDiscount?: () => void
  onClear?: () => void
}

export function OrderPanelActions({
  hasItems,
  hasPendingItems,
  isSending = false,
  onSend,
  onPay,
  onDiscount,
  onClear,
}: OrderPanelActionsProps) {
  const handleClear = () => {
    if (!hasItems) return

    const confirmed = window.confirm(
      'Are you sure you want to clear this order? This cannot be undone.'
    )

    if (confirmed) {
      onClear?.()
    }
  }

  return (
    <div
      style={{
        padding: '16px 20px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      {/* Primary actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        {onSend && (
          <button
            onClick={onSend}
            disabled={!hasPendingItems || isSending}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              background: hasPendingItems && !isSending
                ? 'linear-gradient(135deg, #3b82f6, #06b6d4)'
                : 'rgba(255, 255, 255, 0.1)',
              color: hasPendingItems && !isSending ? '#ffffff' : '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasPendingItems && !isSending ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              boxShadow: hasPendingItems && !isSending ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none',
            }}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        )}
        {onPay && (
          <button
            onClick={onPay}
            disabled={!hasItems}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              background: hasItems
                ? 'linear-gradient(135deg, #22c55e, #10b981)'
                : 'rgba(255, 255, 255, 0.1)',
              color: hasItems ? '#ffffff' : '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasItems ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              boxShadow: hasItems ? '0 4px 12px rgba(34, 197, 94, 0.3)' : 'none',
            }}
          >
            Pay
          </button>
        )}
      </div>

      {/* Secondary actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {onDiscount && (
          <button
            onClick={onDiscount}
            disabled={!hasItems}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: hasItems ? '#94a3b8' : '#475569',
              fontSize: '13px',
              fontWeight: 500,
              cursor: hasItems ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: hasItems ? 1 : 0.5,
            }}
          >
            Discount
          </button>
        )}
        {onClear && (
          <button
            onClick={handleClear}
            disabled={!hasItems}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              background: 'rgba(239, 68, 68, 0.1)',
              color: hasItems ? '#f87171' : '#475569',
              fontSize: '13px',
              fontWeight: 500,
              cursor: hasItems ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: hasItems ? 1 : 0.5,
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
