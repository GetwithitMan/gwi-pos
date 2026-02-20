'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

function CloudAuthContent() {
  const [status, setStatus] = useState<'validating' | 'success' | 'error'>(
    'validating'
  )
  const [errorMsg, setErrorMsg] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((s) => s.login)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setErrorMsg('No authentication token provided.')
      return
    }

    fetch('/api/auth/cloud-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setStatus('error')
          setErrorMsg(data.error || 'Authentication failed.')
          return
        }

        // Populate client-side auth store
        // API returns { data: { employee } } — unwrap the data envelope
        login(data.data?.employee)
        setStatus('success')

        // Navigate to settings (admin home for cloud users)
        router.replace('/settings')
      })
      .catch(() => {
        setStatus('error')
        setErrorMsg('Connection error. Please try again.')
      })
  }, [searchParams, login, router])

  if (status === 'error') {
    return (
      <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-8 text-center">
        <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">
          Access Denied
        </h1>
        <p className="text-gray-400 mb-6">{errorMsg}</p>
        <a
          href="https://app.thepasspos.com"
          className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Return to Mission Control
        </a>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-8 text-center">
        <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">
          Access Granted
        </h1>
        <p className="text-gray-400">Redirecting to admin panel...</p>
      </div>
    )
  }

  // Validating state
  return (
    <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-8 text-center">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <h1 className="text-xl font-semibold text-white mb-2">
        Authenticating...
      </h1>
      <p className="text-gray-400">
        Verifying your access from Mission Control.
      </p>
    </div>
  )
}

export default function CloudAuthPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">
              Loading...
            </h1>
          </div>
        }
      >
        <CloudAuthContent />
      </Suspense>
    </div>
  )
}
