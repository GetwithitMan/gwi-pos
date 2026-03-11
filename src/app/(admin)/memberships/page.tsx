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
import { SaveCardForm } from '@/components/customers/SaveCardForm'

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
  customerEmail?: string
  customerPhone?: string
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
  const [showEnrollModal, setShowEnrollModal] = useState(false)

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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this membership? This cannot be undone.')) return
    const res = await fetch(`/api/memberships/${id}?locationId=${locationId}&requestingEmployeeId=${employee?.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Membership deleted'); fetchMembers(); fetchSummary() }
    else { const j = await res.json(); toast.error(j.error || 'Failed to delete') }
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
            <Button onClick={() => setShowEnrollModal(true)}>Enroll Member</Button>
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
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(m.id)}>Delete</Button>
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

      {/* Detail Modal — Full Management Panel */}
      {showDetailModal && selectedMember && (
        <MembershipDetailPanel
          member={selectedMember}
          charges={charges}
          events={events}
          plans={plans}
          locationId={locationId!}
          employeeId={employee?.id || ''}
          onClose={() => setShowDetailModal(false)}
          onRefresh={() => { fetchMembers(); fetchSummary() }}
        />
      )}

      {/* Plan Form Modal */}
      {showPlanModal && (
        <PlanFormModal
          plan={editingPlan}
          onClose={() => { setShowPlanModal(false); setEditingPlan(null) }}
          onSave={savePlan}
        />
      )}

      {/* Enroll Member Modal */}
      {showEnrollModal && (
        <EnrollMemberModal
          locationId={locationId!}
          employeeId={employee?.id || ''}
          plans={plans}
          onClose={() => setShowEnrollModal(false)}
          onEnrolled={() => { setShowEnrollModal(false); fetchMembers(); fetchSummary() }}
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

function MembershipDetailPanel({ member, charges, events, plans, locationId, employeeId, onClose, onRefresh }: {
  member: MembershipRow; charges: any[]; events: any[]; plans: Plan[]
  locationId: string; employeeId: string; onClose: () => void; onRefresh: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'billing' | 'timeline'>('overview')
  const [showChangePlan, setShowChangePlan] = useState(false)
  const [newPlanId, setNewPlanId] = useState('')
  const [changePlanMode, setChangePlanMode] = useState<'immediate' | 'next_period'>('next_period')
  const [processing, setProcessing] = useState(false)
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [showReplaceCard, setShowReplaceCard] = useState(false)
  const [newCardId, setNewCardId] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)
  const [savingCard, setSavingCard] = useState(false)

  // Fetch saved cards for the customer
  useEffect(() => {
    if (!member.customerId) return
    fetch(`/api/customers/${member.customerId}/saved-cards?locationId=${locationId}&requestingEmployeeId=${employeeId}`)
      .then(r => r.json())
      .then(j => setSavedCards(j.data?.cards || j.data || []))
      .catch(() => {})
  }, [member.customerId, locationId, employeeId])

  const doAction = async (url: string, body: Record<string, any>, successMsg: string) => {
    setProcessing(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, requestingEmployeeId: employeeId, ...body }),
      })
      if (res.ok) {
        toast.success(successMsg)
        onRefresh()
        onClose()
      } else {
        const j = await res.json()
        toast.error(j.error || 'Action failed')
      }
    } catch { toast.error('Action failed') }
    setProcessing(false)
  }

  const handleChangePlan = () => doAction(
    `/api/memberships/${member.id}/change-plan`,
    { newPlanId, effective: changePlanMode },
    'Plan changed successfully'
  )

  const handleReplaceCard = () => doAction(
    `/api/memberships/${member.id}/replace-card`,
    { savedCardId: newCardId },
    'Card updated successfully'
  )

  const handleAddNewCard = async (result: { token: string; last4: string; cardBrand: string; expiryMonth: string; expiryYear: string }) => {
    setSavingCard(true)
    try {
      const res = await fetch(`/api/customers/${member.customerId}/saved-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-employee-id': employeeId },
        body: JSON.stringify({
          locationId,
          requestingEmployeeId: employeeId,
          token: result.token,
          last4: result.last4,
          cardBrand: result.cardBrand,
          expiryMonth: result.expiryMonth,
          expiryYear: result.expiryYear,
          isDefault: true,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        const newCard = json.data
        // Now attach this card to the membership
        await doAction(`/api/memberships/${member.id}/replace-card`, { savedCardId: newCard.id }, 'Card saved and attached to membership')
        setShowAddCard(false)
      } else {
        const json = await res.json()
        toast.error(json.error || 'Failed to save card')
      }
    } catch { toast.error('Failed to save card') }
    setSavingCard(false)
  }

  const handlePause = () => doAction(`/api/memberships/${member.id}/pause`, {}, 'Membership paused')
  const handleResume = () => doAction(`/api/memberships/${member.id}/resume`, {}, 'Membership resumed')
  const handleRetry = () => doAction(`/api/memberships/${member.id}/retry`, {}, 'Payment retried')

  const handleCancel = (immediate: boolean) => {
    const reason = prompt('Cancellation reason (optional):')
    doAction(`/api/memberships/${member.id}/cancel`, { immediate, reason: reason || undefined },
      immediate ? 'Membership cancelled immediately' : 'Membership will cancel at period end')
  }

  const handleDelete = async () => {
    if (!confirm('Permanently delete this membership record? This cannot be undone.')) return
    setProcessing(true)
    const res = await fetch(`/api/memberships/${member.id}?locationId=${locationId}&requestingEmployeeId=${employeeId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Membership deleted'); onRefresh(); onClose() }
    else { const j = await res.json(); toast.error(j.error || 'Failed') }
    setProcessing(false)
  }

  const activePlans = plans.filter(p => p.isActive && p.id !== member.planId)
  const isActive = ['active', 'trial'].includes(member.status)
  const isPaused = member.status === 'paused'
  const isCancellable = ['active', 'trial', 'paused'].includes(member.status)

  return (
    <Modal isOpen onClose={onClose} title="Manage Membership" size="lg">
      <div className="space-y-5 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">{member.customerFirstName} {member.customerLastName}</h3>
            {member.customerEmail && <div className="text-sm text-gray-500">{member.customerEmail}</div>}
          </div>
          <div className="flex gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[member.status] || 'bg-gray-100'}`}>
              {member.status}
            </span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${BILLING_COLORS[member.billingStatus] || 'bg-gray-100'}`}>
              {member.billingStatus}
            </span>
          </div>
        </div>

        {/* Failure Alert */}
        {member.lastFailReason && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-lg text-sm text-red-700 flex items-center justify-between">
            <div>
              <span className="font-medium">Payment Failed:</span> {member.lastFailReason} ({member.failedAttempts} attempt{member.failedAttempts !== 1 ? 's' : ''})
            </div>
            <Button size="sm" onClick={handleRetry} disabled={processing}>Retry Now</Button>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b">
          {(['overview', 'billing', 'timeline'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize border-b-2 transition-colors ${
                activeTab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Plan Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Current Plan</h4>
                {isActive && activePlans.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setShowChangePlan(!showChangePlan)}>
                    {showChangePlan ? 'Cancel' : 'Change Plan'}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Plan:</span> <span className="font-medium">{member.planName}</span></div>
                <div><span className="text-gray-500">Price:</span> <span className="font-medium">{formatCurrency(Number(member.priceAtSignup))}/{member.billingCycle}</span></div>
                <div><span className="text-gray-500">Next Billing:</span> <span className="font-medium">{member.nextBillingDate ? formatDate(member.nextBillingDate) : 'N/A'}</span></div>
                <div><span className="text-gray-500">Cycle:</span> <span className="font-medium capitalize">{member.billingCycle}</span></div>
              </div>

              {showChangePlan && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <div>
                    <Label>New Plan</Label>
                    <select value={newPlanId} onChange={e => setNewPlanId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                      <option value="">Select a plan...</option>
                      {activePlans.map(p => (
                        <option key={p.id} value={p.id}>{p.name} — {formatCurrency(Number(p.price))}/{p.billingCycle}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="changePlanMode" checked={changePlanMode === 'next_period'} onChange={() => setChangePlanMode('next_period')} />
                      At next billing date
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="changePlanMode" checked={changePlanMode === 'immediate'} onChange={() => setChangePlanMode('immediate')} />
                      Immediately (prorated)
                    </label>
                  </div>
                  <Button size="sm" disabled={!newPlanId || processing} onClick={handleChangePlan}>
                    {processing ? 'Processing...' : 'Confirm Plan Change'}
                  </Button>
                </div>
              )}
            </div>

            {/* Payment Card Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Payment Card</h4>
                <div className="flex gap-2">
                  {!showAddCard && (
                    <Button size="sm" variant="outline" onClick={() => { setShowAddCard(true); setShowReplaceCard(false) }}>
                      + Add Card
                    </Button>
                  )}
                  {savedCards.length > 0 && !showAddCard && (
                    <Button size="sm" variant="outline" onClick={() => { setShowReplaceCard(!showReplaceCard); setShowAddCard(false) }}>
                      {showReplaceCard ? 'Cancel' : 'Change Card'}
                    </Button>
                  )}
                </div>
              </div>
              {member.cardLast4 ? (
                <div className="text-sm">
                  <span className="font-medium">{member.cardBrand || 'Card'}</span> ending in <span className="font-mono font-medium">{member.cardLast4}</span>
                </div>
              ) : (
                <div className="text-sm text-amber-600">No card on file — add a card below</div>
              )}

              {showAddCard && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-sm font-medium text-gray-700 mb-2">Add New Card</div>
                  <SaveCardForm
                    onTokenized={handleAddNewCard}
                    onCancel={() => setShowAddCard(false)}
                    loading={savingCard}
                  />
                </div>
              )}

              {showReplaceCard && !showAddCard && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <Label>Select Card</Label>
                  <select value={newCardId} onChange={e => setNewCardId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                    <option value="">Select a card...</option>
                    {savedCards.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.cardBrand || 'Card'} ****{c.last4}{c.isDefault ? ' (default)' : ''}</option>
                    ))}
                  </select>
                  <Button size="sm" disabled={!newCardId || processing} onClick={handleReplaceCard}>
                    {processing ? 'Updating...' : 'Update Card'}
                  </Button>
                </div>
              )}
            </div>

            {/* Actions Section */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-3">Actions</h4>
              <div className="flex flex-wrap gap-2">
                {isActive && <Button size="sm" variant="outline" onClick={handlePause} disabled={processing}>Pause Membership</Button>}
                {isPaused && <Button size="sm" variant="outline" onClick={handleResume} disabled={processing}>Resume Membership</Button>}
                {member.failedAttempts > 0 && <Button size="sm" onClick={handleRetry} disabled={processing}>Retry Payment</Button>}
                {isCancellable && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleCancel(false)} disabled={processing}>Cancel at Period End</Button>
                    <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => handleCancel(true)} disabled={processing}>Cancel Immediately</Button>
                  </>
                )}
                <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={handleDelete} disabled={processing}>Delete</Button>
              </div>
            </div>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <div>
            <h4 className="font-semibold mb-3">Charge History</h4>
            {charges.length === 0 ? (
              <div className="text-sm text-gray-500 py-4 text-center">No charges recorded yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c: any) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2">{formatDate(c.processedAt || c.createdAt)}</td>
                      <td className="py-2 capitalize">{(c.chargeType || '').replace(/_/g, ' ')}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'approved' ? 'bg-green-100 text-green-800' :
                          c.status === 'declined' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                        }`}>{c.status}</span>
                      </td>
                      <td className="py-2 text-right font-mono">{formatCurrency(Number(c.totalAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div>
            <h4 className="font-semibold mb-3">Event Timeline</h4>
            {events.length === 0 ? (
              <div className="text-sm text-gray-500 py-4 text-center">No events recorded</div>
            ) : (
              <div className="space-y-2">
                {events.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-3 text-sm border-l-2 border-blue-200 pl-3 py-1">
                    <div className="min-w-[120px] text-gray-500">{formatDate(e.createdAt)}</div>
                    <div>
                      <span className="font-medium capitalize">{(e.eventType || '').replace(/_/g, ' ')}</span>
                      {e.details && typeof e.details === 'object' && Object.keys(e.details).length > 0 && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function EnrollMemberModal({ locationId, employeeId, plans, onClose, onEnrolled }: {
  locationId: string; employeeId: string; plans: Plan[]; onClose: () => void; onEnrolled: () => void
}) {
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || '')
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [selectedCardId, setSelectedCardId] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [searching, setSearching] = useState(false)
  const [showNewCardForm, setShowNewCardForm] = useState(false)
  const [savingNewCard, setSavingNewCard] = useState(false)

  const searchCustomers = async (q: string) => {
    if (q.length < 2) { setCustomers([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers?locationId=${locationId}&requestingEmployeeId=${employeeId}&search=${encodeURIComponent(q)}&limit=10`)
      const json = await res.json()
      setCustomers(json.data?.customers || [])
    } catch { /* */ }
    setSearching(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => searchCustomers(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const selectCustomer = async (customer: any) => {
    setSelectedCustomer(customer)
    setCustomers([])
    setSearch(`${customer.firstName} ${customer.lastName}`)
    // Fetch saved cards
    try {
      const res = await fetch(`/api/customers/${customer.id}/saved-cards?locationId=${locationId}&requestingEmployeeId=${employeeId}`)
      const json = await res.json()
      const cards = json.data || []
      setSavedCards(cards)
      if (cards.length > 0) setSelectedCardId(cards[0].id)
    } catch { setSavedCards([]) }
  }

  const handleNewCardTokenized = async (result: { token: string; last4: string; cardBrand: string; expiryMonth: string; expiryYear: string }) => {
    if (!selectedCustomer) return
    setSavingNewCard(true)
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}/saved-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-employee-id': employeeId },
        body: JSON.stringify({
          locationId,
          requestingEmployeeId: employeeId,
          token: result.token,
          last4: result.last4,
          cardBrand: result.cardBrand,
          expiryMonth: result.expiryMonth,
          expiryYear: result.expiryYear,
          isDefault: true,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        const newCard = json.data
        setSavedCards(prev => [...prev, newCard])
        setSelectedCardId(newCard.id)
        setShowNewCardForm(false)
        toast.success('Card saved')
      } else {
        const json = await res.json()
        toast.error(json.error || 'Failed to save card')
      }
    } catch { toast.error('Failed to save card') }
    setSavingNewCard(false)
  }

  const handleEnroll = async () => {
    if (!selectedCustomer || !selectedPlanId) { toast.error('Select a customer and plan'); return }
    setEnrolling(true)
    try {
      const res = await fetch('/api/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          requestingEmployeeId: employeeId,
          customerId: selectedCustomer.id,
          planId: selectedPlanId,
          savedCardId: selectedCardId || undefined,
        }),
      })
      if (res.ok) {
        toast.success('Member enrolled successfully')
        onEnrolled()
      } else {
        const json = await res.json()
        toast.error(json.error || 'Enrollment failed')
      }
    } catch {
      toast.error('Enrollment failed')
    }
    setEnrolling(false)
  }

  const activePlans = plans.filter(p => p.isActive)
  const selectedPlan = activePlans.find(p => p.id === selectedPlanId)

  return (
    <Modal isOpen onClose={onClose} title="Enroll Member">
      <div className="space-y-4">
        {/* Customer Search */}
        <div>
          <Label>Customer</Label>
          <Input
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedCustomer(null) }}
          />
          {searching && <div className="text-xs text-gray-500 mt-1">Searching...</div>}
          {customers.length > 0 && !selectedCustomer && (
            <div className="border rounded mt-1 max-h-40 overflow-y-auto">
              {customers.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectCustomer(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0"
                >
                  <span className="font-medium">{c.firstName} {c.lastName}</span>
                  {c.email && <span className="text-gray-500 ml-2">{c.email}</span>}
                  {c.phone && <span className="text-gray-500 ml-2">{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="mt-1 text-sm text-green-700 flex items-center gap-1">
              Selected: {selectedCustomer.firstName} {selectedCustomer.lastName}
              <button onClick={() => { setSelectedCustomer(null); setSearch(''); setSavedCards([]) }} className="text-red-500 ml-2 text-xs underline">clear</button>
            </div>
          )}
        </div>

        {/* Plan Selection */}
        <div>
          <Label>Plan</Label>
          {activePlans.length === 0 ? (
            <div className="text-sm text-red-600">No active plans. Create a plan first.</div>
          ) : (
            <select
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              {activePlans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatCurrency(Number(p.price))}/{p.billingCycle}
                  {p.trialDays > 0 ? ` (${p.trialDays}-day trial)` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Saved Card */}
        {selectedCustomer && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Payment Card</Label>
              {!showNewCardForm && (
                <button
                  type="button"
                  onClick={() => setShowNewCardForm(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add New Card
                </button>
              )}
            </div>
            {savedCards.length === 0 && !showNewCardForm ? (
              <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-3 text-center">
                <p className="mb-2">No saved cards on file</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNewCardForm(true)}>
                  + Add Card
                </Button>
              </div>
            ) : savedCards.length > 0 && (
              <select
                value={selectedCardId}
                onChange={e => setSelectedCardId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">No card (bill later)</option>
                {savedCards.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.cardBrand || 'Card'} ****{c.last4}{c.expiryMonth ? ` — exp ${c.expiryMonth}/${c.expiryYear}` : ''}
                  </option>
                ))}
              </select>
            )}
            {showNewCardForm && (
              <div className="mt-2 p-3 border border-blue-200 rounded-lg bg-blue-50/50">
                <div className="text-sm font-medium text-gray-700 mb-2">Add New Card</div>
                <SaveCardForm
                  onTokenized={handleNewCardTokenized}
                  onCancel={() => setShowNewCardForm(false)}
                  loading={savingNewCard}
                />
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        {selectedCustomer && selectedPlan && (
          <div className="bg-blue-50 p-3 rounded text-sm space-y-1">
            <div className="font-medium text-blue-900">Enrollment Summary</div>
            <div>Customer: {selectedCustomer.firstName} {selectedCustomer.lastName}</div>
            <div>Plan: {selectedPlan.name} — {formatCurrency(Number(selectedPlan.price))}/{selectedPlan.billingCycle}</div>
            {selectedPlan.trialDays > 0 && <div>Trial: {selectedPlan.trialDays} days (no charge until trial ends)</div>}
            {Number(selectedPlan.setupFee) > 0 && <div>Setup fee: {formatCurrency(Number(selectedPlan.setupFee))} (charged now)</div>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleEnroll}
            disabled={!selectedCustomer || !selectedPlanId || enrolling || activePlans.length === 0}
          >
            {enrolling ? 'Enrolling...' : 'Enroll'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
