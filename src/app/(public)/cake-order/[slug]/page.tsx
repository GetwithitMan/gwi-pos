'use client'

/**
 * Public Cake Ordering Wizard — 9-step flow
 *
 * Step 1: Event & Date (type, date, time, guest count, lead time validation)
 * Step 2: Cake Selection (base cake per tier, multi-tier support)
 * Step 3: Flavors (per-tier flavor selection from flavor modifier groups)
 * Step 4: Fillings & Frosting (per-tier filling optional + frosting required)
 * Step 5: Design (colors, decoration modifiers with prices)
 * Step 6: Message & Dietary (message text, per-tier dietary checkboxes)
 * Step 7: Delivery (pickup/delivery toggle, address if delivery)
 * Step 8: Contact (name, email, phone, notes, honeypot)
 * Step 9: Review & Submit (summary, price estimate, submit)
 *
 * Route: /cake-order/[slug]
 */

import { useState, useEffect, useCallback, FormEvent, useMemo } from 'react'
import { useParams } from 'next/navigation'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CakeMenuItem {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
}

interface CakeModifier {
  id: string
  name: string
  price: number
  groupId: string
  groupName: string
  groupTag: string // 'flavor' | 'filling' | 'frosting' | 'decoration' | 'dietary'
}

interface CakeConfig {
  available: boolean
  locationName?: string
  leadTimeDays: number
  maxTiers: number
  eventTypes: string[]
  cakes: CakeMenuItem[]
  modifiers: CakeModifier[]
}

interface TierData {
  cakeId: string
  cakeName: string
  cakePrice: number
  flavorId: string
  fillingId: string
  frostingId: string
  decorationIds: string[]
  dietaryIds: string[]
  message: string
}

function emptyTier(): TierData {
  return {
    cakeId: '',
    cakeName: '',
    cakePrice: 0,
    flavorId: '',
    fillingId: '',
    frostingId: '',
    decorationIds: [],
    dietaryIds: [],
    message: '',
  }
}

interface FormData {
  eventType: string
  eventDate: string
  eventTime: string
  guestCount: number
  tiers: TierData[]
  designColors: string
  deliveryMethod: 'pickup' | 'delivery'
  deliveryAddress: string
  deliveryCity: string
  deliveryZip: string
  contactName: string
  contactEmail: string
  contactPhone: string
  notes: string
  website: string // honeypot
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CakeOrderPage() {
  const params = useParams()
  const slug = params.slug as string

  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<CakeConfig | null>(null)
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [submissionToken] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )

