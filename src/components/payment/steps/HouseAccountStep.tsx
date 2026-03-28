'use client'

import React, { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment, HouseAccountInfo } from '../PaymentContext'
import {
  sectionLabelClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
  infoPanelBase,
  infoPanelIndigo,
} from '../payment-styles'

/**
 * HouseAccountStep — search, select, and charge a house account.
 */
export function HouseAccountStep() {
  const {
    totalWithTip,
    currentTotal,
    tipAmount,
    locationId,
    isProcessing,
    pendingPayments,
    processPayments,
    setStep,
  } = usePaymentContext()

  // Local house account state
  const [houseAccounts, setHouseAccounts] = useState<HouseAccountInfo[]>([])
  const [selectedHouseAccount, setSelectedHouseAccount] = useState<HouseAccountInfo | null>(null)
  const [houseAccountSearch, setHouseAccountSearch] = useState('')
  const [houseAccountsLoading, setHouseAccountsLoading] = useState(false)

  // Load house accounts on mount
  useEffect(() => {
    const loadHouseAccounts = async () => {
      setHouseAccountsLoading(true)
      try {
        const response = await fetch(`/api/house-accounts?locationId=${locationId || ''}&status=active`)
        if (response.ok) {
          const raw = await response.json()
          const data = raw.data ?? raw
          setHouseAccounts(data)
        }
      } catch {
        console.error('Failed to load house accounts')
      } finally {
        setHouseAccountsLoading(false)
      }
    }
    void loadHouseAccounts()
  }, [locationId])

  const handleHouseAccountPayment = () => {
    if (!selectedHouseAccount) return

    const payment: PendingPayment = {
      method: 'house_account',
      amount: currentTotal,
      tipAmount,
      houseAccountId: selectedHouseAccount.id,
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={sectionLabelClasses}>House Account</h3>

      <div className={`${infoPanelBase} ${infoPanelIndigo}`}>
        <div className="flex justify-between font-bold text-lg font-mono">
          <span className="text-slate-400">Amount to Charge</span>
          <span className="text-indigo-400">{formatCurrency(totalWithTip)}</span>
        </div>
      </div>

      <div>
        <label className="text-slate-400 text-[13px] block mb-1.5">Search Account</label>
        <input
          type="text"
          value={houseAccountSearch}
          onChange={(e) => setHouseAccountSearch(e.target.value)}
          className={inputClasses}
          placeholder="Search by name..."
        />
      </div>

      {houseAccountsLoading ? (
        <div className="text-center p-4 text-slate-400">Loading accounts...</div>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-[10px] border border-slate-600/20">
          {houseAccounts
            .filter(acc =>
              !houseAccountSearch ||
              acc.name.toLowerCase().includes(houseAccountSearch.toLowerCase())
            )
            .map(account => {
              const availableCredit = account.creditLimit > 0
                ? account.creditLimit - account.currentBalance
                : Infinity
              const canCharge = availableCredit >= totalWithTip
              const isSelected = selectedHouseAccount?.id === account.id

              return (
                <button
                  key={account.id}
                  className={`w-full p-3 text-left border-b border-slate-600/10 ${isSelected ? 'bg-indigo-500/15' : 'bg-transparent hover:bg-white/[0.03]'} ${canCharge ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                  onClick={() => canCharge && setSelectedHouseAccount(account)}
                  disabled={!canCharge}
                >
                  <div className="text-slate-100 font-medium">{account.name}</div>
                  <div className="text-[13px] text-slate-400 flex justify-between mt-0.5">
                    <span>Balance: {formatCurrency(account.currentBalance)}</span>
                    <span>
                      {account.creditLimit > 0
                        ? `Limit: ${formatCurrency(account.creditLimit)}`
                        : 'No limit'}
                    </span>
                  </div>
                  {!canCharge && (
                    <div className="text-xs text-red-400 mt-1">
                      Insufficient credit available
                    </div>
                  )}
                </button>
              )
            })}
          {houseAccounts.length === 0 && (
            <div className="p-4 text-center text-slate-500">
              No house accounts available
            </div>
          )}
        </div>
      )}

      {selectedHouseAccount && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-[10px]">
          <div className="text-slate-100 font-medium">{selectedHouseAccount.name}</div>
          <div className="text-[13px] text-slate-400">
            Current balance: {formatCurrency(selectedHouseAccount.currentBalance)}
            {selectedHouseAccount.creditLimit > 0 && (
              <span className="ml-2">
                (Available: {formatCurrency(selectedHouseAccount.creditLimit - selectedHouseAccount.currentBalance)})
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={() => setStep('method')}
          disabled={isProcessing}
          className={`${backButtonClasses} ${isProcessing ? 'opacity-50' : ''}`}
        >
          Back
        </button>
        <button
          onClick={handleHouseAccountPayment}
          disabled={isProcessing || !selectedHouseAccount}
          className={`${primaryButtonClasses} ${(isProcessing || !selectedHouseAccount) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessing ? 'Processing...' : 'Charge to Account'}
        </button>
      </div>
    </div>
  )
}
