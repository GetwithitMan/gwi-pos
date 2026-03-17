'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, NumberRow, SettingsSaveBar } from '@/components/admin/settings'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { toast } from '@/stores/toast-store'
import {
  type ReservationSettings,
  type DepositRules,
  type ReservationMessageTemplates,
  type MessageTemplate,
  DEFAULT_RESERVATION_SETTINGS,
  DEFAULT_DEPOSIT_RULES,
  DEFAULT_RESERVATION_TEMPLATES,
  TEMPLATE_PACKS,
  AVAILABLE_PLACEHOLDERS,
  getEffectiveDepositMode,
} from '@/lib/settings'

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab = 'general' | 'policies' | 'deposits' | 'notifications' | 'hours' | 'widget'

const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'policies', label: 'Policies' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'hours', label: 'Hours & Blocks' },
  { key: 'widget', label: 'Widget' },
]

type TemplateKey = keyof ReservationMessageTemplates
const TEMPLATE_NAMES: { key: TemplateKey; label: string }[] = [
  { key: 'confirmation', label: 'Confirmation' },
  { key: 'reminder24h', label: '24-Hour Reminder' },
  { key: 'reminder2h', label: '2-Hour Reminder' },
  { key: 'depositRequest', label: 'Deposit Request' },
  { key: 'depositReceived', label: 'Deposit Received' },
  { key: 'cancellation', label: 'Cancellation' },
  { key: 'modification', label: 'Modification' },
  { key: 'noShow', label: 'No-Show' },
  { key: 'waitlistPromoted', label: 'Waitlist Promoted' },
  { key: 'thankYou', label: 'Thank You' },
]

interface ReservationBlockRow {
  id?: string
  name: string
  reason: string
  blockDate: string
  startTime: string
  endTime: string
  isAllDay: boolean
  reducedCapacityPercent: number | null
  blockedTableIds: string[]
  blockedSectionIds: string[]
}

