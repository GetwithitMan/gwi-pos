'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Modal } from '@/components/ui/modal'
import { TerminalFailoverManager } from '@/components/hardware/TerminalFailoverManager'
import { useAuthStore } from '@/stores/auth-store'

interface Printer {
  id: string
  name: string
  ipAddress: string
  printerRole: string
}

interface Terminal {
  id: string
  name: string
  category: 'FIXED_STATION' | 'HANDHELD'
  staticIp: string | null
  receiptPrinterId: string | null
  receiptPrinter: Printer | null
  roleSkipRules: Record<string, string[]> | null
  forceAllPrints: boolean
  isPaired: boolean
  isOnline: boolean
  isActive: boolean
  lastSeenAt: string | null
  sortOrder: number
  backupTerminalId: string | null
  failoverEnabled: boolean
  failoverTimeout: number
}

interface Role {
  id: string
  name: string
}

// Printer roles that can be skipped
const SKIP_TAGS = ['bar', 'kitchen', 'pizza', 'entertainment']

export default function TerminalsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTerminal, setEditingTerminal] = useState<Terminal | null>(null)
  const [pairingCode, setPairingCode] = useState<{ code: string; terminalId: string; expiresAt: string } | null>(null)

  const fetchData = useCallback(async () => {
    if (!locationId) return
    try {
      const [terminalsRes, printersRes, rolesRes] = await Promise.all([
        fetch(`/api/hardware/terminals?locationId=${locationId}`),
        fetch(`/api/hardware/printers?locationId=${locationId}&role=receipt`),
        fetch(`/api/employees/roles?locationId=${locationId}`),
      ])

      if (terminalsRes.ok) {
        const data = await terminalsRes.json()
        setTerminals(data.data.terminals || [])
      }

      if (printersRes.ok) {
        const data = await printersRes.json()
        setPrinters(data.data.printers || [])
      }

      if (rolesRes.ok) {
        const data = await rolesRes.json()
        setRoles(data.data.roles || [])
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleGeneratePairingCode = async (terminalId: string) => {
    try {
      const res = await fetch(`/api/hardware/terminals/${terminalId}/generate-code`, {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setPairingCode({
          code: data.pairingCode,
          terminalId,
          expiresAt: data.expiresAt,
        })
      }
    } catch (error) {
      console.error('Failed to generate pairing code:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this terminal?')) return

    try {
      const res = await fetch(`/api/hardware/terminals/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setTerminals((prev) => prev.filter((t) => t.id !== id))
      }
    } catch (error) {
      console.error('Failed to delete terminal:', error)
    }
  }

  const handleToggleForceAllPrints = async (terminal: Terminal) => {
    try {
      const res = await fetch(`/api/hardware/terminals/${terminal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceAllPrints: !terminal.forceAllPrints }),
      })
      if (res.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to toggle force all prints:', error)
    }
  }

  const handleUnpair = async (terminalId: string) => {
    if (!confirm('This will disconnect the device. It will need to be re-paired to use this terminal again.')) return

    try {
      const res = await fetch(`/api/hardware/terminals/${terminalId}/unpair`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to unpair terminal:', error)
    }
  }

  const fixedStations = terminals.filter((t) => t.category === 'FIXED_STATION')
  const handhelds = terminals.filter((t) => t.category === 'HANDHELD')

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-600">Loading terminals...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
        <AdminPageHeader
          title="Terminals & Stations"
          subtitle="Manage POS devices and configure print routing rules"
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Hardware', href: '/settings/hardware' },
          ]}
          actions={
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Station
            </button>
          }
        />

        {/* Fixed Stations Section */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Fixed Stations ({fixedStations.length})
          </h2>
          {fixedStations.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow">
              <p className="text-gray-500">No fixed stations configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {fixedStations.map((terminal) => (
                <TerminalCard
                  key={terminal.id}
                  terminal={terminal}
                  onEdit={() => setEditingTerminal(terminal)}
                  onDelete={() => handleDelete(terminal.id)}
                  onPair={() => handleGeneratePairingCode(terminal.id)}
                  onUnpair={() => handleUnpair(terminal.id)}
                  onToggleForce={() => handleToggleForceAllPrints(terminal)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Handhelds Section */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Handhelds ({handhelds.length})
          </h2>
          {handhelds.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow">
              <p className="text-gray-500">No handhelds configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {handhelds.map((terminal) => (
                <TerminalCard
                  key={terminal.id}
                  terminal={terminal}
                  onEdit={() => setEditingTerminal(terminal)}
                  onDelete={() => handleDelete(terminal.id)}
                  onPair={() => handleGeneratePairingCode(terminal.id)}
                  onUnpair={() => handleUnpair(terminal.id)}
                  onToggleForce={() => handleToggleForceAllPrints(terminal)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Failover Configuration */}
        <TerminalFailoverManager terminals={terminals} onUpdate={fetchData} />

      {/* Add/Edit Modal */}
      {(showAddModal || editingTerminal) && (
        <TerminalModal
          terminal={editingTerminal}
          printers={printers}
          roles={roles}
          locationId={locationId!}
          onClose={() => {
            setShowAddModal(false)
            setEditingTerminal(null)
          }}
          onSave={() => {
            setShowAddModal(false)
            setEditingTerminal(null)
            fetchData()
          }}
        />
      )}

      {/* Pairing Code Modal */}
      {pairingCode && (
        <PairingCodeModal
          code={pairingCode.code}
          expiresAt={pairingCode.expiresAt}
          onClose={() => setPairingCode(null)}
        />
      )}
    </div>
  )
}

// Staleness threshold - device is considered offline if no heartbeat for 60+ seconds
const STALE_THRESHOLD_MS = 60000

// Terminal Status Badge Component
function TerminalStatusBadge({ status }: { status: 'online' | 'stale' | 'offline' | 'unpaired' }) {
  const config = {
    online: {
      dotClass: 'bg-green-500 animate-pulse',
      textClass: 'text-green-400',
      label: 'Online',
    },
    stale: {
      dotClass: 'bg-yellow-500',
      textClass: 'text-yellow-400',
      label: 'Stale',
    },
    offline: {
      dotClass: 'bg-red-500',
      textClass: 'text-red-400',
      label: 'Offline',
    },
    unpaired: {
      dotClass: 'bg-slate-500',
      textClass: 'text-slate-500',
      label: 'Not Paired',
    },
  }

  const { dotClass, textClass, label } = config[status]

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span className={`text-[10px] font-bold uppercase tracking-wide ${textClass}`}>
        {label}
      </span>
    </div>
  )
}

function getTerminalStatus(terminal: Terminal): 'online' | 'stale' | 'offline' | 'unpaired' {
  if (!terminal.isPaired) return 'unpaired'
  if (!terminal.isOnline) return 'offline'

  // Check staleness based on lastSeenAt
  if (terminal.lastSeenAt) {
    const lastSeen = new Date(terminal.lastSeenAt).getTime()
    const now = Date.now()
    if (now - lastSeen > STALE_THRESHOLD_MS) {
      return 'stale' // Device hasn't checked in recently
    }
  }

  return 'online'
}

// Terminal Card Component
function TerminalCard({
  terminal,
  onEdit,
  onDelete,
  onPair,
  onUnpair,
  onToggleForce,
}: {
  terminal: Terminal
  onEdit: () => void
  onDelete: () => void
  onPair: () => void
  onUnpair: () => void
  onToggleForce: () => void
}) {
  const skipRules = terminal.roleSkipRules || {}
  const hasSkipRules = Object.keys(skipRules).some((role) => skipRules[role]?.length > 0)
  const status = getTerminalStatus(terminal)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-gray-300 transition-colors shadow">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {terminal.category === 'FIXED_STATION' ? (
            <div className="w-10 h-10 bg-cyan-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          ) : (
            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          <div>
            <h3 className="font-bold text-gray-900">{terminal.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <TerminalStatusBadge status={status} />
              {terminal.staticIp && (
                <span className="text-xs text-gray-500 font-mono">{terminal.staticIp}</span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Edit"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Receipt Printer */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Receipt Printer</span>
          <span className="text-gray-900">
            {terminal.receiptPrinter?.name || <span className="text-gray-500">None</span>}
          </span>
        </div>

        {/* Skip Rules Summary */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Skip Rules</span>
          <span className={hasSkipRules ? 'text-amber-600' : 'text-gray-500'}>
            {hasSkipRules ? `${Object.keys(skipRules).filter(r => skipRules[r]?.length > 0).length} roles configured` : 'None'}
          </span>
        </div>

        {/* Force All Prints Toggle */}
        <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-200">
          <span className="text-gray-600">Force All Prints</span>
          <button
            onClick={onToggleForce}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              terminal.forceAllPrints ? 'bg-red-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                terminal.forceAllPrints ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {terminal.forceAllPrints && (
          <p className="text-xs text-red-400">Override active - all tickets will print</p>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-200 flex gap-2">
        {terminal.isPaired ? (
          <>
            <button
              onClick={onUnpair}
              className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm rounded-lg font-medium transition-colors"
            >
              Unpair
            </button>
            <button
              onClick={onPair}
              className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm rounded-lg font-medium transition-colors"
            >
              Re-pair
            </button>
          </>
        ) : (
          <button
            onClick={onPair}
            className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg font-medium transition-colors"
          >
            Pair Device
          </button>
        )}
        <button
          onClick={onDelete}
          className="px-3 py-2 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-lg transition-colors"
          title="Delete"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Terminal Add/Edit Modal
function TerminalModal({
  terminal,
  printers,
  roles,
  locationId,
  onClose,
  onSave,
}: {
  terminal: Terminal | null
  printers: Printer[]
  roles: Role[]
  locationId: string
  onClose: () => void
  onSave: () => void
}) {
  const [name, setName] = useState(terminal?.name || '')
  const [category, setCategory] = useState<'FIXED_STATION' | 'HANDHELD'>(terminal?.category || 'FIXED_STATION')
  const [staticIp, setStaticIp] = useState(terminal?.staticIp || '')
  const [receiptPrinterId, setReceiptPrinterId] = useState(terminal?.receiptPrinterId || '')
  const [roleSkipRules, setRoleSkipRules] = useState<Record<string, string[]>>(
    terminal?.roleSkipRules || {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleToggleSkipTag = (roleSlug: string, tag: string) => {
    setRoleSkipRules((prev) => {
      const current = prev[roleSlug] || []
      const updated = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag]
      return { ...prev, [roleSlug]: updated }
    })
  }

  const handleSave = async () => {
    setError('')
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    try {
      const url = terminal
        ? `/api/hardware/terminals/${terminal.id}`
        : '/api/hardware/terminals'
      const method = terminal ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: name.trim(),
          category,
          staticIp: staticIp.trim() || null,
          receiptPrinterId: receiptPrinterId || null,
          roleSkipRules,
        }),
      })

      if (res.ok) {
        onSave()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save terminal')
      }
    } catch (err) {
      setError('Failed to save terminal')
    } finally {
      setSaving(false)
    }
  }

  // Get role slug/name for display
  const getRoleSlug = (role: Role) => role.name.toLowerCase().replace(/\s+/g, '_')

  return (
    <Modal isOpen={true} onClose={onClose} title={terminal ? 'Edit Station' : 'Add New Station'} size="2xl">
        {/* Category Toggle */}
        <div className="flex justify-end mb-4">
          <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-300">
            <button
              onClick={() => setCategory('FIXED_STATION')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
                category === 'FIXED_STATION' ? 'bg-cyan-600 text-white' : 'text-gray-600'
              }`}
            >
              FIXED STATION
            </button>
            <button
              onClick={() => setCategory('HANDHELD')}
              className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
                category === 'HANDHELD' ? 'bg-purple-600 text-white' : 'text-gray-600'
              }`}
            >
              HANDHELD
            </button>
          </div>
        </div>

        {/* Content */}
        <div>
          <div className="grid grid-cols-2 gap-6">
            {/* Left Column - Identity */}
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block mb-2">
                  Station Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Bar Terminal 1"
                  className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block mb-2">
                  Static IP Address
                </label>
                <input
                  type="text"
                  value={staticIp}
                  onChange={(e) => setStaticIp(e.target.value)}
                  placeholder="192.168.1.XX"
                  className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm font-mono text-gray-900 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Optional - helps identify this terminal on the network
                </p>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest block mb-2">
                  Local Receipt Printer
                </label>
                <select
                  value={receiptPrinterId}
                  onChange={(e) => setReceiptPrinterId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none"
                >
                  <option value="">None (No local printer)</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.ipAddress})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right Column - Skip Rules Matrix */}
            <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4">
              <h3 className="text-xs font-black text-amber-600 uppercase mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-Skip Rules
              </h3>
              <p className="text-[10px] text-gray-600 mb-4">
                When an employee with this role logs in at this station, selected ticket types won&apos;t print.
              </p>

              <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                {roles.map((role) => {
                  const slug = getRoleSlug(role)
                  const currentSkips = roleSkipRules[slug] || []
                  return (
                    <div key={role.id} className="border-b border-gray-200 pb-3 last:border-0">
                      <span className="text-xs font-bold text-gray-900">{role.name}</span>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {SKIP_TAGS.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => handleToggleSkipTag(slug, tag)}
                            className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                              currentSkips.includes(tag)
                                ? 'bg-amber-600 text-white border-amber-500'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                            } border`}
                          >
                            {currentSkips.includes(tag) ? '✓ ' : ''}Skip {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {roles.length === 0 && (
                <p className="text-xs text-gray-500 italic">No roles found</p>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-gray-600 font-bold hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : terminal ? 'Save Changes' : 'Create Station'}
          </button>
        </div>
    </Modal>
  )
}

// Pairing Code Modal
function PairingCodeModal({
  code,
  expiresAt,
  onClose,
}: {
  code: string
  expiresAt: string
  onClose: () => void
}) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date()
      const expires = new Date(expiresAt)
      const diff = expires.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('Expired')
        return
      }

      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  return (
    <Modal isOpen={true} onClose={onClose} title="Pairing Code" size="md">
      <div className="text-center">
        <p className="text-gray-600 text-sm mb-6">
          Enter this code on the device to pair it
        </p>

        <div className="bg-gray-50 rounded-2xl p-6 mb-4 border border-gray-200">
          <div className="text-5xl font-mono font-bold tracking-[0.3em] text-cyan-600">
            {code}
          </div>
        </div>

        <p className={`text-sm ${timeLeft === 'Expired' ? 'text-red-600' : 'text-gray-600'}`}>
          {timeLeft === 'Expired' ? 'Code expired' : `Expires in ${timeLeft}`}
        </p>

        <button
          onClick={onClose}
          className="w-full mt-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold rounded-xl transition-colors"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
