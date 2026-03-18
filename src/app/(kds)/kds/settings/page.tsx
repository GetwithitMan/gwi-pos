'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KDSSettingsSidebar } from '../../components/KDSSettingsSidebar'
import { ToastContainer } from '@/components/ui/ToastContainer'
import { toast } from '@/stores/toast-store'
import type { KDSOrderBehavior, KDSTransitionTimes, KDSOrderTypeFilters, KDSDisplayMode } from '@/lib/kds/types'

// LocalStorage keys (matches kds/page.tsx)
const DEVICE_TOKEN_KEY = 'kds_device_token'
const SCREEN_CONFIG_KEY = 'kds_screen_config'

export interface ScreenConfig {
  id: string
  name: string
  slug: string | null
  screenType: string
  locationId: string
  columns: number
  fontSize: string
  colorScheme: string
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  isPaired: boolean
  displayMode: KDSDisplayMode
  transitionTimes: KDSTransitionTimes | null
  orderBehavior: Partial<KDSOrderBehavior> | null
  orderTypeFilters: KDSOrderTypeFilters | null
  sourceLinks: Array<{
    id: string
    targetScreenId: string
    targetScreenName: string
    linkType: string
    bumpAction: string
    resetStrikethroughsOnSend: boolean
  }>
  stations: Array<{
    id: string
    name: string
    displayName: string | null
    stationType: string
    color: string | null
  }>
}

function KDSSettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const screenId = searchParams.get('screen')

  const [screenConfig, setScreenConfig] = useState<ScreenConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load screen config on mount
  const fetchScreenConfig = useCallback(async () => {
    if (!screenId) {
      setError('No screen ID provided. Add ?screen=ID to the URL.')
      setLoading(false)
      return
    }

    const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY)

    try {
      const headers: Record<string, string> = {}
      if (deviceToken) {
        headers['x-device-token'] = deviceToken
      }

      const response = await fetch(
        `/api/hardware/kds-screens/auth?screenId=${encodeURIComponent(screenId)}`,
        { headers }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || `Failed to load screen (${response.status})`)
        setLoading(false)
        return
      }

      const data = await response.json()
      const result = data.data || data

      if (result.authenticated && result.screen) {
        setScreenConfig(result.screen)
        setError(null)
      } else {
        setError('Screen not found or not authenticated.')
      }
    } catch (err) {
      console.error('Failed to fetch screen config:', err)
      setError('Network error loading screen config.')
    } finally {
      setLoading(false)
    }
  }, [screenId])

  useEffect(() => {
    fetchScreenConfig()
  }, [fetchScreenConfig])

  // Save handler — sends only changed fields via PUT
  const handleSave = useCallback(async (updates: Partial<ScreenConfig>) => {
    if (!screenConfig) return

    setSaving(true)
    try {
      const response = await fetch(`/api/hardware/kds-screens/${screenConfig.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Save failed (${response.status})`)
      }

      const data = await response.json()
      const updatedScreen = data.data?.screen || data.screen || data.data

      // Merge updates into local state
      if (updatedScreen) {
        setScreenConfig(updatedScreen)
      } else {
        // Optimistically merge if API doesn't return full object
        setScreenConfig(prev => prev ? { ...prev, ...updates } : prev)
      }

      // Update localStorage cache so main KDS page picks up changes
      const storedConfig = localStorage.getItem(SCREEN_CONFIG_KEY)
      if (storedConfig) {
        try {
          const parsed = JSON.parse(storedConfig)
          if (parsed.id === screenConfig.id) {
            localStorage.setItem(SCREEN_CONFIG_KEY, JSON.stringify({
              ...parsed,
              ...updates,
            }))
          }
        } catch {
          // Ignore parse errors
        }
      }

      toast.success('Settings saved successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings'
      toast.error(message)
      throw err // Re-throw so sidebar can handle
    } finally {
      setSaving(false)
    }
  }, [screenConfig])

  // Navigate back to KDS view
  const handleBack = useCallback(() => {
    if (screenConfig?.slug) {
      router.push(`/kds?screen=${encodeURIComponent(screenConfig.slug)}`)
    } else if (screenConfig?.id) {
      router.push(`/kds?screen=${encodeURIComponent(screenConfig.id)}`)
    } else {
      router.push('/kds')
    }
  }, [router, screenConfig])

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading screen settings...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !screenConfig) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Unable to Load Settings</h2>
          <p className="text-gray-400 mb-6">{error || 'Screen configuration not found.'}</p>
          <button
            onClick={handleBack}
            className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            Back to KDS
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to KDS
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">
              {screenConfig.name} — Settings
            </h1>
            <p className="text-xs text-gray-400">
              Screen ID: {screenConfig.id}
            </p>
          </div>
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-blue-400 text-sm">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Saving...
          </div>
        )}
      </div>

      {/* Settings form */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <KDSSettingsSidebar
          screenConfig={screenConfig}
          onSave={handleSave}
          saving={saving}
        />
      </div>

      <ToastContainer />
    </div>
  )
}

export default function KDSSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <KDSSettingsContent />
    </Suspense>
  )
}
