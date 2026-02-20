import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'

const REPORTING_CERT_URL = 'https://reporting-cert.dcap.com'
const REPORTING_PROD_URL = 'https://reporting.dcap.com'

interface DatacapTransaction {
  Request?: {
    TranCode?: string
    TransactionTime?: string
    Authorize?: string
    Purchase?: string
  }
  Response?: {
    TranCode?: string
    DSIXReturnCode?: string
    AuthCode?: string
    CardType?: string
    Authorize?: string
    Purchase?: string
    Gratuity?: string
    RefNo?: string
    EntryMethod?: string
    AuthResponseText?: string
  }
}

// GET /api/reports/datacap-transactions
// Returns local card payments cross-referenced with Datacap Reporting V3 (if key configured).
// Owners use this to verify payments went through and identify offline/SAF captures.
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const page = parseInt(searchParams.get('page') || '1')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const start = startDate
      ? new Date(`${startDate}T00:00:00`)
      : new Date(new Date().setHours(0, 0, 0, 0))
    const end = endDate
      ? new Date(`${endDate}T23:59:59`)
      : new Date(new Date().setHours(23, 59, 59, 999))

    // 1. Local card payments from venue DB
    const localPayments = await db.payment.findMany({
      where: {
        locationId,
        processedAt: { gte: start, lte: end },
        deletedAt: null,
        paymentMethod: { in: ['credit', 'debit'] },
      },
      select: {
        id: true,
        amount: true,
        tipAmount: true,
        totalAmount: true,
        cardBrand: true,
        cardLast4: true,
        authCode: true,
        entryMethod: true,
        datacapRefNumber: true,
        datacapSequenceNo: true,
        isOfflineCapture: true,
        status: true,
        processedAt: true,
        paymentMethod: true,
      },
      orderBy: { processedAt: 'desc' },
    })

    // 2. Read location settings for Datacap merchant ID + environment
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })

    const settings = parseSettings(location?.settings)
    const merchantId = settings.payments?.datacapMerchantId
    const environment = settings.payments?.datacapEnvironment || 'cert'
    const reportingApiKey = process.env.DATACAP_REPORTING_API_KEY

    const hasReportingKey = !!(merchantId && reportingApiKey)

    // 3. Optionally fetch from Datacap Reporting V3 API
    let datacapTransactions: DatacapTransaction[] = []
    let datacapError: string | null = null
    let datacapHasMore = false

    if (hasReportingKey) {
      try {
        const baseUrl =
          environment === 'production' ? REPORTING_PROD_URL : REPORTING_CERT_URL

        const res = await fetch(`${baseUrl}/V3/Credit/Transactions/Query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: reportingApiKey!,
          },
          body: JSON.stringify({
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0],
            merchant: merchantId,
            pageSize: 100,
            pageNumber: page,
            select: [
              'Request.TranCode',
              'Request.TransactionTime',
              'Request.Authorize',
              'Request.Purchase',
              'Response.TranCode',
              'Response.DSIXReturnCode',
              'Response.AuthCode',
              'Response.CardType',
              'Response.Authorize',
              'Response.Purchase',
              'Response.Gratuity',
              'Response.RefNo',
              'Response.EntryMethod',
              'Response.AuthResponseText',
            ],
          }),
          signal: AbortSignal.timeout(10000),
        })

        if (res.ok) {
          const data = await res.json()
          datacapTransactions = (data.transactions || []) as DatacapTransaction[]
          datacapHasMore = data.hasMore || false
        } else {
          const text = await res.text().catch(() => '')
          datacapError = `Datacap Reporting returned ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`
        }
      } catch {
        datacapError = 'Could not reach Datacap Reporting API — check key and network'
      }
    }

    // 4. Cross-reference: match by authCode
    const datacapByAuthCode = new Map<string, DatacapTransaction>()
    for (const t of datacapTransactions) {
      const code = (t.Response?.AuthCode || '').toUpperCase().trim()
      if (code) datacapByAuthCode.set(code, t)
    }

    const localWithStatus = localPayments.map((p) => {
      const authCode = (p.authCode || '').toUpperCase().trim()
      const datacapMatch = authCode ? datacapByAuthCode.get(authCode) : undefined
      return {
        ...p,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        datacapVerified: !!datacapMatch,
        datacapReturnCode: datacapMatch?.Response?.DSIXReturnCode ?? null,
        datacapTranCode: datacapMatch?.Response?.TranCode ?? null,
        datacapAuthResponseText: datacapMatch?.Response?.AuthResponseText ?? null,
      }
    })

    // 5. Summary
    const totalCard = localWithStatus.length
    const totalLive = localWithStatus.filter(
      (p) => !p.isOfflineCapture && p.status === 'completed'
    ).length
    const totalOffline = localWithStatus.filter((p) => p.isOfflineCapture).length
    const totalVoided = localWithStatus.filter(
      (p) => p.status === 'voided' || p.status === 'refunded'
    ).length
    const totalAmount = localWithStatus.reduce((sum, p) => sum + p.totalAmount, 0)
    const datacapApproved = datacapTransactions.filter(
      (t) => t.Response?.DSIXReturnCode === '000000'
    ).length
    const datacapDeclined = datacapTransactions.filter(
      (t) =>
        t.Response?.DSIXReturnCode &&
        t.Response.DSIXReturnCode !== '000000'
    ).length

    return NextResponse.json({
      data: {
        localPayments: localWithStatus,
        datacapTransactions,
        hasReportingKey,
        hasMerchantId: !!merchantId,
        datacapError,
        datacapHasMore,
        summary: {
          totalCard,
          totalLive,
          totalOffline,
          totalVoided,
          totalAmount,
          datacapApproved,
          datacapDeclined,
          datacapTotal: datacapTransactions.length,
        },
      },
    })
  } catch (err) {
    console.error('GET /api/reports/datacap-transactions error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
