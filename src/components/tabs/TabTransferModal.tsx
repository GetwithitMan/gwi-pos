'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface Employee {
  id: string
  displayName?: string
  firstName: string
  lastName: string
}

interface TabTransferModalProps {
  isOpen: boolean
  onClose: () => void
  tabId: string
  tabName: string | null
  currentEmployeeId: string
  locationId: string
  onTransferComplete: (newEmployee: { id: string; name: string }) => void
}

export function TabTransferModal({
  isOpen,
  onClose,
  tabId,
  tabName,
  currentEmployeeId,
  locationId,
  onTransferComplete,
}: TabTransferModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && locationId) {
      loadEmployees()
    }
  }, [isOpen, locationId])

  useEffect(() => {
    if (isOpen) {
      setSelectedEmployeeId(null)
      setReason('')
      setError(null)
    }
  }, [isOpen])

  const loadEmployees = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/employees?${params}`)
      if (response.ok) {
        const data = await response.json()
        // Filter out current employee and inactive employees
        const available = (data.employees || []).filter(
          (emp: Employee & { isActive?: boolean }) =>
            emp.id !== currentEmployeeId && emp.isActive !== false
        )
        setEmployees(available)
      }
    } catch (err) {
      console.error('Failed to load employees:', err)
      setError('Failed to load employees')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  const handleTransfer = async () => {
    if (!selectedEmployeeId) {
      setError('Please select an employee')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/tabs/${tabId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmployeeId: selectedEmployeeId,
          fromEmployeeId: currentEmployeeId,
          reason: reason || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to transfer tab')
      }

      const result = await response.json()
      onTransferComplete(result.tab.newEmployee)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer tab')
    } finally {
      setIsProcessing(false)
    }
  }

  const getEmployeeName = (emp: Employee) => {
    return emp.displayName || `${emp.firstName} ${emp.lastName}`
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Transfer Tab</h2>
            {tabName && <p className="text-sm text-gray-500">{tabName}</p>}
          </div>
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

          <p className="text-gray-600 mb-4">
            Select an employee to transfer this tab to:
          </p>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading employees...</div>
          ) : employees.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No other employees available for transfer.
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {employees.map((emp) => (
                <Card
                  key={emp.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    selectedEmployeeId === emp.id
                      ? 'bg-blue-50 border-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedEmployeeId === emp.id
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300'
                      }`}
                    >
                      {selectedEmployeeId === emp.id && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="font-medium">{getEmployeeName(emp)}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="e.g., Shift change, covering break"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleTransfer}
            disabled={isProcessing || !selectedEmployeeId}
          >
            {isProcessing ? 'Transferring...' : 'Transfer Tab'}
          </Button>
        </div>
      </div>
    </div>
  )
}
