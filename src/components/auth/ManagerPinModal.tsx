'use client'

import { useState, useEffect } from 'react'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

interface ManagerPinModalProps {
  isOpen: boolean
  onClose: () => void
  onVerified: (managerId: string, managerName: string) => void
  title?: string
  message?: string
  locationId: string
}

export function ManagerPinModal({
  isOpen,
  onClose,
  onVerified,
  title = 'Manager Authorization Required',
  message = 'Enter manager PIN to continue',
  locationId,
}: ManagerPinModalProps) {
  const [pin, setPin] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const maxAttempts = 3

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPin('')
      setAttempts(0)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (pin.length < 4) {
      toast.error('PIN must be at least 4 digits')
      return
    }

    if (attempts >= maxAttempts) {
      toast.error('Too many failed attempts')
      onClose()
      return
    }

    setIsVerifying(true)
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, locationId }),
      })

      if (res.ok) {
        const data = await res.json()
        const managerName = `${data.employee.firstName} ${data.employee.lastName}`
        toast.success(`Authorized by ${managerName}`)
        onVerified(data.employee.id, managerName)
        onClose()
      } else {
        const { error } = await res.json()
        setAttempts((prev) => prev + 1)
        toast.error(error || 'Invalid PIN')
        setPin('')

        if (attempts + 1 >= maxAttempts) {
          toast.error('Too many failed attempts. Please try again later.')
          setTimeout(onClose, 2000)
        }
      }
    } catch (error) {
      console.error('PIN verification error:', error)
      toast.error('Failed to verify PIN')
    } finally {
      setIsVerifying(false)
    }
  }

  const handlePinChange = (value: string) => {
    // Only allow digits
    const digitsOnly = value.replace(/\D/g, '')
    setPin(digitsOnly.slice(0, 6)) // Max 6 digits
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
        <p className="text-sm text-gray-500 mb-6">{message}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Manager PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              placeholder="Enter 4-6 digit PIN"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-lg tracking-widest text-center focus:outline-none focus:border-indigo-500"
              autoFocus
              disabled={isVerifying}
            />
          </div>

          {attempts > 0 && attempts < maxAttempts && (
            <p className="text-sm text-red-400">
              {maxAttempts - attempts} {maxAttempts - attempts === 1 ? 'attempt' : 'attempts'} remaining
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isVerifying}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isVerifying || pin.length < 4}
              className="flex-1 px-4 py-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
