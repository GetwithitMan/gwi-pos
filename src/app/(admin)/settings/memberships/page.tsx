'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

export default function MembershipSettingsPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        const fetched = data.data.settings || {}
        const defaultMemberships = {
          enabled: false,
          retryScheduleDays: [0, 3, 7],
          gracePeriodDays: 14,
          sendDeclineEmails: true,
          sendUpcomingChargeEmails: true,
          sendRetryScheduledEmails: true,
          sendAdminDeclineAlerts: true,
        }
        setSettings({
          ...DEFAULT_SETTINGS,
          ...fetched,
          memberships: { ...defaultMemberships, ...(fetched.memberships || {}) },
        })
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const saveSettings = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings, employeeId }),
      })
      if (response.ok) {
        toast.success('Membership settings saved')
      } else {
        toast.error('Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const membership = settings.memberships ?? {
    enabled: false,
    retryScheduleDays: [0, 3, 7],
    gracePeriodDays: 14,
    sendDeclineEmails: true,
    sendUpcomingChargeEmails: true,
    sendRetryScheduledEmails: true,
    sendAdminDeclineAlerts: true,
  }

  const updateMemberships = (updates: Partial<typeof membership>) => {
    setSettings(prev => ({
      ...prev,
      memberships: { ...membership, ...updates },
    }))
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-900">Loading...</div>
  }

  const disabled = !membership.enabled

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Memberships</h1>
          <p className="text-sm text-gray-900 mt-1">Recurring payments, retry schedule, and customer notifications.</p>
        </div>
        <Button onClick={saveSettings} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Enable / Disable */}
      <Card className="p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={membership.enabled}
            onChange={(e) => updateMemberships({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300"
          />
          <div>
            <span className="text-base font-semibold">Enable Memberships</span>
            <p className="text-sm text-gray-900">Allow recurring payment plans and customer subscriptions.</p>
          </div>
        </label>
      </Card>

      {/* Retry Schedule */}
      <Card className={`p-6 space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-lg font-semibold">Billing Retry Schedule</h2>
        <p className="text-sm text-gray-900">When a charge fails, the system retries on these days after the initial failure.</p>

        <div className="grid grid-cols-3 gap-4">
          {(membership.retryScheduleDays ?? [0, 3, 7]).map((day, index) => (
            <div key={index}>
              <label className="block text-xs font-medium text-gray-900 mb-1">
                {index === 0 ? 'First retry (days)' : index === 1 ? 'Second retry (days)' : 'Third retry (days)'}
              </label>
              <input
                type="number"
                min="0"
                max="30"
                step="1"
                value={day}
                onChange={(e) => {
                  const newDays = [...membership.retryScheduleDays]
                  newDays[index] = Math.max(0, parseInt(e.target.value) || 0)
                  updateMemberships({ retryScheduleDays: newDays })
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={disabled}
              />
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-900 mb-1">Grace period after retries exhausted (days)</label>
          <input
            type="number"
            min="1"
            max="90"
            step="1"
            value={membership.gracePeriodDays}
            onChange={(e) => updateMemberships({ gracePeriodDays: Math.max(1, parseInt(e.target.value) || 14) })}
            className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm"
            disabled={disabled}
          />
          <p className="text-xs text-gray-900 mt-1">After all retries fail, the membership stays active for this many days before expiring.</p>
        </div>
      </Card>

      {/* Email Notifications */}
      <Card className={`p-6 space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-lg font-semibold">Email Notifications</h2>

        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={membership.sendUpcomingChargeEmails}
              onChange={(e) => updateMemberships({ sendUpcomingChargeEmails: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <div>
              <span className="text-sm">Upcoming charge reminder</span>
              <p className="text-xs text-gray-900">Send customers an email 3 days before their next billing date.</p>
            </div>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={membership.sendDeclineEmails}
              onChange={(e) => updateMemberships({ sendDeclineEmails: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <div>
              <span className="text-sm">Decline notification</span>
              <p className="text-xs text-gray-900">Notify customers when their card is declined so they can update it.</p>
            </div>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={membership.sendRetryScheduledEmails}
              onChange={(e) => updateMemberships({ sendRetryScheduledEmails: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <div>
              <span className="text-sm">Retry scheduled notification</span>
              <p className="text-xs text-gray-900">Tell customers when their next charge retry is scheduled.</p>
            </div>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={membership.sendAdminDeclineAlerts}
              onChange={(e) => updateMemberships({ sendAdminDeclineAlerts: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <div>
              <span className="text-sm font-medium">Admin decline alerts</span>
              <p className="text-xs text-gray-900">Send managers a daily summary of persistent declines that need attention.</p>
            </div>
          </label>
        </div>
      </Card>

      {/* Summary Preview */}
      {membership.enabled && (
        <Card className="p-6">
          <div className="p-4 bg-blue-50 rounded-xl">
            <h4 className="font-medium text-blue-900 mb-1 text-sm">Preview</h4>
            <div className="text-sm text-blue-700 space-y-1">
              <p>Retry schedule: Day {membership.retryScheduleDays.join(', Day ')} after initial failure.</p>
              <p>Grace period: <span className="font-bold">{membership.gracePeriodDays} days</span> before membership expires.</p>
              <p>Customer emails: {[
                membership.sendUpcomingChargeEmails && 'upcoming charge',
                membership.sendDeclineEmails && 'decline notice',
                membership.sendRetryScheduledEmails && 'retry scheduled',
              ].filter(Boolean).join(', ') || 'none enabled'}.</p>
              {membership.sendAdminDeclineAlerts && <p>Admin alerts: daily decline summary enabled.</p>}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
