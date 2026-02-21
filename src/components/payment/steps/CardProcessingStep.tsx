/**
 * Card Processing Step
 *
 * Handles card payment processing via Datacap.
 * Shows processing state and terminal instructions.
 */

import React from 'react'

type ProcessingStatus = 'idle' | 'checking_reader' | 'waiting_card' | 'authorizing' | 'approved' | 'declined' | 'error'

const STATUS_LABELS: Record<ProcessingStatus, string> = {
  idle: 'Ready',
  checking_reader: 'Verifying reader\u2026',
  waiting_card: 'Present card\u2026',
  authorizing: 'Authorizing\u2026',
  approved: 'Approved',
  declined: 'Declined',
  error: 'Error \u2014 try again',
}

interface CardProcessingStepProps {
  isProcessing: boolean
  amount: number
  terminalId?: string
  onCancel: () => void
  instructions?: string
  status?: ProcessingStatus
}

export function CardProcessingStep({
  isProcessing,
  amount,
  terminalId,
  onCancel,
  instructions = 'Please follow the prompts on the card reader',
  status,
}: CardProcessingStepProps) {
  if (!terminalId) {
    return (
      <div className="text-center py-8">
        <div className="text-red-600 mb-4">⚠️ Terminal not configured</div>
        <p className="text-gray-600 mb-4">
          Please configure a payment terminal in settings before processing card payments.
        </p>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold"
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="text-center py-8 space-y-4">
      {/* Processing indicator */}
      {isProcessing && (
        <>
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>

          <div className="text-xl font-bold text-gray-800">
            Processing Card Payment
          </div>

          {status && (
            <div className="text-sm text-gray-500">
              {STATUS_LABELS[status] ?? 'Processing\u2026'}
            </div>
          )}

          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-lg font-bold text-blue-600 mb-2">
              ${amount.toFixed(2)}
            </div>
            <div className="text-sm text-gray-600">
              {instructions}
            </div>
          </div>

          {/* Card reader animation */}
          <div className="flex justify-center items-center gap-2 py-4">
            <div className="w-16 h-20 bg-gray-200 rounded-lg border-2 border-gray-300 flex items-center justify-center">
              <div className="text-3xl">💳</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-75"></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-150"></div>
            </div>
            <div className="w-16 h-24 bg-gray-700 rounded-lg flex items-center justify-center">
              <div className="w-12 h-16 bg-gray-800 rounded"></div>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Terminal: {terminalId}
          </div>
        </>
      )}

      {/* Cancel button (only show if processing) */}
      {isProcessing && (
        <button
          onClick={onCancel}
          className="mt-4 px-6 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg font-bold transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
