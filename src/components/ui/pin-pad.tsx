'use client'

import { useState, useCallback } from 'react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface PinPadProps {
  onSubmit: (pin: string) => void
  onSecondarySubmit?: (pin: string) => void
  submitLabel?: string
  secondaryLabel?: string
  maxLength?: number
  isLoading?: boolean
  error?: string
  showClear?: boolean
}

export function PinPad({ onSubmit, onSecondarySubmit, submitLabel = 'Login', secondaryLabel, maxLength = 6, isLoading, error, showClear = true }: PinPadProps) {
  const [pin, setPin] = useState('')

  const handleDigit = useCallback((digit: string) => {
    if (pin.length < maxLength) {
      setPin(prev => prev + digit)
    }
  }, [pin.length, maxLength])

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1))
  }, [])

  const handleClear = useCallback(() => {
    setPin('')
  }, [])

  const handleSubmit = useCallback(() => {
    if (pin.length >= 4) {
      onSubmit(pin)
      setPin('')
    }
  }, [pin, onSubmit])

  const handleSecondarySubmit = useCallback(() => {
    if (pin.length >= 4 && onSecondarySubmit) {
      onSecondarySubmit(pin)
      setPin('')
    }
  }, [pin, onSecondarySubmit])

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '']

  return (
    <div className="flex flex-col items-center gap-6">
      {/* PIN Display */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-3">
          {Array.from({ length: maxLength }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-4 h-4 rounded-full border-2 transition-all duration-150',
                i < pin.length
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-transparent border-gray-300'
              )}
            />
          ))}
        </div>
        {error && (
          <p className="text-red-500 text-sm font-medium">{error}</p>
        )}
      </div>

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-3">
        {digits.map((digit, i) => (
          <div key={i} className="w-20 h-20">
            {digit !== '' ? (
              <Button
                variant="outline"
                size="xl"
                className="w-full h-full text-2xl font-bold"
                onClick={() => handleDigit(digit)}
                disabled={isLoading}
                data-testid={`pin-digit-${digit}`}
              >
                {digit}
              </Button>
            ) : i === 9 && showClear ? (
              <Button
                variant="ghost"
                size="xl"
                className="w-full h-full text-sm"
                onClick={handleClear}
                disabled={isLoading}
              >
                Clear
              </Button>
            ) : i === 11 ? (
              <Button
                variant="ghost"
                size="xl"
                className="w-full h-full"
                onClick={handleBackspace}
                disabled={isLoading}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
                  />
                </svg>
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 w-full max-w-[268px]">
        <Button
          variant="primary"
          size="xl"
          className="w-full"
          onClick={handleSubmit}
          disabled={pin.length < 4 || isLoading}
          isLoading={isLoading}
          data-testid="pin-submit"
        >
          {submitLabel}
        </Button>
        {onSecondarySubmit && secondaryLabel && (
          <Button
            variant="outline"
            size="lg"
            className="w-full text-sm"
            onClick={handleSecondarySubmit}
            disabled={pin.length < 4 || isLoading}
          >
            {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
