'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { getOrderVersion, handleVersionConflict } from '@/lib/order-version'
import { ManagerPinModal } from '@/components/auth/ManagerPinModal'

interface DiscountRule {
  id: string
  name: string
  displayText: string
  description?: string
  discountType: string
  discountConfig: {
    type: 'percent' | 'fixed'
    value: number
    maxAmount?: number
  }
  requiresApproval: boolean
  isActive: boolean
  isEmployeeDiscount: boolean
}

// Module-level cache — discount rules rarely change during a shift
let cachedDiscountRules: DiscountRule[] | null = null
let discountCacheLocationId: string | null = null

interface AppliedDiscount {
  id: string
  name: string
  amount: number
  percent?: number | null
  discountRuleId?: string | null
}

interface DiscountModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  orderSubtotal: number
  locationId: string
  employeeId: string
  appliedDiscounts: AppliedDiscount[]
  onDiscountApplied: (newTotals: {
    discountTotal: number
    taxTotal: number
    total: number
  }) => void
  /** When set, discount is applied to this specific item instead of the whole order */
  itemId?: string
  itemName?: string
}

type DiscountMode = 'select' | 'custom' | 'manage'

export function DiscountModal({
  isOpen,
  onClose,
  orderId,
  orderSubtotal,
  locationId,
  employeeId,
  appliedDiscounts,
  onDiscountApplied,
  itemId,
  itemName,
}: DiscountModalProps) {
  const isItemDiscount = !!itemId
  const discountUrl = isItemDiscount
    ? `/api/orders/${orderId}/items/${itemId}/discount`
    : `/api/orders/${orderId}/discount`
  const [mode, setMode] = useState<DiscountMode>('select')
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Custom discount state
  const [customType, setCustomType] = useState<'percent' | 'fixed'>('percent')
  const [customValue, setCustomValue] = useState('')
  const [customReason, setCustomReason] = useState('')

  // Manager PIN approval state (for 403 requiresApproval responses)
  const [showManagerPin, setShowManagerPin] = useState(false)
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<
    { type: 'preset'; rule: DiscountRule } | { type: 'custom' } | null
  >(null)

  // Load discount rules
  useEffect(() => {
    if (isOpen && locationId) {
      loadDiscountRules()
    }
  }, [isOpen, locationId])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode('select')
      setCustomValue('')
      setCustomReason('')
      setError(null)
    }
  }, [isOpen])

  const loadDiscountRules = async () => {
    // Use cached rules if available for same location
    if (cachedDiscountRules && discountCacheLocationId === locationId) {
      setDiscountRules(cachedDiscountRules)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        activeOnly: 'true',
        manualOnly: 'true',
      })
      const response = await fetch(`/api/discounts?${params}`)
      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        const rules = data.discounts || []
        setDiscountRules(rules)
        // Cache for subsequent opens
        cachedDiscountRules = rules
        discountCacheLocationId = locationId
      }
    } catch (err) {
      console.error('Failed to load discount rules:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyPreset = async (rule: DiscountRule, approvedById?: string) => {
    setIsProcessing(true)
    setError(null)

    try {
      const body = isItemDiscount
        ? {
            type: rule.discountConfig.type,
            value: rule.discountConfig.value,
            reason: rule.name,
            employeeId,
            discountRuleId: rule.id,
          }
        : {
            discountRuleId: rule.id,
            employeeId,
            version: getOrderVersion(),
            ...(approvedById && { approvedById }),
          }
      const response = await fetch(discountUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        if (await handleVersionConflict(response, orderId)) { onClose(); return }
        const data = await response.json()

        // Handle 403 with requiresApproval — prompt for manager PIN
        if (response.status === 403 && data.requiresApproval) {
          setPendingApprovalRequest({ type: 'preset', rule })
          setShowManagerPin(true)
          setIsProcessing(false)
          return
        }

        throw new Error(data.error || 'Failed to apply discount')
      }

      const rawResult = await response.json()
      const result = rawResult.data ?? rawResult

      if (isItemDiscount) {
        // Per-item endpoint returns { discount, newItemTotal, newOrderTotal }
        // Signal parent to refresh order data
        onDiscountApplied({ discountTotal: 0, taxTotal: 0, total: result.newOrderTotal ?? 0 })
      } else {
        onDiscountApplied(result.orderTotals)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply discount')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleApplyCustom = async (approvedById?: string) => {
    const value = parseFloat(customValue)
    if (!value || value <= 0) {
      setError('Please enter a valid discount amount')
      return
    }

    if (customType === 'percent' && value > 100) {
      setError('Percentage cannot exceed 100%')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const body = isItemDiscount
        ? { type: customType, value, reason: customReason || undefined, employeeId }
        : {
            type: customType,
            value,
            reason: customReason || undefined,
            employeeId,
            version: getOrderVersion(),
            ...(approvedById && { approvedById }),
          }
      const response = await fetch(discountUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        if (await handleVersionConflict(response, orderId)) { onClose(); return }
        const data = await response.json()

        // Handle 403 with requiresApproval — prompt for manager PIN
        if (response.status === 403 && data.requiresApproval) {
          setPendingApprovalRequest({ type: 'custom' })
          setShowManagerPin(true)
          setIsProcessing(false)
          return
        }

        throw new Error(data.error || 'Failed to apply discount')
      }

      const rawResult = await response.json()
      const result = rawResult.data ?? rawResult

      if (isItemDiscount) {
        onDiscountApplied({ discountTotal: 0, taxTotal: 0, total: result.newOrderTotal ?? 0 })
      } else {
        onDiscountApplied(result.orderTotals)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply discount')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRemoveDiscount = async (discountId: string) => {
    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(
        `${discountUrl}?discountId=${discountId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove discount')
      }

      const rawResult = await response.json()
      const result = rawResult.data ?? rawResult
      onDiscountApplied(result.orderTotals)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove discount')
    } finally {
      setIsProcessing(false)
    }
  }

  const calculatePreview = () => {
    const value = parseFloat(customValue) || 0
    if (customType === 'percent') {
      return Math.round(orderSubtotal * (value / 100) * 100) / 100
    }
    return Math.min(value, orderSubtotal)
  }

  const handleManagerPinVerified = (managerId: string, _managerName: string) => {
    setShowManagerPin(false)
    if (!pendingApprovalRequest) return

    // Retry the original request with manager approval
    if (pendingApprovalRequest.type === 'preset') {
      handleApplyPreset(pendingApprovalRequest.rule, managerId)
    } else {
      handleApplyCustom(managerId)
    }
    setPendingApprovalRequest(null)
  }

  const currentDiscountTotal = appliedDiscounts.reduce((sum, d) => sum + d.amount, 0)

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} size="md" variant="default">
      <div className="bg-white rounded-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-xl font-bold">{isItemDiscount ? `Discount: ${itemName}` : 'Apply Discount'}</h2>
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

          {/* Order Summary */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span>{isItemDiscount ? 'Item Price' : 'Subtotal'}</span>
              <span className="font-medium">{formatCurrency(orderSubtotal)}</span>
            </div>
            {currentDiscountTotal > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Current Discounts</span>
                <span>-{formatCurrency(currentDiscountTotal)}</span>
              </div>
            )}
          </div>

          {/* Applied Discounts */}
          {appliedDiscounts.length > 0 && mode === 'select' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm text-gray-700">Applied Discounts</h3>
                <button
                  className="text-sm text-blue-600 hover:text-blue-800"
                  onClick={() => setMode('manage')}
                >
                  Manage
                </button>
              </div>
              <div className="space-y-2">
                {appliedDiscounts.map(d => (
                  <div key={d.id} className="flex justify-between items-center p-2 bg-green-50 rounded text-sm">
                    <span className="text-green-800">{d.name}</span>
                    <span className="font-medium text-green-700">-{formatCurrency(d.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode: Select Discount */}
          {mode === 'select' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Quick Discounts</h3>

              {isLoading ? (
                <div className="text-center py-4 text-gray-500">Loading...</div>
              ) : discountRules.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No preset discounts available.
                  <br />
                  Use custom discount below.
                </div>
              ) : (() => {
                const employeeDiscounts = discountRules.filter(r => r.isEmployeeDiscount === true)
                const regularDiscounts = discountRules.filter(r => r.isEmployeeDiscount !== true)

                const renderButton = (rule: DiscountRule) => {
                  const config = rule.discountConfig
                  const preview = config.type === 'percent'
                    ? Math.round(orderSubtotal * (config.value / 100) * 100) / 100
                    : config.value

                  // Check if this rule is already applied (toggle behavior)
                  const existingDiscount = appliedDiscounts.find(
                    d => d.discountRuleId === rule.id || d.name === rule.displayText
                  )

                  if (existingDiscount) {
                    return (
                      <Button
                        key={rule.id}
                        variant="outline"
                        className="h-auto py-3 flex-col items-start text-left border-green-300 bg-green-50"
                        onClick={() => handleRemoveDiscount(existingDiscount.id)}
                        disabled={isProcessing}
                      >
                        <span className="font-medium text-green-700">{rule.displayText} ✓</span>
                        <span className="text-xs text-green-600">
                          -{formatCurrency(existingDiscount.amount)} · Tap to remove
                        </span>
                      </Button>
                    )
                  }

                  return (
                    <Button
                      key={rule.id}
                      variant="outline"
                      className="h-auto py-3 flex-col items-start text-left"
                      onClick={() => handleApplyPreset(rule)}
                      disabled={isProcessing}
                    >
                      <span className="font-medium">{rule.displayText}</span>
                      <span className="text-xs text-gray-500">
                        -{formatCurrency(preview)}
                      </span>
                    </Button>
                  )
                }

                return (
                  <>
                    {employeeDiscounts.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 text-xs font-bold bg-green-500 text-white rounded">
                            EMPLOYEE
                          </span>
                          <span className="text-sm font-medium text-green-800">Employee Discount</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {employeeDiscounts.map(renderButton)}
                        </div>
                      </div>
                    )}
                    {regularDiscounts.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {regularDiscounts.map(renderButton)}
                      </div>
                    )}
                  </>
                )
              })()}

              <div className="border-t pt-3 mt-3">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setMode('custom')}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Custom Discount
                </Button>
              </div>
            </div>
          )}

          {/* Mode: Custom Discount */}
          {mode === 'custom' && (
            <div className="space-y-4">
              <h3 className="font-medium">Custom Discount</h3>

              {/* Type Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={customType === 'percent' ? 'primary' : 'outline'}
                  className="flex-1"
                  onClick={() => setCustomType('percent')}
                >
                  Percentage %
                </Button>
                <Button
                  variant={customType === 'fixed' ? 'primary' : 'outline'}
                  className="flex-1"
                  onClick={() => setCustomType('fixed')}
                >
                  Fixed Amount $
                </Button>
              </div>

              {/* Value Input */}
              <div>
                <label className="text-sm text-gray-600 block mb-1">
                  {customType === 'percent' ? 'Percentage' : 'Amount'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-500">
                    {customType === 'percent' ? '%' : '$'}
                  </span>
                  <input
                    type="number"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 text-xl border rounded-lg"
                    placeholder="0"
                    step={customType === 'percent' ? '1' : '0.01'}
                    min="0"
                    max={customType === 'percent' ? '100' : undefined}
                  />
                </div>
              </div>

              {/* Preview */}
              {customValue && parseFloat(customValue) > 0 && (
                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="flex justify-between font-medium">
                    <span>Discount Amount:</span>
                    <span className="text-green-700">-{formatCurrency(calculatePreview())}</span>
                  </div>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-sm text-gray-600 block mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Manager comp, birthday, etc."
                />
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setMode('select')}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleApplyCustom}
                  disabled={isProcessing || !customValue}
                >
                  {isProcessing ? 'Applying...' : 'Apply Discount'}
                </Button>
              </div>
            </div>
          )}

          {/* Mode: Manage Discounts */}
          {mode === 'manage' && (
            <div className="space-y-3">
              <h3 className="font-medium">Manage Applied Discounts</h3>

              {appliedDiscounts.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  No discounts applied.
                </div>
              ) : (
                <div className="space-y-2">
                  {appliedDiscounts.map(d => (
                    <Card key={d.id} className="p-3">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">{d.name}</p>
                          <p className="text-sm text-green-600">
                            -{formatCurrency(d.amount)}
                            {d.percent && ` (${d.percent}%)`}
                          </p>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleRemoveDiscount(d.id)}
                          disabled={isProcessing}
                        >
                          Remove
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => setMode('select')}
              >
                Back
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <Button variant="outline" className="w-full" onClick={onClose} disabled={isProcessing}>
            Close
          </Button>
        </div>
      </div>
    </Modal>

    {/* Manager PIN Modal (for discount approval) */}
    <ManagerPinModal
      isOpen={showManagerPin}
      onClose={() => {
        setShowManagerPin(false)
        setPendingApprovalRequest(null)
      }}
      onVerified={handleManagerPinVerified}
      title="Manager Approval Required"
      message="This discount requires manager authorization. Enter manager PIN to continue."
      locationId={locationId}
    />
    </>
  )
}
