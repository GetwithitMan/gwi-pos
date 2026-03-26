'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'

interface GiftCardExportProps {
  locationId: string | undefined
}

export function GiftCardExport({ locationId }: GiftCardExportProps) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  async function handleExport(type: 'cards' | 'transactions') {
    if (!locationId) return
    setExporting(true)
    try {
      const params = new URLSearchParams({ type, locationId })
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)

      const response = await fetch(`/api/gift-cards/export?${params}`)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Export failed')
        return
      }

      // Download the CSV
      const blob = await response.blob()
      const contentDisposition = response.headers.get('Content-Disposition') || ''
      const filenameMatch = contentDisposition.match(/filename="(.+?)"/)
      const filename = filenameMatch?.[1] || `gift-cards-export.csv`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Exported ${type} CSV`)
    } catch (error) {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Export Data</h3>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">From (optional)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">To (optional)</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => handleExport('cards')}
          disabled={exporting}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Cards CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => handleExport('transactions')}
          disabled={exporting}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Transactions CSV
        </Button>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Leave date range empty to export all records. CSV files can be opened in Excel or Google Sheets.
      </p>
    </Card>
  )
}
