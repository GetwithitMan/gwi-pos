'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HardwareHealthWidget } from '@/components/hardware/HardwareHealthWidget'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useSocket } from '@/hooks/useSocket'
import { useAuthStore } from '@/stores/auth-store'
import { getSharedSocket } from '@/lib/shared-socket'

// ─── Section Card ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  icon: string
  title: string
  description: string
  href: string
}

function SectionCard({ icon, title, description, href }: SectionCardProps) {
  return (
    <Link
      href={href}
      className="block bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-gray-300 transition-all group"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-2xl mb-2">{icon}</div>
          <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-600 leading-snug">{description}</p>
        </div>
        <svg
          className="w-5 h-5 text-gray-900 group-hover:text-gray-500 mt-1 ml-3 flex-shrink-0 transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { isConnected } = useSocket()
  const locationId = useAuthStore(s => s.employee?.location?.id)

  const [locationName, setLocationName] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Hardware health data
  const [terminals, setTerminals] = useState<any[]>([])
  const [printers, setPrinters] = useState<any[]>([])
  const [kdsScreens, setKdsScreens] = useState<any[]>([])

  const loadHardwareStatus = useCallback(async () => {
    if (!locationId) return
    try {
      const [terminalsRes, printersRes, kdsRes] = await Promise.all([
        fetch(`/api/hardware/terminals?locationId=${locationId}`),
        fetch(`/api/hardware/printers?locationId=${locationId}`),
        fetch(`/api/hardware/kds-screens?locationId=${locationId}`),
      ])
      if (terminalsRes.ok) setTerminals((await terminalsRes.json()).data.terminals || [])
      if (printersRes.ok)  setPrinters((await printersRes.json()).data.printers || [])
      if (kdsRes.ok)       setKdsScreens((await kdsRes.json()).data.screens || [])
    } catch (error) {
      console.error('Failed to load hardware status:', error)
    }
  }, [locationId])

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        setLocationName(data.data.locationName)
      }
    } catch (error) {
      console.error('Failed to load location name:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadHardwareStatus()
  }, [loadSettings, loadHardwareStatus])

  // Socket: live-refresh when settings change from another terminal
  useEffect(() => {
    const socket = getSharedSocket()
    const handler = () => { loadSettings(); loadHardwareStatus() }
    socket.on('settings:updated', handler)
    return () => { socket.off('settings:updated', handler) }
  }, [loadSettings, loadHardwareStatus])

  // 20s fallback polling when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(loadHardwareStatus, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, loadHardwareStatus])

  // Refresh on tab visibility
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadHardwareStatus()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [loadHardwareStatus])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-900">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader title="Settings" subtitle={locationName} />

      <div className="max-w-5xl mx-auto space-y-8">

        {/* Section Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SectionCard
            icon="💳"
            title="Payments & Processing"
            description="Payment methods, card processor, batch settlement, Quick Pay, walkout recovery, and bottle service"
            href="/settings/payments"
          />
          <SectionCard
            icon="💰"
            title="Tips & Tip-Outs"
            description="Tip percentages, tip bank, tip sharing rules, and tip-out allocation"
            href="/settings/tips"
          />
          <SectionCard
            icon="🍺"
            title="Tabs & Pre-Auth"
            description="Bar tab policies, card requirements, pre-authorization holds, and auto-increment"
            href="/settings/tabs"
          />
          <SectionCard
            icon="⏰"
            title="Staff & Shifts"
            description="Clock-out requirements, business day boundary, and shift enforcement rules"
            href="/settings/staff"
          />
          <SectionCard
            icon="🧾"
            title="Receipts"
            description="Receipt header/footer, itemized display, tip lines, signature requirements, and kitchen tickets"
            href="/settings/receipts"
          />
          <SectionCard
            icon="🔧"
            title="Hardware"
            description="Printers, KDS screens, payment readers, terminals, and routing"
            href="/settings/hardware"
          />
          <SectionCard
            icon="🔒"
            title="Security"
            description="PIN lockout, 2FA requirements, buddy punch detection, and approval thresholds"
            href="/settings/security"
          />
          <SectionCard
            icon="📊"
            title="Tax Rules"
            description="Tax rates, inclusive pricing, discount calculation order, and price rounding"
            href="/settings/tax-rules"
          />
          <SectionCard
            icon="🏢"
            title="Venue & Display"
            description="Business information, POS display layout, auto-reboot, and system settings"
            href="/settings/venue"
          />
          <SectionCard
            icon="🎓"
            title="Training & Messages"
            description="Training mode for new employees, login screen announcements, and staff alerts"
            href="/settings/training"
          />
          <SectionCard
            icon="💡"
            title="Upsell Rules"
            description="Configure intelligent upsell prompts to increase revenue per check"
            href="/settings/upsell-rules"
          />
          <SectionCard
            icon="🔄"
            title="Memberships"
            description="Recurring payments, retry schedule, grace periods, and decline notifications"
            href="/settings/memberships"
          />
          <SectionCard
            icon="⏳"
            title="Waitlist"
            description="Entertainment waitlist settings, SMS notifications, deposit collection, and no-show policies"
            href="/settings/waitlist"
          />
          <SectionCard
            icon="📺"
            title="Customer Display (CFD)"
            description="Display modes, item visibility, dual pricing, upsell messages, and idle screen customization"
            href="/settings/cfd"
          />
        </div>

        {/* Hardware Health Widget */}
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <HardwareHealthWidget
            terminals={terminals}
            printers={printers}
            kdsScreens={kdsScreens}
          />
        </div>

      </div>
    </div>
  )
}
