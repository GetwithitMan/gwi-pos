'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface LineItem {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  total: number
  taxable: boolean
}

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerId: string
  invoiceDate: string
  dueDate: string | null
  sentAt: string | null
  paidDate: string | null
  subtotal: number
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  notes: string
  paymentHistory?: PaymentRecord[]
  lineItems: LineItem[]
  lineItemCount: number
  createdAt: string
}

interface PaymentRecord {
  amount: number
  paymentMethod: string
  reference: string | null
  notes: string | null
  date: string
}

interface Summary {
  outstanding: { count: number; total: number }
  overdue: { count: number; total: number }
  paidThisMonth: { count: number; total: number }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  pending: { label: 'Sent', color: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Viewed', color: 'bg-indigo-100 text-indigo-700' },
  paid: { label: 'Paid', color: 'bg-emerald-100 text-emerald-800' },
  voided: { label: 'Cancelled', color: 'bg-red-100 text-red-700' },
}

function getStatusInfo(status: string) {
  return STATUS_MAP[status] || { label: status, color: 'bg-gray-100 text-gray-700' }
}

function isOverdue(invoice: Invoice): boolean {
  return (
    invoice.status !== 'paid' &&
    invoice.status !== 'voided' &&
    invoice.status !== 'draft' &&
    !!invoice.dueDate &&
    new Date(invoice.dueDate) < new Date()
  )
}

// ─── Inline Form Item ────────────────────────────────────────────────────────

interface FormLineItem {
  key: string
  description: string
  quantity: string
  unitPrice: string
  taxable: boolean
}

function emptyFormLine(): FormLineItem {
  return {
    key: Math.random().toString(36).slice(2, 10),
    description: '',
    quantity: '1',
    unitPrice: '',
    taxable: true,
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BillingInvoicesPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/billing-invoices' })

  // List state
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Create form state
  const [formCustomerName, setFormCustomerName] = useState('')
  const [formCustomerEmail, setFormCustomerEmail] = useState('')
  const [formCustomerAddress, setFormCustomerAddress] = useState('')
  const [formDueDate, setFormDueDate] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formLineItems, setFormLineItems] = useState<FormLineItem[]>([emptyFormLine()])

  // Payment form state
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<string>('card')
  const [payReference, setPayReference] = useState('')
  const [payNotes, setPayNotes] = useState('')

  // ─── Data Loading ─────────────────────────────────────────────────────────

  const loadInvoices = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (statusFilter) params.set('status', statusFilter)
      if (searchFilter) params.set('search', searchFilter)

      const res = await fetch(`/api/billing-invoices?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setInvoices(data.data.invoices)
      setTotal(data.data.total)
      setSummary(data.data.summary)
    } catch {
      toast.error('Failed to load invoices')
    } finally {
      setIsLoading(false)
    }
  }, [page, statusFilter, searchFilter])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  const loadInvoiceDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/billing-invoices/${id}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setSelectedInvoice(data.data)
      setShowDetailModal(true)
    } catch {
      toast.error('Failed to load invoice details')
    }
  }, [])

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!formCustomerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    const validLines = formLineItems.filter(li => li.description.trim() && parseFloat(li.unitPrice))
    if (validLines.length === 0) {
      toast.error('Add at least one line item with a description and price')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/billing-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: formCustomerName.trim(),
          customerEmail: formCustomerEmail.trim() || undefined,
          customerAddress: formCustomerAddress.trim() || undefined,
          dueDate: formDueDate || undefined,
          notes: formNotes.trim() || undefined,
          lineItems: validLines.map(li => ({
            description: li.description,
            quantity: parseFloat(li.quantity) || 1,
            unitPrice: parseFloat(li.unitPrice) || 0,
            taxable: li.taxable,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create')
      }

      toast.success('Invoice created as draft')
      setShowCreateModal(false)
      resetCreateForm()
      loadInvoices()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSend = async (invoiceId: string) => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/billing-invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send')
      }

      const data = await res.json()
      if (data.data.emailSent) {
        toast.success(`Invoice sent to ${data.data.sentTo}`)
      } else {
        toast.warning('Invoice marked as sent, but email delivery failed. You may need to resend.')
      }
      loadInvoices()
      if (selectedInvoice?.id === invoiceId) {
        loadInvoiceDetail(invoiceId)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invoice')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!selectedInvoice) return
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) {
      toast.error('Enter a valid payment amount')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/billing-invoices/${selectedInvoice.id}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          paymentMethod: payMethod,
          reference: payReference.trim() || undefined,
          notes: payNotes.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to record payment')
      }

      const data = await res.json()
      toast.success(
        data.data.isFullyPaid
          ? 'Payment recorded. Invoice is now fully paid!'
          : `Payment of ${formatCurrency(data.data.paymentAmount)} recorded. Balance due: ${formatCurrency(data.data.balanceDue)}`
      )
      setShowPaymentModal(false)
      resetPaymentForm()
      loadInvoices()
      if (selectedInvoice) {
        loadInvoiceDetail(selectedInvoice.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setIsSaving(false)
    }
  }

  const handleVoid = async (invoiceId: string) => {
    if (!confirm('Are you sure you want to void this invoice? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/billing-invoices/${invoiceId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to void')
      }
      toast.success('Invoice voided')
      setShowDetailModal(false)
      loadInvoices()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to void invoice')
    }
  }

  // ─── Form Helpers ─────────────────────────────────────────────────────────

  const resetCreateForm = () => {
    setFormCustomerName('')
    setFormCustomerEmail('')
    setFormCustomerAddress('')
    setFormDueDate('')
    setFormNotes('')
    setFormLineItems([emptyFormLine()])
  }

  const resetPaymentForm = () => {
    setPayAmount('')
    setPayMethod('card')
    setPayReference('')
    setPayNotes('')
  }

  const addFormLine = () => setFormLineItems(prev => [...prev, emptyFormLine()])

  const removeFormLine = (key: string) => {
    setFormLineItems(prev => prev.length > 1 ? prev.filter(li => li.key !== key) : prev)
  }

  const updateFormLine = (key: string, field: keyof FormLineItem, value: string | boolean) => {
    setFormLineItems(prev => prev.map(li => li.key === key ? { ...li, [field]: value } : li))
  }

  const formSubtotal = useMemo(() => {
    return formLineItems.reduce((sum, li) => {
      const qty = parseFloat(li.quantity) || 0
      const price = parseFloat(li.unitPrice) || 0
      return sum + qty * price
    }, 0)
  }, [formLineItems])

  const totalPages = useMemo(() => Math.ceil(total / 50), [total])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Billing Invoices"
        subtitle={`${total} invoice${total !== 1 ? 's' : ''}`}
        actions={
          <Button onClick={() => { resetCreateForm(); setShowCreateModal(true) }}>
            + New Invoice
          </Button>
        }
      />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">Outstanding</div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(summary.outstanding.total)}</div>
              <div className="text-xs text-gray-400">{summary.outstanding.count} invoice{summary.outstanding.count !== 1 ? 's' : ''}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">Overdue</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.overdue.total)}</div>
              <div className="text-xs text-gray-400">{summary.overdue.count} invoice{summary.overdue.count !== 1 ? 's' : ''}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">Paid This Month</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.paidThisMonth.total)}</div>
              <div className="text-xs text-gray-400">{summary.paidThisMonth.count} invoice{summary.paidThisMonth.count !== 1 ? 's' : ''}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          value={searchFilter}
          onChange={(e) => { setSearchFilter(e.target.value); setPage(1) }}
          placeholder="Search by number, customer, notes..."
          className="w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Cancelled</option>
        </select>
        {(statusFilter || searchFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setSearchFilter(''); setPage(1) }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Invoice Table */}
      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            No invoices found. Create your first billing invoice to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Due</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Balance</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map(inv => {
                  const statusInfo = getStatusInfo(inv.status)
                  const overdue = isOverdue(inv)
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3">
                        <div>{inv.customerName}</div>
                        {inv.customerEmail && (
                          <div className="text-xs text-gray-400">{inv.customerEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(inv.invoiceDate)}</td>
                      <td className={`px-4 py-3 ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                        {inv.dueDate ? formatDate(inv.dueDate) : '---'}
                        {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.total)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${inv.balanceDue > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                        {formatCurrency(inv.balanceDue)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${overdue ? 'bg-red-100 text-red-700' : statusInfo.color}`}>
                          {overdue ? 'Overdue' : statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadInvoiceDetail(inv.id)}
                          >
                            View
                          </Button>
                          {inv.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSend(inv.id)}
                              disabled={isSaving}
                              className="text-blue-700 border-blue-300 hover:bg-blue-50"
                            >
                              Send
                            </Button>
                          )}
                          {(inv.status === 'pending' || inv.status === 'approved') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedInvoice(inv)
                                setPayAmount(String(inv.balanceDue.toFixed(2)))
                                setShowPaymentModal(true)
                              }}
                              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                            >
                              Pay
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages} ({total} total)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Create Invoice Modal ──────────────────────────────────────────── */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Invoice"
        size="lg"
      >
        <div className="space-y-4">
          {/* Customer Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
              <Input
                value={formCustomerName}
                onChange={(e) => setFormCustomerName(e.target.value)}
                placeholder="Business or contact name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input
                type="email"
                value={formCustomerEmail}
                onChange={(e) => setFormCustomerEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <Input
                value={formCustomerAddress}
                onChange={(e) => setFormCustomerAddress(e.target.value)}
                placeholder="Billing address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <Input
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank for default payment terms</p>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <Button variant="outline" size="sm" onClick={addFormLine}>+ Add Item</Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
                <div className="col-span-5">Description</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Price</div>
                <div className="col-span-2 text-right">Total</div>
                <div className="col-span-1" />
              </div>
              {formLineItems.map(li => {
                const qty = parseFloat(li.quantity) || 0
                const price = parseFloat(li.unitPrice) || 0
                return (
                  <div key={li.key} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Input
                        value={li.description}
                        onChange={(e) => updateFormLine(li.key, 'description', e.target.value)}
                        placeholder="Item description"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={li.quantity}
                        onChange={(e) => updateFormLine(li.key, 'quantity', e.target.value)}
                        min="0"
                        step="any"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={li.unitPrice}
                        onChange={(e) => updateFormLine(li.key, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium">
                      {formatCurrency(qty * price)}
                    </div>
                    <div className="col-span-1 text-center">
                      {formLineItems.length > 1 && (
                        <button
                          onClick={() => removeFormLine(li.key)}
                          className="text-gray-400 hover:text-red-500 text-lg"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="text-right mt-3 text-lg font-semibold">
              Subtotal: {formatCurrency(formSubtotal)}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              rows={2}
              placeholder="Payment instructions, terms, etc."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? 'Creating...' : 'Create Draft'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Invoice Detail Modal ──────────────────────────────────────────── */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={selectedInvoice ? `Invoice ${selectedInvoice.invoiceNumber}` : 'Invoice Detail'}
        size="lg"
      >
        {selectedInvoice && (() => {
          const inv = selectedInvoice
          const statusInfo = getStatusInfo(inv.status)
          const overdue = isOverdue(inv)
          return (
            <div className="space-y-5">
              {/* Status + Customer */}
              <div className="flex items-start justify-between">
                <div>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${overdue ? 'bg-red-100 text-red-700' : statusInfo.color}`}>
                    {overdue ? 'Overdue' : statusInfo.label}
                  </span>
                  <h3 className="mt-2 text-lg font-semibold">{inv.customerName}</h3>
                  {inv.customerEmail && <p className="text-sm text-gray-500">{inv.customerEmail}</p>}
                  {inv.customerAddress && <p className="text-sm text-gray-500">{inv.customerAddress}</p>}
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Invoice Date</div>
                  <div className="font-medium">{formatDate(inv.invoiceDate)}</div>
                  {inv.dueDate && (
                    <>
                      <div className="text-sm text-gray-500 mt-2">Due Date</div>
                      <div className={`font-medium ${overdue ? 'text-red-600' : ''}`}>
                        {formatDate(inv.dueDate)}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Line Items */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Line Items</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Price</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {inv.lineItems.map((li, idx) => (
                        <tr key={li.id || idx}>
                          <td className="px-3 py-2">{li.description || 'Item'}</td>
                          <td className="px-3 py-2 text-center">{li.quantity}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(li.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(li.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span>{formatCurrency(inv.subtotal)}</span>
                  </div>
                  {inv.taxAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Tax</span>
                      <span>{formatCurrency(inv.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Total</span>
                    <span>{formatCurrency(inv.total)}</span>
                  </div>
                  {inv.amountPaid > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Paid</span>
                      <span>-{formatCurrency(inv.amountPaid)}</span>
                    </div>
                  )}
                  <div className={`flex justify-between font-bold text-lg pt-1 ${inv.balanceDue > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                    <span>Balance Due</span>
                    <span>{formatCurrency(inv.balanceDue)}</span>
                  </div>
                </div>
              </div>

              {/* Payment History */}
              {inv.paymentHistory && inv.paymentHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Payment History</h4>
                  <div className="space-y-2">
                    {inv.paymentHistory.map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-emerald-50 rounded px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium capitalize">{p.paymentMethod}</span>
                          {p.reference && <span className="text-gray-500 ml-2">Ref: {p.reference}</span>}
                          <span className="text-gray-400 ml-2">{formatDate(p.date)}</span>
                        </div>
                        <span className="font-semibold text-emerald-700">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {inv.notes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Notes</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{inv.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t">
                {inv.status === 'draft' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleSend(inv.id)}
                      disabled={isSaving}
                      className="text-blue-700"
                    >
                      Send Invoice
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleVoid(inv.id)}
                      className="text-red-600"
                    >
                      Void
                    </Button>
                  </>
                )}
                {(inv.status === 'pending' || inv.status === 'approved') && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleSend(inv.id)}
                      disabled={isSaving}
                      className="text-blue-700"
                    >
                      Resend
                    </Button>
                    <Button
                      onClick={() => {
                        setPayAmount(String(inv.balanceDue.toFixed(2)))
                        resetPaymentForm()
                        setPayAmount(String(inv.balanceDue.toFixed(2)))
                        setShowPaymentModal(true)
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      Record Payment
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleVoid(inv.id)}
                      className="text-red-600"
                    >
                      Void
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setShowDetailModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ─── Record Payment Modal ──────────────────────────────────────────── */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title={`Record Payment — ${selectedInvoice?.invoiceNumber || ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount *</label>
            <Input
              type="number"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            {selectedInvoice && (
              <p className="text-xs text-gray-400 mt-1">
                Balance due: {formatCurrency(selectedInvoice.balanceDue)}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="transfer">Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reference #</label>
            <Input
              value={payReference}
              onChange={(e) => setPayReference(e.target.value)}
              placeholder="Check number, transaction ID, etc."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <Input
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="Optional payment notes"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowPaymentModal(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
              {isSaving ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
