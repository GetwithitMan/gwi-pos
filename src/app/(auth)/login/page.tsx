'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PinPad } from '@/components/ui/pin-pad'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useDevStore } from '@/stores/dev-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'
import type { LoginMessage } from '@/lib/settings'

function LoginMessages() {
  const [messages, setMessages] = useState<LoginMessage[]>([])

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(raw => {
        const data = raw.data ?? raw
        const s = data.settings || data
        const loginMsgs = s.loginMessages
        if (!loginMsgs?.enabled || !loginMsgs.messages?.length) return

        // Filter out expired messages
        const now = new Date()
        const active = loginMsgs.messages.filter((m: LoginMessage) => {
          if (!m.expiresAt) return true
          return new Date(m.expiresAt) > now
        })
        setMessages(active)
      })
      .catch(err => console.warn('login page messages fetch failed:', err))
  }, [])

  if (messages.length === 0) return null

  const typeStyles: Record<string, string> = {
    info: 'bg-gray-700/80 border-gray-600 text-gray-200',
    warning: 'bg-amber-900/60 border-amber-600 text-amber-100',
    urgent: 'bg-red-900/70 border-red-500 text-red-100 animate-pulse',
  }

  return (
    <div className="w-full max-w-md mt-4 space-y-2 max-h-40 overflow-y-auto">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`rounded-lg border px-4 py-2.5 text-sm ${typeStyles[msg.type] || typeStyles.info}`}
        >
          {msg.type === 'urgent' && (
            <span className="font-bold mr-1.5">!</span>
          )}
          {msg.text}
        </div>
      ))}
    </div>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const clockInStore = useAuthStore((state) => state.clockIn)
  const setHasDevAccess = useDevStore((state) => state.setHasDevAccess)
  const setWorkingRole = useAuthStore((state) => state.setWorkingRole)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [pendingEmployee, setPendingEmployee] = useState<{ id: string; locationId: string } | null>(null)
  const [pendingAvailableRoles, setPendingAvailableRoles] = useState<{ id: string; name: string; cashHandlingMode: string; isPrimary: boolean }[]>([])
  const [showTimeClockModal, setShowTimeClockModal] = useState(false)
  const [welcomeName, setWelcomeName] = useState<string | null>(null)
  const [breakPrompt, setBreakPrompt] = useState<{ name: string; onBreak: boolean; entryId: string; emp: any } | null>(null)
  const [breakActionLoading, setBreakActionLoading] = useState(false)

  const employee = useAuthStore((state) => state.employee)

  const getRedirectPath = useCallback((employee: { defaultScreen?: string; permissions?: string[] }) => {
    const redirectParam = searchParams.get('redirect')
    if (redirectParam) return redirectParam

    // Non-POS employees go to Crew Hub
    if (employee.permissions && !hasPermission(employee.permissions, PERMISSIONS.POS_ACCESS)) {
      return '/crew'
    }

    const defaultScreen = employee.defaultScreen || 'orders'
    switch (defaultScreen) {
      case 'kds':
        return '/kds'
      case 'crew':
        return '/crew'
      case 'bar':
      case 'orders':
      default:
        return '/orders'
    }
  }, [searchParams])

  const handleRoleSelected = (role: { id: string; name: string; cashHandlingMode: string; isPrimary: boolean }) => {
    setWorkingRole(role)
    setShowRolePicker(false)
    setShowTimeClockModal(true)
  }

  const handleTimeClockClose = async () => {
    setShowTimeClockModal(false)
  }

  const handleClockInSuccess = (entryId: string) => {
    clockInStore({ entryId })
  }

  const authenticatePin = async (pin: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    const json = await response.json()

    if (!response.ok) {
      throw new Error(json.error || 'Invalid PIN')
    }

    const data = json.data
    setHasDevAccess(data.employee.isDevAccess || false)
    login(data.employee)

    const roles = data.employee.availableRoles || []
    if (roles.length === 1) {
      setWorkingRole(roles[0])
    }
    setPendingAvailableRoles(roles)
    setPendingEmployee({ id: data.employee.id, locationId: data.employee.location.id })
    setPendingRedirect(getRedirectPath(data.employee))

    return data.employee
  }

  const handlePinSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const emp = await authenticatePin(pin)

      try {
        const statusRes = await fetch(`/api/time-clock/status?employeeId=${emp.id}`)
        const statusData = await statusRes.json()
        const clockData = statusData.data ?? statusData

        if (statusRes.ok && clockData.clockedIn) {
          clockInStore({ entryId: clockData.entryId, clockInTime: clockData.clockInTime })
          const name = emp.displayName || emp.firstName || 'there'

          // If on break, show resume prompt instead of auto-redirect
          if (clockData.onBreak) {
            setBreakPrompt({ name, onBreak: true, entryId: clockData.entryId, emp })
            return
          }

          // Clocked in, not on break — show welcome with optional "Start Break" link
          setBreakPrompt({ name, onBreak: false, entryId: clockData.entryId, emp })
          return
        }
      } catch {}

      setError('Must clock in first')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClockInOutSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const emp = await authenticatePin(pin)

      const workingRole = useAuthStore.getState().workingRole
      if ((emp.availableRoles || []).length > 1 && !workingRole) {
        setShowRolePicker(true)
        return
      }

      setShowTimeClockModal(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (welcomeName) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-4">
            <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-1">Welcome, {welcomeName}!</h2>
          <p className="text-gray-400 text-sm">Redirecting...</p>
        </CardContent>
      </Card>
    )
  }

  if (breakPrompt) {
    const handleBreakAction = async (action: 'resume' | 'start_break' | 'continue') => {
      if (action === 'continue') {
        // Just redirect — no break action needed
        setWelcomeName(breakPrompt.name)
        setTimeout(() => router.push(getRedirectPath(breakPrompt.emp)), 800)
        setBreakPrompt(null)
        return
      }
      setBreakActionLoading(true)
      try {
        const res = await fetch('/api/time-clock', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: breakPrompt.entryId,
            action: action === 'resume' ? 'endBreak' : 'startBreak',
          }),
        })
        if (!res.ok) {
          const json = await res.json()
          setError(json.error || 'Break action failed')
          setBreakPrompt(null)
          return
        }
        setWelcomeName(breakPrompt.name)
        setTimeout(() => router.push(getRedirectPath(breakPrompt.emp)), 800)
        setBreakPrompt(null)
      } catch {
        setError('Connection error')
        setBreakPrompt(null)
      } finally {
        setBreakActionLoading(false)
      }
    }

    return (
      <Card className="w-full max-w-md">
        <CardContent className="py-8">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold mb-1">Welcome, {breakPrompt.name}</h2>
            {breakPrompt.onBreak ? (
              <p className="text-amber-400 text-sm">You are currently on break</p>
            ) : (
              <p className="text-green-400 text-sm">You are clocked in</p>
            )}
          </div>
          <div className="space-y-3">
            {breakPrompt.onBreak ? (
              <>
                <button
                  onClick={() => handleBreakAction('resume')}
                  disabled={breakActionLoading}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl font-semibold transition-all"
                >
                  {breakActionLoading ? 'Resuming...' : 'Resume from Break'}
                </button>
                <button
                  onClick={() => handleBreakAction('continue')}
                  disabled={breakActionLoading}
                  className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Continue to POS (stay on break)
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleBreakAction('continue')}
                  disabled={breakActionLoading}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-semibold transition-all"
                >
                  Continue to POS
                </button>
                <button
                  onClick={() => handleBreakAction('start_break')}
                  disabled={breakActionLoading}
                  className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  {breakActionLoading ? 'Starting break...' : 'Start Break'}
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (showRolePicker) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Working As</CardTitle>
          <CardDescription className="text-base mt-2">
            Which role are you working today?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pendingAvailableRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => handleRoleSelected(role)}
              className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
                role.isPrimary
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
            >
              {role.name}
              {role.isPrimary && (
                <span className="ml-2 text-xs opacity-70">(Primary)</span>
              )}
            </button>
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
    {showTimeClockModal && pendingEmployee && employee && (
      <TimeClockModal
        isOpen={showTimeClockModal}
        onClose={handleTimeClockClose}
        employeeId={pendingEmployee.id}
        employeeName={employee.displayName || `${employee.firstName} ${employee.lastName}`}
        locationId={pendingEmployee.locationId}
        permissions={employee.permissions}
        workingRoleId={useAuthStore.getState().workingRole?.id}
        onClockInSuccess={handleClockInSuccess}
      />
    )}

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
          onSecondarySubmit={handleClockInOutSubmit}
          submitLabel="Login"
          secondaryLabel="Clock In / Out"
          isLoading={isLoading}
          error={error}
        />
      </CardContent>
    </Card>
    <LoginMessages />
    </>
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
