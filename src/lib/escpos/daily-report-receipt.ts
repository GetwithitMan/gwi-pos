import {
  buildDocument,
  twoColumnLine,
  boldLine,
  largeLine,
  divider,
  line,
  ESCPOS,
} from './commands'

export interface DailyReportPrintData {
  locationName: string
  reportDate: string // YYYY-MM-DD

  // Revenue
  grossSales: number
  discounts: number
  netSales: number
  salesTax: number
  tips: number
  totalCollected: number

  // Payments
  cashPayments: { count: number; amount: number }
  creditPayments: { count: number; amount: number }
  giftPayments: { count: number; amount: number }
  houseAccountPayments: { count: number; amount: number }
  totalPayments: number

  // Sales by Category
  salesByCategory: Array<{ name: string; units: number; net: number; percentOfTotal: number }>

  // Voids & Comps
  voidCount: number
  voidAmount: number
  compCount: number
  compAmount: number

  // Labor
  laborHours: number
  laborCost: number
  laborPercent: number

  // Business Costs
  ccTipFees: number
  ccTipFeeTransactions: number

  // Cash
  cashReceived: number
  cashIn: number
  cashOut: number
  tipsOut: number
  cashDue: number

  // Stats
  checks: number
  avgCheck: number
  covers: number
}

export function buildDailyReportReceipt(data: DailyReportPrintData): Buffer {
  const parts: Buffer[] = []
  const W = 48

  // Header
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(largeLine(data.locationName))
  parts.push(boldLine('DAILY BUSINESS SUMMARY'))
  const displayDate = new Date(data.reportDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  })
  parts.push(line(displayDate))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(divider(W, '='))

  // Revenue
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('REVENUE'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Gross Sales', fmt(data.grossSales), W))
  if (data.discounts > 0) {
    parts.push(twoColumnLine('  Discounts', `-${fmt(data.discounts)}`, W))
  }
  parts.push(twoColumnLine('Net Sales', fmt(data.netSales), W))
  parts.push(twoColumnLine('Sales Tax', fmt(data.salesTax), W))
  parts.push(twoColumnLine('Tips', fmt(data.tips), W))
  parts.push(divider(W, '-'))
  parts.push(ESCPOS.BOLD_ON)
  parts.push(twoColumnLine('Total Collected', fmt(data.totalCollected), W))
  parts.push(ESCPOS.BOLD_OFF)

  // Payments
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('PAYMENTS'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine(`Cash (${data.cashPayments.count})`, fmt(data.cashPayments.amount), W))
  parts.push(twoColumnLine(`Credit (${data.creditPayments.count})`, fmt(data.creditPayments.amount), W))
  if (data.giftPayments.count > 0) {
    parts.push(twoColumnLine(`Gift Card (${data.giftPayments.count})`, fmt(data.giftPayments.amount), W))
  }
  if (data.houseAccountPayments.count > 0) {
    parts.push(twoColumnLine(`House Acct (${data.houseAccountPayments.count})`, fmt(data.houseAccountPayments.amount), W))
  }
  parts.push(divider(W, '-'))
  parts.push(ESCPOS.BOLD_ON)
  parts.push(twoColumnLine('Total Payments', fmt(data.totalPayments), W))
  parts.push(ESCPOS.BOLD_OFF)

  // Sales by Category (top 10 only to fit on paper)
  if (data.salesByCategory.length > 0) {
    parts.push(divider(W))
    parts.push(ESCPOS.ALIGN_CENTER)
    parts.push(boldLine('SALES BY CATEGORY'))
    parts.push(ESCPOS.ALIGN_LEFT)
    const top = data.salesByCategory.slice(0, 10)
    for (const cat of top) {
      parts.push(twoColumnLine(`${cat.name} (${cat.units})`, `${fmt(cat.net)}  ${cat.percentOfTotal.toFixed(0)}%`, W))
    }
    if (data.salesByCategory.length > 10) {
      parts.push(line(`  ... and ${data.salesByCategory.length - 10} more`))
    }
  }

  // Voids & Comps
  if (data.voidCount > 0 || data.compCount > 0) {
    parts.push(divider(W))
    parts.push(ESCPOS.ALIGN_CENTER)
    parts.push(boldLine('VOIDS & COMPS'))
    parts.push(ESCPOS.ALIGN_LEFT)
    if (data.voidCount > 0) {
      parts.push(twoColumnLine(`Voids (${data.voidCount})`, fmt(data.voidAmount), W))
    }
    if (data.compCount > 0) {
      parts.push(twoColumnLine(`Comps (${data.compCount})`, fmt(data.compAmount), W))
    }
  }

  // Labor
  if (data.laborHours > 0) {
    parts.push(divider(W))
    parts.push(ESCPOS.ALIGN_CENTER)
    parts.push(boldLine('LABOR'))
    parts.push(ESCPOS.ALIGN_LEFT)
    parts.push(twoColumnLine('Total Hours', data.laborHours.toFixed(1), W))
    parts.push(twoColumnLine('Labor Cost', fmt(data.laborCost), W))
    parts.push(twoColumnLine('Labor % of Sales', `${data.laborPercent.toFixed(1)}%`, W))
  }

  // Business Costs
  if (data.ccTipFees > 0) {
    parts.push(divider(W))
    parts.push(ESCPOS.ALIGN_CENTER)
    parts.push(boldLine('BUSINESS COSTS'))
    parts.push(ESCPOS.ALIGN_LEFT)
    parts.push(twoColumnLine(`CC Tip Fees (${data.ccTipFeeTransactions})`, fmt(data.ccTipFees), W))
  }

  // Cash Accountability
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('CASH'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Cash Received', fmt(data.cashReceived), W))
  parts.push(twoColumnLine('Paid In', fmt(data.cashIn), W))
  parts.push(twoColumnLine('Paid Out', fmt(data.cashOut), W))
  parts.push(twoColumnLine('Tips Out', fmt(data.tipsOut), W))
  parts.push(divider(W, '-'))
  parts.push(ESCPOS.BOLD_ON)
  parts.push(twoColumnLine('Cash Due', fmt(data.cashDue), W))
  parts.push(ESCPOS.BOLD_OFF)

  // Stats
  parts.push(divider(W, '='))
  parts.push(twoColumnLine('Checks', String(data.checks), W))
  parts.push(twoColumnLine('Avg Check', fmt(data.avgCheck), W))
  parts.push(twoColumnLine('Covers', String(data.covers), W))

  // Footer timestamp
  parts.push(divider(W, '='))
  parts.push(ESCPOS.ALIGN_CENTER)
  const now = new Date()
  parts.push(line(
    now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    + ' '
    + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  ))
  parts.push(ESCPOS.ALIGN_LEFT)

  return buildDocument(...parts)
}

function fmt(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return sign + '$' + Math.abs(amount).toFixed(2)
}
