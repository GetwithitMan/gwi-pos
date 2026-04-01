'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'
import { clientLog } from '@/lib/client-logger'
import type { OpenOrderHandoff as OpenOrder } from '@/types'

interface TipGroupOwned {
  id: string
  memberCount: number
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface ShiftHandoffModalProps {
  isOpen: boolean
  onClose: () => void
  shiftId: string
  employeeId: string
  locationId: string
  openOrders: OpenOrder[]
  tipGroupsOwned: TipGroupOwned[]
  onHandoffComplete: () => void
}

export function ShiftHandoffModal({
  isOpen,
  onClose,
  shiftId,
  employeeId,
  locationId,
  openOrders,
  tipGroupsOwned,
  onHandoffComplete,
}: ShiftHandoffModalProps) {
  const [step, setStep] = useState<'select' | 'confirm' | 'transferring' | 'done'>('select')
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [transferTipGroups, setTransferTipGroups] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [transferResult, setTransferResult] = useState<{
    ordersTransferred: number
    tipGroupsTransferred: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch employees with open shifts
  const fetchEligibleEmployees = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/employees?locationId=${locationId}&hasOpenShift=true&requestingEmployeeId=${employeeId}`
      )
      if (!res.ok) return

      const data = await res.json()
      const list = (data.data ?? data) as EmployeeOption[]

      // Filter out the current employee
      setEmployees(
        Array.isArray(list)
          ? list.filter((e) => e.id !== employeeId)
          : []
      )
    } catch {
      // Non-blocking — employee list is still usable if empty
    }
  }, [locationId, employeeId])

  useEffect(() => {
    if (isOpen) {
      setStep('select')
      setSelectedEmployeeId('')
      setTransferTipGroups(true)
      setTransferResult(null)
      setError(null)
      fetchEligibleEmployees()
    }
  }, [isOpen, fetchEligibleEmployees])

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId)
  const selectedName = selectedEmployee
    ? selectedEmployee.displayName || `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : ''

  const handleTransfer = async () => {
    if (!selectedEmployeeId) return

    setStep('transferring')
    setIsLoading(true)
    setError(null)

    let ordersTransferred = 0
    let tipGroupsTransferred = 0

    try {
      // 1. Transfer all open orders
      const orderRes = await fetch(`/api/shifts/${shiftId}/transfer-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmployeeId: selectedEmployeeId,
          requestingEmployeeId: employeeId,
        }),
      })

      if (!orderRes.ok) {
        const err = await orderRes.json()
        throw new Error(err.error || 'Failed to transfer orders')
      }

      const orderData = await orderRes.json()
      ordersTransferred = orderData.data?.transferred ?? 0

      // 2. Transfer tip groups if opted in
      if (transferTipGroups && tipGroupsOwned.length > 0) {
        for (const group of tipGroupsOwned) {
          try {
            const tipRes = await fetch(`/api/tips/groups/${group.id}/transfer`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-employee-id': employeeId,
              },
              body: JSON.stringify({
                toEmployeeId: selectedEmployeeId,
                removeFromEmployee: true,
              }),
            })

            if (tipRes.ok) {
              tipGroupsTransferred++
            } else {
              const err = await tipRes.json()
              clientLog.warn(`Failed to transfer tip group ${group.id}:`, err.error)
            }
          } catch {
            clientLog.warn(`Failed to transfer tip group ${group.id}`)
          }
        }
      }

      setTransferResult({ ordersTransferred, tipGroupsTransferred })
      setStep('done')
      toast.success(
        `Transferred ${ordersTransferred} order${ordersTransferred !== 1 ? 's' : ''} to ${selectedName}`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed')
      setStep('select')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shift Handoff" size="lg">
      <div className="space-y-4">
        {/* Step: Select employee */}
        {step === 'select' && (
          <>
            {error && (
              <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {/* Open orders summary */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Open Orders ({openOrders.length})
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {openOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between px-3 py-2 bg-gray-800/50 rounded text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300 font-mono">
                        #{order.orderNumber}
                      </span>
                      {order.tabName && (
                        <span className="text-gray-400">{order.tabName}</span>
                      )}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          order.status === 'sent'
                            ? 'bg-blue-500/20 text-blue-400'
                            : order.status === 'in_progress'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>
                    <span className="text-gray-200 font-medium">
                      {formatCurrency(order.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tip group notice */}
            {tipGroupsOwned.length > 0 && (
              <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-300 text-sm font-medium">
                      Tip Group{tipGroupsOwned.length > 1 ? 's' : ''} Owned
                    </p>
                    <p className="text-blue-400/70 text-xs mt-0.5">
                      {tipGroupsOwned.length} group{tipGroupsOwned.length > 1 ? 's' : ''} will be
                      transferred with your orders
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={transferTipGroups}
                      onChange={(e) => setTransferTipGroups(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-400">Transfer</span>
                  </label>
                </div>
              </div>
            )}

            {/* Employee picker */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Transfer to:
              </label>
              {employees.length === 0 ? (
                <p className="text-amber-400 text-sm">
                  No other employees with open shifts found.
                </p>
              ) : (
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select an employee...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={!selectedEmployeeId}
              >
                Transfer All
              </Button>
            </div>
          </>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && (
          <>
            <Card className="bg-amber-900/20 border-amber-700/50 p-4">
              <h3 className="text-amber-300 font-semibold text-sm mb-2">
                Confirm Transfer
              </h3>
              <p className="text-gray-300 text-sm">
                Transfer{' '}
                <span className="font-bold text-white">{openOrders.length}</span>{' '}
                open order{openOrders.length !== 1 ? 's' : ''}
                {transferTipGroups && tipGroupsOwned.length > 0 && (
                  <>
                    {' '}and{' '}
                    <span className="font-bold text-white">
                      {tipGroupsOwned.length}
                    </span>{' '}
                    tip group{tipGroupsOwned.length !== 1 ? 's' : ''}
                  </>
                )}{' '}
                to <span className="font-bold text-white">{selectedName}</span>?
              </p>
              <p className="text-gray-400 text-xs mt-2">
                This action cannot be undone. Tips earned before the transfer remain yours.
              </p>
            </Card>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button onClick={handleTransfer}>
                Confirm Transfer
              </Button>
            </div>
          </>
        )}

        {/* Step: Transferring */}
        {step === 'transferring' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-300 text-sm">Transferring orders...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && transferResult && (
          <>
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-green-300 font-semibold">Transfer Complete</h3>
              <p className="text-gray-300 text-sm text-center">
                {transferResult.ordersTransferred} order{transferResult.ordersTransferred !== 1 ? 's' : ''} transferred to {selectedName}
                {transferResult.tipGroupsTransferred > 0 && (
                  <>
                    <br />
                    {transferResult.tipGroupsTransferred} tip group{transferResult.tipGroupsTransferred !== 1 ? 's' : ''} transferred
                  </>
                )}
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => {
                  onClose()
                  onHandoffComplete()
                }}
              >
                Continue to Close Shift
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
