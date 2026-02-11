'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface HouseAccount {
  id: string
  name: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  creditLimit: number
  currentBalance: number
  paymentTerms: number
  billingCycle: string
  status: string
  taxExempt: boolean
  taxId?: string | null
  createdAt: string
  customer?: {
    id: string
    firstName: string
    lastName: string
    displayName?: string | null
  } | null
  _count?: { transactions: number }
}

interface HouseAccountTransaction {
  id: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  notes?: string | null
  paymentMethod?: string | null
  referenceNumber?: string | null
  dueDate?: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-gray-100 text-gray-700',
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  charge: 'Charge',
  payment: 'Payment',
  adjustment: 'Adjustment',
  credit: 'Credit',
}

export default function HouseAccountsPage() {
  const [accounts, setAccounts] = useState<HouseAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<HouseAccount | null>(null)
  const [accountTransactions, setAccountTransactions] = useState<HouseAccountTransaction[]>([])
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)

  // Create/Edit form
  const [formName, setFormName] = useState('')
  const [formContactName, setFormContactName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [formCreditLimit, setFormCreditLimit] = useState('')
  const [formPaymentTerms, setFormPaymentTerms] = useState('30')
  const [formBillingCycle, setFormBillingCycle] = useState('monthly')
  const [formTaxExempt, setFormTaxExempt] = useState(false)
  const [formTaxId, setFormTaxId] = useState('')

  // Payment form
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('check')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')

  const locationId = 'default-location' // In a real app, get from context

  useEffect(() => {
    loadAccounts()
  }, [statusFilter])

  async function loadAccounts() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      const response = await fetch(`/api/house-accounts?${params}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
      }
    } catch (error) {
      console.error('Failed to load house accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadAccountDetails(account: HouseAccount) {
    setSelectedAccount(account)
    try {
      const response = await fetch(`/api/house-accounts/${account.id}`)
      if (response.ok) {
        const data = await response.json()
        setAccountTransactions(data.transactions || [])
      }
    } catch (error) {
      console.error('Failed to load account details:', error)
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    try {
      const response = await fetch('/api/house-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: formName,
          contactName: formContactName || null,
          email: formEmail || null,
          phone: formPhone || null,
          address: formAddress || null,
          creditLimit: parseFloat(formCreditLimit) || 0,
          paymentTerms: isNaN(parseInt(formPaymentTerms)) ? 30 : parseInt(formPaymentTerms),
          billingCycle: formBillingCycle,
          taxExempt: formTaxExempt,
          taxId: formTaxId || null,
        }),
      })

      if (response.ok) {
        setShowCreateModal(false)
        resetForm()
        loadAccounts()
      }
    } catch (error) {
      console.error('Failed to create account:', error)
    }
  }

  async function handleUpdateAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) return

    try {
      const response = await fetch(`/api/house-accounts/${selectedAccount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          contactName: formContactName || null,
          email: formEmail || null,
          phone: formPhone || null,
          address: formAddress || null,
          creditLimit: parseFloat(formCreditLimit) || 0,
          paymentTerms: isNaN(parseInt(formPaymentTerms)) ? 30 : parseInt(formPaymentTerms),
          billingCycle: formBillingCycle,
          taxExempt: formTaxExempt,
          taxId: formTaxId || null,
        }),
      })

      if (response.ok) {
        setShowEditModal(false)
        resetForm()
        loadAccounts()
        loadAccountDetails(selectedAccount)
      }
    } catch (error) {
      console.error('Failed to update account:', error)
    }
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) return

    try {
      const response = await fetch(`/api/house-accounts/${selectedAccount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'payment',
          amount: parseFloat(paymentAmount),
          paymentMethod,
          referenceNumber: paymentReference || null,
          notes: paymentNotes || null,
        }),
      })

      if (response.ok) {
        setShowPaymentModal(false)
        resetPaymentForm()
        loadAccounts()
        loadAccountDetails(selectedAccount)
      }
    } catch (error) {
      console.error('Failed to process payment:', error)
    }
  }

  async function handleToggleStatus(account: HouseAccount) {
    const action = account.status === 'suspended' ? 'reactivate' : 'suspend'
    try {
      const response = await fetch(`/api/house-accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (response.ok) {
        loadAccounts()
        if (selectedAccount?.id === account.id) {
          const data = await response.json()
          setSelectedAccount(data)
        }
      }
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  function openEditModal(account: HouseAccount) {
    setFormName(account.name)
    setFormContactName(account.contactName || '')
    setFormEmail(account.email || '')
    setFormPhone(account.phone || '')
    setFormAddress(account.address || '')
    setFormCreditLimit(account.creditLimit.toString())
    setFormPaymentTerms(account.paymentTerms.toString())
    setFormBillingCycle(account.billingCycle)
    setFormTaxExempt(account.taxExempt)
    setFormTaxId(account.taxId || '')
    setShowEditModal(true)
  }

  function resetForm() {
    setFormName('')
    setFormContactName('')
    setFormEmail('')
    setFormPhone('')
    setFormAddress('')
    setFormCreditLimit('')
    setFormPaymentTerms('30')
    setFormBillingCycle('monthly')
    setFormTaxExempt(false)
    setFormTaxId('')
  }

  function resetPaymentForm() {
    setPaymentAmount('')
    setPaymentMethod('check')
    setPaymentReference('')
    setPaymentNotes('')
  }

  // Calculate totals
  const totalOwed = accounts
    .filter(a => a.status === 'active')
    .reduce((sum, a) => sum + a.currentBalance, 0)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="House Accounts"
        subtitle={<>Total Outstanding: <span className="font-medium text-red-600">{formatCurrency(totalOwed)}</span></>}
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            New Account
          </Button>
        }
      />

      {/* Filters */}
      <div className="max-w-7xl mx-auto mt-6">
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadAccounts()}
            placeholder="Search by name, contact, or email..."
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
        <Button variant="outline" onClick={loadAccounts}>
          Search
        </Button>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accounts List */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No house accounts found</div>
            ) : (
              <div className="divide-y">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 ${
                      selectedAccount?.id === account.id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => loadAccountDetails(account)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{account.name}</div>
                        {account.contactName && (
                          <div className="text-sm text-gray-500">{account.contactName}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[account.status] || 'bg-gray-100'}`}>
                          {account.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-2 text-sm">
                      <span className="text-gray-500">
                        Limit: {account.creditLimit > 0 ? formatCurrency(account.creditLimit) : 'Unlimited'}
                      </span>
                      <span className={`font-medium ${account.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Balance: {formatCurrency(account.currentBalance)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Terms: Net {account.paymentTerms}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Account Details */}
        <div>
          {selectedAccount ? (
            <Card className="p-4">
              <h2 className="text-lg font-bold mb-4">Account Details</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Account Name</label>
                  <div className="font-medium">{selectedAccount.name}</div>
                </div>

                {selectedAccount.contactName && (
                  <div>
                    <label className="text-xs text-gray-500">Contact</label>
                    <div>{selectedAccount.contactName}</div>
                  </div>
                )}

                {(selectedAccount.email || selectedAccount.phone) && (
                  <div>
                    <label className="text-xs text-gray-500">Contact Info</label>
                    {selectedAccount.email && <div className="text-sm">{selectedAccount.email}</div>}
                    {selectedAccount.phone && <div className="text-sm">{selectedAccount.phone}</div>}
                  </div>
                )}

                {selectedAccount.address && (
                  <div>
                    <label className="text-xs text-gray-500">Address</label>
                    <div className="text-sm">{selectedAccount.address}</div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Credit Limit</label>
                    <div>{selectedAccount.creditLimit > 0 ? formatCurrency(selectedAccount.creditLimit) : 'Unlimited'}</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Balance</label>
                    <div className={`text-xl font-bold ${selectedAccount.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(selectedAccount.currentBalance)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Terms</label>
                    <div>Net {selectedAccount.paymentTerms}</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Billing</label>
                    <div className="capitalize">{selectedAccount.billingCycle}</div>
                  </div>
                </div>

                {selectedAccount.taxExempt && (
                  <div>
                    <label className="text-xs text-gray-500">Tax Status</label>
                    <div className="text-green-600">
                      Tax Exempt {selectedAccount.taxId && `(${selectedAccount.taxId})`}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs text-gray-500">Status</label>
                  <div>
                    <span className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[selectedAccount.status]}`}>
                      {selectedAccount.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t flex flex-wrap gap-2">
                {selectedAccount.status === 'active' && selectedAccount.currentBalance > 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowPaymentModal(true)}
                  >
                    Record Payment
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditModal(selectedAccount)}
                >
                  Edit
                </Button>
                <Button
                  variant={selectedAccount.status === 'suspended' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => handleToggleStatus(selectedAccount)}
                >
                  {selectedAccount.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </Button>
              </div>

              {/* Transaction History */}
              <div className="mt-4 pt-4 border-t">
                <h3 className="font-medium mb-2">Recent Activity</h3>
                {accountTransactions.length === 0 ? (
                  <div className="text-sm text-gray-500">No transactions</div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {accountTransactions.map((txn) => (
                      <div key={txn.id} className="text-sm p-2 bg-gray-50 rounded">
                        <div className="flex justify-between">
                          <span>{TRANSACTION_TYPE_LABELS[txn.type] || txn.type}</span>
                          <span className={txn.amount > 0 ? 'text-red-600' : 'text-green-600'}>
                            {txn.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(txn.amount))}
                          </span>
                        </div>
                        {txn.notes && (
                          <div className="text-xs text-gray-500">{txn.notes}</div>
                        )}
                        {txn.referenceNumber && (
                          <div className="text-xs text-gray-500">Ref: {txn.referenceNumber}</div>
                        )}
                        <div className="text-xs text-gray-400 flex justify-between">
                          <span>{formatDate(txn.createdAt)}</span>
                          <span>Bal: {formatCurrency(txn.balanceAfter)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-gray-500">
              Select an account to view details
            </Card>
          )}
        </div>
      </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Create House Account</h2>
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Account Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Company or individual name"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Contact Name</label>
                <input
                  type="text"
                  value={formContactName}
                  onChange={(e) => setFormContactName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Contact person"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Address</label>
                <textarea
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Billing address"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Credit Limit</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={formCreditLimit}
                      onChange={(e) => setFormCreditLimit(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                      placeholder="0 = unlimited"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Payment Terms</label>
                  <select
                    value={formPaymentTerms}
                    onChange={(e) => setFormPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="0">Due on receipt</option>
                    <option value="7">Net 7</option>
                    <option value="15">Net 15</option>
                    <option value="30">Net 30</option>
                    <option value="45">Net 45</option>
                    <option value="60">Net 60</option>
                    <option value="90">Net 90</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Billing Cycle</label>
                <select
                  value={formBillingCycle}
                  onChange={(e) => setFormBillingCycle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="on_demand">On Demand</option>
                </select>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formTaxExempt}
                    onChange={(e) => setFormTaxExempt(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">Tax Exempt</span>
                </label>
                {formTaxExempt && (
                  <input
                    type="text"
                    value={formTaxId}
                    onChange={(e) => setFormTaxId(e.target.value)}
                    className="flex-1 px-3 py-1 border rounded-lg text-sm"
                    placeholder="Tax Exempt ID"
                  />
                )}
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowCreateModal(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  Create Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Edit Account</h2>
            <form onSubmit={handleUpdateAccount} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Account Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Contact Name</label>
                <input
                  type="text"
                  value={formContactName}
                  onChange={(e) => setFormContactName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Address</label>
                <textarea
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Credit Limit</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      value={formCreditLimit}
                      onChange={(e) => setFormCreditLimit(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Payment Terms</label>
                  <select
                    value={formPaymentTerms}
                    onChange={(e) => setFormPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="0">Due on receipt</option>
                    <option value="7">Net 7</option>
                    <option value="15">Net 15</option>
                    <option value="30">Net 30</option>
                    <option value="45">Net 45</option>
                    <option value="60">Net 60</option>
                    <option value="90">Net 90</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Billing Cycle</label>
                <select
                  value={formBillingCycle}
                  onChange={(e) => setFormBillingCycle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="on_demand">On Demand</option>
                </select>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formTaxExempt}
                    onChange={(e) => setFormTaxExempt(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">Tax Exempt</span>
                </label>
                {formTaxExempt && (
                  <input
                    type="text"
                    value={formTaxId}
                    onChange={(e) => setFormTaxId(e.target.value)}
                    className="flex-1 px-3 py-1 border rounded-lg text-sm"
                    placeholder="Tax Exempt ID"
                  />
                )}
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowEditModal(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-xl font-bold mb-4">Record Payment</h2>
            <div className="mb-4 text-sm text-gray-500">
              {selectedAccount.name}
              <br />
              Current Balance: <span className="font-medium text-red-600">{formatCurrency(selectedAccount.currentBalance)}</span>
            </div>
            <form onSubmit={handlePayment} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Payment Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg"
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    max={selectedAccount.currentBalance}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="ach">ACH Transfer</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="card">Credit Card</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Reference Number</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Check number, etc."
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">Notes</label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowPaymentModal(false)
                    resetPaymentForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  Record Payment
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
