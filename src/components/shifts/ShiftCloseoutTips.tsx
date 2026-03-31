'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface CalculatedTipOut {
  ruleId: string
  toRoleId: string
  toRoleName: string
  percentage: number
  amount: number
  toEmployeeId?: string
  toEmployeeName?: string
  basisType: string
  basisLabel: string
  basisAmount: number
  wasCapped: boolean
  uncappedAmount?: number
  maxPercentage?: number
}

interface CustomTipShare {
  toEmployeeId: string
  toEmployeeName: string
  amount: number
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  role: { id: string; name: string }
}

interface ShiftCloseoutTipsProps {
  mode: string
  grossTips: number
  netTips: number
  totalTipOuts: number
  totalCustomShares: number
  ccFeeDeducted: number
  tipBankSettings: {
    ccFeePercent: number
  } | null
  totalCommission: number
  calculatedTipOuts: CalculatedTipOut[]
  customTipShares: CustomTipShare[]
  employees: Employee[]
  newShareEmployeeId: string
  newShareAmount: string
  isLoading: boolean
  onNewShareEmployeeIdChange: (value: string) => void
  onNewShareAmountChange: (value: string) => void
  onAddCustomShare: () => void
  onRemoveCustomShare: (index: number) => void
  onBack: () => void
  onContinueToPayout: () => void
  error: string | null
}

export const ShiftCloseoutTips = memo(function ShiftCloseoutTips({
  mode,
  grossTips,
  netTips,
  totalTipOuts,
  totalCustomShares,
  ccFeeDeducted,
  tipBankSettings,
  totalCommission,
  calculatedTipOuts,
  customTipShares,
  employees,
  newShareEmployeeId,
  newShareAmount,
  isLoading,
  onNewShareEmployeeIdChange,
  onNewShareAmountChange,
  onAddCustomShare,
  onRemoveCustomShare,
  onBack,
  onContinueToPayout,
  error,
}: ShiftCloseoutTipsProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Tip Distribution</h3>

      {/* Commission Earned (if any) */}
      {totalCommission > 0 && (
        <Card className="p-4 bg-purple-50">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-gray-700">Commission Earned</span>
              <p className="text-xs text-gray-600">Added to payroll</p>
            </div>
            <span className="text-2xl font-bold text-purple-600">
              {formatCurrency(totalCommission)}
            </span>
          </div>
        </Card>
      )}

      {/* Gross Tips */}
      <Card className="p-4 bg-green-50">
        <div className="flex justify-between items-center">
          <span className="text-gray-700">Gross Tips Collected</span>
          <span className="text-2xl font-bold text-green-600">
            {formatCurrency(grossTips)}
          </span>
        </div>
      </Card>

      {/* CC Processing Fee */}
      {ccFeeDeducted > 0 && (
        <Card className="p-4 bg-red-50 border-red-200">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-gray-700">CC Processing Fee ({tipBankSettings?.ccFeePercent}%)</span>
              <p className="text-xs text-gray-600">Deducted from credit card tips</p>
            </div>
            <span className="text-lg font-bold text-red-600">
              -{formatCurrency(ccFeeDeducted)}
            </span>
          </div>
        </Card>
      )}

      {/* Automatic Tip-Outs */}
      {calculatedTipOuts.length > 0 && (
        <Card className="p-4">
          <h4 className="font-medium text-gray-900 mb-3">
            Automatic Tip-Outs (from rules)
          </h4>
          <div className="space-y-2">
            {calculatedTipOuts.map((tipOut, index) => (
              <div key={index} className="py-2 border-b last:border-0">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">{tipOut.toRoleName}</span>
                    {tipOut.basisType === 'tips_earned' ? (
                      <span className="text-sm text-gray-600 ml-2">({tipOut.percentage}%)</span>
                    ) : (
                      <span className="text-sm text-gray-600 ml-2">
                        ({tipOut.percentage}% of {formatCurrency(tipOut.basisAmount)} {tipOut.basisLabel})
                      </span>
                    )}
                  </div>
                  <span className="text-red-600 font-medium">-{formatCurrency(tipOut.amount)}</span>
                </div>
                {tipOut.wasCapped && tipOut.uncappedAmount != null && (
                  <div className="text-xs text-amber-600 mt-1 ml-1">
                    Capped at {tipOut.maxPercentage}% of tips (was {formatCurrency(tipOut.uncappedAmount)})
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {calculatedTipOuts.length === 0 && (
        <div className="text-sm text-gray-700 text-center py-2">
          No automatic tip-out rules configured for your role.
        </div>
      )}

      {/* Custom Tip Shares */}
      <Card className="p-4">
        <h4 className="font-medium text-gray-900 mb-3">
          Custom Tip Shares
        </h4>

        {customTipShares.length > 0 && (
          <div className="space-y-2 mb-4">
            {customTipShares.map((share, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b">
                <span className="font-medium">{share.toEmployeeName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-red-600 font-medium">-{formatCurrency(share.amount)}</span>
                  <button
                    onClick={() => onRemoveCustomShare(index)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-700 mb-1">Employee</label>
            <select
              value={newShareEmployeeId}
              onChange={(e) => onNewShareEmployeeIdChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">Select employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.role.name})
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="block text-xs text-gray-700 mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-2 top-2 text-gray-700">$</span>
              <input
                type="number"
                value={newShareAmount}
                onChange={(e) => onNewShareAmountChange(e.target.value)}
                className="w-full pl-6 pr-2 py-2 border rounded-lg text-sm"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={onAddCustomShare}
            className="px-3"
          >
            Add
          </Button>
        </div>
      </Card>

      {/* Net Tips Summary */}
      <Card className={`p-4 ${netTips >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Gross Tips</span>
            <span>{formatCurrency(grossTips)}</span>
          </div>
          {ccFeeDeducted > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">CC Fee ({tipBankSettings?.ccFeePercent}%)</span>
              <span className="text-red-600">-{formatCurrency(ccFeeDeducted)}</span>
            </div>
          )}
          {totalTipOuts > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Role Tip-Outs</span>
              <span className="text-red-600">-{formatCurrency(totalTipOuts)}</span>
            </div>
          )}
          {totalCustomShares > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Custom Shares</span>
              <span className="text-red-600">-{formatCurrency(totalCustomShares)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2">
            <span className="font-medium">Your Net Tips</span>
            <span className={`text-xl font-bold ${netTips >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              {formatCurrency(netTips)}
            </span>
          </div>
        </div>
      </Card>

      <p className="text-sm text-gray-600 text-center">
        Tip shares will be distributed to recipients. If a recipient is not on shift, their share will be banked.
      </p>

      <div className="flex gap-2">
        {mode !== 'none' && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={onBack}
          >
            &larr; Back
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1"
          onClick={onContinueToPayout}
          disabled={isLoading || netTips < 0}
        >
          {isLoading ? 'Loading...' : 'Continue to Payout \u2192'}
        </Button>
      </div>
    </div>
  )
})
