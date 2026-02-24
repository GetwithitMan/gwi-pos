'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface PreviewRow {
  name: string
  price: string
  category: string
  cost: string
  sku: string
  description: string
}

interface ImportResult {
  imported: number
  skipped: number
  errors: { row: number; error: string }[]
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current.trim())
  return fields
}

function normalizeHeader(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '')
  const headerMap: Record<string, string> = {
    name: 'name',
    itemname: 'name',
    item: 'name',
    menuitem: 'name',
    product: 'name',
    price: 'price',
    itemprice: 'price',
    saleprice: 'price',
    category: 'category',
    categoryname: 'category',
    dept: 'category',
    department: 'category',
    cost: 'cost',
    itemcost: 'cost',
    foodcost: 'cost',
    sku: 'sku',
    itemsku: 'sku',
    barcode: 'sku',
    upc: 'sku',
    description: 'description',
    desc: 'description',
    itemdescription: 'description',
  }
  return headerMap[h] || h
}

const SAMPLE_CSV = `name,price,category,cost,sku,description
Cheeseburger,12.99,Burgers,4.50,BRG-001,Classic beef burger with cheese
Chicken Wings,10.99,Appetizers,3.25,APP-001,6 crispy wings with sauce
Caesar Salad,9.49,Salads,2.75,SAL-001,Romaine with caesar dressing
Margarita,11.00,Cocktails,2.50,DRK-001,Classic lime margarita
French Fries,5.99,Sides,1.25,SDE-001,Crispy golden fries`

