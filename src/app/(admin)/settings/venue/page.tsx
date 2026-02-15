'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
]

interface LocationData {
  id: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
}

export default function VenueSettingsPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [hasChanges, setHasChanges] = useState(false)
  const [original, setOriginal] = useState({ name: '', address: '', phone: '', timezone: 'America/New_York' })

  // NUC Registration
  const [regCode, setRegCode] = useState<string | null>(null)
  const [regStatus, setRegStatus] = useState<'none' | 'active' | 'expired' | 'used' | 'revoked'>('none')
  const [regExpiresAt, setRegExpiresAt] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  const loadRegCode = useCallback(async () => {
    try {
      const res = await fetch('/api/location/registration-code')
      if (res.ok) {
        const { data } = await res.json()
        setRegCode(data.code)
        setRegStatus(data.status)
        setRegExpiresAt(data.expiresAt)
      }
    } catch {
      // Non-critical — don't toast on load failure
    }
  }, [])

  useEffect(() => {
    async function loadLocation() {
      try {
        const res = await fetch('/api/location')
        if (res.ok) {
          const { data } = await res.json() as { data: LocationData }
          setName(data.name)
          setAddress(data.address || '')
          setPhone(data.phone || '')
          setTimezone(data.timezone)
          setOriginal({
            name: data.name,
            address: data.address || '',
            phone: data.phone || '',
            timezone: data.timezone,
          })
        }
      } catch {
        toast.error('Failed to load venue settings')
      } finally {
        setIsLoading(false)
      }
    }
    loadLocation()
    loadRegCode()
  }, [loadRegCode])

  useEffect(() => {
    setHasChanges(
      name !== original.name ||
      address !== original.address ||
      phone !== original.phone ||
      timezone !== original.timezone
    )
  }, [name, address, phone, timezone, original])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Business name is required')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/location', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim(), phone: phone.trim(), timezone }),
      })

      if (res.ok) {
        const { data } = await res.json() as { data: LocationData }
        setOriginal({
          name: data.name,
          address: data.address || '',
          phone: data.phone || '',
          timezone: data.timezone,
        })
        setHasChanges(false)
        toast.success('Venue settings saved')
      } else {
        toast.error('Failed to save venue settings')
      }
    } catch {
      toast.error('Failed to save venue settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = async () => {
    setIsGenerating(true)
    try {
      const res = await fetch('/api/location/registration-code', { method: 'POST' })
      if (res.ok) {
        const { data } = await res.json()
        setRegCode(data.code)
        setRegStatus(data.status)
        setRegExpiresAt(data.expiresAt)
        toast.success('Registration code generated — expires in 24 hours')
      } else {
        toast.error('Failed to generate registration code')
      }
    } catch {
      toast.error('Failed to generate registration code')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopyCode = () => {
    if (regCode) {
      navigator.clipboard.writeText(regCode).catch(() => {})
      toast.success('Code copied')
    }
  }

  const formatExpiry = (iso: string): string => {
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return 'Expired'
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <AdminPageHeader
        title="Venue Settings"
        subtitle="Business name, address, timezone, and locale configuration."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            isLoading={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Business Info */}
        <Card>
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label htmlFor="venue-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="venue-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g. Joe's Bar & Grill"
                />
              </div>

              <div>
                <label htmlFor="venue-address" className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  id="venue-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g. 123 Main St, City, ST 12345"
                />
              </div>

              <div>
                <label htmlFor="venue-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  id="venue-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g. (555) 123-4567"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Locale */}
        <Card>
          <CardHeader>
            <CardTitle>Locale</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <label htmlFor="venue-timezone" className="block text-sm font-medium text-gray-700 mb-1">
                Timezone
              </label>
              <select
                id="venue-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* NUC Registration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>NUC Registration</CardTitle>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                regStatus === 'active' ? 'bg-green-100 text-green-700' :
                regStatus === 'expired' ? 'bg-red-100 text-red-700' :
                regStatus === 'used' ? 'bg-gray-200 text-gray-600' :
                'bg-gray-100 text-gray-500'
              }`}>
                {regStatus === 'active' ? 'Active' :
                 regStatus === 'expired' ? 'Expired' :
                 regStatus === 'used' ? 'Used' :
                 regStatus === 'revoked' ? 'Revoked' :
                 'No Code'}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-50 border rounded px-4 py-3 font-mono text-2xl tracking-widest text-center select-all">
                  {regCode || '\u2014'}
                </div>
                {regCode && regStatus === 'active' && (
                  <Button variant="outline" onClick={handleCopyCode} className="shrink-0">
                    Copy
                  </Button>
                )}
              </div>

              {regExpiresAt && regStatus === 'active' && (
                <p className="text-sm text-gray-500">
                  Expires in {formatExpiry(regExpiresAt)}
                </p>
              )}
              {regStatus === 'expired' && (
                <p className="text-sm text-red-500">
                  Code has expired. Generate a new one.
                </p>
              )}

              <Button
                variant={regStatus === 'active' ? 'outline' : 'primary'}
                onClick={handleGenerateCode}
                disabled={isGenerating}
                isLoading={isGenerating}
                className="w-full"
              >
                {isGenerating ? 'Generating...' :
                 regStatus === 'active' ? 'Regenerate Code' : 'Generate Code'}
              </Button>

              <p className="text-xs text-gray-400">
                Use this code during NUC installation:{' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-500">
                  curl -sSL https://www.thepasspos.com/installer.run | sudo bash
                </code>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Coming Soon */}
        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Additional Configuration</CardTitle>
              <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                Coming Soon
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Operating Hours
                </label>
                <input
                  type="text"
                  disabled
                  className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
                  placeholder="Per-day operating hours"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Week Start Day
                  </label>
                  <select
                    disabled
                    className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
                  >
                    <option>Sunday</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Fiscal Year Start
                  </label>
                  <select
                    disabled
                    className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
                  >
                    <option>January</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Logo
                </label>
                <div className="w-full border border-dashed rounded px-3 py-6 bg-gray-50 text-gray-400 text-center text-sm cursor-not-allowed">
                  Logo upload coming soon
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Venue Type
                </label>
                <select
                  disabled
                  className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
                >
                  <option>Bar / Restaurant</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
