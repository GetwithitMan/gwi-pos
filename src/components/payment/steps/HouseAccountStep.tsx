/**
 * House Account Step
 *
 * Handles house account selection and charging.
 * Shows account search, balance, and credit limit.
 */

import React from 'react'

interface HouseAccountInfo {
  id: string
  accountNumber: string
  customerName: string
  balance: number
  creditLimit: number
  isActive: boolean
}

interface HouseAccountStepProps {
  amountDue: number
  accounts: HouseAccountInfo[]
  selectedAccount: HouseAccountInfo | null
  searchQuery: string
  isLoading: boolean
  onSetSearchQuery: (query: string) => void
  onSelectAccount: (account: HouseAccountInfo) => void
  onComplete: () => void
  onBack: () => void
}

export function HouseAccountStep({
  amountDue,
  accounts,
  selectedAccount,
  searchQuery,
  isLoading,
  onSetSearchQuery,
  onSelectAccount,
  onComplete,
  onBack,
}: HouseAccountStepProps) {
  const filteredAccounts = accounts.filter(
    (acc) =>
      acc.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      acc.accountNumber.includes(searchQuery)
  )

  const canComplete =
    selectedAccount &&
    selectedAccount.isActive &&
    selectedAccount.balance + amountDue <= selectedAccount.creditLimit

  const newBalance = selectedAccount
    ? selectedAccount.balance + amountDue
    : 0

  return (
    <div className="space-y-3">
      {/* Amount due */}
      <div className="p-3 bg-orange-50 rounded-lg mb-3">
        <div className="flex justify-between font-bold text-lg">
          <span>Amount to Charge:</span>
          <span className="text-orange-600">${amountDue.toFixed(2)}</span>
        </div>
      </div>

      {/* Search input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Search Account
        </label>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSetSearchQuery(e.target.value)}
          placeholder="Search by name or account number"
          className="w-full px-3 py-2 border rounded-lg"
          autoFocus
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="text-center py-4 text-gray-500">
          <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          Loading accounts...
        </div>
      )}

      {/* Account list */}
      {!isLoading && filteredAccounts.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-2">
          {filteredAccounts.map((account) => {
            const isSelected = selectedAccount?.id === account.id
            const availableCredit = account.creditLimit - account.balance
            const canUse = account.isActive && availableCredit >= amountDue

            return (
              <button
                key={account.id}
                onClick={() => onSelectAccount(account)}
                disabled={!canUse}
                className={`w-full p-3 rounded-lg text-left transition-all ${
                  isSelected
                    ? 'bg-orange-500 text-white ring-2 ring-orange-300'
                    : canUse
                    ? 'bg-white hover:bg-gray-50 border'
                    : 'bg-gray-100 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <div className="font-bold">{account.customerName}</div>
                    <div
                      className={`text-sm ${
                        isSelected ? 'text-orange-100' : 'text-gray-500'
                      }`}
                    >
                      #{account.accountNumber}
                    </div>
                  </div>
                  {isSelected && <span className="text-xl">✓</span>}
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span
                    className={isSelected ? 'text-orange-100' : 'text-gray-600'}
                  >
                    Balance: ${account.balance.toFixed(2)}
                  </span>
                  <span
                    className={
                      isSelected
                        ? 'text-orange-100'
                        : availableCredit >= amountDue
                        ? 'text-green-600 font-medium'
                        : 'text-red-600 font-medium'
                    }
                  >
                    Available: ${availableCredit.toFixed(2)}
                  </span>
                </div>
                {!account.isActive && (
                  <div className="text-sm text-red-600 mt-1">Inactive</div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* No accounts found */}
      {!isLoading && filteredAccounts.length === 0 && searchQuery && (
        <div className="text-center py-8 text-gray-500">
          No accounts found matching &quot;{searchQuery}&quot;
        </div>
      )}

      {/* No accounts available */}
      {!isLoading && accounts.length === 0 && !searchQuery && (
        <div className="text-center py-8 text-gray-500">
          No house accounts available
        </div>
      )}

      {/* Selected account summary */}
      {selectedAccount && (
        <div className="p-3 bg-white border rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Current Balance:</span>
            <span className="font-medium">
              ${selectedAccount.balance.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">This Charge:</span>
            <span className="font-medium text-orange-600">
              ${amountDue.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t">
            <span className="text-gray-600">New Balance:</span>
            <span className="font-bold">${newBalance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Credit Limit:</span>
            <span
              className={
                newBalance <= selectedAccount.creditLimit
                  ? 'text-green-600'
                  : 'text-red-600'
              }
            >
              ${selectedAccount.creditLimit.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onBack}
          className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold"
        >
          Back
        </button>
        <button
          onClick={onComplete}
          disabled={!canComplete}
          className={`flex-1 px-4 py-3 rounded-lg font-bold ${
            canComplete
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Charge Account
        </button>
      </div>
    </div>
  )
}
