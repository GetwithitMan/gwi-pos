'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { LoginMessage, LoginMessageSettings, TrainingSettings } from '@/lib/settings'

// ─── Login Message Editor ────────────────────────────────────────────────────

function LoginMessageEditor({
  messages,
  onChange,
}: {
  messages: LoginMessage[]
  onChange: (msgs: LoginMessage[]) => void
}) {
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<'info' | 'warning' | 'urgent'>('info')
  const [newExpiry, setNewExpiry] = useState('')

  const handleAdd = () => {
    if (!newText.trim()) return
    const msg: LoginMessage = {
      text: newText.trim(),
      type: newType,
      ...(newExpiry ? { expiresAt: new Date(newExpiry).toISOString() } : {}),
    }
    onChange([...messages, msg])
    setNewText('')
    setNewExpiry('')
  }

  const handleRemove = (index: number) => {
    onChange(messages.filter((_, i) => i !== index))
  }

  const typeColors: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    urgent: 'bg-red-50 border-red-200 text-red-800',
  }

  const typeBadgeColors: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-amber-100 text-amber-700',
    urgent: 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`rounded-lg border px-4 py-3 flex items-start justify-between gap-3 ${typeColors[msg.type] || typeColors.info}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeBadgeColors[msg.type] || typeBadgeColors.info}`}>
                {msg.type}
              </span>
              {msg.expiresAt && (
                <span className="text-xs opacity-70">
                  Expires: {new Date(msg.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-sm">{msg.text}</p>
          </div>
          <button
            onClick={() => handleRemove(i)}
            className="text-gray-900 hover:text-red-500 transition-colors flex-shrink-0 mt-0.5"
            title="Remove message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add new message */}
      <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
        <div className="text-xs font-medium text-gray-900 uppercase tracking-wide">New Message</div>
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Enter message text..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          rows={2}
        />
        <div className="flex items-center gap-3">
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as 'info' | 'warning' | 'urgent')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="urgent">Urgent</option>
          </select>
          <input
            type="date"
            value={newExpiry}
            onChange={e => setNewExpiry(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            placeholder="Expiry (optional)"
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Training Employee Selector ─────────────────────────────────────────────

function TrainingEmployeeList({
  trainingIds,
  onToggle,
}: {
  trainingIds: string[]
  onToggle: (employeeId: string, enabled: boolean) => void
}) {
  const [employees, setEmployees] = useState<Array<{ id: string; firstName: string; lastName: string; displayName: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(data => {
        const list = data.data?.employees || data.data || []
        setEmployees(list)
      })
      .catch(() => toast.error('Failed to load employees'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-gray-900">Loading employees...</p>

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {employees.map(emp => {
        const isTraining = trainingIds.includes(emp.id)
        const name = emp.displayName || `${emp.firstName} ${emp.lastName}`
        return (
          <div
            key={emp.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="text-sm text-gray-900">{name}</div>
            <button
              onClick={() => onToggle(emp.id, !isTraining)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isTraining
                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {isTraining ? 'In Training' : 'Normal'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function TrainingSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Login messages state
  const [loginMessagesEnabled, setLoginMessagesEnabled] = useState(false)
  const [loginMessages, setLoginMessages] = useState<LoginMessage[]>([])

  // Training state
  const [trainingEnabled, setTrainingEnabled] = useState(false)
  const [trainingEmployeeIds, setTrainingEmployeeIds] = useState<string[]>([])
  const [suppressInventory, setSuppressInventory] = useState(true)
  const [suppressPayments, setSuppressPayments] = useState(true)
  const [suppressPrinting, setSuppressPrinting] = useState(true)

  useUnsavedWarning(isDirty)

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        const s = data.settings
        // Login messages
        setLoginMessagesEnabled(s.loginMessages?.enabled ?? false)
        setLoginMessages(s.loginMessages?.messages ?? [])
        // Training
        setTrainingEnabled(s.training?.enabled ?? false)
        setTrainingEmployeeIds(s.training?.trainingEmployeeIds ?? [])
        setSuppressInventory(s.training?.suppressInventory ?? true)
        setSuppressPayments(s.training?.suppressPayments ?? true)
        setSuppressPrinting(s.training?.suppressPrinting ?? true)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadSettings()
    return cleanup
  }, [loadSettings])

  const handleSave = async () => {
    try {
      setIsSaving(true)

      const loginMsgs: LoginMessageSettings = {
        enabled: loginMessagesEnabled,
        messages: loginMessages,
      }

      const training: TrainingSettings = {
        enabled: trainingEnabled,
        trainingEmployeeIds,
        suppressInventory,
        suppressPayments,
        suppressPrinting,
      }

      await saveSettingsApi(
        { loginMessages: loginMsgs, training } as any,
        employee?.id,
      )

      setIsDirty(false)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTrainingToggle = (empId: string, enabled: boolean) => {
    setTrainingEmployeeIds(prev =>
      enabled ? [...prev, empId] : prev.filter(id => id !== empId)
    )
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-900">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader title="Training & Login Messages" subtitle="Configure training mode and login screen messages" />

      <div className="max-w-3xl mx-auto space-y-8">

        {/* ─── Login Messages Section ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Login Screen Messages</h2>
          <p className="text-sm text-gray-900 mb-4">Display announcements, reminders, or alerts on the login screen for all staff.</p>

          <ToggleRow
            label="Enable Login Messages"
            description="Show messages below the PIN pad on the login screen"
            checked={loginMessagesEnabled}
            onChange={v => { setLoginMessagesEnabled(v); setIsDirty(true) }}
          />

          {loginMessagesEnabled && (
            <div className="mt-4">
              <LoginMessageEditor
                messages={loginMessages}
                onChange={msgs => { setLoginMessages(msgs); setIsDirty(true) }}
              />
            </div>
          )}
        </section>

        {/* ─── Training Mode Section ─── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Training Mode</h2>
          <p className="text-sm text-gray-900 mb-4">
            Enable training mode for new employees. Training orders will not hit real payment processors,
            print kitchen tickets, or deduct inventory.
          </p>

          <ToggleRow
            label="Enable Training Mode"
            description="Master toggle for the training system"
            checked={trainingEnabled}
            onChange={v => { setTrainingEnabled(v); setIsDirty(true) }}
          />

          {trainingEnabled && (
            <div className="mt-4 space-y-4">
              <ToggleRow
                label="Suppress Payments"
                description="Skip Datacap / real payment processing for training orders"
                checked={suppressPayments}
                onChange={v => { setSuppressPayments(v); setIsDirty(true) }}
                border
              />
              <ToggleRow
                label="Suppress Printing"
                description="Don't print kitchen tickets for training orders (KDS still shows them)"
                checked={suppressPrinting}
                onChange={v => { setSuppressPrinting(v); setIsDirty(true) }}
                border
              />
              <ToggleRow
                label="Suppress Inventory"
                description="Don't deduct inventory for training orders"
                checked={suppressInventory}
                onChange={v => { setSuppressInventory(v); setIsDirty(true) }}
                border
              />

              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Training Employees</h3>
                <p className="text-xs text-gray-900 mb-3">
                  Select which employees are in training mode. Their orders will be flagged as training
                  and handled according to the settings above.
                </p>
                <TrainingEmployeeList
                  trainingIds={trainingEmployeeIds}
                  onToggle={handleTrainingToggle}
                />
              </div>
            </div>
          )}
        </section>

        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
