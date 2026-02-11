'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface Coupon {
  id: string
  code: string
  name: string
  description?: string
  discountType: string
  discountValue: number
  minimumOrder?: number
  maximumDiscount?: number
  appliesTo: string
  usageLimit?: number
  usageCount: number
  perCustomerLimit?: number
  singleUse: boolean
  validFrom?: string
  validUntil?: string
  isActive: boolean
  createdAt: string
  _count: { redemptions: number }
}

const LOCATION_ID = 'loc_default'

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')

  useEffect(() => {
    fetchCoupons()
  }, [])

  async function fetchCoupons() {
    try {
      const res = await fetch(`/api/coupons?locationId=${LOCATION_ID}`)
      const data = await res.json()
      setCoupons(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Failed to fetch coupons:', error)
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(coupon: Coupon) {
    try {
      await fetch(`/api/coupons/${coupon.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: coupon.isActive ? 'deactivate' : 'activate',
        }),
      })
      fetchCoupons()
    } catch (error) {
      console.error('Failed to toggle coupon:', error)
    }
  }

  async function deleteCoupon(id: string) {
    if (!confirm('Are you sure you want to delete this coupon?')) return

    try {
      await fetch(`/api/coupons/${id}`, { method: 'DELETE' })
      fetchCoupons()
    } catch (error) {
      console.error('Failed to delete coupon:', error)
    }
  }

  const filteredCoupons = coupons.filter(c => {
    if (filter === 'active') return c.isActive
    if (filter === 'inactive') return !c.isActive
    return true
  })

  function formatDiscount(coupon: Coupon) {
    if (coupon.discountType === 'percent') {
      return `${coupon.discountValue}% off`
    } else if (coupon.discountType === 'fixed') {
      return `$${coupon.discountValue.toFixed(2)} off`
    } else if (coupon.discountType === 'free_item') {
      return 'Free item'
    }
    return coupon.discountValue.toString()
  }

  function getStatusBadge(coupon: Coupon) {
    const now = new Date()
    if (!coupon.isActive) {
      return <span className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300">Inactive</span>
    }
    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return <span className="px-2 py-1 text-xs rounded bg-yellow-900 text-yellow-300">Scheduled</span>
    }
    if (coupon.validUntil && new Date(coupon.validUntil) < now) {
      return <span className="px-2 py-1 text-xs rounded bg-red-900 text-red-300">Expired</span>
    }
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return <span className="px-2 py-1 text-xs rounded bg-orange-900 text-orange-300">Limit Reached</span>
    }
    return <span className="px-2 py-1 text-xs rounded bg-green-900 text-green-300">Active</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading coupons...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Coupons & Promo Codes"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            Create Coupon
          </Button>
        }
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto mt-6">
      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(['all', 'active', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg capitalize ${
              filter === f ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Coupons</div>
          <div className="text-2xl font-bold">{coupons.length}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Active</div>
          <div className="text-2xl font-bold text-green-400">
            {coupons.filter(c => c.isActive).length}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Redemptions</div>
          <div className="text-2xl font-bold">
            {coupons.reduce((sum, c) => sum + c.usageCount, 0)}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Avg. Redemptions</div>
          <div className="text-2xl font-bold">
            {coupons.length > 0
              ? (coupons.reduce((sum, c) => sum + c.usageCount, 0) / coupons.length).toFixed(1)
              : 0}
          </div>
        </div>
      </div>

      {/* Coupon List */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="text-left p-4">Code</th>
              <th className="text-left p-4">Name</th>
              <th className="text-left p-4">Discount</th>
              <th className="text-left p-4">Usage</th>
              <th className="text-left p-4">Validity</th>
              <th className="text-left p-4">Status</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCoupons.map(coupon => (
              <tr key={coupon.id} className="border-t border-gray-700 hover:bg-gray-750">
                <td className="p-4">
                  <span className="font-mono bg-gray-700 px-2 py-1 rounded">
                    {coupon.code}
                  </span>
                </td>
                <td className="p-4">
                  <div>{coupon.name}</div>
                  {coupon.description && (
                    <div className="text-sm text-gray-400">{coupon.description}</div>
                  )}
                </td>
                <td className="p-4">
                  <div className="font-medium">{formatDiscount(coupon)}</div>
                  {coupon.minimumOrder && (
                    <div className="text-sm text-gray-400">
                      Min. ${coupon.minimumOrder.toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="p-4">
                  <div>
                    {coupon.usageCount}
                    {coupon.usageLimit && ` / ${coupon.usageLimit}`}
                  </div>
                  {coupon.perCustomerLimit && (
                    <div className="text-sm text-gray-400">
                      {coupon.perCustomerLimit}/customer
                    </div>
                  )}
                </td>
                <td className="p-4 text-sm">
                  {coupon.validFrom && (
                    <div>From: {new Date(coupon.validFrom).toLocaleDateString()}</div>
                  )}
                  {coupon.validUntil && (
                    <div>Until: {new Date(coupon.validUntil).toLocaleDateString()}</div>
                  )}
                  {!coupon.validFrom && !coupon.validUntil && (
                    <span className="text-gray-400">No expiration</span>
                  )}
                </td>
                <td className="p-4">{getStatusBadge(coupon)}</td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => setEditingCoupon(coupon)}
                    className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600 mr-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(coupon)}
                    className={`px-3 py-1 text-sm rounded mr-2 ${
                      coupon.isActive
                        ? 'bg-yellow-600 hover:bg-yellow-700'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {coupon.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteCoupon(coupon.id)}
                    className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filteredCoupons.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-400">
                  No coupons found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </main>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingCoupon) && (
        <CouponModal
          coupon={editingCoupon}
          onClose={() => {
            setShowCreateModal(false)
            setEditingCoupon(null)
          }}
          onSave={() => {
            setShowCreateModal(false)
            setEditingCoupon(null)
            fetchCoupons()
          }}
        />
      )}
    </div>
  )
}

function CouponModal({
  coupon,
  onClose,
  onSave,
}: {
  coupon: Coupon | null
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    code: coupon?.code || '',
    name: coupon?.name || '',
    description: coupon?.description || '',
    discountType: coupon?.discountType || 'percent',
    discountValue: coupon?.discountValue || 0,
    minimumOrder: coupon?.minimumOrder || '',
    maximumDiscount: coupon?.maximumDiscount || '',
    appliesTo: coupon?.appliesTo || 'order',
    usageLimit: coupon?.usageLimit || '',
    perCustomerLimit: coupon?.perCustomerLimit || '',
    singleUse: coupon?.singleUse || false,
    validFrom: coupon?.validFrom ? new Date(coupon.validFrom).toISOString().split('T')[0] : '',
    validUntil: coupon?.validUntil ? new Date(coupon.validUntil).toISOString().split('T')[0] : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const payload = {
        ...form,
        locationId: LOCATION_ID,
        code: form.code.toUpperCase(),
        discountValue: Number(form.discountValue),
        minimumOrder: form.minimumOrder ? Number(form.minimumOrder) : null,
        maximumDiscount: form.maximumDiscount ? Number(form.maximumDiscount) : null,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
      }

      const res = await fetch(
        coupon ? `/api/coupons/${coupon.id}` : '/api/coupons',
        {
          method: coupon ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save coupon')
      }

      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">
          {coupon ? 'Edit Coupon' : 'Create Coupon'}
        </h2>

        {error && (
          <div className="bg-red-900/50 text-red-300 p-3 rounded mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Code *</label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded uppercase"
                placeholder="SAVE20"
                required
                disabled={!!coupon}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                placeholder="20% Off Order"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Discount Type *</label>
              <select
                value={form.discountType}
                onChange={e => setForm({ ...form, discountType: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              >
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed Amount</option>
                <option value="free_item">Free Item</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                {form.discountType === 'percent' ? 'Percentage *' : 'Amount *'}
              </label>
              <input
                type="number"
                value={form.discountValue}
                onChange={e => setForm({ ...form, discountValue: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="0"
                step={form.discountType === 'percent' ? '1' : '0.01'}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Minimum Order</label>
              <input
                type="number"
                value={form.minimumOrder}
                onChange={e => setForm({ ...form, minimumOrder: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="0"
                step="0.01"
                placeholder="No minimum"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Maximum Discount</label>
              <input
                type="number"
                value={form.maximumDiscount}
                onChange={e => setForm({ ...form, maximumDiscount: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="0"
                step="0.01"
                placeholder="No maximum"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Usage Limit</label>
              <input
                type="number"
                value={form.usageLimit}
                onChange={e => setForm({ ...form, usageLimit: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="1"
                placeholder="Unlimited"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Per Customer Limit</label>
              <input
                type="number"
                value={form.perCustomerLimit}
                onChange={e => setForm({ ...form, perCustomerLimit: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="1"
                placeholder="Unlimited"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Valid From</label>
              <input
                type="date"
                value={form.validFrom}
                onChange={e => setForm({ ...form, validFrom: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Valid Until</label>
              <input
                type="date"
                value={form.validUntil}
                onChange={e => setForm({ ...form, validUntil: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.singleUse}
                onChange={e => setForm({ ...form, singleUse: e.target.checked })}
                className="w-4 h-4"
              />
              <span>Single use per customer</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : coupon ? 'Save Changes' : 'Create Coupon'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
