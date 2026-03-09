'use client'

import { useState, useRef } from 'react'
import { toast } from '@/stores/toast-store'

interface ImportResult {
  created: number
  skipped: number
  errors: { row: number; barcode: string; reason: string }[]
  total: number
}

interface BarcodeImportProps {
  locationId: string
  onComplete?: () => void
}

// Flexible column header matching
const BARCODE_HEADERS = ['barcode', 'upc', 'ean', 'code', 'sku']
const MENU_ITEM_HEADERS = ['menuitemname', 'menu_item_name', 'menu_item', 'item_name', 'item', 'name', 'menuitem']
const INVENTORY_HEADERS = ['inventoryitemname', 'inventory_item_name', 'inventory_item', 'inventory_name', 'inventory']
const PACK_SIZE_HEADERS = ['packsize', 'pack_size', 'pack', 'qty', 'quantity']
const PRICE_HEADERS = ['price', 'cost', 'price_override', 'override_price']
const LABEL_HEADERS = ['label', 'description', 'desc', 'type']

function matchHeader(header: string, candidates: string[]): boolean {
  const normalized = header.toLowerCase().replace(/[\s\-_'"]/g, '')
  return candidates.some(c => normalized === c.replace(/[\s\-_]/g, ''))
}

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex(h => matchHeader(h, candidates))
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''))
  const rows = lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      // Handle quoted values with commas
      const values: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/^["']|["']$/g, ''))
          current = ''
        } else {
          current += char
        }
      }
      values.push(current.trim().replace(/^["']|["']$/g, ''))

      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = values[i] || '' })
      return row
    })

  return { headers, rows }
}

const SAMPLE_CSV = `barcode,menuItemName,inventoryItemName,packSize,price,label
012345678901,Bud Light,,1,,Single
012345678902,Bud Light,,6,8.99,6-Pack
012345678903,Bud Light,,24,29.99,Case
012345678904,,Vodka House,1,,750ml
012345678905,Jack & Coke,,1,,`

export function BarcodeImport({ locationId, onComplete }: BarcodeImportProps) {
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { headers, rows } = parseCSV(text)
      if (headers.length === 0 || rows.length === 0) {
        toast.error('CSV appears empty or has no data rows')
        return
      }

      // Validate we can find at least the barcode column
      const barcodeIdx = findColumn(headers, BARCODE_HEADERS)
      if (barcodeIdx === -1) {
        toast.error('CSV must have a "barcode" column')
        return
      }

      setParsedHeaders(headers)
      setParsedRows(rows)
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (parsedRows.length === 0) return

    setImporting(true)
    setResult(null)

    try {
      const barcodeIdx = findColumn(parsedHeaders, BARCODE_HEADERS)
      const menuIdx = findColumn(parsedHeaders, MENU_ITEM_HEADERS)
      const invIdx = findColumn(parsedHeaders, INVENTORY_HEADERS)
      const packIdx = findColumn(parsedHeaders, PACK_SIZE_HEADERS)
      const priceIdx = findColumn(parsedHeaders, PRICE_HEADERS)
      const labelIdx = findColumn(parsedHeaders, LABEL_HEADERS)

      const rows = parsedRows.map(row => {
        const values = parsedHeaders.map(h => row[h] || '')
        return {
          barcode: barcodeIdx >= 0 ? values[barcodeIdx] : '',
          menuItemName: menuIdx >= 0 ? values[menuIdx] || undefined : undefined,
          inventoryItemName: invIdx >= 0 ? values[invIdx] || undefined : undefined,
          packSize: packIdx >= 0 && values[packIdx] ? parseInt(values[packIdx]) || undefined : undefined,
          price: priceIdx >= 0 && values[priceIdx] ? parseFloat(values[priceIdx]) || undefined : undefined,
          label: labelIdx >= 0 ? values[labelIdx] || undefined : undefined,
        }
      })

      const res = await fetch('/api/barcode/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, rows }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }))
        toast.error(err.error || 'Import failed')
        return
      }

      const data: ImportResult = await res.json()
      setResult(data)

      if (data.created > 0) {
        toast.success(`Imported ${data.created} barcode${data.created !== 1 ? 's' : ''}`)
        onComplete?.()
      } else if (data.skipped > 0 && data.errors.length === 0) {
        toast.info('All barcodes already existed — nothing new imported')
      } else {
        toast.error('No barcodes imported — check errors below')
      }
    } catch {
      toast.error('Failed to import barcodes')
    } finally {
      setImporting(false)
    }
  }

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'barcode-import-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClear = () => {
    setParsedHeaders([])
    setParsedRows([])
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const previewRows = parsedRows.slice(0, 10)

  return (
    <div className="space-y-4">
      {/* File Upload */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">CSV Import</h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Upload a CSV with columns: barcode, menuItemName, inventoryItemName, packSize, price, label
            </p>
          </div>
          <button
            onClick={handleDownloadSample}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
          >
            Download Sample CSV
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="block w-full text-sm text-gray-500
            file:mr-3 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100
            file:cursor-pointer cursor-pointer"
        />
      </div>

      {/* Preview Table */}
      {parsedRows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              Preview ({parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''})
              {parsedRows.length > 10 && <span className="text-gray-500 font-normal"> — showing first 10</span>}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClear}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
              >
                Clear
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing...' : `Import ${parsedRows.length} Rows`}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  {parsedHeaders.map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-600">{i + 1}</td>
                    {parsedHeaders.map((h) => (
                      <td key={h} className="px-3 py-2 text-sm text-gray-900 font-mono">
                        {row[h] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Import Results</h4>

          <div className="flex gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{result.created}</div>
              <div className="text-xs text-gray-500">Created</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{result.skipped}</div>
              <div className="text-xs text-gray-500">Skipped</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{result.errors.length}</div>
              <div className="text-xs text-gray-500">Errors</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-gray-600 mb-1">Error Details:</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {result.errors.map((err, i) => (
                  <div key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                    Row {err.row}: <span className="font-mono">{err.barcode || '(empty)'}</span> — {err.reason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
