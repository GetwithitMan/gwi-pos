'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const DEVICE_TOKEN_KEY = 'kds_device_token'
const SCREEN_CONFIG_KEY = 'kds_screen_config'

function PairContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/kds'
  const screenSlug = searchParams.get('screen')

  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleInputChange = (index: number, value: string) => {
    // Only allow numbers
    const digit = value.replace(/\D/g, '').slice(-1)

    const newCode = [...code]
    newCode[index] = digit
    setCode(newCode)
    setError(null)

    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all digits are entered
    if (digit && index === 5) {
      const fullCode = [...newCode.slice(0, 5), digit].join('')
      if (fullCode.length === 6) {
        handleSubmit(fullCode)
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Enter') {
      const fullCode = code.join('')
      if (fullCode.length === 6) {
        handleSubmit(fullCode)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)

    if (pastedData.length === 6) {
      const newCode = pastedData.split('')
      setCode(newCode)
      inputRefs.current[5]?.focus()
      handleSubmit(pastedData)
    }
  }

  const handleSubmit = async (pairingCode: string) => {
    setIsLoading(true)
    setError(null)

    try {
      // Collect device info
      const deviceInfo = {
        userAgent: navigator.userAgent,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        platform: navigator.platform,
        pairedAt: new Date().toISOString(),
      }

      const response = await fetch('/api/hardware/kds-screens/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode, deviceInfo }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Pairing failed')
      }

      // Store device token and screen config in localStorage
      localStorage.setItem(DEVICE_TOKEN_KEY, data.deviceToken)
      localStorage.setItem(SCREEN_CONFIG_KEY, JSON.stringify(data.screen))

      setSuccess(true)

      // Redirect to KDS — always include screen slug from API response
      setTimeout(() => {
        const slug = data.screen.slug || screenSlug
        const targetUrl = slug ? `/kds?screen=${slug}` : returnTo
        router.push(targetUrl)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed')
      setCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setIsLoading(false)
    }
  }

  const handleClearStorage = () => {
    localStorage.removeItem(DEVICE_TOKEN_KEY)
    localStorage.removeItem(SCREEN_CONFIG_KEY)
    setError(null)
    setCode(['', '', '', '', '', ''])
    inputRefs.current[0]?.focus()
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Pair KDS Display</h1>
          <p className="text-gray-400">
            Enter the 6-digit code shown in your admin settings
          </p>
        </div>

        {/* Success State */}
        {success ? (
          <div className="bg-green-900/50 border border-green-500 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-green-400 mb-2">Paired Successfully!</h2>
            <p className="text-green-300">Redirecting to KDS...</p>
          </div>
        ) : (
          <>
            {/* Code Input */}
            <div className="bg-gray-800 rounded-2xl p-8 mb-6">
              <div className="flex justify-center gap-3 mb-6" onPaste={handlePaste}>
                {code.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleInputChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    disabled={isLoading}
                    className={`w-14 h-16 text-center text-3xl font-mono font-bold rounded-xl border-2 transition-all
                      ${error
                        ? 'border-red-500 bg-red-900/20 text-red-400'
                        : 'border-gray-600 bg-gray-900 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50'
                      }
                      ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                  />
                ))}
              </div>

              {/* Error Message */}
              {error && (
                <div className="text-center text-red-400 mb-4">
                  <p className="font-medium">{error}</p>
                  <p className="text-sm text-red-500 mt-1">Please try again or generate a new code</p>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="flex items-center justify-center gap-3 text-blue-400">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span>Verifying code...</span>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-gray-800/50 rounded-xl p-4 text-sm text-gray-400">
              <h3 className="font-medium text-gray-300 mb-2">How to get a pairing code:</h3>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <span className="text-blue-400">Settings → Hardware</span></li>
                <li>Click <span className="text-blue-400">Manage Screens</span></li>
                <li>Select a KDS screen and click <span className="text-blue-400">Generate Pairing Code</span></li>
                <li>Enter the 6-digit code above within 5 minutes</li>
              </ol>
            </div>

            {/* Debug/Admin Options */}
            <div className="mt-6 text-center">
              <button
                onClick={handleClearStorage}
                className="text-sm text-gray-500 hover:text-gray-400 underline"
              >
                Clear saved credentials
              </button>
            </div>
          </>
        )}

        {/* Back Button */}
        <div className="mt-8 text-center">
          <button
            onClick={() => router.push('/orders')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← Back to POS
          </button>
        </div>
      </div>
    </div>
  )
}

function PairLoading() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-gray-400 text-xl">Loading...</div>
    </div>
  )
}

export default function KDSPairPage() {
  return (
    <Suspense fallback={<PairLoading />}>
      <PairContent />
    </Suspense>
  )
}
