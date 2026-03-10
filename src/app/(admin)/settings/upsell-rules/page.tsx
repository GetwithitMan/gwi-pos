'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useAuthStore } from '@/stores/auth-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { DEFAULT_UPSELL_PROMPTS, type UpsellPromptSettings } from '@/lib/settings'
import { formatCurrency } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface UpsellRule {
  id: string
  name: string
  triggerType: string
  triggerItemId: string | null
  triggerCategoryId: string | null
  triggerMinTotal: number | null
  triggerTimeStart: string | null
  triggerTimeEnd: string | null
  triggerDaysOfWeek: number[] | null
  suggestItemId: string | null
  suggestCategoryId: string | null
  suggestItemName?: string | null
  suggestItemPrice?: number | null
  triggerItemName?: string | null
  triggerCategoryName?: string | null
  suggestCategoryName?: string | null
  message: string
  priority: number
  isActive: boolean
  createdAt: string
}

interface MenuItemOption {
  id: string
  name: string
  basePrice: number
  categoryId: string
  categoryName: string
}

interface CategoryOption {
  id: string
  name: string
  categoryType: string
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  item_added: 'When Item Added',
  category_match: 'When Category Ordered',
  order_total: 'Order Total Threshold',
  time_of_day: 'Time of Day',
  no_drink: 'No Drink in Order',
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Component ──────────────────────────────────────────────────────────────

export default function UpsellRulesPage() {
  const { employee } = useRequireAuth()
  const locationId = useAuthStore(s => s.locationId)

  // Settings state
  const [upsellSettings, setUpsellSettings] = useState<UpsellPromptSettings>(DEFAULT_UPSELL_PROMPTS)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(true)

  // Rules state
  const [rules, setRules] = useState<UpsellRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)

