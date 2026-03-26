'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'

interface ImportResult {
  imported: number
  skipped: number
  errors: { row: number; cardNumber: string; error: string }[]
  batchId: string | null
}

interface RangePreview {
  preview: string[]
  count: number
}

interface GiftCardImportProps {
  locationId: string | undefined
  onImportComplete: () => void
}

export function GiftCardImport({ locationId, onImportComplete }: GiftCardImportProps) {
  // File upload state
  const [dragOver, setDragOver] = useState(false)
  const [fileCardNumbers, setFileCardNumbers] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Range generator state
  const [prefix, setPrefix] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [rangePreview, setRangePreview] = useState<RangePreview | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ generated: number; skipped: number } | null>(null)

  // ── File Upload ──────────────────────────────────────────────────────────

  function parseFile(file: File) {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) return
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
      const numbers = lines.map(l => {
        const parts = l.includes('\t') ? l.split('\t') : l.split(',')
        return parts[0].trim().toUpperCase()
      }).filter(n => n.length >= 4)
      setFileCardNumbers(numbers)
      setImportResult(null)
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  async function handleImport() {
    if (!locationId || fileCardNumbers.length === 0) return
    setImporting(true)
    try {
      const response = await fetch('/api/gift-cards/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumbers: fileCardNumbers }),
      })

      if (response.ok) {
        const data: ImportResult = await response.json()
        setImportResult(data)
        if (data.imported > 0) {
          toast.success(`Imported ${data.imported} card${data.imported !== 1 ? 's' : ''}`)
          onImportComplete()
        }
      } else {
        const data = await response.json()
        toast.error(data.error || 'Import failed')
      }
    } catch (error) {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  function clearFile() {
    setFileCardNumbers([])
    setFileName(null)
    setImportResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // ── Range Generator ──────────────────────────────────────────────────────

  async function handleDryRun() {
    if (!locationId || !prefix || !rangeStart || !rangeEnd) return
    setGenerating(true)
    setRangePreview(null)
    try {
      const response = await fetch('/api/gift-cards/generate-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          start: parseInt(rangeStart),
          end: parseInt(rangeEnd),
          dryRun: true,
        }),
      })

      if (response.ok) {
        const data: RangePreview = await response.json()
        setRangePreview(data)
      } else {
        const data = await response.json()
        toast.error(data.error || 'Preview failed')
      }
    } catch (error) {
      toast.error('Preview failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateRange() {
    if (!locationId || !prefix || !rangeStart || !rangeEnd) return
    setGenerating(true)
    try {
      const response = await fetch('/api/gift-cards/generate-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          start: parseInt(rangeStart),
          end: parseInt(rangeEnd),
          dryRun: false,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setGenerateResult({ generated: data.generated, skipped: data.skipped })
        if (data.generated > 0) {
          toast.success(`Generated ${data.generated} card number${data.generated !== 1 ? 's' : ''}`)
          onImportComplete()
        }
        setRangePreview(null)
      } else {
        const data = await response.json()
        toast.error(data.error || 'Generation failed')
      }
    } catch (error) {
      toast.error('Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── File Upload ─────────────────────────────────────────────────── */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Import from File</h3>

        {/* Dropzone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileSelect}
          />
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400 mt-1">CSV or TXT file. One card number per line.</p>
        </div>

        {/* File preview */}
        {fileCardNumbers.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">
                {fileName} - {fileCardNumbers.length} card number{fileCardNumbers.length !== 1 ? 's' : ''} found
              </p>
              <Button variant="ghost" size="sm" onClick={clearFile}>Clear</Button>
            </div>
            <div className="max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-2 text-xs font-mono space-y-0.5">
              {fileCardNumbers.slice(0, 20).map((num, i) => (
                <div key={i} className="text-gray-700">{num}</div>
              ))}
              {fileCardNumbers.length > 20 && (
                <div className="text-gray-400">... and {fileCardNumbers.length - 20} more</div>
              )}
            </div>
            <div className="mt-3">
              <Button
                variant="primary"
                size="sm"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? 'Importing...' : `Import ${fileCardNumbers.length} Cards`}
              </Button>
            </div>
          </div>
        )}

        {/* Import results */}
        {importResult && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50">
            <div className="flex gap-4 text-sm">
              <span className="text-green-600 font-medium">Imported: {importResult.imported}</span>
              {importResult.skipped > 0 && (
                <span className="text-amber-600 font-medium">Skipped: {importResult.skipped}</span>
              )}
            </div>
            {importResult.errors.length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                {importResult.errors.map((err, i) => (
                  <div key={i} className="text-red-600">
                    Row {err.row}: {err.cardNumber} - {err.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Range Generator ─────────────────────────────────────────────── */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Generate Card Number Range</h3>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="GWI"
              maxLength={10}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Start</label>
            <input
              type="number"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="1"
              min="1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">End</label>
            <input
              type="number"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="100"
              min="1"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDryRun}
            disabled={generating || !prefix || !rangeStart || !rangeEnd}
          >
            Preview
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerateRange}
            disabled={generating || !prefix || !rangeStart || !rangeEnd}
          >
            {generating ? 'Generating...' : 'Generate'}
          </Button>
        </div>

        {/* Range preview */}
        {rangePreview && (
          <div className="mt-3 max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-2 text-xs font-mono space-y-0.5">
            <p className="text-gray-500 font-sans mb-1">{rangePreview.count} numbers will be generated:</p>
            {rangePreview.preview.slice(0, 20).map((num, i) => (
              <div key={i} className="text-gray-700">{num}</div>
            ))}
            {rangePreview.count > 20 && (
              <div className="text-gray-400">... and {rangePreview.count - 20} more</div>
            )}
          </div>
        )}

        {/* Generate results */}
        {generateResult && (
          <div className="mt-3 p-3 rounded-lg bg-gray-50 text-sm">
            <span className="text-green-600 font-medium">Generated: {generateResult.generated}</span>
            {generateResult.skipped > 0 && (
              <span className="text-amber-600 font-medium ml-3">Skipped (existing): {generateResult.skipped}</span>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
