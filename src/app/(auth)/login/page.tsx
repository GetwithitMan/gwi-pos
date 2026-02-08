'use client'

import { useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PinPad } from '@/components/ui/pin-pad'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useDevStore } from '@/stores/dev-store'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const clockInStore = useAuthStore((state) => state.clockIn)
  const setHasDevAccess = useDevStore((state) => state.setHasDevAccess)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showClockInPrompt, setShowClockInPrompt] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [pendingEmployee, setPendingEmployee] = useState<{ id: string; locationId: string } | null>(null)
  const [clockingIn, setClockingIn] = useState(false)

  const getRedirectPath = useCallback((employee: { defaultScreen?: string }) => {
    const redirectParam = searchParams.get('redirect')
    if (redirectParam) return redirectParam
    const defaultScreen = employee.defaultScreen || 'orders'
    switch (defaultScreen) {
      case 'kds':
        return '/kds'
      case 'bar':
      case 'orders':
      default:
        return '/orders'
    }
  }, [searchParams])

  const handleClockInYes = async () => {
    if (!pendingEmployee) return
    setClockingIn(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: pendingEmployee.locationId,
          employeeId: pendingEmployee.id,
        }),
      })
      if (res.ok) {
        clockInStore()
      }
    } catch {
      // Non-blocking: clock-in failure shouldn't prevent POS access
    } finally {
      setClockingIn(false)
      setShowClockInPrompt(false)
      if (pendingRedirect) router.push(pendingRedirect)
    }
  }

  const handleClockInNo = () => {
    setShowClockInPrompt(false)
    if (pendingRedirect) router.push(pendingRedirect)
  }

  const handlePinSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid PIN')
        return
      }

      // Set dev access if employee has dev permissions
      setHasDevAccess(data.employee.isDevAccess || false)

      login(data.employee)

      const redirect = getRedirectPath(data.employee)

      // Check clock-in status
      try {
        const statusRes = await fetch(`/api/time-clock/status?employeeId=${data.employee.id}`)
        const statusData = await statusRes.json()

        if (statusRes.ok && statusData.clockedIn) {
          // Already clocked in — update store and redirect
          clockInStore()
          router.push(redirect)
          return
        }
      } catch {
        // Status check failed — just redirect (non-blocking)
        router.push(redirect)
        return
      }

      // Not clocked in — show prompt
      setPendingEmployee({ id: data.employee.id, locationId: data.employee.location.id })
      setPendingRedirect(redirect)
      setShowClockInPrompt(true)
    } catch (err) {
      setError('Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (showClockInPrompt) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Not Clocked In</CardTitle>
          <CardDescription className="text-base mt-2">
            You are not currently clocked in. Would you like to clock in now?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4 justify-center">
          <button
            onClick={handleClockInYes}
            disabled={clockingIn}
            className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-lg disabled:opacity-50 transition-colors"
          >
            {clockingIn ? 'Clocking In...' : 'Yes, Clock In'}
          </button>
          <button
            onClick={handleClockInNo}
            disabled={clockingIn}
            className="px-8 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg text-lg disabled:opacity-50 transition-colors"
          >
            No, Skip
          </button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>
        <CardTitle className="text-2xl">GWI POS</CardTitle>
        <CardDescription>Enter your PIN to sign in</CardDescription>
      </CardHeader>
      <CardContent>
        <PinPad
          onSubmit={handlePinSubmit}
          isLoading={isLoading}
          error={error}
        />
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <Suspense fallback={
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">Loading...</p>
          </CardContent>
        </Card>
      }>
        <LoginContent />
      </Suspense>
    </div>
  )
}
