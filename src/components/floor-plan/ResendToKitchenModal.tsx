'use client'

import { useState, useCallback } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'

interface ResendToKitchenModalProps {
  item: { itemId: string; itemName: string }
  onClose: () => void
}

export function ResendToKitchenModal({ item, onClose }: ResendToKitchenModalProps) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/kds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [item.itemId],
          action: 'resend',
          resendNote: note.trim() || undefined,
        }),
      })

      if (response.ok) {
        const store = useOrderStore.getState()
        const existingItem = store.currentOrder?.items.find(i => i.id === item.itemId)
        store.updateItem(item.itemId, {
          resendCount: (existingItem?.resendCount || 0) + 1,
        })
        onClose()
        toast.success('Item resent to kitchen')
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to resend item')
      }
    } catch (error) {
      console.error('Failed to resend item:', error)
      toast.error('Failed to resend item')
    } finally {
      setLoading(false)
    }
  }, [item, note, onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#1e293b',
          borderRadius: '12px',
          padding: '24px',
          width: '400px',
          maxWidth: '90vw',
          border: '1px solid rgba(245, 158, 11, 0.3)',
        }}
      >
        <h3
          style={{
            color: '#f1f5f9',
            fontSize: '18px',
            fontWeight: 600,
            marginBottom: '16px',
          }}
        >
          Resend to Kitchen
        </h3>
        <p
          style={{
            color: '#94a3b8',
            fontSize: '14px',
            marginBottom: '16px',
          }}
        >
          Resending: <strong style={{ color: '#e2e8f0' }}>{item.itemName}</strong>
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note for the kitchen (optional)"
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#e2e8f0',
            fontSize: '14px',
            resize: 'none',
            height: '80px',
            marginBottom: '16px',
            fontFamily: 'inherit',
          }}
        />
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '10px 20px',
              background: loading ? 'rgba(245, 158, 11, 0.5)' : '#f59e0b',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: loading ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#d97706'
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#f59e0b'
              }
            }}
          >
            {loading ? 'Sending...' : 'Resend'}
          </button>
        </div>
      </div>
    </div>
  )
}
