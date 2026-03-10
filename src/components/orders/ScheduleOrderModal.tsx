'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

interface ScheduleOrderModalProps {
  isOpen: boolean
  onClose: () => void
  onSchedule: (scheduledFor: string) => void
  maxAdvanceHours?: number
  minAdvanceMinutes?: number
}

// Quick-select time options (minutes from now)
const QUICK_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
]

export function ScheduleOrderModal({
  isOpen,
  onClose,
  onSchedule,
  maxAdvanceHours = 72,
  minAdvanceMinutes = 30,
}: ScheduleOrderModalProps) {
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      // Default to today + minAdvanceMinutes from now
      const defaultTime = new Date(Date.now() + minAdvanceMinutes * 60 * 1000)
      setSelectedDate(defaultTime.toISOString().split('T')[0])
      const hours = String(defaultTime.getHours()).padStart(2, '0')
      const mins = String(Math.ceil(defaultTime.getMinutes() / 15) * 15).padStart(2, '0')
      setSelectedTime(`${hours}:${mins === '60' ? '00' : mins}`)
      setError(null)
    }
  }, [isOpen, minAdvanceMinutes])

  const handleQuickSelect = (minutesFromNow: number) => {
    const scheduled = new Date(Date.now() + minutesFromNow * 60 * 1000)
    setSelectedDate(scheduled.toISOString().split('T')[0])
    const hours = String(scheduled.getHours()).padStart(2, '0')
    const mins = String(Math.round(scheduled.getMinutes() / 5) * 5).padStart(2, '0')
    setSelectedTime(`${hours}:${mins}`)
    setError(null)
  }

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) {
      setError('Please select a date and time')
      return
    }

    const scheduledFor = new Date(`${selectedDate}T${selectedTime}:00`)
    const now = new Date()

    if (isNaN(scheduledFor.getTime())) {
      setError('Invalid date/time')
      return
    }

    const diffMs = scheduledFor.getTime() - now.getTime()
    const diffMin = diffMs / 60000

    if (diffMin < minAdvanceMinutes) {
      setError(`Must be at least ${minAdvanceMinutes} minutes in the future`)
      return
    }

    if (diffMin > maxAdvanceHours * 60) {
      setError(`Cannot schedule more than ${maxAdvanceHours} hours ahead`)
      return
    }

    onSchedule(scheduledFor.toISOString())
    onClose()
  }

  // Compute min/max for date input
  const now = new Date()
  const minDate = now.toISOString().split('T')[0]
  const maxDate = new Date(now.getTime() + maxAdvanceHours * 60 * 60 * 1000).toISOString().split('T')[0]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Schedule for Later" size="md" variant="default">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Set the time this order should be fired to the kitchen.
        </p>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Quick select buttons */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Quick Select</label>
          <div className="flex flex-wrap gap-2">
            {QUICK_OPTIONS.filter(o => o.minutes >= minAdvanceMinutes && o.minutes <= maxAdvanceHours * 60).map(option => (
              <Button
                key={option.minutes}
                variant="outline"
                size="sm"
                onClick={() => handleQuickSelect(option.minutes)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Date picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => { setSelectedDate(e.target.value); setError(null) }}
            min={minDate}
            max={maxDate}
            className="w-full px-3 py-2 border rounded-lg text-lg"
          />
        </div>

        {/* Time picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Time</label>
          <input
            type="time"
            value={selectedTime}
            onChange={(e) => { setSelectedTime(e.target.value); setError(null) }}
            className="w-full px-3 py-2 border rounded-lg text-lg"
          />
        </div>

        {/* Preview */}
        {selectedDate && selectedTime && (
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-sm text-purple-700">
              This order will fire at:{' '}
              <span className="font-bold">
                {new Date(`${selectedDate}T${selectedTime}:00`).toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-4 border-t mt-4">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-1" onClick={handleConfirm}>
          Schedule Order
        </Button>
      </div>
    </Modal>
  )
}