const EMPTY_BLOCK: ReservationBlockRow = {
  name: '',
  reason: '',
  blockDate: '',
  startTime: '',
  endTime: '',
  isAllDay: false,
  reducedCapacityPercent: null,
  blockedTableIds: [],
  blockedSectionIds: [],
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReservationSettingsPage() {
  const { employee } = useRequireAuth()

  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Settings state
  const [general, setGeneral] = useState<ReservationSettings>(DEFAULT_RESERVATION_SETTINGS)
  const [deposit, setDeposit] = useState<DepositRules>(DEFAULT_DEPOSIT_RULES)
  const [templates, setTemplates] = useState<ReservationMessageTemplates>(DEFAULT_RESERVATION_TEMPLATES)

  // Blocks state
  const [blocks, setBlocks] = useState<ReservationBlockRow[]>([])
  const [editingBlock, setEditingBlock] = useState<ReservationBlockRow | null>(null)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [deleteBlockId, setDeleteBlockId] = useState<string | null>(null)

  // Notifications state
  const [expandedTemplate, setExpandedTemplate] = useState<TemplateKey | null>(null)
  const [placeholdersOpen, setPlaceholdersOpen] = useState(false)

  useUnsavedWarning(isDirty)

  // ─── Load ───────────────────────────────────────────────────────────

  const loadAll = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const [settingsData, blocksRes] = await Promise.all([
          loadSettingsApi(controller.signal),
          fetch('/api/reservations/blocks', { signal: controller.signal }),
        ])

        const s = settingsData.settings
        setGeneral({ ...DEFAULT_RESERVATION_SETTINGS, ...(s.reservationSettings || {}) })
        setDeposit({ ...DEFAULT_DEPOSIT_RULES, ...(s.depositRules || {}), paymentMethods: s.depositRules?.paymentMethods ?? DEFAULT_DEPOSIT_RULES.paymentMethods })
        setTemplates({ ...DEFAULT_RESERVATION_TEMPLATES, ...(s.reservationTemplates || {}) })

        if (blocksRes.ok) {
          const blocksData = await blocksRes.json()
          setBlocks((blocksData.data || blocksData || []).map((b: any) => ({
            id: b.id,
            name: b.name || '',
            reason: b.reason || '',
            blockDate: b.blockDate ? b.blockDate.split('T')[0] : '',
            startTime: b.startTime || '',
            endTime: b.endTime || '',
            isAllDay: b.isAllDay ?? false,
            reducedCapacityPercent: b.reducedCapacityPercent ?? null,
            blockedTableIds: b.blockedTableIds || [],
            blockedSectionIds: b.blockedSectionIds || [],
          })))
        }
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load reservation settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadAll()
    return cleanup
  }, [loadAll])

  // ─── Save Settings ──────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({
        reservationSettings: general,
        depositRules: deposit,
        reservationTemplates: templates,
      }, employee?.id)

      const s = data.settings
      setGeneral({ ...DEFAULT_RESERVATION_SETTINGS, ...(s.reservationSettings || {}) })
      setDeposit({ ...DEFAULT_DEPOSIT_RULES, ...(s.depositRules || {}), paymentMethods: s.depositRules?.paymentMethods ?? DEFAULT_DEPOSIT_RULES.paymentMethods })
      setTemplates({ ...DEFAULT_RESERVATION_TEMPLATES, ...(s.reservationTemplates || {}) })
      setIsDirty(false)
      toast.success('Reservation settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  function updateGeneral<K extends keyof ReservationSettings>(key: K, value: ReservationSettings[K]) {
    setGeneral(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateDeposit<K extends keyof DepositRules>(key: K, value: DepositRules[K]) {
    setDeposit(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateTemplate(templateKey: TemplateKey, field: keyof MessageTemplate, value: string) {
    setTemplates(prev => ({
      ...prev,
      [templateKey]: { ...prev[templateKey], [field]: value },
    }))
    setIsDirty(true)
  }

  function applyTemplatePack(pack: 'professional' | 'casual') {
    setTemplates(TEMPLATE_PACKS[pack])
    setIsDirty(true)
    toast.success(`Applied ${pack} template pack`)
  }

  // ─── Block CRUD ─────────────────────────────────────────────────────

  async function saveBlock() {
    if (!editingBlock) return
    const isEdit = !!editingBlock.id
    const url = isEdit ? `/api/reservations/blocks/${editingBlock.id}` : '/api/reservations/blocks'
    const method = isEdit ? 'PUT' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingBlock),
      })
      if (!res.ok) throw new Error('Failed to save block')
      setBlockModalOpen(false)
      setEditingBlock(null)
      toast.success(isEdit ? 'Block updated' : 'Block created')
      loadAll()
    } catch {
      toast.error('Failed to save block')
    }
  }

  async function deleteBlock() {
    if (!deleteBlockId) return
    try {
      const res = await fetch(`/api/reservations/blocks/${deleteBlockId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete block')
      setDeleteBlockId(null)
      toast.success('Block deleted')
      loadAll()
    } catch {
      toast.error('Failed to delete block')
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6">
        <AdminPageHeader title="Reservation Settings" breadcrumbs={[{ label: 'Settings', href: '/settings' }]} />
        <div className="flex items-center justify-center py-20 text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <AdminPageHeader
        title="Reservation Settings"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── General Tab ───────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-1">
          <SectionCard title="Booking Defaults">
            <NumberRow label="Default Turn Time" description="Minutes per reservation (default seating duration)" value={general.defaultTurnTimeMinutes} onChange={v => updateGeneral('defaultTurnTimeMinutes', v)} suffix="min" min={15} max={480} step={15} />
            <NumberRow label="Slot Interval" description="Time between available booking slots" value={general.slotIntervalMinutes} onChange={v => updateGeneral('slotIntervalMinutes', v)} suffix="min" min={5} max={60} step={5} />
            <NumberRow label="Max Party Size" description="Largest party that can book online" value={general.maxPartySize} onChange={v => updateGeneral('maxPartySize', v)} min={1} max={100} />
            <NumberRow label="Future Booking Window" description="How far in advance guests can reserve" value={general.maxFutureBookingDays} onChange={v => updateGeneral('maxFutureBookingDays', v)} suffix="days" min={1} max={365} />
          </SectionCard>

          <SectionCard title="No-Show Policy">
            <NumberRow label="Grace Period" description="Minutes past reservation time before marking no-show" value={general.noShowGraceMinutes} onChange={v => updateGeneral('noShowGraceMinutes', v)} suffix="min" min={0} max={60} />
            <NumberRow label="Blacklist After" description="Auto-blacklist after this many no-shows (0 = never)" value={general.noShowBlacklistAfterCount} onChange={v => updateGeneral('noShowBlacklistAfterCount', v)} suffix="no-shows" min={0} max={20} />
          </SectionCard>

          <SectionCard title="Automation">
            <ToggleRow label="Auto-Confirm (No Deposit)" description="Automatically confirm reservations that don't require a deposit" checked={general.autoConfirmNoDeposit} onChange={v => updateGeneral('autoConfirmNoDeposit', v)} />
          </SectionCard>
        </div>
      )}

      {/* ── Policies Tab ──────────────────────────────────────────── */}
      {activeTab === 'policies' && (
        <div className="space-y-1">
          <SectionCard title="Modification & Cancellation">
            <NumberRow label="Modification Cutoff" description="Hours before reservation when changes are no longer allowed" value={general.modificationCutoffHours} onChange={v => updateGeneral('modificationCutoffHours', v)} suffix="hours" min={0} max={72} />
            <NumberRow label="Cancellation Cutoff" description="Hours before reservation when cancellation is no longer allowed" value={general.cancellationCutoffHours} onChange={v => updateGeneral('cancellationCutoffHours', v)} suffix="hours" min={0} max={72} />
          </SectionCard>

          <SectionCard title="Service Window">
            <NumberRow label="Service End Hour" description="Hour of day when the previous day's service ends (e.g. 4 = 4 AM)" value={general.serviceEndHour} onChange={v => updateGeneral('serviceEndHour', v)} suffix="AM" min={0} max={8} />
          </SectionCard>
        </div>
      )}

      {/* ── Deposits Tab ──────────────────────────────────────────── */}
      {activeTab === 'deposits' && (
        <div className="space-y-1">
          <SectionCard title="Deposit Engine">
            <div className="mb-1">
              <div className="text-sm font-medium text-gray-900 mb-1">Deposit Mode</div>
              <div className="text-xs text-gray-500 mb-3">
                Control whether deposits are required, offered optionally, or disabled entirely.
              </div>
              <div className="flex gap-2">
                {(['disabled', 'optional', 'required'] as const).map(mode => {
                  const effectiveMode = getEffectiveDepositMode(deposit)
                  return (
                    <button
                      key={mode}
                      onClick={() => {
                        updateDeposit('requirementMode', mode)
                        updateDeposit('enabled', mode !== 'disabled')
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        effectiveMode === mode
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {mode === 'disabled' ? 'Disabled' : mode === 'optional' ? 'Optional' : 'Required'}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {getEffectiveDepositMode(deposit) === 'disabled' && 'No deposits will be collected for any reservations.'}
                {getEffectiveDepositMode(deposit) === 'optional' && 'Guests can choose to pay a deposit but reservations are confirmed without one.'}
                {getEffectiveDepositMode(deposit) === 'required' && 'Reservations stay pending until the deposit is paid. A hold timer enforces the deadline.'}
              </div>
            </div>
          </SectionCard>

          {getEffectiveDepositMode(deposit) !== 'disabled' && (
            <>
              <SectionCard title="Trigger Rules">
                <NumberRow label="Party Size Threshold" description="Require deposit for parties of this size or larger (0 = all reservations)" value={deposit.partySizeThreshold} onChange={v => updateDeposit('partySizeThreshold', v)} min={0} max={50} />
                <ToggleRow label="Force for Large Parties" description="Always require deposit for large parties regardless of other rules" checked={deposit.forceForLargeParty} onChange={v => updateDeposit('forceForLargeParty', v)} border />
                {deposit.forceForLargeParty && (
                  <NumberRow label="Large Party Threshold" description="What counts as a large party" value={deposit.largePartyThreshold} onChange={v => updateDeposit('largePartyThreshold', v)} min={2} max={100} />
                )}
                <ToggleRow label="Force for Online Bookings" description="Always require deposit for reservations made online" checked={deposit.forceForOnline} onChange={v => updateDeposit('forceForOnline', v)} border />
              </SectionCard>

              <SectionCard title="Amount">
                <div className="flex gap-2 mb-4">
                  {(['flat', 'per_guest', 'percentage'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => updateDeposit('depositMode', mode)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        deposit.depositMode === mode
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {mode === 'flat' ? 'Flat Amount' : mode === 'per_guest' ? 'Per Guest' : 'Percentage'}
                    </button>
                  ))}
                </div>
                {deposit.depositMode === 'flat' && (
                  <NumberRow label="Flat Deposit Amount" description="Fixed deposit amount in cents" value={deposit.defaultAmountCents} onChange={v => updateDeposit('defaultAmountCents', v)} prefix="$" min={0} step={100} suffix={`(${formatCents(deposit.defaultAmountCents)})`} />
                )}
                {deposit.depositMode === 'per_guest' && (
                  <NumberRow label="Per-Guest Amount" description="Deposit per guest in cents" value={deposit.perGuestAmountCents} onChange={v => updateDeposit('perGuestAmountCents', v)} prefix="$" min={0} step={100} suffix={`(${formatCents(deposit.perGuestAmountCents)})`} />
                )}
                {deposit.depositMode === 'percentage' && (
                  <NumberRow label="Percentage of Estimated Spend" description="Percentage of estimated bill total" value={deposit.percentageOfEstimated} onChange={v => updateDeposit('percentageOfEstimated', v)} suffix="%" min={0} max={100} />
                )}
              </SectionCard>

              <SectionCard title="Refund Policy">
                <div className="flex gap-2 mb-4">
                  {(['always', 'cutoff', 'never'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => updateDeposit('refundableBefore', mode)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        deposit.refundableBefore === mode
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {mode === 'always' ? 'Always Refundable' : mode === 'cutoff' ? 'Before Cutoff' : 'Never'}
                    </button>
                  ))}
                </div>
                {deposit.refundableBefore === 'cutoff' && (
                  <NumberRow label="Refund Cutoff" description="Hours before reservation to allow full refund" value={deposit.refundCutoffHours} onChange={v => updateDeposit('refundCutoffHours', v)} suffix="hours" min={0} max={168} />
                )}
                {deposit.refundableBefore !== 'never' && (
                  <NumberRow label="Non-Refundable Portion" description="Percentage always retained (0 = fully refundable)" value={deposit.nonRefundablePercent} onChange={v => updateDeposit('nonRefundablePercent', v)} suffix="%" min={0} max={100} />
                )}
              </SectionCard>

              <SectionCard title="Payment & Expiration">
                <div className="mb-3">
                  <div className="text-sm text-gray-900 mb-1">Accepted Payment Methods</div>
                  <div className="flex gap-2">
                    {(['card', 'text_to_pay'] as const).map(method => {
                      const active = deposit.paymentMethods.includes(method)
                      return (
                        <button
                          key={method}
                          onClick={() => {
                            const next = active
                              ? deposit.paymentMethods.filter(m => m !== method)
                              : [...deposit.paymentMethods, method]
                            if (next.length > 0) updateDeposit('paymentMethods', next)
                          }}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {method === 'card' ? 'Card' : 'Text to Pay'}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <NumberRow label="Link Expiration" description="Minutes before the deposit payment link expires" value={deposit.expirationMinutes} onChange={v => updateDeposit('expirationMinutes', v)} suffix="min" min={5} max={1440} />
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* ── Notifications Tab ─────────────────────────────────────── */}
      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <SectionCard title="Template Pack">
            <div className="flex gap-2">
              <button onClick={() => applyTemplatePack('professional')} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                Professional
              </button>
              <button onClick={() => applyTemplatePack('casual')} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors">
                Casual
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Templates">
            {TEMPLATE_NAMES.map(({ key, label }) => {
              const isExpanded = expandedTemplate === key
              const tpl = templates[key]
              return (
                <div key={key} className="border-b border-gray-100 last:border-0">
                  <button
                    onClick={() => setExpandedTemplate(isExpanded ? null : key)}
                    className="w-full flex items-center justify-between py-3 text-left"
                  >
                    <span className="text-sm font-medium text-gray-900">{label}</span>
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="pb-4 space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Email Subject</label>
                        <input
                          type="text"
                          value={tpl.subject}
                          onChange={e => updateTemplate(key, 'subject', e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">SMS Body</label>
                        <textarea
                          value={tpl.smsBody}
                          onChange={e => updateTemplate(key, 'smsBody', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Email Body (HTML)</label>
                        <textarea
                          value={tpl.emailBody}
                          onChange={e => updateTemplate(key, 'emailBody', e.target.value)}
                          rows={5}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </SectionCard>

          <SectionCard title="Available Placeholders">
            <button
              onClick={() => setPlaceholdersOpen(!placeholdersOpen)}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {placeholdersOpen ? 'Hide Placeholders' : 'Show Placeholders'}
            </button>
            {placeholdersOpen && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AVAILABLE_PLACEHOLDERS.map(p => (
                  <div key={p.key} className="flex items-start gap-2 text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-indigo-700 font-mono whitespace-nowrap">{p.key}</code>
                    <span className="text-gray-600">{p.description}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Hours & Blocks Tab ────────────────────────────────────── */}
      {activeTab === 'hours' && (
        <div className="space-y-4">
          <SectionCard title="Operating Hours">
            <p className="text-sm text-gray-600">
              Reservation availability follows your venue operating hours configured in General Settings.
              Use blocks below to override availability for specific dates.
            </p>
          </SectionCard>

          <SectionCard
            title="Reservation Blocks"
            actions={
              <button
                onClick={() => { setEditingBlock({ ...EMPTY_BLOCK }); setBlockModalOpen(true) }}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Add Block
              </button>
            }
          >
            {blocks.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No reservation blocks configured.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {blocks.map(block => (
                  <div key={block.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{block.name}</div>
                      <div className="text-xs text-gray-600">
                        {block.blockDate}
                        {block.isAllDay ? ' (All Day)' : ` ${block.startTime} - ${block.endTime}`}
                        {block.reason && ` — ${block.reason}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingBlock({ ...block }); setBlockModalOpen(true) }}
                        className="text-sm text-indigo-600 hover:text-indigo-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteBlockId(block.id!)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Widget Tab ────────────────────────────────────────────── */}
      {activeTab === 'widget' && (
        <div className="space-y-1">
          <SectionCard title="Online Booking">
            <ToggleRow
              label="Allow Online Booking"
              description="Enable the public booking widget for your website"
              checked={general.allowOnlineBooking}
              onChange={v => updateGeneral('allowOnlineBooking', v)}
            />
          </SectionCard>

          {general.allowOnlineBooking ? (
            <SectionCard title="Embed Code">
              <p className="text-sm text-gray-600 mb-3">
                Copy this snippet into your website to display the reservation widget.
              </p>
              <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                {`<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/widget/reservations.js" data-location="${employee?.location?.id || 'YOUR_LOCATION_ID'}"></script>`}
              </div>
              <button
                onClick={() => {
                  const code = `<script src="${window.location.origin}/widget/reservations.js" data-location="${employee?.location?.id || ''}"></script>`
                  void navigator.clipboard.writeText(code).then(() => toast.success('Copied to clipboard'))
                }}
                className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Copy to Clipboard
              </button>
            </SectionCard>
          ) : (
            <SectionCard title="Widget Preview">
              <p className="text-sm text-gray-500 py-4 text-center">
                Enable online booking above to configure the widget.
              </p>
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Save Bar ──────────────────────────────────────────────── */}
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />

      {/* ── Block Modal ───────────────────────────────────────────── */}
      <Modal
        isOpen={blockModalOpen}
        onClose={() => { setBlockModalOpen(false); setEditingBlock(null) }}
        title={editingBlock?.id ? 'Edit Block' : 'New Reservation Block'}
        size="md"
      >
        {editingBlock && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={editingBlock.name}
                onChange={e => setEditingBlock(prev => prev ? { ...prev, name: e.target.value } : null)}
                placeholder="e.g. Private Event, Holiday Closure"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
              <input
                type="text"
                value={editingBlock.reason}
                onChange={e => setEditingBlock(prev => prev ? { ...prev, reason: e.target.value } : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={editingBlock.blockDate}
                onChange={e => setEditingBlock(prev => prev ? { ...prev, blockDate: e.target.value } : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <ToggleRow
              label="All Day"
              description="Block all reservation slots for this date"
              checked={editingBlock.isAllDay}
              onChange={v => setEditingBlock(prev => prev ? { ...prev, isAllDay: v } : null)}
            />
            {!editingBlock.isAllDay && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={editingBlock.startTime}
                    onChange={e => setEditingBlock(prev => prev ? { ...prev, startTime: e.target.value } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={editingBlock.endTime}
                    onChange={e => setEditingBlock(prev => prev ? { ...prev, endTime: e.target.value } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity Reduction (optional)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={editingBlock.reducedCapacityPercent ?? ''}
                  onChange={e => setEditingBlock(prev => prev ? { ...prev, reducedCapacityPercent: e.target.value ? parseInt(e.target.value) : null } : null)}
                  placeholder="e.g. 50"
                  min={0}
                  max={100}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-600">% reduction (blank = full block)</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setBlockModalOpen(false); setEditingBlock(null) }} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={saveBlock} disabled={!editingBlock.name || !editingBlock.blockDate} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                {editingBlock.id ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm ────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteBlockId}
        onCancel={() => setDeleteBlockId(null)}
        onConfirm={deleteBlock}
        title="Delete Block"
        description="Are you sure you want to delete this reservation block? This cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </div>
  )
}

// ─── Sub-Components ────────────────────────────────────────────────────────

function SectionCard({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
