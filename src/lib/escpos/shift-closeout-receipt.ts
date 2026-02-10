import {
  buildDocument,
  twoColumnLine,
  centeredLine,
  boldLine,
  largeLine,
  divider,
  line,
  ESCPOS,
} from './commands'

export interface ShiftCloseoutData {
  locationName: string
  employeeName: string
  clockIn: string      // ISO date
  clockOut: string     // ISO date
  durationMinutes: number
  // Sales
  totalSales: number
  cashSales: number
  cardSales: number
  orderCount: number
  // Drawer
  startingCash: number
  cashReceived: number
  changeGiven: number
  expectedCash: number
  countedCash: number
  variance: number
  // Tips
  grossTips: number
  tipOuts: Array<{ roleName: string; percentage: number; amount: number }>
  netTips: number
  // Payout
  tipBankBalance: number
  payoutMethod: string   // 'CASH' or 'PAYROLL'
  payoutAmount: number
  // Safe drop
  safeDrop: number
  employeeTakeHome: number
}

export function buildShiftCloseoutReceipt(data: ShiftCloseoutData): Buffer {
  const parts: Buffer[] = []
  const W = 48 // 80mm paper

  // Header
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(largeLine(data.locationName))
  parts.push(boldLine('SHIFT CLOSEOUT'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(divider(W, '='))

  // Employee info
  parts.push(twoColumnLine('Employee:', data.employeeName, W))

  const clockInDate = new Date(data.clockIn)
  const clockOutDate = new Date(data.clockOut)
  parts.push(twoColumnLine('Clock In:', formatTime(clockInDate), W))
  parts.push(twoColumnLine('Clock Out:', formatTime(clockOutDate), W))

  const hours = Math.floor(data.durationMinutes / 60)
  const mins = data.durationMinutes % 60
  parts.push(twoColumnLine('Duration:', `${hours}h ${mins}m`, W))

  // Sales
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('SALES'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Total Sales', formatDollars(data.totalSales), W))
  parts.push(twoColumnLine('  Cash', formatDollars(data.cashSales), W))
  parts.push(twoColumnLine('  Card', formatDollars(data.cardSales), W))
  parts.push(twoColumnLine('Orders', String(data.orderCount), W))

  // Drawer
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('DRAWER'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Starting Cash', formatDollars(data.startingCash), W))
  parts.push(twoColumnLine('+ Cash Received', formatDollars(data.cashReceived), W))
  parts.push(twoColumnLine('- Change Given', formatDollars(data.changeGiven), W))
  parts.push(twoColumnLine('Expected', formatDollars(data.expectedCash), W))
  parts.push(twoColumnLine('Counted', formatDollars(data.countedCash), W))
  parts.push(twoColumnLine('Variance', formatDollars(data.variance), W))

  // Tips
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('TIPS'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Gross Tips', formatDollars(data.grossTips), W))
  for (const tipOut of data.tipOuts) {
    parts.push(twoColumnLine(
      `  -> ${tipOut.roleName} (${tipOut.percentage}%)`,
      `-${formatDollars(tipOut.amount)}`,
      W
    ))
  }
  parts.push(twoColumnLine('Net Tips', formatDollars(data.netTips), W))

  // Payout
  parts.push(divider(W))
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(boldLine('TIP PAYOUT'))
  parts.push(ESCPOS.ALIGN_LEFT)
  parts.push(twoColumnLine('Tip Bank Balance', formatDollars(data.tipBankBalance), W))
  parts.push(twoColumnLine('Payout Method:', data.payoutMethod, W))
  parts.push(twoColumnLine('Payout Amount', formatDollars(data.payoutAmount), W))

  // Bottom
  parts.push(divider(W, '='))
  parts.push(ESCPOS.BOLD_ON)
  parts.push(twoColumnLine('SAFE DROP', formatDollars(data.safeDrop), W))
  parts.push(twoColumnLine('EMPLOYEE TAKE HOME', formatDollars(data.employeeTakeHome), W))
  parts.push(ESCPOS.BOLD_OFF)
  parts.push(divider(W, '='))

  // Timestamp
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

function formatDollars(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return sign + '$' + Math.abs(amount).toFixed(2)
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
