'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PinPad } from '@/components/ui/pin-pad'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useDevStore } from '@/stores/dev-store'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const setHasDevAccess = useDevStore((state) => state.setHasDevAccess)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

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

      // Redirect based on defaultScreen preference
      const redirectParam = searchParams.get('redirect')
      if (redirectParam) {
        router.push(redirectParam)
      } else {
        const defaultScreen = data.employee.defaultScreen || 'orders'

        switch (defaultScreen) {
          case 'bar':
          case 'orders':
          default:
            router.push('/orders')
            break
          case 'kds':
            router.push('/kds')
            break
        }
      }
    } catch (err) {
      setError('Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
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
        <CardDescription>Enter your PIN to clock in</CardDescription>
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
