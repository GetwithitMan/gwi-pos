'use client'

import { Modal } from '@/components/ui/modal'

interface AgeVerificationModalProps {
  isOpen: boolean
  itemName: string
  minimumAge: number
  onVerified: () => void
  onCancel: () => void
}

/**
 * Age verification confirmation modal.
 * Manual verification only — no ID scanning.
 */
export function AgeVerificationModal({
  isOpen,
  itemName,
  minimumAge,
  onVerified,
  onCancel,
}: AgeVerificationModalProps) {
  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Age Verification Required" size="sm" variant="default">
      <div className="p-1">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Customer must be {minimumAge}+ to purchase
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {itemName}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-5">
          Verify the customer&apos;s government-issued photo ID before proceeding.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors min-h-[48px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onVerified}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors min-h-[48px]"
          >
            ID Verified
          </button>
        </div>
      </div>
    </Modal>
  )
}
