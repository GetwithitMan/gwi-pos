'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { RemoteVoidApprovalModal } from './RemoteVoidApprovalModal'
import type { UiModifier } from '@/types/orders'

interface OrderItem {
  id: string
  name: string
  quantity: number
  price: number
  modifiers: UiModifier[]  // ✅ Use canonical type
  status?: string
  voidReason?: string
  kitchenStatus?: 'pending' | 'sent' | 'cooking' | 'ready' | 'served'
  sentToKitchen?: boolean
}

interface CompVoidModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  item: OrderItem
  employeeId: string
  locationId: string
  terminalId?: string
  onComplete: (result: {
    action: 'comp' | 'void' | 'restore'
    orderAutoClosed?: boolean
    orderTotals: {
      subtotal: number
      discountTotal: number
      taxTotal: number
      total: number
    }
  }) => void
}

const COMMON_REASONS = {
  comp: [
    'Customer complaint',
    'Manager comp',
    'Employee meal',
    'Birthday/celebration',
    'VIP guest',
    'Quality issue',
    'Wrong order - our fault',
  ],
  void: [
    'Customer changed mind',
    'Wrong item entered',
    'Duplicate entry',
    'Item unavailable',
    'Customer left',
    'Test order',
  ],
}

export function CompVoidModal({
  isOpen,
  onClose,
  orderId,
  item,
  employeeId,
  locationId,
  terminalId,
  onComplete,
}: CompVoidModalProps) {
  const [action, setAction] = useState<'comp' | 'void' | null>(null)
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [wasMade, setWasMade] = useState<boolean | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRemoteApproval, setShowRemoteApproval] = useState(false)
  const [remoteApprovalCode, setRemoteApprovalCode] = useState<string | null>(null)

  const modifiersTotal = item.modifiers.reduce((sum, m) => sum + m.price, 0)
  const itemTotal = (item.price + modifiersTotal) * item.quantity

  const isCompedOrVoided = item.status === 'comped' || item.status === 'voided'

  const handleSubmit = async () => {
    const finalReason = reason === 'custom' ? customReason : reason

    if (!finalReason.trim()) {
      setError('Please select or enter a reason')
      return
    }

    if (!action) {
      setError('Please select an action')
      return
    }

    // For voids, require "was it made?" answer
    if (action === 'void' && wasMade === null) {
      setError('Please indicate if the item was already made')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/comp-void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          itemId: item.id,
          reason: finalReason,
          employeeId,
          wasMade: action === 'comp' ? true : wasMade,
          ...(remoteApprovalCode && { remoteApprovalCode }),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to process')
      }

      const result = await response.json()
      onComplete({
        action,
        orderAutoClosed: result.orderAutoClosed,
        orderTotals: result.orderTotals,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRestore = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/comp-void`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          employeeId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to restore')
      }

      const result = await response.json()
      onComplete({
        action: 'restore',
        orderTotals: result.orderTotals,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRemoteApprovalSuccess = async (approvalData: {
    approvalId: string
    managerId: string
    managerName: string
  }) => {
    // Code has been validated by RemoteVoidApprovalModal
    // The approval code is now used - close remote modal and complete void
    setShowRemoteApproval(false)

    // Store a flag that remote approval was used - the validate-code endpoint
    // already marked it as used, but we need to know for the void log
    // We'll re-fetch the code from the approval to link it
    setRemoteApprovalCode(approvalData.approvalId) // Using approvalId for tracking

    // Auto-submit the void with remote approval
    setIsProcessing(true)
    setError(null)
    const finalReason = reason === 'custom' ? customReason : reason

    try {
      // Fetch the actual approval code for the API call
      const statusResponse = await fetch(`/api/voids/remote-approval/${approvalData.approvalId}/status`)
      const statusData = await statusResponse.json()
      const code = statusData.data?.approvalCode

      const response = await fetch(`/api/orders/${orderId}/comp-void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          itemId: item.id,
          reason: finalReason,
          employeeId,
          wasMade: action === 'comp' ? true : wasMade,
          remoteApprovalCode: code,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to process')
      }

      const result = await response.json()
      onComplete({
        action: action!,
        orderTotals: result.orderTotals,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md" variant="default">
        <div className="bg-white rounded-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {isCompedOrVoided ? 'Restore Item' : 'Comp / Void Item'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Item Info */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold">
                  {item.quantity > 1 && `${item.quantity}x `}{item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-sm text-gray-500">
                    {item.modifiers.map(m => m.name).join(', ')}
                  </p>
                )}
              </div>
              <p className="font-bold">{formatCurrency(itemTotal)}</p>
            </div>
            {isCompedOrVoided && (
              <div className={`mt-2 text-sm ${item.status === 'comped' ? 'text-blue-600' : 'text-red-600'}`}>
                Status: {item.status?.toUpperCase()}
                {item.voidReason && <span className="block text-gray-500">Reason: {item.voidReason}</span>}
              </div>
            )}
          </div>

          {isCompedOrVoided ? (
            /* Restore UI */
            <div className="space-y-4">
              <p className="text-gray-600">
                This item has been {item.status}. Would you like to restore it to the order?
              </p>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleRestore}
                disabled={isProcessing}
              >
                {isProcessing ? 'Restoring...' : 'Restore Item'}
              </Button>
            </div>
          ) : (
            /* Comp/Void UI */
            <div className="space-y-4">
              {/* Action Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Action
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={action === 'comp' ? 'primary' : 'outline'}
                    className="h-16 flex-col"
                    onClick={() => {
                      setAction('comp')
                      setReason(COMMON_REASONS['comp'][0])
                      const autoWasMade = item.kitchenStatus && item.kitchenStatus !== 'pending' ? true : false
                      setWasMade(autoWasMade)
                    }}
                  >
                    <span className="text-lg">🎁</span>
                    <span>Comp</span>
                    <span className="text-xs opacity-75">Free item</span>
                  </Button>
                  <Button
                    variant={action === 'void' ? 'danger' : 'outline'}
                    className="h-16 flex-col"
                    onClick={() => {
                      setAction('void')
                      setReason(COMMON_REASONS['void'][0])
                      const autoWasMade = item.kitchenStatus && item.kitchenStatus !== 'pending' ? true : false
                      setWasMade(autoWasMade)
                    }}
                  >
                    <span className="text-lg">🗑️</span>
                    <span>Void</span>
                    <span className="text-xs opacity-75">Remove item</span>
                  </Button>
                </div>
              </div>

              {/* Reason Selection */}
              {action && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason
                  </label>
                  <div className="space-y-2">
                    {COMMON_REASONS[action].map((r) => (
                      <button
                        key={r}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          reason === r
                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => setReason(r)}
                      >
                        {r}
                      </button>
                    ))}
                    <button
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        reason === 'custom'
                          ? 'bg-blue-50 border-blue-500 text-blue-700'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => setReason('custom')}
                    >
                      Other (custom reason)
                    </button>
                  </div>

                  {reason === 'custom' && (
                    <input
                      type="text"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      className="w-full mt-2 px-3 py-2 border rounded-lg"
                      placeholder="Enter reason..."
                      autoFocus
                    />
                  )}
                </div>
              )}

              {/* Was it made? (void only) */}
              {action === 'void' && reason && (reason !== 'custom' || customReason.trim()) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Was this item already made?
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    This determines waste tracking for inventory and loss reports
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`px-4 py-3 rounded-lg border-2 font-medium transition-colors ${
                        wasMade === true
                          ? 'bg-red-50 border-red-500 text-red-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                      onClick={() => setWasMade(true)}
                    >
                      <span className="text-lg block mb-1">🍳</span>
                      Yes, it was made
                      <span className="block text-xs opacity-75 mt-0.5">Count as waste</span>
                    </button>
                    <button
                      className={`px-4 py-3 rounded-lg border-2 font-medium transition-colors ${
                        wasMade === false
                          ? 'bg-green-50 border-green-500 text-green-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                      onClick={() => setWasMade(false)}
                    >
                      <span className="text-lg block mb-1">✋</span>
                      No, not made
                      <span className="block text-xs opacity-75 mt-0.5">No waste</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Summary */}
              {action && reason && (
                <div className={`p-3 rounded-lg ${
                  action === 'comp' ? 'bg-blue-50' : 'bg-red-50'
                }`}>
                  <p className={`font-medium ${
                    action === 'comp' ? 'text-blue-700' : 'text-red-700'
                  }`}>
                    {action === 'comp' ? 'Comp' : 'Void'} {formatCurrency(itemTotal)}
                  </p>
                  <p className="text-sm text-gray-600">
                    {action === 'comp'
                      ? 'Item will remain on order but not charged'
                      : 'Item will be removed from order'}
                  </p>
                </div>
              )}

              {/* Submit */}
              {action && (
                <div className="space-y-2">
                  <Button
                    variant={action === 'comp' ? 'primary' : 'danger'}
                    className="w-full"
                    onClick={handleSubmit}
                    disabled={isProcessing || !reason || (reason === 'custom' && !customReason.trim()) || (action === 'void' && wasMade === null)}
                  >
                    {isProcessing
                      ? 'Processing...'
                      : `${action === 'comp' ? 'Comp' : 'Void'} Item`}
                  </Button>

                  {/* Remote Approval Option */}
                  {reason && (reason !== 'custom' || customReason.trim()) && (
                    <Button
                      variant="outline"
                      className="w-full text-blue-600 border-blue-300 hover:bg-blue-50"
                      onClick={() => setShowRemoteApproval(true)}
                      disabled={isProcessing}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Request Remote Manager Approval
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <Button variant="outline" className="w-full" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
        </div>
      </div>

      </Modal>

      {/* Remote Void Approval Modal */}
      <RemoteVoidApprovalModal
        isOpen={showRemoteApproval}
        onClose={() => setShowRemoteApproval(false)}
        locationId={locationId}
        orderId={orderId}
        orderItemId={item.id}
        itemName={item.name}
        amount={itemTotal}
        voidType={action === 'comp' ? 'comp' : 'item'}
        employeeId={employeeId}
        terminalId={terminalId}
        onSuccess={handleRemoteApprovalSuccess}
      />
    </>
  )
}
