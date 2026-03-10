'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

type Tab = 'dashboard' | 'members' | 'plans'

const STATUS_COLORS: Record<string, string> = {
  trial: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-gray-100 text-gray-800',
  expired: 'bg-red-100 text-red-800',
}

const BILLING_COLORS: Record<string, string> = {
  current: 'bg-green-100 text-green-800',
  past_due: 'bg-orange-100 text-orange-800',
  retry_scheduled: 'bg-yellow-100 text-yellow-800',
  uncollectible: 'bg-red-100 text-red-800',
}

interface MembershipRow {
  id: string
  customerId: string
  planId: string
  status: string
  billingStatus: string
  nextBillingDate: string | null
  priceAtSignup: number
  billingCycle: string
  planName: string
  customerFirstName?: string
  customerLastName?: string
  cardLast4?: string
  cardBrand?: string
  failedAttempts: number
  lastFailReason?: string
}

interface Plan {
  id: string
  name: string
  description: string | null
  price: number
  billingCycle: string
  billingDayOfMonth: number | null
  trialDays: number
  setupFee: number
  maxMembers: number | null
  isActive: boolean
  sortOrder: number
}

interface Summary {
  activeCount: number
  trialCount: number
  pastDueCount: number
  mrr: number
  arr: number
  churnRate: number
}

