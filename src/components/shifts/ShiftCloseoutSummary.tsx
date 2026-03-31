'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface ShiftSummary {
  totalSales: number
  cashSales: number
  cardSales: number
  totalTips: number
  totalCommission: number
  cashReceived: number
  changeGiven: number
  netCashReceived: number
  paidIn: number
  paidOut: number
  orderCount: number
  paymentCount: number
  voidCount: number
  compCount: number
  safPendingCount?: number
  safPendingTotal?: number
  safFailedCount?: number
  safFailedTotal?: number
  laborCost?: {
    totalWages: number
    totalHours: number
    employeeCount: number
  } | null
}

interface ShiftCloseoutSummaryProps {
  summary: ShiftSummary
  startingCash: number
  expectedCash: number
  canSeeExpectedFirst: boolean
  onCountDrawer: () => void
}

export const ShiftCloseoutSummary = memo(function ShiftCloseoutSummary({
  summary,
  startingCash,
  expectedCash,
  canSeeExpectedFirst,
  onCountDrawer,
}: ShiftCloseoutSummaryProps) {
  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span className="text-sm font-medium text-yellow-800">Manager Override - Non-Blind Mode</span>
      </div>

      <h3 className="font-semibold text-lg">Shift Summary</h3>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-700">Total Sales</div>
          <div className="text-2xl font-bold">{formatCurrency(summary.totalSales)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-700">Orders</div>
          <div className="text-2xl font-bold">{summary.orderCount}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Payment Breakdown</div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Cash Sales</span>
            <span className="font-medium">{formatCurrency(summary.cashSales)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Card Sales</span>
            <span className="font-medium">{formatCurrency(summary.cardSales)}</span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="text-gray-600">Tips Collected</span>
            <span className="font-medium">{formatCurrency(summary.totalTips)}</span>
          </div>
        </div>
      </Card>

      {/* Cash Drawer breakdown -- only visible to managers with full cash drawer access */}
      {canSeeExpectedFirst && (
        <Card className="p-4 bg-blue-50">
          <div className="text-sm font-medium mb-2">Cash Drawer</div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Starting Cash</span>
              <span className="font-medium">{formatCurrency(startingCash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Cash Received</span>
              <span className="font-medium text-green-600">+{formatCurrency(summary.cashReceived)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Change Given</span>
              <span className="font-medium text-red-600">-{formatCurrency(summary.changeGiven)}</span>
            </div>
            {(summary.paidIn > 0 || summary.paidOut > 0) && (
              <>
                {summary.paidIn > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Paid In</span>
                    <span className="font-medium text-green-600">+{formatCurrency(summary.paidIn)}</span>
                  </div>
                )}
                {summary.paidOut > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Paid Out / Drops</span>
                    <span className="font-medium text-red-600">-{formatCurrency(summary.paidOut)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Expected in Drawer</span>
              <span>{formatCurrency(expectedCash)}</span>
            </div>
          </div>
        </Card>
      )}

      {(summary.voidCount > 0 || summary.compCount > 0) && (
        <Card className="p-4 bg-yellow-50">
          <div className="text-sm font-medium mb-2">Adjustments</div>
          <div className="space-y-1">
            {summary.voidCount > 0 && (
              <div className="flex justify-between text-sm">
                <span>Voids</span>
                <span>{summary.voidCount}</span>
              </div>
            )}
            {summary.compCount > 0 && (
              <div className="flex justify-between text-sm">
                <span>Comps</span>
                <span>{summary.compCount}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {((summary.safPendingCount ?? 0) > 0 || (summary.safFailedCount ?? 0) > 0) && (
        <Card className={`p-4 ${(summary.safFailedCount ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="text-sm font-medium mb-2">Offline Card Payments (SAF)</div>
          <div className="space-y-1">
            {(summary.safPendingCount ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-amber-700">Pending Upload</span>
                <span className="font-medium text-amber-700">
                  {summary.safPendingCount} &mdash; {formatCurrency(summary.safPendingTotal ?? 0)}
                </span>
              </div>
            )}
            {(summary.safFailedCount ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-red-700">Failed / Needs Attention</span>
                <span className="font-medium text-red-700">
                  {summary.safFailedCount} &mdash; {formatCurrency(summary.safFailedTotal ?? 0)}
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {(summary.safFailedCount ?? 0) > 0
              ? 'Failed uploads need manager attention before closing shift.'
              : 'These payments were approved offline and will upload when internet returns.'}
          </p>
        </Card>
      )}

      <Button
        variant="primary"
        className="w-full"
        onClick={onCountDrawer}
      >
        Count Drawer &rarr;
      </Button>
    </div>
  )
})
