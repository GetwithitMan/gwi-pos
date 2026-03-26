'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Persistent banner shown at the top of the POS when the current employee
 * is in training mode. Self-contained: fetches training settings on mount.
 * Only renders when the logged-in employee is a training employee.
 */
export function TrainingModeBanner() {
  const [isTraining, setIsTraining] = useState(false)
  const employeeId = useAuthStore(s => s.employee?.id)

  useEffect(() => {
    if (!employeeId) return
    fetch('/api/training')
      .then(r => r.json())
      .then(({ data }) => {
        if (data?.training?.enabled && data.training.trainingEmployeeIds?.includes(employeeId)) {
          setIsTraining(true)
        } else {
          setIsTraining(false)
        }
      })
      .catch(err => console.warn('training mode check failed:', err))
  }, [employeeId])

  if (!isTraining) return null

  return (
    <div className="w-full bg-orange-500 text-white text-center text-xs font-semibold py-1 tracking-wide select-none animate-pulse">
      TRAINING MODE — Orders will not be processed
    </div>
  )
}