export default function MembershipsPage() {
  const ready = useAuthenticationGuard()
  const { employee, locationId } = useAuthStore()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [members, setMembers] = useState<MembershipRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedMember, setSelectedMember] = useState<MembershipRow | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [charges, setCharges] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState('')

  const fetchMembers = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId, requestingEmployeeId: employee.id })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/memberships?${params}`)
      const json = await res.json()
      if (json.data) setMembers(json.data)
    } catch { /* */ }
    setLoading(false)
  }, [locationId, employee?.id, statusFilter])

  const fetchPlans = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/membership-plans?locationId=${locationId}&requestingEmployeeId=${employee.id}`)
      const json = await res.json()
      if (json.data) setPlans(json.data)
    } catch { /* */ }
  }, [locationId, employee?.id])

  const fetchSummary = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/reports/memberships?locationId=${locationId}&requestingEmployeeId=${employee.id}&type=summary`)
      const json = await res.json()
      if (json.data) setSummary(json.data)
    } catch { /* */ }
  }, [locationId, employee?.id])

  useEffect(() => {
    if (!ready) return
    fetchSummary()
    fetchPlans()
    if (tab === 'members') fetchMembers()
  }, [ready, tab, fetchSummary, fetchPlans, fetchMembers])

  const handlePause = async (id: string) => {
    const res = await fetch(`/api/memberships/${id}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, requestingEmployeeId: employee?.id }),
    })
    if (res.ok) { toast.success('Membership paused'); fetchMembers() }
    else { const j = await res.json(); toast.error(j.error || 'Failed to pause') }
  }

  const handleResume = async (id: string) => {
    const res = await fetch(`/api/memberships/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, requestingEmployeeId: employee?.id }),
    })
    if (res.ok) { toast.success('Membership resumed'); fetchMembers() }
    else { const j = await res.json(); toast.error(j.error || 'Failed to resume') }
  }

  const handleCancel = async (id: string, immediate: boolean) => {
    const reason = prompt('Cancellation reason (optional):')
    const res = await fetch(`/api/memberships/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, requestingEmployeeId: employee?.id, immediate, reason }),
    })
    if (res.ok) { toast.success('Membership cancelled'); fetchMembers() }
    else { const j = await res.json(); toast.error(j.error || 'Failed to cancel') }
  }

  const handleRetry = async (id: string) => {
    const res = await fetch(`/api/memberships/${id}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, requestingEmployeeId: employee?.id }),
    })
    if (res.ok) { toast.success('Charge succeeded'); fetchMembers() }
    else { const j = await res.json(); toast.error(j.error || 'Retry failed') }
  }

  const openDetail = async (mbr: MembershipRow) => {
    setSelectedMember(mbr)
    setShowDetailModal(true)
    // Fetch charges and events
    const [cRes, eRes] = await Promise.all([
      fetch(`/api/memberships/${mbr.id}/charges?locationId=${locationId}&requestingEmployeeId=${employee?.id}&limit=20`),
      fetch(`/api/memberships/${mbr.id}/events?locationId=${locationId}&requestingEmployeeId=${employee?.id}&limit=20`),
    ])
    const cJson = await cRes.json()
    const eJson = await eRes.json()
    setCharges(cJson.data || [])
    setEvents(eJson.data || [])
  }

  // Plan CRUD
  const savePlan = async (form: Record<string, any>) => {
    const method = editingPlan ? 'PUT' : 'POST'
    const url = editingPlan ? `/api/membership-plans/${editingPlan.id}` : '/api/membership-plans'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, locationId, requestingEmployeeId: employee?.id }),
    })
    if (res.ok) { toast.success(editingPlan ? 'Plan updated' : 'Plan created'); fetchPlans(); setShowPlanModal(false); setEditingPlan(null) }
    else { const j = await res.json(); toast.error(j.error || 'Failed') }
  }

  const deletePlan = async (id: string) => {
    if (!confirm('Delete this plan?')) return
    const res = await fetch(`/api/membership-plans/${id}?locationId=${locationId}&requestingEmployeeId=${employee?.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Plan deleted'); fetchPlans() }
    else { const j = await res.json(); toast.error(j.error || 'Failed') }
  }

  if (!ready) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminPageHeader title="Memberships" subtitle="Recurring membership billing and management" />

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {(['dashboard', 'members', 'plans'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-900 hover:text-gray-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {tab === 'dashboard' && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-sm text-gray-900">Active Members</div>
              <div className="text-2xl font-bold">{summary.activeCount}</div>
              <div className="text-xs text-gray-900">{summary.trialCount} in trial</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-900">MRR</div>
              <div className="text-2xl font-bold">{formatCurrency(summary.mrr)}</div>
              <div className="text-xs text-gray-900">ARR: {formatCurrency(summary.arr)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-900">Past Due</div>
              <div className="text-2xl font-bold text-orange-600">{summary.pastDueCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-900">30d Churn Rate</div>
              <div className="text-2xl font-bold">{summary.churnRate}%</div>
            </Card>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && (
        <div className="space-y-4">
          <div className="flex gap-2 items-center">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
            <Button onClick={fetchMembers} variant="outline" size="sm">Refresh</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-900">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Plan</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Billing</th>
                  <th className="pb-2">Next Billing</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-b hover:bg-gray-50">
                    <td className="py-2">{m.customerFirstName} {m.customerLastName}</td>
                    <td className="py-2">{m.planName}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[m.status] || ''}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BILLING_COLORS[m.billingStatus] || ''}`}>
                        {m.billingStatus}
                      </span>
                    </td>
                    <td className="py-2">{m.nextBillingDate ? formatDate(m.nextBillingDate) : '-'}</td>
                    <td className="py-2">{formatCurrency(Number(m.priceAtSignup))}/{m.billingCycle?.[0] || 'm'}</td>
                    <td className="py-2 flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openDetail(m)}>View</Button>
                      {m.status === 'active' && <Button size="sm" variant="outline" onClick={() => handlePause(m.id)}>Pause</Button>}
                      {m.status === 'paused' && <Button size="sm" variant="outline" onClick={() => handleResume(m.id)}>Resume</Button>}
                      {['active', 'trial', 'paused'].includes(m.status) && (
                        <Button size="sm" variant="outline" onClick={() => handleCancel(m.id, true)}>Cancel</Button>
                      )}
                      {m.failedAttempts > 0 && (
                        <Button size="sm" variant="default" onClick={() => handleRetry(m.id)}>Retry</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && !loading && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-900">No memberships found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plans Tab */}
      {tab === 'plans' && (
        <div className="space-y-4">
          <Button onClick={() => { setEditingPlan(null); setShowPlanModal(true) }}>Add Plan</Button>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map(p => (
              <Card key={p.id} className={`p-4 ${!p.isActive ? 'opacity-50' : ''}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{p.name}</h3>
                    <p className="text-sm text-gray-900">{p.description}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-900'}`}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="mt-3 text-2xl font-bold">
                  {formatCurrency(Number(p.price))}<span className="text-sm text-gray-900">/{p.billingCycle}</span>
                </div>
                {p.trialDays > 0 && <div className="text-sm text-blue-600">{p.trialDays}-day trial</div>}
                {Number(p.setupFee) > 0 && <div className="text-sm text-gray-900">Setup fee: {formatCurrency(Number(p.setupFee))}</div>}
                {p.maxMembers && <div className="text-sm text-gray-900">Max: {p.maxMembers} members</div>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditingPlan(p); setShowPlanModal(true) }}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => deletePlan(p.id)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedMember && (
        <Modal isOpen={showDetailModal} onClose={() => setShowDetailModal(false)} title="Membership Details">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-gray-900">Customer:</span> {selectedMember.customerFirstName} {selectedMember.customerLastName}</div>
              <div><span className="text-gray-900">Plan:</span> {selectedMember.planName}</div>
              <div><span className="text-gray-900">Status:</span> <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selectedMember.status]}`}>{selectedMember.status}</span></div>
              <div><span className="text-gray-900">Billing:</span> <span className={`px-2 py-0.5 rounded-full text-xs ${BILLING_COLORS[selectedMember.billingStatus]}`}>{selectedMember.billingStatus}</span></div>
              <div><span className="text-gray-900">Card:</span> {selectedMember.cardBrand} ****{selectedMember.cardLast4 || 'N/A'}</div>
              <div><span className="text-gray-900">Price:</span> {formatCurrency(Number(selectedMember.priceAtSignup))}/{selectedMember.billingCycle}</div>
            </div>

            {selectedMember.lastFailReason && (
              <div className="bg-red-50 p-3 rounded text-sm text-red-700">
                Last failure: {selectedMember.lastFailReason} ({selectedMember.failedAttempts} attempts)
              </div>
            )}

            <div>
              <h4 className="font-semibold mb-2">Charge History</h4>
              <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                {charges.map((c: any) => (
                  <div key={c.id} className="flex justify-between border-b py-1">
                    <span>{c.chargeType} — {c.status}</span>
                    <span>{formatCurrency(Number(c.totalAmount))}</span>
                    <span className="text-gray-900">{formatDate(c.createdAt)}</span>
                  </div>
                ))}
                {charges.length === 0 && <div className="text-gray-900">No charges</div>}
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Event Timeline</h4>
              <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                {events.map((e: any) => (
                  <div key={e.id} className="flex justify-between border-b py-1">
                    <span>{e.eventType}</span>
                    <span className="text-gray-900">{formatDate(e.createdAt)}</span>
                  </div>
                ))}
                {events.length === 0 && <div className="text-gray-900">No events</div>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Plan Form Modal */}
      {showPlanModal && (
        <PlanFormModal
          plan={editingPlan}
          onClose={() => { setShowPlanModal(false); setEditingPlan(null) }}
          onSave={savePlan}
        />
      )}
    </div>
  )
}

function PlanFormModal({ plan, onClose, onSave }: { plan: Plan | null; onClose: () => void; onSave: (form: Record<string, any>) => void }) {
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    price: plan ? Number(plan.price) : 0,
    billingCycle: plan?.billingCycle || 'monthly',
    billingDayOfMonth: plan?.billingDayOfMonth || 1,
    trialDays: plan?.trialDays || 0,
    setupFee: plan ? Number(plan.setupFee) : 0,
    maxMembers: plan?.maxMembers || '',
    isActive: plan?.isActive !== false,
    sortOrder: plan?.sortOrder || 0,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || form.price <= 0) { toast.error('Name and positive price required'); return }
    onSave({ ...form, maxMembers: form.maxMembers || null })
  }

  return (
    <Modal isOpen onClose={onClose} title={plan ? 'Edit Plan' : 'New Plan'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div>
          <Label>Description</Label>
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Price</Label>
            <Input type="number" step="0.01" min="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) }))} required />
          </div>
          <div>
            <Label>Billing Cycle</Label>
            <select value={form.billingCycle} onChange={e => setForm(f => ({ ...f, billingCycle: e.target.value }))} className="w-full border rounded px-3 py-2">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Billing Day (1-28)</Label>
            <Input type="number" min="1" max="28" value={form.billingDayOfMonth} onChange={e => setForm(f => ({ ...f, billingDayOfMonth: parseInt(e.target.value) }))} />
          </div>
          <div>
            <Label>Trial Days</Label>
            <Input type="number" min="0" value={form.trialDays} onChange={e => setForm(f => ({ ...f, trialDays: parseInt(e.target.value) }))} />
          </div>
          <div>
            <Label>Setup Fee</Label>
            <Input type="number" step="0.01" min="0" value={form.setupFee} onChange={e => setForm(f => ({ ...f, setupFee: parseFloat(e.target.value) }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Max Members</Label>
            <Input type="number" min="0" placeholder="Unlimited" value={form.maxMembers} onChange={e => setForm(f => ({ ...f, maxMembers: e.target.value }))} />
          </div>
          <div>
            <Label>Sort Order</Label>
            <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) }))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} id="isActive" />
          <Label htmlFor="isActive">Active</Label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit">{plan ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}