  const [formData, setFormData] = useState<FormData>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(`cake-order-${slug}`)
        if (saved) return JSON.parse(saved)
      } catch { /* ignore */ }
    }
    return {
      eventType: '',
      eventDate: '',
      eventTime: '',
      guestCount: 10,
      tiers: [emptyTier()],
      designColors: '',
      deliveryMethod: 'pickup' as const,
      deliveryAddress: '',
      deliveryCity: '',
      deliveryZip: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      notes: '',
      website: '',
    }
  })

  // Autosave to sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(`cake-order-${slug}`, JSON.stringify(formData))
      } catch { /* ignore */ }
    }
  }, [formData, slug])

  const update = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError(null)
  }, [])

  const updateTier = useCallback((index: number, field: keyof TierData, value: TierData[keyof TierData]) => {
    setFormData(prev => {
      const tiers = [...prev.tiers]
      tiers[index] = { ...tiers[index], [field]: value }
      return { ...prev, tiers }
    })
    setError(null)
  }, [])

  // ─── Fetch config on mount ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/public/cake-order/${slug}/config`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || 'Failed to load configuration')
        setConfig(json)
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  // ─── Modifier helpers ──────────────────────────────────────────────────────

  const modifiersByTag = useMemo(() => {
    if (!config) return {} as Record<string, CakeModifier[]>
    const map: Record<string, CakeModifier[]> = {}
    for (const m of config.modifiers) {
      if (!map[m.groupTag]) map[m.groupTag] = []
      map[m.groupTag].push(m)
    }
    return map
  }, [config])

  const flavors = modifiersByTag['flavor'] || []
  const fillings = modifiersByTag['filling'] || []
  const frostings = modifiersByTag['frosting'] || []
  const decorations = modifiersByTag['decoration'] || []
  const dietaryOptions = modifiersByTag['dietary'] || []

  // ─── Price estimate ────────────────────────────────────────────────────────

  const priceEstimate = useMemo(() => {
    if (!config) return 0
    let total = 0
    for (const tier of formData.tiers) {
      total += tier.cakePrice
      const tierMods = [
        tier.flavorId, tier.fillingId, tier.frostingId,
        ...tier.decorationIds, ...tier.dietaryIds,
      ].filter(Boolean)
      for (const modId of tierMods) {
        const mod = config.modifiers.find(m => m.id === modId)
        if (mod) total += mod.price
      }
    }
    return total
  }, [config, formData.tiers])

  // ─── Lead time validation ──────────────────────────────────────────────────

  const minDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + (config?.leadTimeDays || 3))
    return d.toISOString().slice(0, 10)
  }, [config])

  // ─── Tier management ───────────────────────────────────────────────────────

  const addTier = useCallback(() => {
    if (!config) return
    setFormData(prev => {
      if (prev.tiers.length >= config.maxTiers) return prev
      return { ...prev, tiers: [...prev.tiers, emptyTier()] }
    })
  }, [config])

  const removeTier = useCallback((index: number) => {
    setFormData(prev => {
      if (prev.tiers.length <= 1) return prev
      const tiers = prev.tiers.filter((_, i) => i !== index)
      return { ...prev, tiers }
    })
  }, [])

  // ─── Navigation ────────────────────────────────────────────────────────────

  const canProceed = useCallback((step: number): boolean => {
    switch (step) {
      case 1:
        return !!formData.eventType && !!formData.eventDate && !!formData.eventTime && formData.guestCount > 0
      case 2:
        return formData.tiers.every(t => !!t.cakeId)
      case 3:
        return formData.tiers.every(t => !!t.flavorId)
      case 4:
        return formData.tiers.every(t => !!t.frostingId)
      case 5:
        return true // design is optional
      case 6:
        return true // message & dietary are optional
      case 7:
        if (formData.deliveryMethod === 'delivery') {
          return !!formData.deliveryAddress && !!formData.deliveryCity && !!formData.deliveryZip
        }
        return true
      case 8:
        return !!formData.contactName && !!formData.contactEmail && !!formData.contactPhone
      default:
        return true
    }
  }, [formData])

  const goNext = useCallback(() => {
    if (!canProceed(currentStep)) {
      setError('Please complete all required fields before continuing.')
      return
    }
    setError(null)
    setCurrentStep(prev => Math.min(prev + 1, 9))
  }, [currentStep, canProceed])

  const goBack = useCallback(() => {
    setError(null)
    setCurrentStep(prev => Math.max(prev - 1, 1))
  }, [])

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (formData.website) return // honeypot
    if (!canProceed(8)) {
      setError('Please complete all required fields.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/cake-order/${slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Submission-Token': submissionToken,
        },
        body: JSON.stringify({
          ...formData,
          priceEstimate,
          submissionToken,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to submit order')
      setOrderNumber(json.orderNumber || json.id)
      setCurrentStep(10) // success view
      // Clear session storage on success
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`cake-order-${slug}`)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }, [formData, slug, submissionToken, priceEstimate, canProceed])

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading...</p>
      </div>
    )
  }

  if (!config || config.available === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-xl shadow-sm p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Custom Cake Orders</h1>
          <p className="text-gray-600">
            Online cake ordering is not currently available. Please call us to place a custom cake order.
          </p>
        </div>
      </div>
    )
  }

  // ─── Success view ──────────────────────────────────────────────────────────

  if (currentStep === 10 && orderNumber) {
    return (
      <div className="min-h-screen flex items-start justify-center bg-gray-50 px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl font-bold mx-auto mb-4">
            &#10003;
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Submitted!</h1>
          <p className="text-blue-600 font-semibold text-lg mb-4">
            Order #{orderNumber}
          </p>
          <p className="text-gray-600 mb-6">
            We&apos;ve received your custom cake order. You&apos;ll receive a confirmation email shortly
            with details and next steps.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-left text-sm text-gray-700 space-y-1">
            <p><strong>Event:</strong> {formData.eventType}</p>
            <p><strong>Date:</strong> {formData.eventDate}</p>
            <p><strong>Tiers:</strong> {formData.tiers.length}</p>
            <p><strong>Estimated Total:</strong> ${priceEstimate.toFixed(2)}</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step labels ───────────────────────────────────────────────────────────

  const stepLabels = [
    'Event & Date', 'Cake', 'Flavors', 'Fillings & Frosting',
    'Design', 'Message', 'Delivery', 'Contact', 'Review',
  ]

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{config.locationName || 'Custom Cake Order'}</h1>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  i + 1 <= currentStep
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i + 1}
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`w-4 h-0.5 ${i + 1 < currentStep ? 'bg-blue-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-gray-500 mb-4">
          Step {currentStep}: {stepLabels[currentStep - 1]}
        </p>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-6">

          {/* Step 1: Event & Date */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Event Details</h2>

              <div>
                <label htmlFor="event-type" className="block text-sm font-medium text-gray-700 mb-1">Event Type *</label>
                <select
                  id="event-type"
                  value={formData.eventType}
                  onChange={e => update('eventType', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                >
                  <option value="">Select event type</option>
                  {config.eventTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="event-date" className="block text-sm font-medium text-gray-700 mb-1">Event Date *</label>
                <input
                  id="event-date"
                  type="date"
                  value={formData.eventDate}
                  onChange={e => update('eventDate', e.target.value)}
                  min={minDate}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Minimum {config.leadTimeDays} days advance notice required.
                </p>
              </div>

              <div>
                <label htmlFor="event-time" className="block text-sm font-medium text-gray-700 mb-1">Event Time *</label>
                <input
                  id="event-time"
                  type="time"
                  value={formData.eventTime}
                  onChange={e => update('eventTime', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>

              <div>
                <label htmlFor="guest-count" className="block text-sm font-medium text-gray-700 mb-1">Guest Count *</label>
                <input
                  id="guest-count"
                  type="number"
                  value={formData.guestCount}
                  onChange={e => update('guestCount', Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>
            </div>
          )}

          {/* Step 2: Cake Selection */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Select Your Cake</h2>
              {formData.tiers.map((tier, ti) => (
                <div key={ti} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">
                      {formData.tiers.length > 1 ? `Tier ${ti + 1}` : 'Base Cake'}
                    </h3>
                    {formData.tiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTier(ti)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {config.cakes.map(cake => (
                      <button
                        key={cake.id}
                        type="button"
                        onClick={() => {
                          updateTier(ti, 'cakeId', cake.id)
                          updateTier(ti, 'cakeName', cake.name)
                          updateTier(ti, 'cakePrice', cake.price)
                        }}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          tier.cakeId === cake.id
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="font-medium text-gray-900 text-sm">{cake.name}</p>
                        {cake.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{cake.description}</p>
                        )}
                        <p className="text-sm font-semibold text-blue-600 mt-1">${cake.price.toFixed(2)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {formData.tiers.length < config.maxTiers && (
                <button
                  type="button"
                  onClick={addTier}
                  className="w-full py-3 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors text-sm font-medium"
                >
                  + Add Tier
                </button>
              )}
            </div>
          )}

          {/* Step 3: Flavors */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Choose Flavors</h2>
              {formData.tiers.map((tier, ti) => (
                <div key={ti} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-3">
                    {formData.tiers.length > 1 ? `Tier ${ti + 1}: ${tier.cakeName}` : tier.cakeName}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {flavors.map(mod => (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => updateTier(ti, 'flavorId', mod.id)}
                        className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                          tier.flavorId === mod.id
                            ? 'border-blue-600 bg-blue-50 font-medium'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {mod.name}
                        {mod.price > 0 && (
                          <span className="block text-xs text-gray-500">+${mod.price.toFixed(2)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Fillings & Frosting */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Fillings & Frosting</h2>
              {formData.tiers.map((tier, ti) => (
                <div key={ti} className="border border-gray-200 rounded-lg p-4 space-y-4">
                  <h3 className="font-medium text-gray-900">
                    {formData.tiers.length > 1 ? `Tier ${ti + 1}: ${tier.cakeName}` : tier.cakeName}
                  </h3>

                  {/* Filling (optional) */}
                  {fillings.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Filling (optional)</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => updateTier(ti, 'fillingId', '')}
                          className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                            !tier.fillingId
                              ? 'border-blue-600 bg-blue-50 font-medium'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          No filling
                        </button>
                        {fillings.map(mod => (
                          <button
                            key={mod.id}
                            type="button"
                            onClick={() => updateTier(ti, 'fillingId', mod.id)}
                            className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                              tier.fillingId === mod.id
                                ? 'border-blue-600 bg-blue-50 font-medium'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            {mod.name}
                            {mod.price > 0 && (
                              <span className="block text-xs text-gray-500">+${mod.price.toFixed(2)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Frosting (required) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Frosting *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {frostings.map(mod => (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => updateTier(ti, 'frostingId', mod.id)}
                          className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                            tier.frostingId === mod.id
                              ? 'border-blue-600 bg-blue-50 font-medium'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {mod.name}
                          {mod.price > 0 && (
                            <span className="block text-xs text-gray-500">+${mod.price.toFixed(2)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 5: Design */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Design & Decorations</h2>

              <div>
                <label htmlFor="design-colors" className="block text-sm font-medium text-gray-700 mb-1">
                  Color Preferences
                </label>
                <input
                  id="design-colors"
                  type="text"
                  value={formData.designColors}
                  onChange={e => update('designColors', e.target.value)}
                  placeholder="e.g., pastel pink and white, navy and gold"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>

              {decorations.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Decorations</label>
                  <div className="grid grid-cols-2 gap-2">
                    {decorations.map(mod => {
                      // Decorations apply to all tiers uniformly for simplicity
                      const isSelected = formData.tiers[0]?.decorationIds.includes(mod.id)
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => {
                            setFormData(prev => {
                              const tiers = prev.tiers.map(tier => {
                                const ids = tier.decorationIds.includes(mod.id)
                                  ? tier.decorationIds.filter(id => id !== mod.id)
                                  : [...tier.decorationIds, mod.id]
                                return { ...tier, decorationIds: ids }
                              })
                              return { ...prev, tiers }
                            })
                          }}
                          className={`p-3 rounded-lg border-2 text-sm text-left transition-colors ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className="font-medium">{mod.name}</p>
                          {mod.price > 0 && (
                            <p className="text-xs text-gray-500">+${mod.price.toFixed(2)}</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 6: Message & Dietary */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Message & Dietary Needs</h2>
              {formData.tiers.map((tier, ti) => (
                <div key={ti} className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <h3 className="font-medium text-gray-900">
                    {formData.tiers.length > 1 ? `Tier ${ti + 1}: ${tier.cakeName}` : tier.cakeName}
                  </h3>

                  <div>
                    <label htmlFor={`message-${ti}`} className="block text-sm font-medium text-gray-700 mb-1">
                      Cake Message
                    </label>
                    <input
                      id={`message-${ti}`}
                      type="text"
                      value={tier.message}
                      onChange={e => updateTier(ti, 'message', e.target.value)}
                      placeholder='e.g., "Happy Birthday, Sarah!"'
                      maxLength={100}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                    />
                  </div>

                  {dietaryOptions.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Dietary Requirements</label>
                      <div className="space-y-2">
                        {dietaryOptions.map(mod => (
                          <label key={mod.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={tier.dietaryIds.includes(mod.id)}
                              onChange={() => {
                                const ids = tier.dietaryIds.includes(mod.id)
                                  ? tier.dietaryIds.filter(id => id !== mod.id)
                                  : [...tier.dietaryIds, mod.id]
                                updateTier(ti, 'dietaryIds', ids)
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600"
                            />
                            <span className="text-sm text-gray-700">
                              {mod.name}
                              {mod.price > 0 && (
                                <span className="text-gray-500"> (+${mod.price.toFixed(2)})</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step 7: Delivery */}
          {currentStep === 7 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Pickup or Delivery</h2>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => update('deliveryMethod', 'pickup')}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                    formData.deliveryMethod === 'pickup'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Pickup
                </button>
                <button
                  type="button"
                  onClick={() => update('deliveryMethod', 'delivery')}
                  className={`flex-1 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                    formData.deliveryMethod === 'delivery'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Delivery
                </button>
              </div>

              {formData.deliveryMethod === 'delivery' && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="delivery-address" className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                    <input
                      id="delivery-address"
                      type="text"
                      value={formData.deliveryAddress}
                      onChange={e => update('deliveryAddress', e.target.value)}
                      autoComplete="street-address"
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="delivery-city" className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                      <input
                        id="delivery-city"
                        type="text"
                        value={formData.deliveryCity}
                        onChange={e => update('deliveryCity', e.target.value)}
                        autoComplete="address-level2"
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="delivery-zip" className="block text-sm font-medium text-gray-700 mb-1">ZIP *</label>
                      <input
                        id="delivery-zip"
                        type="text"
                        value={formData.deliveryZip}
                        onChange={e => update('deliveryZip', e.target.value)}
                        autoComplete="postal-code"
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 8: Contact */}
          {currentStep === 8 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Contact Information</h2>

              <div>
                <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  id="contact-name"
                  type="text"
                  value={formData.contactName}
                  onChange={e => update('contactName', e.target.value)}
                  required
                  autoComplete="name"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>

              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  id="contact-email"
                  type="email"
                  value={formData.contactEmail}
                  onChange={e => update('contactEmail', e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>

              <div>
                <label htmlFor="contact-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                <input
                  id="contact-phone"
                  type="tel"
                  value={formData.contactPhone}
                  onChange={e => update('contactPhone', e.target.value)}
                  required
                  autoComplete="tel"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base"
                />
              </div>

              <div>
                <label htmlFor="contact-notes" className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
                <textarea
                  id="contact-notes"
                  value={formData.notes}
                  onChange={e => update('notes', e.target.value)}
                  rows={3}
                  placeholder="Anything else we should know?"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base resize-vertical"
                />
              </div>

              {/* Honeypot */}
              <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={formData.website}
                  onChange={e => update('website', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 9: Review & Submit */}
          {currentStep === 9 && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Review Your Order</h2>

              <div className="space-y-3 text-sm">
                {/* Event details */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="font-medium text-gray-900">Event Details</p>
                  <p className="text-gray-600">Type: {formData.eventType}</p>
                  <p className="text-gray-600">Date: {formData.eventDate} at {formData.eventTime}</p>
                  <p className="text-gray-600">Guests: {formData.guestCount}</p>
                </div>

                {/* Tiers */}
                {formData.tiers.map((tier, ti) => {
                  const flavorMod = flavors.find(m => m.id === tier.flavorId)
                  const fillingMod = fillings.find(m => m.id === tier.fillingId)
                  const frostingMod = frostings.find(m => m.id === tier.frostingId)
                  const decoMods = decorations.filter(m => tier.decorationIds.includes(m.id))
                  const dietMods = dietaryOptions.filter(m => tier.dietaryIds.includes(m.id))

                  return (
                    <div key={ti} className="bg-gray-50 rounded-lg p-4 space-y-1">
                      <p className="font-medium text-gray-900">
                        {formData.tiers.length > 1 ? `Tier ${ti + 1}: ` : ''}{tier.cakeName} — ${tier.cakePrice.toFixed(2)}
                      </p>
                      {flavorMod && <p className="text-gray-600">Flavor: {flavorMod.name}</p>}
                      {fillingMod && <p className="text-gray-600">Filling: {fillingMod.name}</p>}
                      {frostingMod && <p className="text-gray-600">Frosting: {frostingMod.name}</p>}
                      {decoMods.length > 0 && (
                        <p className="text-gray-600">Decorations: {decoMods.map(d => d.name).join(', ')}</p>
                      )}
                      {dietMods.length > 0 && (
                        <p className="text-gray-600">Dietary: {dietMods.map(d => d.name).join(', ')}</p>
                      )}
                      {tier.message && <p className="text-gray-600">Message: &ldquo;{tier.message}&rdquo;</p>}
                    </div>
                  )
                })}

                {/* Design */}
                {formData.designColors && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-gray-600">Colors: {formData.designColors}</p>
                  </div>
                )}

                {/* Delivery */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="font-medium text-gray-900">
                    {formData.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}
                  </p>
                  {formData.deliveryMethod === 'delivery' && (
                    <p className="text-gray-600">
                      {formData.deliveryAddress}, {formData.deliveryCity} {formData.deliveryZip}
                    </p>
                  )}
                </div>

                {/* Contact */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                  <p className="font-medium text-gray-900">Contact</p>
                  <p className="text-gray-600">{formData.contactName}</p>
                  <p className="text-gray-600">{formData.contactEmail}</p>
                  <p className="text-gray-600">{formData.contactPhone}</p>
                  {formData.notes && <p className="text-gray-600">Notes: {formData.notes}</p>}
                </div>

                {/* Price estimate */}
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <p className="text-base font-semibold text-gray-900">Estimated Total</p>
                    <p className="text-xl font-bold text-blue-600">${priceEstimate.toFixed(2)}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Final price may vary based on design complexity and consultation.
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-6 py-3 rounded-lg bg-blue-600 text-white font-semibold text-base hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Order'}
              </button>
            </form>
          )}

          {/* Navigation buttons (steps 1-8) */}
          {currentStep < 9 && (
            <div className="flex gap-3 mt-6">
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium text-base hover:bg-gray-200 transition-colors"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={goNext}
                className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-semibold text-base hover:bg-blue-700 transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {/* Back button on step 9 */}
          {currentStep === 9 && (
            <button
              type="button"
              onClick={goBack}
              className="w-full mt-3 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium text-base hover:bg-gray-200 transition-colors"
            >
              Back
            </button>
          )}
        </div>

        {/* Running price footer */}
        {currentStep >= 2 && currentStep <= 8 && priceEstimate > 0 && (
          <div className="mt-4 text-center text-sm text-gray-500">
            Running estimate: <span className="font-semibold text-gray-900">${priceEstimate.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
