'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface NotificationSettings {
  notificationEmail: string | null
  notificationPhone: string | null
}

const DEFAULTS: NotificationSettings = {
  notificationEmail: null,
  notificationPhone: null,
}

export default function NotificationsPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULTS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!employee?.location?.id) return
    fetch(`/api/settings/online-ordering?locationId=${employee.location.id}`)
      .then(res => res.json())
      .then(data => {
        const d = data.data || {}
        setSettings({
          notificationEmail: d.notificationEmail ?? null,
          notificationPhone: d.notificationPhone ?? null,
        })
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setIsLoading(false))
  }, [employee?.location?.id])

  const handleSave = async () => {
    if (!employee?.location?.id) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/settings/online-ordering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          employeeId: employee.id,
          settings: {
            onlineOrdering: {
              notificationEmail: settings.notificationEmail || null,
              notificationPhone: settings.notificationPhone || null,
            },
          },
        }),
      })
      if (res.ok) {
        toast.success('Notification settings saved')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <AdminPageHeader
        title="Notifications"
        subtitle="Configure where new order alerts are sent"
        breadcrumbs={[{ label: 'Online Ordering', href: '/settings/online-ordering' }]}
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Restaurant Notifications */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Restaurant Notifications</h2>
          <p className="text-sm text-gray-400 mb-5">
            We&apos;ll send a notification when a new online order arrives.
          </p>

          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">
                Email notification
              </label>
              <input
                type="email"
                value={settings.notificationEmail || ''}
                onChange={e => setSettings(prev => ({ ...prev, notificationEmail: e.target.value }))}
                placeholder="orders@yourrestaurant.com"
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Receives an email for every new online order
              </p>
            </div>

            <div className="border-t border-gray-800" />

            <div>
              <label className="text-sm font-medium text-gray-300 block mb-1.5">
                SMS notification
              </label>
              <input
                type="tel"
                value={settings.notificationPhone || ''}
                onChange={e => setSettings(prev => ({ ...prev, notificationPhone: e.target.value }))}
                placeholder="(555) 555-5555"
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Requires Twilio SMS to be configured
              </p>
              <p className="text-xs text-gray-600 mt-1 italic">
                SMS notifications require Twilio to be set up in Integrations
              </p>
            </div>
          </div>
        </div>

        {/* Customer Notifications (coming soon) */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800/50 p-6 opacity-60">
          <h2 className="text-lg font-semibold text-gray-400 mb-3">Customer Notifications</h2>

          <div className="bg-gray-800/50 rounded-lg p-3 mb-5">
            <p className="text-sm text-gray-400">
              Customer confirmation email is coming in a future update.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Customer confirmation email</p>
              <button
                type="button"
                role="switch"
                aria-checked={false}
                disabled
                className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-gray-800"
              >
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-gray-600 shadow-lg translate-x-0" />
              </button>
            </div>

            <div className="border-t border-gray-800/50" />

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Customer confirmation SMS</p>
              <button
                type="button"
                role="switch"
                aria-checked={false}
                disabled
                className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-gray-800"
              >
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-gray-600 shadow-lg translate-x-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
