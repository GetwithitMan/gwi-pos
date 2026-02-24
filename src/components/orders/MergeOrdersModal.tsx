'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface TargetOrder {
  id: string
  orderNumber: number
  orderType: string
  tabName: string | null
  tableNumber: string | null
  total: number
  itemCount: number
  employeeName: string
}

interface MergeOrdersModalProps {
  isOpen: boolean
  onClose: () => void
  currentOrderId: string
  currentOrderNumber: number
  locationId: string
  employeeId: string
  onMergeComplete: () => void
}

export function MergeOrdersModal({
  isOpen,
  onClose,
  currentOrderId,
  currentOrderNumber,
  locationId,
  employeeId,
  onMergeComplete,
}: MergeOrdersModalProps) {
  const [orders, setOrders] = useState<TargetOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setSelectedOrderId(null)
      setError(null)
      loadOrders()
    }
  }, [isOpen])

  const loadOrders = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/orders/${currentOrderId}/transfer-items?${params}`)
      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        setOrders(data.orders || [])
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to load orders')
      }
    } catch {
      setError('Failed to load orders')
    } finally {
      setIsLoading(false)
    }
  }

  const selectedOrder = orders.find(o => o.id === selectedOrderId)

  const getOrderLabel = (order: TargetOrder) => {
    if (order.orderType === 'bar_tab' && order.tabName) {
      return `${order.tabName} (Tab #${order.orderNumber})`
    }
    if (order.tableNumber) {
      return `Table ${order.tableNumber} (#${order.orderNumber})`
    }
    return `Order #${order.orderNumber}`
  }

  const handleMerge = async () => {
    if (!selectedOrderId) {
      setError('Please select an order to merge')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${currentOrderId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceOrderId: selectedOrderId,
          employeeId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to merge orders')
      }

      const data = await response.json()
      const moved = data.data?.itemsMoved || 0
      toast.success(`Merged ${moved} item${moved !== 1 ? 's' : ''} into order #${currentOrderNumber}`)
      onMergeComplete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge orders')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" variant="glass">
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.98)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                Merge Orders
              </h2>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                Merge another order into Order #{currentOrderNumber}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#94a3b8',
                cursor: 'pointer',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {error && (
            <div
              style={{
                marginBottom: '12px',
                padding: '10px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '13px',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Select order to merge in
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
              Loading orders...
            </div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
              <p>No other open orders to merge.</p>
              <p style={{ fontSize: '12px', marginTop: '8px' }}>
                There must be another open order at this location to merge.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {orders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: selectedOrderId === order.id
                      ? '2px solid rgba(251, 191, 36, 0.6)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    background: selectedOrderId === order.id
                      ? 'rgba(251, 191, 36, 0.1)'
                      : 'rgba(255, 255, 255, 0.03)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: selectedOrderId === order.id ? '#fde68a' : '#e2e8f0',
                    }}>
                      {getOrderLabel(order)}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#64748b',
                      marginTop: '2px',
                    }}>
                      {order.itemCount} item{order.itemCount !== 1 ? 's' : ''} · {order.employeeName}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: selectedOrderId === order.id ? '#fbbf24' : '#94a3b8',
                  }}>
                    {formatCurrency(order.total)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Merge preview */}
          {selectedOrder && (
            <div
              style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                borderRadius: '10px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24', marginBottom: '6px' }}>
                Merge Preview
              </div>
              <div style={{ fontSize: '13px', color: '#e2e8f0' }}>
                All {selectedOrder.itemCount} item{selectedOrder.itemCount !== 1 ? 's' : ''} from{' '}
                <strong>{getOrderLabel(selectedOrder)}</strong> will be moved into Order #{currentOrderNumber}.
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                The source order will be voided after merge.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            gap: '10px',
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={isProcessing || !selectedOrderId}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              background: !selectedOrderId || isProcessing
                ? 'rgba(100, 116, 139, 0.2)'
                : '#d97706',
              color: !selectedOrderId || isProcessing ? '#64748b' : '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              cursor: !selectedOrderId || isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {isProcessing ? 'Merging...' : 'Merge Orders'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
