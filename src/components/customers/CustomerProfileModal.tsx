'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'

interface CustomerProfileModalProps {
  isOpen: boolean
  onClose: () => void
  customerId: string
  locationId: string
  employeeId: string
  isManager: boolean
  loyaltyEnabled: boolean
  onChangeCustomer: () => void
  onRemoveCustomer: () => void
}

interface RecentOrder {
  id: string
  orderNumber: string
  orderType: string
  subtotal: number
  total: number
  status: string
  itemCount: number
  createdAt: string
}

interface FavoriteItem {
  menuItemId: string
  name: string
  orderCount: number
  totalQuantity: number
}

interface HouseAccount {
  id: string
  name: string
  status: string
  currentBalance: number
  creditLimit: number
  paymentTerms: string
}

interface Membership {
  id: string
  status: string
  planName: string
  planPrice: number
  billingCycle: string
  priceAtSignup: number
  nextBillingDate: string
}

interface CustomerDetail {
  id: string
  firstName: string
  lastName: string
  displayName: string
  name: string
  email: string
  phone: string
  notes: string
  allergies: string
  favoriteDrink: string
  favoriteFood: string
  tags: string[]
  loyaltyPoints: number
  totalSpent: number
  totalOrders: number
  averageTicket: number
  lastVisit: string
  birthday: string
  createdAt: string
  recentOrders: RecentOrder[]
  ordersPagination: { total: number; pages: number }
  favoriteItems: FavoriteItem[]
  houseAccount: HouseAccount | null
  savedCardsCount: number
  memberships: Membership[]
}

const VIP_TIERS = [
  { tag: 'vip_silver', label: 'Silver', emoji: '\u{1F948}', bg: '#374151', color: '#d1d5db' },
  { tag: 'vip_gold', label: 'Gold', emoji: '\u{1F947}', bg: '#92400e', color: '#fbbf24' },
  { tag: 'vip_platinum', label: 'Platinum', emoji: '\u{1F451}', bg: '#581c87', color: '#c084fc' },
]

function maskPhone(phone: string): string {
  if (!phone) return '--'
  const digits = phone.replace(/\D/g, '')
  return `***${digits.slice(-4)}`
}

