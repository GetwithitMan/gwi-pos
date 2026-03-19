'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { KDSOrderBehavior, KDSTransitionTimes, KDSOrderTypeFilters, KDSDisplayMode, KDSScreenLinkData } from '@/lib/kds/types'
import { mergeOrderBehavior } from '@/lib/kds/defaults'

// ── Screen Config Type ──

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

// ── Props ──

export interface KDSSettingsSidebarProps {
  screenConfig: ScreenConfig
  onSave: (updates: Partial<ScreenConfig>) => Promise<void>
  saving: boolean
}

// ── Constants ──

const ORDER_TYPES = [
  { key: 'dine_in', label: 'Dine In' },
  { key: 'takeout', label: 'Takeout' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'bar_tab', label: 'Bar Tab' },
  { key: 'boh_sale', label: 'BOH' },
] as const

const DISPLAY_MODES: { value: KDSDisplayMode; label: string; description: string }[] = [
  { value: 'tiled', label: 'Tiled', description: 'Grid of order cards across columns' },
  { value: 'classic', label: 'Classic', description: 'Single-column scrolling list' },
  { value: 'split', label: 'Split', description: 'Active orders left, completed right' },
  { value: 'takeout', label: 'Take Out', description: 'Optimized for pickup/takeout flow' },
]

const FONT_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
]

const LINK_TYPE_LABELS: Record<string, string> = {
  send_to_next: 'Send to Next',
  multi_clear: 'Multi-Clear',
}

const BUMP_ACTION_LABELS: Record<string, string> = {
  bump: 'Bump',
  strike_through: 'Strike Through',
  no_action: 'No Action',
}

// ── Component ──

