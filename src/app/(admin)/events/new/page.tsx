'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'

interface PricingTierInput {
  name: string
  description: string
  color: string
  price: number
  serviceFee: number
  quantityAvailable: number | null
  maxPerOrder: number | null
}

const DEFAULT_TIER: PricingTierInput = {
  name: '',
  description: '',
  color: '#4b5563',
  price: 0,
  serviceFee: 0,
  quantityAvailable: null,
  maxPerOrder: null,
}

const EVENT_TYPES = [
  { value: 'dinner_show', label: 'Dinner Show' },
  { value: 'concert', label: 'Concert' },
  { value: 'comedy_night', label: 'Comedy Night' },
  { value: 'karaoke', label: 'Karaoke Night' },
  { value: 'private_event', label: 'Private Event' },
]

const TICKETING_MODES = [
  { value: 'per_seat', label: 'Per Seat', description: 'Sell individual seat tickets' },
  { value: 'per_table', label: 'Per Table', description: 'Sell entire tables' },
  { value: 'general_admission', label: 'General Admission', description: 'No assigned seating' },
]

export default function CreateEventPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const locationId = employee?.location?.id

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/events/new')
    }
  }, [isAuthenticated, router])

  const [form, setForm] = useState({
    name: '',
    description: '',
    eventType: 'dinner_show',
    eventDate: '',
    doorsOpen: '17:00',
    startTime: '18:00',
    endTime: '22:00',
    ticketingMode: 'per_seat',
    allowOnlineSales: true,
    allowPOSSales: true,
    maxTicketsPerOrder: 10,
    totalCapacity: 100,
  })

  const [pricingTiers, setPricingTiers] = useState<PricingTierInput[]>([
    { ...DEFAULT_TIER, name: 'General Admission', price: 50, color: '#3b82f6' },
  ])

  function addTier() {
    setPricingTiers([...pricingTiers, { ...DEFAULT_TIER }])
  }

  function removeTier(index: number) {
    setPricingTiers(pricingTiers.filter((_, i) => i !== index))
  }

  function updateTier(index: number, updates: Partial<PricingTierInput>) {
    setPricingTiers(pricingTiers.map((tier, i) =>
      i === index ? { ...tier, ...updates } : tier
    ))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Validate
    const validTiers = pricingTiers.filter(t => t.name && t.price > 0)
    if (validTiers.length === 0) {
      setError('At least one pricing tier with name and price is required')
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          locationId,
          pricingTiers: validTiers.map((tier, index) => ({
            ...tier,
            sortOrder: index,
          })),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create event')
      }

      // Redirect to event page
      router.push(`/events/${data.event.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/events" className="text-gray-400 hover:text-white text-sm mb-4 inline-block">
        &larr; Back to Events
      </Link>

      <h1 className="text-2xl font-bold mb-6">Create New Event</h1>

      {error && (
        <div className="bg-red-900/50 text-red-300 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Basic Information</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                placeholder="e.g., New Year's Eve Gala"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                rows={3}
                placeholder="Event description for ticket buyers..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Event Type</label>
                <select
                  value={form.eventType}
                  onChange={e => setForm({ ...form, eventType: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                >
                  {EVENT_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Total Capacity *</label>
                <input
                  type="number"
                  value={form.totalCapacity}
                  onChange={e => setForm({ ...form, totalCapacity: Number(e.target.value) })}
                  className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                  min="1"
                  required
                />
              </div>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Schedule</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Date *</label>
              <input
                type="date"
                value={form.eventDate}
                onChange={e => setForm({ ...form, eventDate: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Doors Open *</label>
              <input
                type="time"
                value={form.doorsOpen}
                onChange={e => setForm({ ...form, doorsOpen: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Show Start *</label>
              <input
                type="time"
                value={form.startTime}
                onChange={e => setForm({ ...form, startTime: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End Time</label>
              <input
                type="time"
                value={form.endTime}
                onChange={e => setForm({ ...form, endTime: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* Ticketing */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Ticketing Options</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Ticketing Mode</label>
              <div className="grid grid-cols-3 gap-4">
                {TICKETING_MODES.map(mode => (
                  <label
                    key={mode.value}
                    className={`p-4 rounded-lg border-2 cursor-pointer ${
                      form.ticketingMode === mode.value
                        ? 'border-blue-500 bg-blue-900/20'
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ticketingMode"
                      value={mode.value}
                      checked={form.ticketingMode === mode.value}
                      onChange={e => setForm({ ...form, ticketingMode: e.target.value })}
                      className="sr-only"
                    />
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-sm text-gray-400 mt-1">{mode.description}</div>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Per Order</label>
                <input
                  type="number"
                  value={form.maxTicketsPerOrder}
                  onChange={e => setForm({ ...form, maxTicketsPerOrder: Number(e.target.value) })}
                  className="w-full px-4 py-2 bg-gray-700 rounded-lg"
                  min="1"
                />
              </div>
              <label className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  checked={form.allowOnlineSales}
                  onChange={e => setForm({ ...form, allowOnlineSales: e.target.checked })}
                  className="w-5 h-5"
                />
                <span>Allow Online Sales</span>
              </label>
              <label className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  checked={form.allowPOSSales}
                  onChange={e => setForm({ ...form, allowPOSSales: e.target.checked })}
                  className="w-5 h-5"
                />
                <span>Allow POS Sales</span>
              </label>
            </div>
          </div>
        </div>

        {/* Pricing Tiers */}
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">Pricing Tiers</h2>
            <button
              type="button"
              onClick={addTier}
              className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-700 text-sm"
            >
              Add Tier
            </button>
          </div>

          <div className="space-y-4">
            {pricingTiers.map((tier, index) => (
              <div key={index} className="bg-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="text-sm text-gray-400">Tier {index + 1}</div>
                  {pricingTiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTier(index)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={tier.name}
                      onChange={e => updateTier(index, { name: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-600 rounded"
                      placeholder="e.g., VIP, General"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Price *</label>
                    <input
                      type="number"
                      value={tier.price}
                      onChange={e => updateTier(index, { price: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-gray-600 rounded"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Service Fee</label>
                    <input
                      type="number"
                      value={tier.serviceFee}
                      onChange={e => updateTier(index, { serviceFee: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-gray-600 rounded"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                    <input
                      type="number"
                      value={tier.quantityAvailable || ''}
                      onChange={e => updateTier(index, {
                        quantityAvailable: e.target.value ? Number(e.target.value) : null
                      })}
                      className="w-full px-3 py-2 bg-gray-600 rounded"
                      min="0"
                      placeholder="Unlimited"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Color</label>
                    <input
                      type="color"
                      value={tier.color}
                      onChange={e => updateTier(index, { color: e.target.value })}
                      className="w-full h-[38px] bg-gray-600 rounded cursor-pointer"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs text-gray-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={tier.description}
                    onChange={e => updateTier(index, { description: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-600 rounded"
                    placeholder="e.g., Premium seating with complimentary drinks"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-4">
          <Link
            href="/events"
            className="flex-1 px-4 py-3 bg-gray-700 rounded-lg text-center hover:bg-gray-600"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-3 bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  )
}