function maskEmail(email: string): string {
  if (!email) return '--'
  return `${email.slice(0, 4)}***@***`
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/20 text-amber-400',
    cancelled: 'bg-red-500/20 text-red-400',
    past_due: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-slate-600 text-slate-300'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function CustomerProfileModal({
  isOpen,
  onClose,
  customerId,
  locationId,
  employeeId,
  isManager,
  loyaltyEnabled,
  onChangeCustomer,
  onRemoveCustomer,
}: CustomerProfileModalProps) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // PII reveal states
  const [showPhone, setShowPhone] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showSpending, setShowSpending] = useState(false)

  // Preferences editing
  const [editingPrefs, setEditingPrefs] = useState(false)
  const [prefForm, setPrefForm] = useState({ allergies: '', favoriteDrink: '', favoriteFood: '', notes: '' })
  const [savingPrefs, setSavingPrefs] = useState(false)

  // Selected order highlight
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  const fetchCustomer = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/customers/${customerId}?locationId=${locationId}`, {
        headers: { 'x-employee-id': employeeId },
      })
      if (!res.ok) throw new Error('Failed to load customer')
      const raw = await res.json()
      const data = raw.data ?? raw
      setCustomer(data)
      setPrefForm({
        allergies: data.allergies || '',
        favoriteDrink: data.favoriteDrink || '',
        favoriteFood: data.favoriteFood || '',
        notes: data.notes || '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [customerId, locationId, employeeId])

  useEffect(() => {
    if (isOpen && customerId) {
      fetchCustomer()
      setShowPhone(false)
      setShowEmail(false)
      setShowSpending(false)
      setEditingPrefs(false)
      setSelectedOrderId(null)
    }
  }, [isOpen, customerId, fetchCustomer])

  const savePreferences = async () => {
    if (!customer) return
    setSavingPrefs(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-employee-id': employeeId },
        body: JSON.stringify({ locationId, ...prefForm }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setCustomer(prev => prev ? { ...prev, ...prefForm } : prev)
      setEditingPrefs(false)
    } catch {
      // Silently fail — form stays open so user can retry
    } finally {
      setSavingPrefs(false)
    }
  }

  const vipTier = customer?.tags
    ? VIP_TIERS.find(t => customer.tags.includes(t.tag))
    : null

  const hasPrefs = customer && (customer.allergies || customer.favoriteDrink || customer.favoriteFood || customer.notes)

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl">
      <div className="flex flex-col h-full max-h-[80vh]" style={{ background: '#0f172a', color: '#f1f5f9', borderRadius: 12 }}>
        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={fetchCustomer} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && customer && (
          <>
            {/* ── Header ── */}
            <div className="px-5 pt-5 pb-4 border-b border-slate-700/60" style={{ background: '#1e293b', borderRadius: '12px 12px 0 0' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-xl font-bold text-white truncate">
                      {customer.displayName || customer.name}
                    </h2>
                    {vipTier && (
                      <span
                        className="px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1"
                        style={{ background: vipTier.bg, color: vipTier.color }}
                      >
                        {vipTier.emoji} {vipTier.label}
                      </span>
                    )}
                  </div>
                  {(customer.firstName || customer.lastName) && (
                    <p className="text-sm mt-0.5" style={{ color: '#94a3b8' }}>
                      {[customer.firstName, customer.lastName].filter(Boolean).join(' ')}
                    </p>
                  )}
                </div>

                {/* Close X */}
                <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 transition-colors text-slate-400 hover:text-white shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Masked PII row */}
              <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
                {/* Phone */}
                <span className="flex items-center gap-1.5" style={{ color: '#94a3b8' }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {showPhone ? customer.phone || '--' : maskPhone(customer.phone)}
                  {isManager && customer.phone && (
                    <button
                      onClick={() => setShowPhone(p => !p)}
                      className="text-blue-400 hover:text-blue-300 text-xs underline ml-0.5"
                    >
                      {showPhone ? 'hide' : 'show'}
                    </button>
                  )}
                </span>

                {/* Email */}
                <span className="flex items-center gap-1.5" style={{ color: '#94a3b8' }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {showEmail ? customer.email || '--' : maskEmail(customer.email)}
                  {isManager && customer.email && (
                    <button
                      onClick={() => setShowEmail(p => !p)}
                      className="text-blue-400 hover:text-blue-300 text-xs underline ml-0.5"
                    >
                      {showEmail ? 'hide' : 'show'}
                    </button>
                  )}
                </span>

                {/* Spending */}
                <button
                  onClick={() => setShowSpending(p => !p)}
                  className="flex items-center gap-1.5 hover:text-slate-200 transition-colors"
                  style={{ color: '#94a3b8' }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {showSpending
                    ? `${formatCurrency(customer.totalSpent)} spent \u00B7 ${customer.totalOrders} orders \u00B7 ${formatCurrency(customer.averageTicket)} avg`
                    : 'Tap to view spending'
                  }
                </button>
              </div>
            </div>

            {/* ── Body (2-column) ── */}
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* ── Left Column ── */}
                <div className="flex flex-col gap-5">
                  {/* Preferences */}
                  <Section title="Preferences">
                    {editingPrefs ? (
                      <div className="flex flex-col gap-2.5">
                        <PrefInput label="Allergies" value={prefForm.allergies} onChange={v => setPrefForm(p => ({ ...p, allergies: v }))} />
                        <PrefInput label="Favorite Drink" value={prefForm.favoriteDrink} onChange={v => setPrefForm(p => ({ ...p, favoriteDrink: v }))} />
                        <PrefInput label="Favorite Food" value={prefForm.favoriteFood} onChange={v => setPrefForm(p => ({ ...p, favoriteFood: v }))} />
                        <PrefInput label="Notes" value={prefForm.notes} onChange={v => setPrefForm(p => ({ ...p, notes: v }))} multiline />
                        <div className="flex gap-2 mt-1">
                          <button
                            onClick={savePreferences}
                            disabled={savingPrefs}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
                          >
                            {savingPrefs ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingPrefs(false)
                              setPrefForm({
                                allergies: customer.allergies || '',
                                favoriteDrink: customer.favoriteDrink || '',
                                favoriteFood: customer.favoriteFood || '',
                                notes: customer.notes || '',
                              })
                            }}
                            className="px-3 py-1.5 bg-slate-700 text-slate-300 text-xs rounded hover:bg-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : hasPrefs ? (
                      <div className="flex flex-wrap gap-1.5">
                        {customer.allergies && <PrefTag label="Allergies" value={customer.allergies} color="red" />}
                        {customer.favoriteDrink && <PrefTag label="Drink" value={customer.favoriteDrink} color="blue" />}
                        {customer.favoriteFood && <PrefTag label="Food" value={customer.favoriteFood} color="amber" />}
                        {customer.notes && <PrefTag label="Notes" value={customer.notes} color="slate" />}
                        <button onClick={() => setEditingPrefs(true)} className="text-blue-400 hover:text-blue-300 text-xs underline ml-1">
                          Edit
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditingPrefs(true)} className="text-blue-400 hover:text-blue-300 text-sm">
                        Preferences
                      </button>
                    )}
                  </Section>

                  {/* Memberships */}
                  <Section title="Memberships">
                    {customer.memberships.length === 0 ? (
                      <p className="text-xs" style={{ color: '#64748b' }}>No memberships</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {customer.memberships.map(m => (
                          <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: '#0f172a' }}>
                            <div>
                              <p className="text-sm font-medium text-white">{m.planName}</p>
                              <p className="text-xs" style={{ color: '#94a3b8' }}>
                                {formatCurrency(m.planPrice)}/{m.billingCycle} &middot; Next: {formatDate(m.nextBillingDate)}
                              </p>
                            </div>
                            <StatusBadge status={m.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>

                {/* ── Right Column ── */}
                <div className="flex flex-col gap-5">
                  {/* Loyalty Points */}
                  {loyaltyEnabled && (
                    <Section title="Loyalty Points">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-white">{customer.loyaltyPoints?.toLocaleString() ?? 0}</span>
                        <span className="text-xs" style={{ color: '#94a3b8' }}>pts</span>
                      </div>
                    </Section>
                  )}

                  {/* House Account */}
                  {customer.houseAccount && (
                    <Section title="House Account">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">{customer.houseAccount.name}</p>
                          <p className="text-xs" style={{ color: '#94a3b8' }}>
                            Limit: {formatCurrency(customer.houseAccount.creditLimit)} &middot; {customer.houseAccount.paymentTerms}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-white">{formatCurrency(customer.houseAccount.currentBalance)}</p>
                          <StatusBadge status={customer.houseAccount.status} />
                        </div>
                      </div>
                    </Section>
                  )}

                  {/* Favorites */}
                  {customer.favoriteItems.length > 0 && (
                    <Section title="Favorites">
                      <div className="flex flex-col gap-1.5">
                        {customer.favoriteItems.slice(0, 6).map(f => (
                          <div key={f.menuItemId} className="flex items-center justify-between py-1">
                            <span className="text-sm text-slate-200 truncate">{f.name}</span>
                            <span className="text-xs shrink-0 ml-2" style={{ color: '#94a3b8' }}>
                              {f.orderCount}x
                            </span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Recent Orders */}
                  <Section title="Recent Orders">
                    {customer.recentOrders.length === 0 ? (
                      <p className="text-xs" style={{ color: '#64748b' }}>No orders yet</p>
                    ) : (
                      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                        {customer.recentOrders.map(o => (
                          <button
                            key={o.id}
                            onClick={() => setSelectedOrderId(o.id === selectedOrderId ? null : o.id)}
                            className={`flex items-center justify-between p-2 rounded-lg text-left transition-colors ${
                              o.id === selectedOrderId ? 'bg-blue-600/20 ring-1 ring-blue-500/40' : 'hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-200">#{o.orderNumber}</p>
                              <p className="text-xs" style={{ color: '#64748b' }}>
                                {formatDate(o.createdAt)} &middot; {o.itemCount} items
                              </p>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <p className="text-sm font-medium text-white">{formatCurrency(o.total)}</p>
                              <OrderStatusBadge status={o.status} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="px-5 py-3.5 border-t border-slate-700/60 flex items-center justify-end gap-2.5" style={{ background: '#1e293b', borderRadius: '0 0 12px 12px' }}>
              <button
                onClick={onChangeCustomer}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors"
              >
                Change Customer
              </button>
              <button
                onClick={onRemoveCustomer}
                className="px-4 py-2 bg-red-600/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-600/30 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-600 transition-colors"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/* ── Sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: '#1e293b' }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: '#64748b' }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function PrefTag({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    red: 'bg-red-500/15 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    slate: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${colors[color] || colors.slate}`}>
      <span className="font-medium">{label}:</span> {value}
    </span>
  )
}

function PrefInput({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  const cls = "w-full px-2.5 py-1.5 rounded text-sm text-white placeholder-slate-500 border border-slate-600 focus:border-blue-500 focus:outline-none transition-colors"
  return (
    <div>
      <label className="text-xs font-medium mb-1 block" style={{ color: '#94a3b8' }}>{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={2}
          className={cls}
          style={{ background: '#0f172a', resize: 'none' }}
          placeholder={`Enter ${label.toLowerCase()}...`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cls}
          style={{ background: '#0f172a' }}
          placeholder={`Enter ${label.toLowerCase()}...`}
        />
      )}
    </div>
  )
}

function OrderStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'text-emerald-400',
    paid: 'text-emerald-400',
    open: 'text-blue-400',
    voided: 'text-red-400',
    refunded: 'text-amber-400',
  }
  return (
    <span className={`text-[10px] font-medium uppercase ${colors[status] || 'text-slate-500'}`}>
      {status}
    </span>
  )
}
