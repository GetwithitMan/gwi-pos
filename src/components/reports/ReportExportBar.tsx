'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { downloadReportPDF } from '@/lib/report-pdf'

interface SummaryItem {
  label: string
  value: string
}

interface ReportExportBarProps {
  /** Report type slug (e.g., 'sales', 'labor-cost', 'product-mix') */
  reportType: string
  /** Human-readable report title */
  reportTitle: string
  /** Table column headers for PDF/email/share */
  headers: string[]
  /** Table rows (string arrays) for PDF/email/share */
  rows: string[][]
  /** Summary items displayed at top of PDF/email/shared view */
  summary?: SummaryItem[]
  /** Date range for the report */
  dateRange?: { start: string; end: string }
  /** Existing CSV export function — called when "Export CSV" is clicked */
  onExportCSV?: () => void
  /** Disable all actions (e.g., while loading) */
  disabled?: boolean
}

/**
 * ReportExportBar — Reusable toolbar for report pages.
 *
 * Provides: Export CSV, Print/PDF, Share Link, Email Report
 *
 * Usage:
 * ```tsx
 * <ReportExportBar
 *   reportType="sales"
 *   reportTitle="Sales Report"
 *   headers={['Date', 'Orders', 'Gross', 'Net']}
 *   rows={report.byDay.map(d => [d.date, String(d.orders), d.gross.toFixed(2), d.net.toFixed(2)])}
 *   summary={[{ label: 'Net Sales', value: formatCurrency(report.summary.netSales) }]}
 *   dateRange={{ start: startDate, end: endDate }}
 *   onExportCSV={() => exportSalesCSV(report, startDate, endDate)}
 * />
 * ```
 */
export function ReportExportBar({
  reportType,
  reportTitle,
  headers,
  rows,
  summary = [],
  dateRange,
  onExportCSV,
  disabled = false,
}: ReportExportBarProps) {
  const employee = useAuthStore(s => s.employee)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [emailAddress, setEmailAddress] = useState('')
  const [emailName, setEmailName] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [error, setError] = useState('')

  const handlePrintPDF = useCallback(() => {
    downloadReportPDF(reportTitle, headers, rows, summary, dateRange)
  }, [reportTitle, headers, rows, summary, dateRange])

  const handleCreateShareLink = useCallback(async () => {
    if (!employee?.location?.id || !employee?.id) return
    setShareLoading(true)
    setError('')
    try {
      const res = await fetch('/api/reports/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType,
          parameters: {
            startDate: dateRange?.start,
            endDate: dateRange?.end,
          },
          generatedData: {
            title: reportTitle,
            headers,
            rows,
            summary,
          },
          locationId: employee.location.id,
          employeeId: employee.id,
          expirationHours: 72,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create share link')
        return
      }
      const data = await res.json()
      setShareUrl(data.data.url)
    } catch {
      setError('Failed to create share link')
    } finally {
      setShareLoading(false)
    }
  }, [reportType, reportTitle, headers, rows, summary, dateRange, employee])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    }
  }, [shareUrl])

  const handleSendEmail = useCallback(async () => {
    if (!emailAddress || !employee?.location?.id) return
    setEmailSending(true)
    setError('')
    try {
      const res = await fetch('/api/reports/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType,
          reportTitle,
          parameters: {
            startDate: dateRange?.start,
            endDate: dateRange?.end,
          },
          generatedData: {
            headers,
            rows,
            summary,
          },
          recipientEmail: emailAddress,
          recipientName: emailName || undefined,
          locationId: employee.location.id,
          employeeId: employee.id,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to send email')
        return
      }
      setEmailSent(true)
      setTimeout(() => {
        setEmailSent(false)
        setEmailModalOpen(false)
        setEmailAddress('')
        setEmailName('')
      }, 2000)
    } catch {
      setError('Failed to send email')
    } finally {
      setEmailSending(false)
    }
  }, [emailAddress, emailName, reportType, reportTitle, headers, rows, summary, dateRange, employee])

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Export CSV */}
        {onExportCSV && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onExportCSV}
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </Button>
        )}

        {/* Print / PDF */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || rows.length === 0}
          onClick={handlePrintPDF}
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print
        </Button>

        {/* Share Link */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || rows.length === 0}
          onClick={() => {
            setShareUrl('')
            setShareCopied(false)
            setError('')
            setShareModalOpen(true)
          }}
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share
        </Button>

        {/* Email */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || rows.length === 0}
          onClick={() => {
            setEmailSent(false)
            setError('')
            setEmailModalOpen(true)
          }}
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Email
        </Button>
      </div>

      {/* Share Link Modal */}
      <Modal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Share Report Link"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Generate a shareable link to this report. The link will expire in 72 hours.
            Anyone with the link can view the report data without logging in.
          </p>

          {!shareUrl ? (
            <Button
              variant="primary"
              onClick={handleCreateShareLink}
              disabled={shareLoading}
              className="w-full"
            >
              {shareLoading ? 'Generating...' : 'Generate Share Link'}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 border rounded-lg bg-gray-50 text-sm text-gray-900 font-mono"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <Button
                  variant={shareCopied ? 'primary' : 'outline'}
                  onClick={handleCopyLink}
                >
                  {shareCopied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-gray-900">
                This link expires in 72 hours and can be viewed by anyone.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>
      </Modal>

      {/* Email Modal */}
      <Modal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title="Email Report"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Send this report via email. The email will include a summary table and up to 50 rows of data.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Recipient Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={emailAddress}
              onChange={e => setEmailAddress(e.target.value)}
              placeholder="owner@restaurant.com"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Recipient Name (optional)
            </label>
            <input
              type="text"
              value={emailName}
              onChange={e => setEmailName(e.target.value)}
              placeholder="John"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEmailModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSendEmail}
              disabled={emailSending || emailSent || !emailAddress}
            >
              {emailSent ? 'Sent!' : emailSending ? 'Sending...' : 'Send Email'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