  // Menu items / categories for pickers
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])

  // Create/edit form state
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<UpsellRule | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    triggerType: 'item_added' as string,
    triggerItemId: '' as string,
    triggerCategoryId: '' as string,
    triggerMinTotal: 50 as number,
    triggerTimeStart: '16:00' as string,
    triggerTimeEnd: '18:00' as string,
    triggerDaysOfWeek: [1, 2, 3, 4, 5] as number[],
    suggestItemId: '' as string,
    suggestCategoryId: '' as string,
    message: '',
    priority: 0,
    isActive: true,
  })
  const [formSaving, setFormSaving] = useState(false)

  // ── Load settings ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const data = await loadSettingsApi(controller.signal)
        setUpsellSettings(data.settings.upsellPrompts ?? DEFAULT_UPSELL_PROMPTS)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setSettingsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  // ── Load rules ───────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    if (!locationId) return
    try {
      setRulesLoading(true)
      const res = await fetch(`/api/upsell-rules?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setRules(data.data ?? [])
      }
    } catch {
      toast.error('Failed to load upsell rules')
    } finally {
      setRulesLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  // ── Load menu items and categories ───────────────────────────────────────

  useEffect(() => {
    if (!locationId) return
    // Load menu items
    fetch(`/api/menu/items?locationId=${locationId}&activeOnly=true`)
      .then(r => r.json())
      .then(data => {
        const items = (data.data ?? data ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          name: i.name as string,
          basePrice: Number(i.basePrice ?? 0),
          categoryId: (i.categoryId ?? '') as string,
          categoryName: ((i.category as Record<string, unknown>)?.name ?? '') as string,
        }))
        setMenuItems(items)
      })
      .catch(() => {/* silent */})

    // Load categories
    fetch(`/api/menu/categories?locationId=${locationId}`)
      .then(r => r.json())
      .then(data => {
        const cats = (data.data ?? data ?? []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          name: c.name as string,
          categoryType: (c.categoryType ?? '') as string,
        }))
        setCategories(cats)
      })
      .catch(() => {/* silent */})
  }, [locationId])

  // ── Settings save ────────────────────────────────────────────────────────

  const handleSettingsSave = async () => {
    try {
      setSettingsSaving(true)
      const data = await saveSettingsApi({ upsellPrompts: upsellSettings }, employee?.id)
      setUpsellSettings(data.settings.upsellPrompts ?? DEFAULT_UPSELL_PROMPTS)
      setSettingsDirty(false)
      toast.success('Upsell settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  const updateSetting = <K extends keyof UpsellPromptSettings>(key: K, value: UpsellPromptSettings[K]) => {
    setUpsellSettings(prev => ({ ...prev, [key]: value }))
    setSettingsDirty(true)
  }

  // ── Rule CRUD ────────────────────────────────────────────────────────────

  const openCreateForm = () => {
    setEditingRule(null)
    setFormData({
      name: '',
      triggerType: 'item_added',
      triggerItemId: '',
      triggerCategoryId: '',
      triggerMinTotal: 50,
      triggerTimeStart: '16:00',
      triggerTimeEnd: '18:00',
      triggerDaysOfWeek: [1, 2, 3, 4, 5],
      suggestItemId: '',
      suggestCategoryId: '',
      message: '',
      priority: 0,
      isActive: true,
    })
    setShowForm(true)
  }

  const openEditForm = (rule: UpsellRule) => {
    setEditingRule(rule)
    setFormData({
      name: rule.name,
      triggerType: rule.triggerType,
      triggerItemId: rule.triggerItemId ?? '',
      triggerCategoryId: rule.triggerCategoryId ?? '',
      triggerMinTotal: rule.triggerMinTotal ?? 50,
      triggerTimeStart: rule.triggerTimeStart ?? '16:00',
      triggerTimeEnd: rule.triggerTimeEnd ?? '18:00',
      triggerDaysOfWeek: rule.triggerDaysOfWeek ?? [1, 2, 3, 4, 5],
      suggestItemId: rule.suggestItemId ?? '',
      suggestCategoryId: rule.suggestCategoryId ?? '',
      message: rule.message,
      priority: rule.priority,
      isActive: rule.isActive,
    })
    setShowForm(true)
  }

  const handleFormSave = async () => {
    if (!locationId) return
    if (!formData.name.trim()) {
      toast.error('Rule name is required')
      return
    }
    if (!formData.suggestItemId && !formData.suggestCategoryId) {
      toast.error('Select an item or category to suggest')
      return
    }

    try {
      setFormSaving(true)
      const payload = {
        locationId,
        name: formData.name.trim(),
        triggerType: formData.triggerType,
        triggerItemId: formData.triggerType === 'item_added' ? formData.triggerItemId || null : null,
        triggerCategoryId: formData.triggerType === 'category_match' ? formData.triggerCategoryId || null : null,
        triggerMinTotal: formData.triggerType === 'order_total' ? formData.triggerMinTotal : null,
        triggerTimeStart: formData.triggerType === 'time_of_day' ? formData.triggerTimeStart : null,
        triggerTimeEnd: formData.triggerType === 'time_of_day' ? formData.triggerTimeEnd : null,
        triggerDaysOfWeek: formData.triggerType === 'time_of_day' ? formData.triggerDaysOfWeek : null,
        suggestItemId: formData.suggestItemId || null,
        suggestCategoryId: !formData.suggestItemId ? (formData.suggestCategoryId || null) : null,
        message: formData.message,
        priority: formData.priority,
        isActive: formData.isActive,
      }

      if (editingRule) {
        const res = await fetch(`/api/upsell-rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to update')
        toast.success('Rule updated')
      } else {
        const res = await fetch('/api/upsell-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to create')
        toast.success('Rule created')
      }

      setShowForm(false)
      loadRules()
    } catch {
      toast.error('Failed to save rule')
    } finally {
      setFormSaving(false)
    }
  }

  const handleToggleActive = async (rule: UpsellRule) => {
    try {
      const res = await fetch(`/api/upsell-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      })
      if (!res.ok) throw new Error()
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, isActive: !r.isActive } : r))
    } catch {
      toast.error('Failed to toggle rule')
    }
  }

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Delete this upsell rule?')) return
    try {
      const res = await fetch(`/api/upsell-rules/${ruleId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setRules(prev => prev.filter(r => r.id !== ruleId))
      toast.success('Rule deleted')
    } catch {
      toast.error('Failed to delete rule')
    }
  }

  // ── Analytics quick-load ─────────────────────────────────────────────────

  const [analytics, setAnalytics] = useState<Record<string, { timesShown: number; timesAccepted: number; conversionRate: number; revenueGenerated: number }>>({})

  useEffect(() => {
    if (!locationId) return
    fetch(`/api/reports/upsell-analytics?locationId=${locationId}`)
      .then(r => r.json())
      .then(data => {
        const byRule: Record<string, { timesShown: number; timesAccepted: number; conversionRate: number; revenueGenerated: number }> = {}
        for (const r of data.data?.byRule ?? []) {
          byRule[r.ruleId] = r
        }
        setAnalytics(byRule)
      })
      .catch(() => {/* silent */})
  }, [locationId, rules])

  // ── Render ───────────────────────────────────────────────────────────────

  const isLoading = settingsLoading || rulesLoading

  // Sorted items for picker
  const sortedItems = useMemo(
    () => [...menuItems].sort((a, b) => a.name.localeCompare(b.name)),
    [menuItems]
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Upsell Rules"
        subtitle="Configure intelligent upsell prompts shown to servers during order entry"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <button
            onClick={openCreateForm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
          >
            + New Rule
          </button>
        }
      />

      {isLoading ? (
        <div className="text-gray-900 text-center py-12">Loading...</div>
      ) : (
        <>
          {/* ── Settings Section ───────────────────────────────────────── */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 mb-6">
            <h3 className="text-base font-bold text-white mb-4">Upsell Settings</h3>

            <ToggleRow
              label="Enable Upsell Prompts"
              description="Show upsell suggestions when items are added to orders"
              checked={upsellSettings.enabled}
              onChange={(v) => updateSetting('enabled', v)}
            />
            <NumberRow
              label="Max Prompts Per Order"
              description="Maximum number of upsell suggestions per order"
              value={upsellSettings.maxPromptsPerOrder}
              onChange={(v) => updateSetting('maxPromptsPerOrder', v)}
              min={1}
              max={10}
            />
            <ToggleRow
              label="Show on Item Add"
              description="Evaluate upsell rules each time an item is added"
              checked={upsellSettings.showOnItemAdd}
              onChange={(v) => updateSetting('showOnItemAdd', v)}
            />
            <ToggleRow
              label="Show Before Send"
              description="Show upsell suggestions before sending order to kitchen"
              checked={upsellSettings.showBeforeSend}
              onChange={(v) => updateSetting('showBeforeSend', v)}
            />
            <NumberRow
              label="Dismiss Cooldown (minutes)"
              description="How long before showing same dismissed prompt again (0 = show once per order)"
              value={upsellSettings.dismissCooldownMinutes}
              onChange={(v) => updateSetting('dismissCooldownMinutes', v)}
              min={0}
              max={1440}
            />

            <SettingsSaveBar
              isDirty={settingsDirty}
              onSave={handleSettingsSave}
              isSaving={settingsSaving}
            />
          </div>

          {/* ── Rules List ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="text-center py-12 text-gray-900">
                <p className="text-lg font-semibold mb-2">No upsell rules yet</p>
                <p className="text-sm">Create your first rule to start suggesting items to servers</p>
              </div>
            ) : (
              rules.map(rule => {
                const stats = analytics[rule.id]
                return (
                  <div
                    key={rule.id}
                    className={`bg-gray-800/50 border rounded-xl p-4 transition ${
                      rule.isActive ? 'border-gray-700' : 'border-gray-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Toggle */}
                      <button
                        onClick={() => handleToggleActive(rule)}
                        className={`w-10 h-6 rounded-full transition flex-shrink-0 ${
                          rule.isActive ? 'bg-blue-600' : 'bg-gray-600'
                        }`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-1 mt-1 ${
                          rule.isActive ? 'translate-x-4' : ''
                        }`} />
                      </button>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{rule.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-900">
                            {TRIGGER_TYPE_LABELS[rule.triggerType] ?? rule.triggerType}
                          </span>
                          <span className="text-xs text-gray-900">P{rule.priority}</span>
                        </div>
                        <div className="text-xs text-gray-900 mt-1">
                          {rule.message || 'No message set'}
                          {rule.suggestItemName && (
                            <span className="ml-2 text-blue-400">
                              Suggests: {rule.suggestItemName}
                              {rule.suggestItemPrice != null && ` (${formatCurrency(Number(rule.suggestItemPrice))})`}
                            </span>
                          )}
                          {rule.suggestCategoryName && (
                            <span className="ml-2 text-blue-400">Suggests from: {rule.suggestCategoryName}</span>
                          )}
                        </div>

                        {/* Stats */}
                        {stats && stats.timesShown > 0 && (
                          <div className="flex gap-4 mt-2 text-xs">
                            <span className="text-gray-900">Shown: {stats.timesShown}</span>
                            <span className="text-green-500">Accepted: {stats.timesAccepted}</span>
                            <span className="text-blue-400">Rate: {stats.conversionRate}%</span>
                            <span className="text-emerald-400">Revenue: {formatCurrency(stats.revenueGenerated)}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEditForm(rule)}
                          className="px-3 py-1.5 bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-600 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="px-3 py-1.5 bg-red-900/30 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-900/50 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* ── Create/Edit Form Modal ─────────────────────────────────── */}
          {showForm && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
                <h3 className="text-lg font-bold text-white mb-4">
                  {editingRule ? 'Edit Upsell Rule' : 'New Upsell Rule'}
                </h3>

                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-1">Rule Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g., Suggest fries with burger"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                    />
                  </div>

                  {/* Trigger Type */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-1">Trigger Type</label>
                    <select
                      value={formData.triggerType}
                      onChange={e => setFormData(p => ({ ...p, triggerType: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                    >
                      <option value="item_added">When Item Added</option>
                      <option value="category_match">When Category Ordered</option>
                      <option value="order_total">Order Total Threshold</option>
                      <option value="time_of_day">Time of Day</option>
                      <option value="no_drink">No Drink in Order</option>
                    </select>
                  </div>

                  {/* Trigger-specific fields */}
                  {formData.triggerType === 'item_added' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">Trigger Item</label>
                      <select
                        value={formData.triggerItemId}
                        onChange={e => setFormData(p => ({ ...p, triggerItemId: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                      >
                        <option value="">Select an item...</option>
                        {sortedItems.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.categoryName})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {formData.triggerType === 'category_match' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">Trigger Category</label>
                      <select
                        value={formData.triggerCategoryId}
                        onChange={e => setFormData(p => ({ ...p, triggerCategoryId: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                      >
                        <option value="">Select a category...</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name} ({cat.categoryType})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {formData.triggerType === 'order_total' && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">Minimum Order Total ($)</label>
                      <input
                        type="number"
                        value={formData.triggerMinTotal}
                        onChange={e => setFormData(p => ({ ...p, triggerMinTotal: Number(e.target.value) }))}
                        min={0}
                        step={5}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                      />
                    </div>
                  )}

                  {formData.triggerType === 'time_of_day' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-1">Start Time</label>
                          <input
                            type="time"
                            value={formData.triggerTimeStart}
                            onChange={e => setFormData(p => ({ ...p, triggerTimeStart: e.target.value }))}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-900 mb-1">End Time</label>
                          <input
                            type="time"
                            value={formData.triggerTimeEnd}
                            onChange={e => setFormData(p => ({ ...p, triggerTimeEnd: e.target.value }))}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">Days of Week</label>
                        <div className="flex gap-1">
                          {DAY_NAMES.map((name, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setFormData(p => ({
                                  ...p,
                                  triggerDaysOfWeek: p.triggerDaysOfWeek.includes(i)
                                    ? p.triggerDaysOfWeek.filter(d => d !== i)
                                    : [...p.triggerDaysOfWeek, i].sort(),
                                }))
                              }}
                              className={`px-2 py-1 rounded text-xs font-semibold transition ${
                                formData.triggerDaysOfWeek.includes(i)
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-700 text-gray-900'
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Suggestion Target */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-1">Suggest Item</label>
                    <select
                      value={formData.suggestItemId}
                      onChange={e => setFormData(p => ({ ...p, suggestItemId: e.target.value, suggestCategoryId: e.target.value ? '' : p.suggestCategoryId }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                    >
                      <option value="">Select a specific item...</option>
                      {sortedItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} - {formatCurrency(item.basePrice)} ({item.categoryName})
                        </option>
                      ))}
                    </select>
                  </div>

                  {!formData.suggestItemId && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">
                        Or Suggest from Category
                      </label>
                      <select
                        value={formData.suggestCategoryId}
                        onChange={e => setFormData(p => ({ ...p, suggestCategoryId: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                      >
                        <option value="">Select a category...</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name} ({cat.categoryType})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Message */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-1">Display Message</label>
                    <input
                      type="text"
                      value={formData.message}
                      onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                      placeholder='e.g., "Would you like fries with that?"'
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-1">Priority</label>
                    <input
                      type="number"
                      value={formData.priority}
                      onChange={e => setFormData(p => ({ ...p, priority: Number(e.target.value) }))}
                      min={0}
                      max={100}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                    />
                    <p className="text-xs text-gray-900 mt-1">Higher priority shows first when multiple rules match</p>
                  </div>

                  {/* Active */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setFormData(p => ({ ...p, isActive: !p.isActive }))}
                      className={`w-10 h-6 rounded-full transition ${
                        formData.isActive ? 'bg-blue-600' : 'bg-gray-600'
                      }`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-1 mt-1 ${
                        formData.isActive ? 'translate-x-4' : ''
                      }`} />
                    </button>
                    <span className="text-sm text-gray-900">Active</span>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-700">
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-600 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleFormSave}
                    disabled={formSaving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {formSaving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
