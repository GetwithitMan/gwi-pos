'use client'

interface WebReportBannerProps {
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  reportType: string // e.g. 'sales', 'payroll', 'tips', etc.
  retentionDays?: number // default 30
  venueSlug?: string
}

const RETENTION_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  '60days': 60,
  '90days': 90,
}

export function WebReportBanner({
  startDate,
  endDate,
  reportType,
  retentionDays = 30,
  venueSlug,
}: WebReportBannerProps) {
  // Calculate whether startDate is older than retentionDays ago from today
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const cutoffDate = new Date(today)
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const start = new Date(startDate + 'T00:00:00')

  // If start date is within retention window, render nothing
  if (start >= cutoffDate) {
    return null
  }

  const webUrl = venueSlug
    ? `https://${venueSlug}.ordercontrolcenter.com/admin/reports/${reportType}?startDate=${startDate}&endDate=${endDate}`
    : undefined

  return (
    <div className="bg-blue-50 text-blue-700 rounded-lg p-4 flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm font-medium">
          Historical data beyond {retentionDays} days is available on the web admin portal.
        </span>
      </div>
      {webUrl && (
        <a
          href={webUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap ml-4"
        >
          View on Web &rarr;
        </a>
      )}
    </div>
  )
}

export { RETENTION_DAYS }
