'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface LastCallTab {
  id: string
  tabName: string
  orderNumber: number
  subtotal: number
  hasCard: boolean
  cardLast4: string | null
  hasTip: boolean
  autoGratuity: number
  total: number
  employee: string
}

interface LastCallPreview {
  tabs: LastCallTab[]
  count: number
  autoGratuityPercent: number
  totalAutoGratuity: number
}

interface LastCallResult {
  closed: number
  total: number
  failed: string[]
  autoGratuityTotal: number
}

interface LastCallDialogProps {
  open: boolean
  onClose: () => void
  employeeId: string
}

type DialogState = 'loading' | 'preview' | 'processing' | 'results' | 'error'

export function LastCallDialog({ open, onClose, employeeId }: LastCallDialogProps) {
  const [state, setState] = useState<DialogState>('loading')
  const [preview, setPreview] = useState<LastCallPreview | null>(null)
  const [result, setResult] = useState<LastCallResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const loadPreview = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch(`/api/tabs/last-call?employeeId=${employeeId}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to load' }))
        throw new Error(data.error || 'Failed to load preview')
      }
      const data = await res.json()
      setPreview(data.data)
      setState('preview')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load preview')
      setState('error')
    }
  }, [employeeId])

  useEffect(() => {
    if (open) {
      loadPreview()
    } else {
      // Reset state when dialog closes
      setState('loading')
      setPreview(null)
      setResult(null)
      setErrorMessage('')
    }
  }, [open, loadPreview])

  const handleExecute = async () => {
    setState('processing')
    try {
      const res = await fetch('/api/tabs/last-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to execute' }))
        throw new Error(data.error || 'Last Call failed')
      }
      const data = await res.json()
      setResult(data.data)
      setState('results')

      if (data.data.closed > 0) {
        toast.success(`Closed ${data.data.closed} tab${data.data.closed === 1 ? '' : 's'}`)
      }
      if (data.data.failed?.length > 0) {
        toast.error(`${data.data.failed.length} tab${data.data.failed.length === 1 ? '' : 's'} failed`)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Last Call failed')
      setState('error')
    }
  }

  const handleClose = () => {
    onClose()
  }

  return (
    <Modal isOpen={open} onClose={handleClose} title="Last Call" size="lg">
      <div className="space-y-4">

        {/* Loading */}
        {state === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading open tabs...</div>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={loadPreview}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        {state === 'preview' && preview && (
          <div className="space-y-4">
            {preview.count === 0 ? (
              <div className="text-center py-6">
                <p className="text-gray-500 text-sm">No open tabs to close.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Close <strong>{preview.count}</strong> open tab{preview.count === 1 ? '' : 's'} with{' '}
                  <strong>{preview.autoGratuityPercent}%</strong> auto-gratuity on tabs without tips.
                </p>

                {/* Tab list */}
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {preview.tabs.map(tab => (
                    <div key={tab.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 truncate">{tab.tabName}</span>
                          {tab.hasCard && tab.cardLast4 && (
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              ****{tab.cardLast4}
                            </span>
                          )}
                          {!tab.hasCard && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">
                              No card
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{tab.employee}</div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <div className="text-sm font-medium text-gray-900">{formatCurrency(tab.subtotal)}</div>
                        {tab.autoGratuity > 0 && (
                          <div className="text-xs text-emerald-600">
                            +{formatCurrency(tab.autoGratuity)} tip
                          </div>
                        )}
                        {tab.hasTip && (
                          <div className="text-xs text-gray-400">Tip already set</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div className="bg-gray-50 rounded-lg p-3 flex justify-between items-center">
                  <span className="text-sm text-gray-600">Auto-gratuity total:</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(preview.totalAutoGratuity)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecute}
                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Close All Tabs
                  </button>
                </div>
              </>
            )}

            {preview.count === 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}

        {/* Processing */}
        {state === 'processing' && (
          <div className="flex flex-col items-center justify-center py-8 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
            <p className="text-sm text-gray-500">Closing tabs...</p>
          </div>
        )}

        {/* Results */}
        {state === 'results' && result && (
          <div className="space-y-4">
            {/* Success summary */}
            {result.closed > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-emerald-800">
                      Closed {result.closed} of {result.total} tab{result.total === 1 ? '' : 's'}
                    </p>
                    {result.autoGratuityTotal > 0 && (
                      <p className="text-xs text-emerald-700 mt-0.5">
                        Auto-gratuity: {formatCurrency(result.autoGratuityTotal)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Failures */}
            {result.failed.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800 mb-2">
                  {result.failed.length} tab{result.failed.length === 1 ? '' : 's'} failed:
                </p>
                <ul className="space-y-1">
                  {result.failed.map((msg, i) => (
                    <li key={i} className="text-xs text-red-700">{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
