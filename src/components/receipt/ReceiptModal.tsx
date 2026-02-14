'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Receipt, type ReceiptData } from './Receipt'
import type { ReceiptSettings } from '@/lib/settings'

interface ReceiptModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
  locationId: string
  receiptSettings?: Partial<ReceiptSettings>
  preloadedData?: ReceiptData | null
}

export function ReceiptModal({
  isOpen,
  onClose,
  orderId,
  locationId,
  receiptSettings,
  preloadedData,
}: ReceiptModalProps) {
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const receiptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || !orderId) {
      setReceiptData(null)
      setIsLoading(true)
      return
    }

    // Skip fetch if preloaded data is provided (from pay API response)
    if (preloadedData) {
      setReceiptData(preloadedData)
      setIsLoading(false)
      return
    }

    const fetchReceipt = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/orders/${orderId}/receipt?locationId=${locationId}`)
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to load receipt')
        }

        const data = await response.json()
        setReceiptData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load receipt')
      } finally {
        setIsLoading(false)
      }
    }

    fetchReceipt()
  }, [isOpen, orderId, locationId, preloadedData])

  const handlePrint = () => {
    // Create a new window with just the receipt content
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (!printWindow || !receiptRef.current) return

    const receiptHtml = receiptRef.current.innerHTML

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt</title>
          <style>
            @media print {
              @page {
                margin: 0;
                size: 80mm auto;
              }
            }
            body {
              font-family: 'Courier New', monospace;
              font-size: 12px;
              margin: 0;
              padding: 10px;
              width: 80mm;
              max-width: 80mm;
            }
            .receipt {
              width: 100%;
            }
            .text-center { text-align: center; }
            .text-xs { font-size: 10px; }
            .text-sm { font-size: 12px; }
            .text-lg { font-size: 14px; }
            .font-bold { font-weight: bold; }
            .font-mono { font-family: 'Courier New', monospace; }
            .italic { font-style: italic; }
            .text-gray-400, .text-gray-500, .text-gray-600 { color: #666; }
            .text-green-600 { color: #059669; }
            .text-red-600 { color: #dc2626; }
            .line-through { text-decoration: line-through; }
            .flex { display: flex; }
            .justify-between { justify-content: space-between; }
            .pl-4 { padding-left: 16px; }
            .ml-1 { margin-left: 4px; }
            .ml-2 { margin-left: 8px; }
            .mb-1 { margin-bottom: 4px; }
            .mb-2 { margin-bottom: 8px; }
            .mb-3 { margin-bottom: 12px; }
            .mt-1 { margin-top: 4px; }
            .mt-2 { margin-top: 8px; }
            .pb-3 { padding-bottom: 12px; }
            .pt-2 { padding-top: 8px; }
            .border-b { border-bottom: 1px dashed #999; }
            .border-t { border-top: 1px solid #ccc; }
            .border-dashed { border-style: dashed; }
            .border-gray-300 { border-color: #d1d5db; }
            .border-gray-400 { border-color: #999; }
          </style>
        </head>
        <body>
          ${receiptHtml}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              };
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-xl font-bold">Receipt</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-100">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          ) : receiptData ? (
            <div ref={receiptRef} className="shadow-lg">
              <Receipt data={receiptData} settings={receiptSettings} />
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              No receipt data available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handlePrint}
            disabled={isLoading || !receiptData}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </Button>
        </div>
      </div>
    </div>
  )
}
