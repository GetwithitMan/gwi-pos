'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/stores/toast-store'

interface Employee {
  id: string
  displayName: string | null
  firstName: string
  lastName: string
}

interface TabTransferModalProps {
  isOpen: boolean
  onClose: () => void
  tabId: string
  tabName: string | null
  currentEmployeeId: string
  currentEmployeeName: string
  locationId: string
  onTransferComplete: () => void
}

export function TabTransferModal({
  isOpen,
  onClose,
  tabId,
  tabName,
  currentEmployeeId,
  currentEmployeeName,
  locationId,
  onTransferComplete,
}: TabTransferModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setSelectedEmployeeId(null)
      setReason('')
      setError(null)
      loadEmployees()
    }
  }, [isOpen])

  const loadEmployees = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/employees?locationId=${locationId}&active=true`)
      if (response.ok) {
        const data = await response.json()
        const list: Employee[] = (data.data || data || []).filter(
          (emp: Employee) => emp.id !== currentEmployeeId
        )
        setEmployees(list)
      } else {
        setError('Failed to load employees')
      }
    } catch {
      setError('Failed to load employees')
    } finally {
      setIsLoading(false)
    }
  }

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
          reason: reason.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to transfer tab')
      }

      const data = await response.json()
      const newName = data.data?.tab?.newEmployee?.name || 'another bartender'
      toast.success(`Tab transferred to ${newName}`)
      onTransferComplete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer tab')
    } finally {
      setIsProcessing(false)
    }
  }

  const getEmployeeName = (emp: Employee) =>
    emp.displayName || `${emp.firstName} ${emp.lastName}`

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
                Transfer Tab
              </h2>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                {tabName || 'Unnamed tab'} — currently with {currentEmployeeName}
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
            Transfer to
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
              Loading employees...
            </div>
          ) : employees.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
              No other active employees found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: selectedEmployeeId === emp.id
                      ? '2px solid rgba(139, 92, 246, 0.6)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    background: selectedEmployeeId === emp.id
                      ? 'rgba(139, 92, 246, 0.15)'
                      : 'rgba(255, 255, 255, 0.03)',
                    color: selectedEmployeeId === emp.id ? '#c4b5fd' : '#e2e8f0',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: selectedEmployeeId === emp.id
                        ? 'rgba(139, 92, 246, 0.3)'
                        : 'rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      color: selectedEmployeeId === emp.id ? '#a78bfa' : '#64748b',
                      flexShrink: 0,
                    }}
                  >
                    {getEmployeeName(emp).charAt(0).toUpperCase()}
                  </div>
                  {getEmployeeName(emp)}
                </button>
              ))}
            </div>
          )}

          {/* Optional reason */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Reason (optional)
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Shift change"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#e2e8f0',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>
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
            onClick={handleTransfer}
            disabled={isProcessing || !selectedEmployeeId}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              background: !selectedEmployeeId || isProcessing
                ? 'rgba(100, 116, 139, 0.2)'
                : '#8b5cf6',
              color: !selectedEmployeeId || isProcessing ? '#64748b' : '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              cursor: !selectedEmployeeId || isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {isProcessing ? 'Transferring...' : 'Transfer Tab'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
