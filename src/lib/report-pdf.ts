/**
 * Report PDF Export — Browser-native approach using window.print()
 *
 * Generates a print-ready HTML document with @media print CSS,
 * opens it in a new window, and triggers print. No server-side
 * PDF libraries needed.
 */

interface ReportSummaryItem {
  label: string
  value: string
}

/**
 * Generate print-ready HTML for a report.
 */
export function generateReportHTML(
  title: string,
  headers: string[],
  rows: string[][],
  summary?: ReportSummaryItem[],
  dateRange?: { start: string; end: string }
): string {
  const now = new Date().toLocaleString()
  const dateRangeStr = dateRange
    ? `${dateRange.start} to ${dateRange.end}`
    : ''

  const summaryHTML = summary && summary.length > 0
    ? `
      <div class="summary-section">
        <h2>Summary</h2>
        <div class="summary-grid">
          ${summary.map(s => `
            <div class="summary-item">
              <span class="summary-label">${escapeHtml(s.label)}</span>
              <span class="summary-value">${escapeHtml(s.value)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : ''

  const tableHTML = rows.length > 0
    ? `
      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : '<p class="no-data">No data available</p>'

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1f2937;
      padding: 40px;
      max-width: 1100px;
      margin: 0 auto;
    }

    .report-header {
      border-bottom: 2px solid #1f2937;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }

    .report-header h1 {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
    }

    .report-meta {
      display: flex;
      gap: 24px;
      margin-top: 8px;
      font-size: 13px;
      color: #6b7280;
    }

    .summary-section {
      margin-bottom: 24px;
    }

    .summary-section h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #374151;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
    }

    .summary-item {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
    }

    .summary-label {
      display: block;
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 4px;
    }

    .summary-value {
      display: block;
      font-size: 18px;
      font-weight: 700;
      color: #111827;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead { background: #f3f4f6; }

    th {
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #d1d5db;
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid #e5e7eb;
    }

    tr:nth-child(even) { background: #f9fafb; }

    .no-data {
      text-align: center;
      padding: 40px;
      color: #9ca3af;
      font-style: italic;
    }

    .report-footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { padding: 0; }

      .report-header {
        border-bottom: 2px solid #000;
      }

      .summary-item {
        background: none;
        border: 1px solid #ccc;
      }

      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }

      .report-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 8px 40px;
        border-top: 1px solid #ccc;
      }

      @page {
        margin: 0.75in;
        size: landscape;
      }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="report-meta">
      ${dateRangeStr ? `<span>Period: ${escapeHtml(dateRangeStr)}</span>` : ''}
      <span>Generated: ${escapeHtml(now)}</span>
    </div>
  </div>

  ${summaryHTML}
  ${tableHTML}

  <div class="report-footer">
    <span>GWI POS Report</span>
    <span>Generated ${escapeHtml(now)}</span>
  </div>
</body>
</html>`
}

/**
 * Open a print-ready report in a new window and trigger print dialog.
 */
export function downloadReportPDF(
  title: string,
  headers: string[],
  rows: string[][],
  summary?: ReportSummaryItem[],
  dateRange?: { start: string; end: string }
): void {
  const html = generateReportHTML(title, headers, rows, summary, dateRange)
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    // Popup blocked — fall back to blob download
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-report.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }

  printWindow.document.write(html)
  printWindow.document.close()

  // Wait for content to render before triggering print
  printWindow.onload = () => {
    printWindow.print()
  }
  // Fallback for browsers where onload doesn't fire on document.write
  setTimeout(() => {
    try { printWindow.print() } catch (_) { /* already printing */ }
  }, 500)
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}