export default function MenuImportPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/menu/import' })

  const locationId = employee?.location?.id
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [totalRowCount, setTotalRowCount] = useState(0)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const parseFile = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

      if (lines.length < 2) {
        toast.error('CSV must have a header row and at least one data row')
        setFile(null)
        return
      }

      const rawHeaders = parseCSVLine(lines[0])
      const normalized = rawHeaders.map(normalizeHeader)
      setHeaders(normalized)
      setTotalRowCount(lines.length - 1)

      const nameIdx = normalized.indexOf('name')
      const priceIdx = normalized.indexOf('price')
      const categoryIdx = normalized.indexOf('category')
      const costIdx = normalized.indexOf('cost')
      const skuIdx = normalized.indexOf('sku')
      const descIdx = normalized.indexOf('description')

      const rows: PreviewRow[] = []
      const previewCount = Math.min(lines.length - 1, 10)
      for (let i = 1; i <= previewCount; i++) {
        const fields = parseCSVLine(lines[i])
        rows.push({
          name: nameIdx !== -1 ? fields[nameIdx] || '' : '',
          price: priceIdx !== -1 ? fields[priceIdx] || '' : '',
          category: categoryIdx !== -1 ? fields[categoryIdx] || '' : '',
          cost: costIdx !== -1 ? fields[costIdx] || '' : '',
          sku: skuIdx !== -1 ? fields[skuIdx] || '' : '',
          description: descIdx !== -1 ? fields[descIdx] || '' : '',
        })
      }
      setPreviewRows(rows)
    }
    reader.readAsText(selectedFile)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) parseFile(selectedFile)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.type === 'text/csv')) {
      parseFile(droppedFile)
    } else {
      toast.error('Please drop a .csv file')
    }
  }

  const handleImport = async () => {
    if (!file || !locationId) return

    setIsImporting(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('locationId', locationId)

      const res = await fetch('/api/import/menu', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error || 'Import failed')
        return
      }

      setResult(json.data)
      if (json.data.imported > 0) {
        toast.success(`Imported ${json.data.imported} items`)
      }
      if (json.data.errors?.length > 0) {
        toast.warning(`${json.data.errors.length} rows had errors`)
      }
    } catch (error) {
      console.error('Import failed:', error)
      toast.error('Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sample-menu-import.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setFile(null)
    setHeaders([])
    setPreviewRows([])
    setTotalRowCount(0)
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const hasNameColumn = headers.includes('name')
  const hasPriceColumn = headers.includes('price')
  const canImport = file && hasNameColumn && hasPriceColumn && !isImporting

  if (!hydrated || !employee) return null

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="Import Menu from CSV"
        subtitle="Upload a CSV file to bulk-import menu items"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Menu Import', href: '/settings/menu/import' },
        ]}
      />

      <div className="mx-auto max-w-4xl">
        {/* Upload Area */}
        {!result && (
          <div className="rounded-xl bg-white p-6 shadow-sm mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Upload CSV File</h2>
              <button
                onClick={handleDownloadSample}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Download sample CSV
              </button>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                isDragOver
                  ? 'border-blue-400 bg-blue-50'
                  : file
                    ? 'border-green-300 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />

              {file ? (
                <div>
                  <svg className="mx-auto h-10 w-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-green-700">{file.name}</p>
                  <p className="text-xs text-green-600 mt-1">
                    {totalRowCount} data row{totalRowCount !== 1 ? 's' : ''} detected
                  </p>
                </div>
              ) : (
                <div>
                  <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-gray-700">
                    Drop a CSV file here or click to browse
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Required columns: name, price. Optional: category, cost, sku, description
                  </p>
                </div>
              )}
            </div>

            {/* Column Detection */}
            {headers.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="text-xs text-gray-500 leading-6">Detected columns:</span>
                {headers.map((h) => {
                  const recognized = ['name', 'price', 'category', 'cost', 'sku', 'description'].includes(h)
                  return (
                    <span
                      key={h}
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        recognized
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {h}
                      {!recognized && ' (ignored)'}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Validation Warnings */}
            {headers.length > 0 && (!hasNameColumn || !hasPriceColumn) && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                {!hasNameColumn && <p>Missing required column: <strong>name</strong></p>}
                {!hasPriceColumn && <p>Missing required column: <strong>price</strong></p>}
              </div>
            )}
          </div>
        )}

        {/* Preview Table */}
        {previewRows.length > 0 && !result && (
          <div className="rounded-xl bg-white shadow-sm mb-6 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                Preview {previewRows.length < totalRowCount ? `(first ${previewRows.length} of ${totalRowCount} rows)` : `(${totalRowCount} rows)`}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Category</th>
                    {headers.includes('cost') && <th className="px-4 py-3">Cost</th>}
                    {headers.includes('sku') && <th className="px-4 py-3">SKU</th>}
                    {headers.includes('description') && <th className="px-4 py-3">Description</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {previewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-gray-900">{row.name || <span className="text-red-400 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-gray-700">{row.price || <span className="text-red-400 italic">empty</span>}</td>
                      <td className="px-4 py-2 text-gray-600">{row.category || <span className="text-gray-300">-</span>}</td>
                      {headers.includes('cost') && <td className="px-4 py-2 text-gray-600">{row.cost || <span className="text-gray-300">-</span>}</td>}
                      {headers.includes('sku') && <td className="px-4 py-2 text-gray-600">{row.sku || <span className="text-gray-300">-</span>}</td>}
                      {headers.includes('description') && <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{row.description || <span className="text-gray-300">-</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Import Actions */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={handleReset}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Choose different file
              </button>
              <button
                onClick={handleImport}
                disabled={!canImport}
                className="rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isImporting ? 'Importing...' : `Import ${totalRowCount} item${totalRowCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Import Results */}
        {result && (
          <div className="rounded-xl bg-white p-6 shadow-sm mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Import Complete</h2>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs font-medium text-green-600 mt-1">Imported</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-600">{result.skipped}</p>
                <p className="text-xs font-medium text-gray-500 mt-1">Skipped (duplicates)</p>
              </div>
              <div className={`rounded-lg p-4 text-center border ${
                result.errors.length > 0
                  ? 'bg-red-50 border-red-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <p className={`text-2xl font-bold ${result.errors.length > 0 ? 'text-red-700' : 'text-gray-600'}`}>
                  {result.errors.length}
                </p>
                <p className={`text-xs font-medium mt-1 ${result.errors.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  Errors
                </p>
              </div>
            </div>

            {/* Error Details */}
            {result.errors.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Error Details</h3>
                <div className="rounded-lg bg-red-50 border border-red-200 divide-y divide-red-100 max-h-48 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="px-4 py-2 text-sm">
                      <span className="font-medium text-red-700">Row {err.row}:</span>{' '}
                      <span className="text-red-600">{err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleReset}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Import Another File
              </button>
              <Link
                href="/menu"
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
              >
                Go to Menu &rarr;
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