export function KDSSettingsSidebar({ screenConfig, onSave, saving }: KDSSettingsSidebarProps) {
  // ── Local form state ──

  const [displayMode, setDisplayMode] = useState<KDSDisplayMode>(screenConfig.displayMode || 'tiled')
  const [colorScheme, setColorScheme] = useState(screenConfig.colorScheme || 'dark')
  const [fontSize, setFontSize] = useState(screenConfig.fontSize || 'normal')
  const [columns, setColumns] = useState(screenConfig.columns || 4)
  const [agingWarning, setAgingWarning] = useState(screenConfig.agingWarning ?? 8)
  const [lateWarning, setLateWarning] = useState(screenConfig.lateWarning ?? 15)
  const [playSound, setPlaySound] = useState(screenConfig.playSound ?? true)
  const [flashOnNew, setFlashOnNew] = useState(screenConfig.flashOnNew ?? true)

  // Order behavior — merged with defaults
  const mergedBehavior = useMemo(() => mergeOrderBehavior(screenConfig.orderBehavior), [screenConfig.orderBehavior])
  const [orderBehavior, setOrderBehavior] = useState<KDSOrderBehavior>(mergedBehavior)

  // Order type filters
  const [orderTypeFilters, setOrderTypeFilters] = useState<Record<string, boolean>>(() => {
    const filters: Record<string, boolean> = {}
    for (const ot of ORDER_TYPES) {
      filters[ot.key] = screenConfig.orderTypeFilters?.[ot.key] ?? true
    }
    return filters
  })

  // Transition times — per-order-type overrides
  const [transitionTimes, setTransitionTimes] = useState<Record<string, { caution: number; late: number }>>(() => {
    const times: Record<string, { caution: number; late: number }> = {}
    for (const ot of ORDER_TYPES) {
      times[ot.key] = screenConfig.transitionTimes?.[ot.key] ?? { caution: 0, late: 0 }
    }
    return times
  })
  const [useGlobalTimes, setUseGlobalTimes] = useState<Record<string, boolean>>(() => {
    const flags: Record<string, boolean> = {}
    for (const ot of ORDER_TYPES) {
      // If no per-type time set (or caution/late are 0), use global
      const t = screenConfig.transitionTimes?.[ot.key]
      flags[ot.key] = !t || (t.caution === 0 && t.late === 0)
    }
    return flags
  })

  // Screen links (read-only)
  const [screenLinks, setScreenLinks] = useState<KDSScreenLinkData[]>([])
  const [linksLoading, setLinksLoading] = useState(false)

  // Sync local state when screenConfig changes (e.g., after save returns updated data)
  useEffect(() => {
    setDisplayMode(screenConfig.displayMode || 'tiled')
    setColorScheme(screenConfig.colorScheme || 'dark')
    setFontSize(screenConfig.fontSize || 'normal')
    setColumns(screenConfig.columns || 4)
    setAgingWarning(screenConfig.agingWarning ?? 8)
    setLateWarning(screenConfig.lateWarning ?? 15)
    setPlaySound(screenConfig.playSound ?? true)
    setFlashOnNew(screenConfig.flashOnNew ?? true)

    const merged = mergeOrderBehavior(screenConfig.orderBehavior)
    setOrderBehavior(merged)

    const filters: Record<string, boolean> = {}
    for (const ot of ORDER_TYPES) {
      filters[ot.key] = screenConfig.orderTypeFilters?.[ot.key] ?? true
    }
    setOrderTypeFilters(filters)

    const times: Record<string, { caution: number; late: number }> = {}
    const flags: Record<string, boolean> = {}
    for (const ot of ORDER_TYPES) {
      const t = screenConfig.transitionTimes?.[ot.key]
      times[ot.key] = t ?? { caution: 0, late: 0 }
      flags[ot.key] = !t || (t.caution === 0 && t.late === 0)
    }
    setTransitionTimes(times)
    setUseGlobalTimes(flags)
  }, [screenConfig])

  // Fetch screen links
  useEffect(() => {
    if (!screenConfig.locationId || !screenConfig.id) return
    setLinksLoading(true)
    fetch(`/api/kds/screen-links?locationId=${screenConfig.locationId}&screenId=${screenConfig.id}`)
      .then(r => r.json())
      .then(data => {
        const links = data.data?.links || []
        setScreenLinks(links)
      })
      .catch(err => {
        console.error('Failed to fetch screen links:', err)
      })
      .finally(() => setLinksLoading(false))
  }, [screenConfig.locationId, screenConfig.id])

  // ── Build update payload with only changed fields ──

  const buildUpdates = useCallback((): Partial<ScreenConfig> => {
    const updates: Record<string, unknown> = {}

    if (displayMode !== (screenConfig.displayMode || 'tiled')) {
      updates.displayMode = displayMode
    }
    if (colorScheme !== (screenConfig.colorScheme || 'dark')) {
      updates.colorScheme = colorScheme
    }
    if (fontSize !== (screenConfig.fontSize || 'normal')) {
      updates.fontSize = fontSize
    }
    if (columns !== (screenConfig.columns || 4)) {
      updates.columns = columns
    }
    if (agingWarning !== (screenConfig.agingWarning ?? 8)) {
      updates.agingWarning = agingWarning
    }
    if (lateWarning !== (screenConfig.lateWarning ?? 15)) {
      updates.lateWarning = lateWarning
    }
    if (playSound !== (screenConfig.playSound ?? true)) {
      updates.playSound = playSound
    }
    if (flashOnNew !== (screenConfig.flashOnNew ?? true)) {
      updates.flashOnNew = flashOnNew
    }

    // Order behavior — always send full object to avoid partial overwrite issues
    const origBehavior = mergeOrderBehavior(screenConfig.orderBehavior)
    const behaviorChanged = JSON.stringify(orderBehavior) !== JSON.stringify(origBehavior)
    if (behaviorChanged) {
      updates.orderBehavior = orderBehavior
    }

    // Order type filters
    const origFilters: Record<string, boolean> = {}
    for (const ot of ORDER_TYPES) {
      origFilters[ot.key] = screenConfig.orderTypeFilters?.[ot.key] ?? true
    }
    if (JSON.stringify(orderTypeFilters) !== JSON.stringify(origFilters)) {
      updates.orderTypeFilters = orderTypeFilters
    }

    // Transition times — build from local state, using null for "use global" types
    const builtTimes: Record<string, { caution: number; late: number }> = {}
    let hasAnyOverride = false
    for (const ot of ORDER_TYPES) {
      if (!useGlobalTimes[ot.key] && (transitionTimes[ot.key].caution > 0 || transitionTimes[ot.key].late > 0)) {
        builtTimes[ot.key] = transitionTimes[ot.key]
        hasAnyOverride = true
      }
    }
    const newTransitionTimes = hasAnyOverride ? builtTimes : null
    const origTT = screenConfig.transitionTimes
    if (JSON.stringify(newTransitionTimes) !== JSON.stringify(origTT)) {
      updates.transitionTimes = newTransitionTimes
    }

    return updates as Partial<ScreenConfig>
  }, [
    displayMode, colorScheme, fontSize, columns, agingWarning, lateWarning,
    playSound, flashOnNew, orderBehavior, orderTypeFilters, transitionTimes,
    useGlobalTimes, screenConfig,
  ])

  const handleSave = useCallback(async () => {
    const updates = buildUpdates()
    if (Object.keys(updates).length === 0) return
    try {
      await onSave(updates)
    } catch {
      // Error toast handled by parent
    }
  }, [buildUpdates, onSave])

  // ── Helpers for order behavior toggles ──

  const toggleBehavior = useCallback((key: keyof KDSOrderBehavior) => {
    setOrderBehavior(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const setBehaviorValue = useCallback((key: keyof KDSOrderBehavior, value: number | string | null) => {
    setOrderBehavior(prev => ({ ...prev, [key]: value }))
  }, [])

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    const updates = buildUpdates()
    return Object.keys(updates).length > 0
  }, [buildUpdates])

  return (
    <div className="space-y-1">
      {/* ── General ── */}
      <Section title="General">
        <ReadOnlyField label="Screen Name" value={screenConfig.name} />
        <ReadOnlyField label="Screen ID" value={screenConfig.id} />
        <ReadOnlyField label="Screen Type" value={screenConfig.screenType} />
        <ReadOnlyField label="Location ID" value={screenConfig.locationId} />
        {screenConfig.slug && <ReadOnlyField label="URL Slug" value={screenConfig.slug} />}
        <ReadOnlyField label="Paired" value={screenConfig.isPaired ? 'Yes' : 'No'} />
      </Section>

      {/* ── Display Mode ── */}
      <Section title="Display Mode">
        <div className="space-y-2">
          {DISPLAY_MODES.map(mode => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                displayMode === mode.value
                  ? 'border-blue-500 bg-blue-900/20'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="displayMode"
                value={mode.value}
                checked={displayMode === mode.value}
                onChange={() => setDisplayMode(mode.value)}
                className="mt-1 accent-blue-500"
              />
              <div>
                <div className="font-medium text-white text-sm">{mode.label}</div>
                <div className="text-xs text-gray-400">{mode.description}</div>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {/* ── Order Type Filters ── */}
      <Section title="Order Type Filters">
        <p className="text-xs text-gray-500 mb-3">Uncheck order types to hide them from this screen.</p>
        <div className="space-y-2">
          {ORDER_TYPES.map(ot => (
            <label key={ot.key} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={orderTypeFilters[ot.key] ?? true}
                onChange={() => setOrderTypeFilters(prev => ({ ...prev, [ot.key]: !prev[ot.key] }))}
                className="w-4 h-4 accent-blue-500 rounded"
              />
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                {ot.label}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {/* ── Appearance ── */}
      <Section title="Appearance">
        <FieldGroup label="Theme">
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map(theme => (
              <button
                key={theme}
                onClick={() => setColorScheme(theme)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  colorScheme === theme
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {theme.charAt(0).toUpperCase() + theme.slice(1)}
              </button>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup label="Font Size">
          <div className="flex gap-2">
            {FONT_SIZES.map(fs => (
              <button
                key={fs.value}
                onClick={() => setFontSize(fs.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  fontSize === fs.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {fs.label}
              </button>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup label={`Columns: ${columns}`}>
          <input
            type="range"
            min={2}
            max={6}
            value={columns}
            onChange={e => setColumns(parseInt(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
          </div>
        </FieldGroup>
      </Section>

      {/* ── Transition Times ── */}
      <Section title="Transition Times">
        <FieldGroup label="Global Thresholds">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Caution (min)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={agingWarning}
                onChange={e => setAgingWarning(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Late (min)</label>
              <input
                type="number"
                min={1}
                max={240}
                value={lateWarning}
                onChange={e => setLateWarning(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </FieldGroup>

        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">Per-order-type overrides (uncheck "Use Global" to customize).</p>
          {ORDER_TYPES.map(ot => (
            <div key={ot.key} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-300">{ot.label}</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useGlobalTimes[ot.key]}
                    onChange={() => setUseGlobalTimes(prev => ({ ...prev, [ot.key]: !prev[ot.key] }))}
                    className="w-3.5 h-3.5 accent-blue-500 rounded"
                  />
                  <span className="text-xs text-gray-400">Use Global</span>
                </label>
              </div>
              {!useGlobalTimes[ot.key] && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Caution (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={transitionTimes[ot.key]?.caution || ''}
                      onChange={e => setTransitionTimes(prev => ({
                        ...prev,
                        [ot.key]: { ...prev[ot.key], caution: parseInt(e.target.value) || 0 },
                      }))}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Late (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={transitionTimes[ot.key]?.late || ''}
                      onChange={e => setTransitionTimes(prev => ({
                        ...prev,
                        [ot.key]: { ...prev[ot.key], late: parseInt(e.target.value) || 0 },
                      }))}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Order Behavior ── */}
      <Section title="Order Behavior">
        <div className="space-y-3">
          <Toggle
            label="Tap to Start Timer"
            description="Timer begins when an order card is first tapped"
            checked={orderBehavior.tapToStart}
            onChange={() => toggleBehavior('tapToStart')}
          />

          <Toggle
            label="Merge Cards"
            description="Combine items from the same order into one card"
            checked={orderBehavior.mergeCards}
            onChange={() => toggleBehavior('mergeCards')}
          />

          {orderBehavior.mergeCards && (
            <FieldGroup label={`Merge Window: ${orderBehavior.mergeWindowMinutes} min`}>
              <input
                type="range"
                min={0}
                max={60}
                value={orderBehavior.mergeWindowMinutes}
                onChange={e => setBehaviorValue('mergeWindowMinutes', parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0m</span>
                <span>30m</span>
                <span>60m</span>
              </div>
            </FieldGroup>
          )}

          <Toggle
            label="New Card Per Send"
            description="Each kitchen send creates a new card instead of appending"
            checked={orderBehavior.newCardPerSend}
            onChange={() => toggleBehavior('newCardPerSend')}
          />

          <Toggle
            label="Move Completed to Bottom"
            description="Bumped orders move to the bottom of the queue"
            checked={orderBehavior.moveCompletedToBottom}
            onChange={() => toggleBehavior('moveCompletedToBottom')}
          />

          <Toggle
            label="Strike Through Modifiers"
            description="Show modifiers with strikethrough when item is bumped"
            checked={orderBehavior.strikeThroughModifiers}
            onChange={() => toggleBehavior('strikeThroughModifiers')}
          />

          <Toggle
            label="Reset Timer on Recall"
            description="Restart the order timer when an item is recalled"
            checked={orderBehavior.resetTimerOnRecall}
            onChange={() => toggleBehavior('resetTimerOnRecall')}
          />

          <Toggle
            label="Intelligent Sort"
            description="Automatically sort orders by priority and aging"
            checked={orderBehavior.intelligentSort}
            onChange={() => toggleBehavior('intelligentSort')}
          />

          <Toggle
            label="Print on Bump"
            description="Automatically print a ticket when an order is bumped"
            checked={orderBehavior.printOnBump}
            onChange={() => toggleBehavior('printOnBump')}
          />

          {orderBehavior.printOnBump && (
            <FieldGroup label="Printer ID">
              <input
                type="text"
                value={orderBehavior.printerId || ''}
                onChange={e => setBehaviorValue('printerId', e.target.value || null)}
                placeholder="Enter printer ID..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </FieldGroup>
          )}

          <Toggle
            label="Send SMS on Ready"
            description="Send a text message to the customer when the order is ready"
            checked={orderBehavior.sendSmsOnReady}
            onChange={() => toggleBehavior('sendSmsOnReady')}
          />
        </div>
      </Section>

      {/* ── Screen Communication ── */}
      <Section title="Screen Communication">
        <p className="text-xs text-gray-500 mb-3">
          Configured screen links (managed in admin settings).
        </p>
        {linksLoading ? (
          <div className="text-sm text-gray-500">Loading links...</div>
        ) : screenLinks.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No screen links configured.</div>
        ) : (
          <div className="space-y-2">
            {screenLinks.map(link => (
              <div
                key={link.id}
                className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    {link.targetScreenName || link.targetScreenId}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    link.isActive ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'
                  }`}>
                    {link.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex gap-3 mt-1.5 text-xs text-gray-400">
                  <span>Type: {LINK_TYPE_LABELS[link.linkType] || link.linkType}</span>
                  <span>Action: {BUMP_ACTION_LABELS[link.bumpAction] || link.bumpAction}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Sounds ── */}
      <Section title="Sounds">
        <Toggle
          label="Play Sound"
          description="Play an audible notification when a new order arrives"
          checked={playSound}
          onChange={() => setPlaySound(!playSound)}
        />
        <Toggle
          label="Flash on New Order"
          description="Flash the screen border when a new order arrives"
          checked={flashOnNew}
          onChange={() => setFlashOnNew(!flashOnNew)}
        />
      </Section>

      {/* ── All Day Counts ── */}
      <Section title="All Day Counts">
        <Toggle
          label="Show All Day Counts"
          description="Display a running total of each item type prepared today"
          checked={orderBehavior.showAllDayCounts}
          onChange={() => toggleBehavior('showAllDayCounts')}
        />
        {orderBehavior.showAllDayCounts && (
          <FieldGroup label="Reset Hour">
            <select
              value={orderBehavior.allDayCountResetHour}
              onChange={e => setBehaviorValue('allDayCountResetHour', parseInt(e.target.value))}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              All day counts reset at this hour each day.
            </p>
          </FieldGroup>
        )}
      </Section>

      {/* ── Order Tracker ── */}
      <Section title="Order Tracker">
        <Toggle
          label="Enable Order Tracker"
          description="Show an order progress tracker at the top of the screen"
          checked={orderBehavior.orderTrackerEnabled}
          onChange={() => toggleBehavior('orderTrackerEnabled')}
        />
      </Section>

      {/* ── Save Button ── */}
      <div className="sticky bottom-0 bg-gray-900 border-t border-gray-700 pt-4 pb-2 -mx-1 px-1">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`w-full py-3 rounded-lg font-bold text-base transition-colors ${
            hasChanges && !saving
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : hasChanges ? (
            'Save Changes'
          ) : (
            'No Changes'
          )}
        </button>
      </div>
    </div>
  )
}

// ── Shared Sub-Components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5 mb-4">
      <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      {children}
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm text-white font-mono">{value}</span>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group py-1">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={onChange}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            checked ? 'bg-blue-600' : 'bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{label}</div>
        {description && (
          <div className="text-xs text-gray-500 mt-0.5">{description}</div>
        )}
      </div>
    </label>
  )
}
