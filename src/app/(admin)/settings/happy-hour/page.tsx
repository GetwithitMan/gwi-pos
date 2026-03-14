'use client'

// Last write wins — concurrent edits from multiple admins are not merged

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatCurrency } from '@/lib/pricing'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import {
  type PricingRule,
  type LocationSettings,
  DEFAULT_SETTINGS,
  validatePricingRule,
  checkPricingRuleOverlaps,
  isPricingRuleActive,
  getAdjustedPrice,
} from '@/lib/settings'

// ─── Constants ─────────────────────────────────────────────────────────────────

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_INDEX = [1, 2, 3, 4, 5, 6, 0] // Mon=1 ... Sun=0 for schedule dayOfWeek

const COLOR_PRESETS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#f97316',
] as const

const ADJUSTMENT_BUTTONS: { type: PricingRule['adjustmentType']; label: string }[] = [
  { type: 'percent-off', label: '% Off' },
  { type: 'fixed-off', label: '$ Off' },
  { type: 'percent-increase', label: '% Up' },
  { type: 'fixed-increase', label: '$ Up' },
  { type: 'override-price', label: 'Set Price' },
]

type Category = { id: string; name: string; categoryType: string; _count?: { menuItems: number } }
type MenuItem = { id: string; name: string; price: number; categoryId: string; category?: { name: string } }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime24to12(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatAdjustment(rule: PricingRule): string {
  const v = rule.adjustmentValue
  switch (rule.adjustmentType) {
    case 'percent-off': return `${v}% off`
    case 'percent-increase': return `${v}% increase`
    case 'fixed-off': return `${formatCurrency(v)} off`
    case 'fixed-increase': return `${formatCurrency(v)} increase`
    case 'override-price': return `Set to ${formatCurrency(v)}`
    default: return ''
  }
}

function scheduleSummary(rule: PricingRule): string {
  if (rule.type === 'recurring') {
    if (rule.schedules.length === 0) return 'No schedule'
    const s = rule.schedules[0]
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days = s.dayOfWeek.length === 7 ? 'Every day' :
      s.dayOfWeek.length === 5 && [1,2,3,4,5].every(d => s.dayOfWeek.includes(d)) ? 'Mon-Fri' :
      s.dayOfWeek.map(d => dayNames[d]).join(', ')
    const suffix = rule.schedules.length > 1 ? ` +${rule.schedules.length - 1} more` : ''
    return `${days} ${formatTime24to12(s.startTime)} - ${formatTime24to12(s.endTime)}${suffix}`
  }
  if (rule.type === 'one-time') {
    return `${rule.startDate || '?'} to ${rule.endDate || '?'} ${formatTime24to12(rule.startTime || '')} - ${formatTime24to12(rule.endTime || '')}`
  }
  if (rule.type === 'yearly-recurring') {
    return `Every year ${rule.startDate || '?'} to ${rule.endDate || '?'} ${formatTime24to12(rule.startTime || '')} - ${formatTime24to12(rule.endTime || '')}`
  }
  return ''
}

function scopeSummary(rule: PricingRule): string {
  if (rule.appliesTo === 'all') return 'All items'
  if (rule.appliesTo === 'categories') return `${rule.categoryIds.length} categor${rule.categoryIds.length === 1 ? 'y' : 'ies'}`
  if (rule.appliesTo === 'items') return `${rule.itemIds.length} item${rule.itemIds.length === 1 ? '' : 's'}`
  return ''
}

function newRule(): PricingRule {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    color: '#10b981',
    type: 'recurring',
    schedules: [{ dayOfWeek: [1,2,3,4,5], startTime: '16:00', endTime: '18:00' }],
    adjustmentType: 'percent-off',
    adjustmentValue: 20,
    appliesTo: 'all',
    categoryIds: [],
    itemIds: [],
    priority: 10,
    showBadge: true,
    showOriginalPrice: true,
    autoDelete: false,
    createdAt: new Date().toISOString(),
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PricingRulesPage() {
  const employeeId = useAuthStore(s => s.employee?.id)

  const [rules, setRules] = useState<PricingRule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null)
  const [draft, setDraft] = useState<PricingRule>(newRule())

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PricingRule | null>(null)

  // ─── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.ok ? r.json() : null),
      fetch('/api/menu/categories').then(r => r.ok ? r.json() : null),
      fetch('/api/menu/items?activeOnly=true').then(r => r.ok ? r.json() : null),
    ]).then(([settingsData, catData, itemData]) => {
      const settings: LocationSettings = settingsData?.data?.settings ?? DEFAULT_SETTINGS
      const loaded = Array.isArray(settings.pricingRules) ? settings.pricingRules : []
      setCategories(catData?.data?.categories ?? catData?.data ?? [])
      setMenuItems(itemData?.data?.items ?? itemData?.data ?? [])

      // autoDelete cleanup: remove expired one-time rules with autoDelete
      const now = new Date()
      const kept: PricingRule[] = []
      let removed = 0
      for (const r of loaded) {
        if (r.type === 'one-time' && r.autoDelete && r.endDate) {
          const endDateObj = new Date(r.endDate + 'T23:59:59')
          if (endDateObj < now) { removed++; continue }
        }
        kept.push(r)
      }
      setRules(kept)
      if (removed > 0) {
        setDirty(true)
        toast.info(`${removed} expired event${removed > 1 ? 's' : ''} removed (you can undo by reloading without saving)`)
      }
    }).catch(err => {
      console.error('Failed to load data:', err)
      toast.error('Failed to load settings')
    }).finally(() => setIsLoading(false))
  }, [])

  // ─── Unsaved changes guard ────────────────────────────────────────────────

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // ─── Save ─────────────────────────────────────────────────────────────────

  const save = async () => {
    setIsSaving(true)
    try {
      // Ghost ID cleanup: strip IDs not in fetched data
      const catIdSet = new Set(categories.map(c => c.id))
      const itemIdSet = new Set(menuItems.map(i => i.id))
      const cleaned = rules.map(r => ({
        ...r,
        categoryIds: r.categoryIds.filter(id => catIdSet.has(id)),
        itemIds: r.itemIds.filter(id => itemIdSet.has(id)),
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { pricingRules: cleaned }, employeeId }),
      })
      if (response.ok) {
        setRules(cleaned)
        setDirty(false)
        toast.success('Pricing rules saved')
      } else {
        toast.error('Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Rule actions ─────────────────────────────────────────────────────────

  const toggleEnabled = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
    setDirty(true)
  }

  const deleteRule = (rule: PricingRule) => {
    setRules(prev => prev.filter(r => r.id !== rule.id))
    setDirty(true)
    setDeleteTarget(null)
  }

  const duplicateRule = (rule: PricingRule) => {
    const dup: PricingRule = {
      ...rule,
      id: crypto.randomUUID(),
      name: `Copy of ${rule.name}`,
      createdAt: new Date().toISOString(),
    }
    setRules(prev => [...prev, dup])
    setDirty(true)
  }

  const openCreate = () => {
    setEditingRule(null)
    setDraft(newRule())
    setShowModal(true)
  }

  const openEdit = (rule: PricingRule) => {
    setEditingRule(rule)
    setDraft({ ...rule })
    setShowModal(true)
  }

  const saveDraft = () => {
    if (editingRule) {
      setRules(prev => prev.map(r => r.id === editingRule.id ? { ...draft } : r))
    } else {
      setRules(prev => [...prev, { ...draft }])
    }
    setDirty(true)
    setShowModal(false)
  }

  // ─── Grouped rules ───────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const activeNow: PricingRule[] = []
    const recurring: PricingRule[] = []
    const events: PricingRule[] = []
    const disabled: PricingRule[] = []

    for (const r of rules) {
      if (!r.enabled) { disabled.push(r); continue }
      if (isPricingRuleActive(r)) { activeNow.push(r); continue }
      if (r.type === 'recurring') { recurring.push(r); continue }
      events.push(r)
    }

    events.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
    return { activeNow, recurring, events, disabled }
  }, [rules])

  // ─── Validation for draft ─────────────────────────────────────────────────

  const draftErrors = useMemo(() => validatePricingRule(draft), [draft])

  const overlaps = useMemo(() => {
    const allRules = editingRule
      ? rules.map(r => r.id === editingRule.id ? draft : r)
      : [...rules, draft]
    return checkPricingRuleOverlaps(allRules).filter(
      o => o.ruleA.id === draft.id || o.ruleB.id === draft.id
    )
  }, [draft, rules, editingRule])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricing Rules</h1>
          <p className="text-sm text-gray-500 mt-1">Manage time-based pricing: happy hours, events, and seasonal promotions.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openCreate}>+ New Rule</Button>
          <Button size="sm" onClick={save} disabled={!dirty || isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Weekly Timeline */}
      {rules.some(r => r.enabled && r.type === 'recurring') && (
        <WeeklyTimeline rules={rules.filter(r => r.enabled && r.type === 'recurring')} />
      )}

      {/* Event badges */}
      {rules.some(r => r.enabled && (r.type === 'one-time' || r.type === 'yearly-recurring')) && (
        <Card className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Upcoming Events</h3>
          <div className="flex flex-wrap gap-2">
            {rules.filter(r => r.enabled && (r.type === 'one-time' || r.type === 'yearly-recurring')).map(r => (
              <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                {r.name} — {r.type === 'one-time' ? r.startDate : r.startDate}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Rules List */}
      {rules.length === 0 && (
        <Card className="p-8 text-center text-gray-400">
          No pricing rules yet. Click &quot;+ New Rule&quot; to create one.
        </Card>
      )}

      <RuleGroup title="Active Now" rules={grouped.activeNow} borderColor="border-l-emerald-500"
        dot={<span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
        onToggle={toggleEnabled} onEdit={openEdit} onDuplicate={duplicateRule} onDelete={setDeleteTarget}
      />
      <RuleGroup title="Recurring" rules={grouped.recurring}
        onToggle={toggleEnabled} onEdit={openEdit} onDuplicate={duplicateRule} onDelete={setDeleteTarget}
      />
      <RuleGroup title="Events" rules={grouped.events}
        onToggle={toggleEnabled} onEdit={openEdit} onDuplicate={duplicateRule} onDelete={setDeleteTarget}
      />
      <RuleGroup title="Disabled" rules={grouped.disabled} faded
        onToggle={toggleEnabled} onEdit={openEdit} onDuplicate={duplicateRule} onDelete={setDeleteTarget}
      />

      {/* Edit/Create Modal */}
      {showModal && (
        <RuleModal
          draft={draft}
          setDraft={setDraft}
          editingRule={editingRule}
          errors={draftErrors}
          overlaps={overlaps}
          categories={categories}
          menuItems={menuItems}
          onSave={saveDraft}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Rule"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (deleteTarget) deleteRule(deleteTarget) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ─── Weekly Timeline ─────────────────────────────────────────────────────────

function WeeklyTimeline({ rules }: { rules: PricingRule[] }) {
  return (
    <Card className="p-4 overflow-x-auto">
      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Weekly Schedule</h3>
      <div className="grid grid-cols-[120px_repeat(7,1fr)] gap-1 min-w-[600px]">
        {/* Header */}
        <div />
        {DAYS_SHORT.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>
        ))}
        {/* Rows per rule */}
        {rules.map(rule => (
          <TimelineRow key={rule.id} rule={rule} />
        ))}
      </div>
    </Card>
  )
}

function TimelineRow({ rule }: { rule: PricingRule }) {
  return (
    <>
      <div className="text-xs font-medium truncate flex items-center gap-1.5 pr-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: rule.color }} />
        {rule.name}
      </div>
      {DAYS_INDEX.map(dayIdx => {
        const windows = rule.schedules.filter(s => s.dayOfWeek.includes(dayIdx))
        return (
          <div key={dayIdx} className="h-6 rounded bg-gray-50 relative group">
            {windows.map((w, i) => {
              const start = parseTimePercent(w.startTime)
              const end = parseTimePercent(w.endTime)
              const width = end > start ? end - start : (100 - start) + end
              return (
                <div
                  key={i}
                  className="absolute top-0.5 bottom-0.5 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity"
                  style={{
                    backgroundColor: rule.color,
                    left: `${start}%`,
                    width: `${Math.min(width, 100 - start)}%`,
                  }}
                  title={`${rule.name}: ${formatTime24to12(w.startTime)} - ${formatTime24to12(w.endTime)} — ${formatAdjustment(rule)}`}
                />
              )
            })}
          </div>
        )
      })}
    </>
  )
}

function parseTimePercent(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return ((h * 60 + m) / 1440) * 100
}

// ─── Rule Group ──────────────────────────────────────────────────────────────

function RuleGroup({
  title, rules, borderColor, dot, faded,
  onToggle, onEdit, onDuplicate, onDelete,
}: {
  title: string
  rules: PricingRule[]
  borderColor?: string
  dot?: React.ReactNode
  faded?: boolean
  onToggle: (id: string) => void
  onEdit: (r: PricingRule) => void
  onDuplicate: (r: PricingRule) => void
  onDelete: (r: PricingRule) => void
}) {
  if (rules.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-2">
        {dot}{title} ({rules.length})
      </h3>
      {rules.map(rule => (
        <RuleCard
          key={rule.id}
          rule={rule}
          borderColor={borderColor}
          faded={faded}
          onToggle={onToggle}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

function RuleCard({
  rule, borderColor, faded,
  onToggle, onEdit, onDuplicate, onDelete,
}: {
  rule: PricingRule
  borderColor?: string
  faded?: boolean
  onToggle: (id: string) => void
  onEdit: (r: PricingRule) => void
  onDuplicate: (r: PricingRule) => void
  onDelete: (r: PricingRule) => void
}) {
  const typeBadge = rule.type === 'recurring' ? 'Weekly' : rule.type === 'one-time' ? 'One-Time' : 'Yearly'
  return (
    <Card className={`p-4 border-l-4 ${borderColor || 'border-l-gray-200'} ${faded ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: rule.color }} />
            <span className="font-semibold text-sm">{rule.name}</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{typeBadge}</span>
          </div>
          <p className="text-xs text-gray-500">{scheduleSummary(rule)}</p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{formatAdjustment(rule)}</span>
            <span>{scopeSummary(rule)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={rule.enabled} onChange={() => onToggle(rule.id)} className="sr-only peer" />
            <div className="w-8 h-4 bg-gray-300 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
          </label>
          <button onClick={() => onEdit(rule)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-xs" title="Edit">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={() => onDuplicate(rule)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-xs" title="Duplicate">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          <button onClick={() => onDelete(rule)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 text-xs" title="Delete">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
    </Card>
  )
}

// ─── Create/Edit Modal ───────────────────────────────────────────────────────

function RuleModal({
  draft, setDraft, editingRule, errors, overlaps, categories, menuItems, onSave, onClose,
}: {
  draft: PricingRule
  setDraft: React.Dispatch<React.SetStateAction<PricingRule>>
  editingRule: PricingRule | null
  errors: string[]
  overlaps: ReturnType<typeof checkPricingRuleOverlaps>
  categories: Category[]
  menuItems: MenuItem[]
  onSave: () => void
  onClose: () => void
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [itemSearch, setItemSearch] = useState('')

  const update = useCallback(<K extends keyof PricingRule>(key: K, value: PricingRule[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }, [setDraft])

  const setType = (type: PricingRule['type']) => {
    const priority = type === 'recurring' ? 10 : type === 'yearly-recurring' ? 50 : 100
    setDraft(prev => ({
      ...prev,
      type,
      priority,
      schedules: type === 'recurring' ? (prev.schedules.length > 0 ? prev.schedules : [{ dayOfWeek: [1,2,3,4,5], startTime: '16:00', endTime: '18:00' }]) : [],
      startDate: undefined,
      endDate: undefined,
      startTime: type !== 'recurring' ? (prev.startTime || '16:00') : undefined,
      endTime: type !== 'recurring' ? (prev.endTime || '18:00') : undefined,
    }))
  }

  // Sample items for live price preview
  const sampleItems = useMemo(() => Array.isArray(menuItems) ? menuItems.slice(0, 5) : [], [menuItems])

  // Ghost ID detection
  const catIdSet = useMemo(() => new Set((Array.isArray(categories) ? categories : []).map(c => c.id)), [categories])
  const itemIdSet = useMemo(() => new Set((Array.isArray(menuItems) ? menuItems : []).map(i => i.id)), [menuItems])

  // Filtered items for scope picker
  const filteredItems = useMemo(() => {
    const items = Array.isArray(menuItems) ? menuItems : []
    if (!itemSearch) return items
    const q = itemSearch.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q) || i.category?.name?.toLowerCase().includes(q))
  }, [menuItems, itemSearch])

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>()
    for (const item of filteredItems) {
      const key = item.category?.name || 'Uncategorized'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  }, [filteredItems])

  return (
    <Modal isOpen onClose={onClose} title={editingRule ? 'Edit Pricing Rule' : 'New Pricing Rule'} size="lg">
      <div className="space-y-6">
        {/* Name + Description + Color */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
            <input
              type="text"
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              maxLength={50}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50"
              placeholder="e.g. Happy Hour, Taco Tuesday"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={draft.description || ''}
              onChange={e => update('description', e.target.value)}
              maxLength={200}
              rows={2}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 resize-none"
              placeholder="Internal notes (not shown to customers)"
            />
            <span className="text-[10px] text-gray-400">{(draft.description || '').length}/200</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
            <div className="flex gap-2">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('color', c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${draft.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <div className="flex gap-1">
            {([['recurring', 'Weekly'], ['one-time', 'One-Time'], ['yearly-recurring', 'Yearly']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setType(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${draft.type === val ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-500">Schedule</label>
          {draft.type === 'recurring' && (
            <>
              {draft.schedules.map((sched, idx) => (
                <div key={idx} className="p-3 border rounded-lg bg-gray-50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-500">Window {idx + 1}</span>
                    {draft.schedules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDraft(prev => ({ ...prev, schedules: prev.schedules.filter((_, i) => i !== idx) }))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >Remove</button>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {DAYS_SHORT.map((d, di) => {
                      const dayVal = DAYS_INDEX[di]
                      const active = sched.dayOfWeek.includes(dayVal)
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            const newDays = active ? sched.dayOfWeek.filter(x => x !== dayVal) : [...sched.dayOfWeek, dayVal].sort()
                            setDraft(prev => ({
                              ...prev,
                              schedules: prev.schedules.map((s, i) => i === idx ? { ...s, dayOfWeek: newDays } : s),
                            }))
                          }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${active ? 'bg-gray-800 text-white' : 'bg-white border text-gray-500 hover:bg-gray-100'}`}
                        >{d}</button>
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Start</label>
                      <input
                        type="time"
                        value={sched.startTime}
                        onChange={e => setDraft(prev => ({
                          ...prev,
                          schedules: prev.schedules.map((s, i) => i === idx ? { ...s, startTime: e.target.value } : s),
                        }))}
                        className="w-full px-2 py-1.5 border rounded text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">End</label>
                      <input
                        type="time"
                        value={sched.endTime}
                        onChange={e => setDraft(prev => ({
                          ...prev,
                          schedules: prev.schedules.map((s, i) => i === idx ? { ...s, endTime: e.target.value } : s),
                        }))}
                        className="w-full px-2 py-1.5 border rounded text-sm bg-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDraft(prev => ({
                  ...prev,
                  schedules: [...prev.schedules, { dayOfWeek: [1,2,3,4,5], startTime: '16:00', endTime: '18:00' }],
                }))}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >+ Add Time Window</button>
            </>
          )}

          {draft.type === 'one-time' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Start Date</label>
                <input type="date" value={draft.startDate || ''} onChange={e => update('startDate', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">End Date</label>
                <input type="date" value={draft.endDate || ''} onChange={e => update('endDate', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Start Time</label>
                <input type="time" value={draft.startTime || ''} onChange={e => update('startTime', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">End Time</label>
                <input type="time" value={draft.endTime || ''} onChange={e => update('endTime', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
            </div>
          )}

          {draft.type === 'yearly-recurring' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Start (MM-DD)</label>
                <input type="text" placeholder="MM-DD" value={draft.startDate || ''} onChange={e => update('startDate', e.target.value)}
                  maxLength={5} className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">End (MM-DD)</label>
                <input type="text" placeholder="MM-DD" value={draft.endDate || ''} onChange={e => update('endDate', e.target.value)}
                  maxLength={5} className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Start Time</label>
                <input type="time" value={draft.startTime || ''} onChange={e => update('startTime', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">End Time</label>
                <input type="time" value={draft.endTime || ''} onChange={e => update('endTime', e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-gray-50" />
              </div>
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-500">Pricing</label>
          <div className="flex gap-1 flex-wrap">
            {ADJUSTMENT_BUTTONS.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => update('adjustmentType', type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${draft.adjustmentType === type ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{label}</button>
            ))}
          </div>
          <div className="relative max-w-[200px]">
            {(draft.adjustmentType === 'fixed-off' || draft.adjustmentType === 'fixed-increase' || draft.adjustmentType === 'override-price') && (
              <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
            )}
            <input
              type="number"
              min="0"
              step={draft.adjustmentType.startsWith('percent') ? '1' : '0.01'}
              value={draft.adjustmentValue}
              onChange={e => update('adjustmentValue', parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 ${
                (draft.adjustmentType === 'fixed-off' || draft.adjustmentType === 'fixed-increase' || draft.adjustmentType === 'override-price') ? 'pl-7' : ''
              }`}
            />
            {draft.adjustmentType.startsWith('percent') && (
              <span className="absolute right-3 top-2 text-gray-400 text-sm">%</span>
            )}
          </div>
          {/* Free item hint */}
          {draft.adjustmentType === 'override-price' && draft.adjustmentValue === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              This makes the item free (tax still applies on $0 unless configured otherwise).
            </p>
          )}
          {/* Live preview */}
          {sampleItems.length > 0 && (
            <div className="p-3 bg-blue-50 rounded-lg space-y-1">
              <span className="text-[10px] font-medium text-blue-600 uppercase">Preview</span>
              {sampleItems.map(item => {
                const adjusted = getAdjustedPrice(item.price, draft)
                return (
                  <div key={item.id} className="flex justify-between text-xs text-blue-800">
                    <span className="truncate mr-2">{item.name}</span>
                    <span>
                      {adjusted !== item.price && <span className="line-through text-blue-400 mr-1">{formatCurrency(item.price)}</span>}
                      <span className="font-semibold">{formatCurrency(adjusted)}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Applies To */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-500">Applies To</label>
          <div className="flex gap-2">
            {(['all', 'categories', 'items'] as const).map(scope => (
              <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  checked={draft.appliesTo === scope}
                  onChange={() => update('appliesTo', scope)}
                  className="accent-gray-800"
                />
                <span className="text-sm capitalize">{scope === 'all' ? 'All Items' : scope}</span>
              </label>
            ))}
          </div>

          {draft.appliesTo === 'categories' && (
            <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1 bg-gray-50">
              {categories.map(cat => {
                const checked = draft.categoryIds.includes(cat.id)
                return (
                  <label key={cat.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update('categoryIds', checked
                        ? draft.categoryIds.filter(id => id !== cat.id)
                        : [...draft.categoryIds, cat.id]
                      )}
                      className="accent-gray-800"
                    />
                    <span className="text-sm flex-1">{cat.name}</span>
                    {cat._count?.menuItems != null && (
                      <span className="text-[10px] text-gray-400">{cat._count.menuItems} items</span>
                    )}
                  </label>
                )
              })}
              {/* Ghost IDs */}
              {draft.categoryIds.filter(id => !catIdSet.has(id)).map(id => (
                <div key={id} className="flex items-center gap-2 px-2 py-1 text-xs text-red-400">
                  <input type="checkbox" checked onChange={() => update('categoryIds', draft.categoryIds.filter(x => x !== id))} className="accent-red-400" />
                  {id.slice(0, 8)}... <span className="text-red-500 font-medium">(deleted)</span>
                </div>
              ))}
            </div>
          )}

          {draft.appliesTo === 'items' && (
            <>
              <input
                type="text"
                placeholder="Search items..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                className="w-full px-3 py-1.5 border rounded-lg text-sm bg-gray-50"
              />
              <div className="max-h-56 overflow-y-auto border rounded-lg p-2 space-y-2 bg-gray-50">
                {Array.from(itemsByCategory.entries()).map(([catName, items]) => (
                  <div key={catName}>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase px-2 mb-1">{catName}</div>
                    {items.map(item => {
                      const checked = draft.itemIds.includes(item.id)
                      return (
                        <label key={item.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => update('itemIds', checked
                              ? draft.itemIds.filter(id => id !== item.id)
                              : [...draft.itemIds, item.id]
                            )}
                            className="accent-gray-800"
                          />
                          <span className="text-sm flex-1">{item.name}</span>
                          <span className="text-[10px] text-gray-400">{formatCurrency(item.price)}</span>
                        </label>
                      )
                    })}
                  </div>
                ))}
                {/* Ghost IDs */}
                {draft.itemIds.filter(id => !itemIdSet.has(id)).map(id => (
                  <div key={id} className="flex items-center gap-2 px-2 py-1 text-xs text-red-400">
                    <input type="checkbox" checked onChange={() => update('itemIds', draft.itemIds.filter(x => x !== id))} className="accent-red-400" />
                    {id.slice(0, 8)}... <span className="text-red-500 font-medium">(deleted)</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Display */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">Display</label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={draft.showBadge} onChange={e => update('showBadge', e.target.checked)} className="accent-gray-800" />
            <span className="text-sm">Show badge on items</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={draft.showOriginalPrice} onChange={e => update('showOriginalPrice', e.target.checked)} className="accent-gray-800" />
            <span className="text-sm">Show original price crossed out</span>
          </label>
          {draft.showBadge && (
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Badge Text (max 20 chars)</label>
              <input
                type="text"
                value={draft.badgeText || ''}
                onChange={e => update('badgeText', e.target.value)}
                maxLength={20}
                placeholder={draft.name || 'Rule name'}
                className="w-full max-w-[200px] px-2 py-1.5 border rounded text-sm bg-gray-50"
              />
            </div>
          )}
        </div>

        {/* Lifecycle (one-time only) */}
        {draft.type === 'one-time' && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={draft.autoDelete} onChange={e => update('autoDelete', e.target.checked)} className="accent-gray-800" />
              <span className="text-sm">Auto-delete after event ends</span>
            </label>
          </div>
        )}

        {/* Overlap Warnings */}
        {overlaps.length > 0 && (
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500">Overlap Warnings</label>
            {overlaps.map((o, i) => (
              <div key={i} className={`text-xs px-3 py-2 rounded-lg ${
                o.severity === 'error' ? 'bg-red-50 text-red-700' :
                o.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase mr-1.5 ${
                  o.severity === 'error' ? 'bg-red-200 text-red-800' :
                  o.severity === 'warning' ? 'bg-amber-200 text-amber-800' :
                  'bg-blue-200 text-blue-800'
                }`}>{o.severity}</span>
                {o.description}
              </div>
            ))}
          </div>
        )}

        {/* Validation Errors */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-red-600">{err}</p>
            ))}
          </div>
        )}

        {/* Advanced */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium"
          >
            {showAdvanced ? '- Hide' : '+ Show'} Advanced
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <label className="block text-[10px] text-gray-400 mb-0.5">Priority (higher = wins over lower)</label>
              <input
                type="number"
                value={draft.priority}
                onChange={e => update('priority', parseInt(e.target.value) || 0)}
                className="w-24 px-2 py-1.5 border rounded text-sm bg-gray-50"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={errors.length > 0}>
            {editingRule ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

