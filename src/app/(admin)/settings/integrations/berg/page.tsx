'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings, saveSettings } from '@/lib/api/settings-client'
import { useAuthStore } from '@/stores/auth-store'
import Link from 'next/link'

interface PluMapping {
  id: string
  pluNumber: number
  description: string
  menuItemId: string | null
  pourSizeOz: number | null
  active: boolean
}

interface PluFormData {
  pluNumber: number | ''
  description: string
  menuItemId: string
  pourSizeOz: number | ''
  active: boolean
}

const emptyForm: PluFormData = { pluNumber: '', description: '', menuItemId: '', pourSizeOz: '', active: true }

export default function BergSettingsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mappings, setMappings] = useState<PluMapping[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PluFormData>(emptyForm)

  const loadMappings = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/berg/plu-mappings?locationId=${locationId}&employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        setMappings(data.data ?? [])
      }
    } catch {
      // silent
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    async function load() {
      try {
        const settingsData = await loadSettings()
        const berg = settingsData.settings?.bergReportsEnabled
        setEnabled(berg === true)
      } catch {
        toast.error('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    if (enabled) void loadMappings()
  }, [enabled, loadMappings])

  async function handleToggle(val: boolean) {
    setEnabled(val)
    setSaving(true)
    try {
      await saveSettings({ bergReportsEnabled: val }, employee?.id)
      toast.success(val ? 'Berg reports enabled' : 'Berg reports disabled')
    } catch {
      setEnabled(!val)
      toast.error('Failed to save setting')
    } finally {
      setSaving(false)
    }
  }

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(m: PluMapping) {
    setForm({
      pluNumber: m.pluNumber,
      description: m.description,
      menuItemId: m.menuItemId ?? '',
      pourSizeOz: m.pourSizeOz ?? '',
      active: m.active,
    })
    setEditingId(m.id)
    setShowForm(true)
  }

  async function handleSubmit() {
    if (!form.pluNumber || !form.description) {
      toast.error('PLU number and description are required')
      return
    }
    const body = {
      pluNumber: Number(form.pluNumber),
      description: form.description,
      menuItemId: form.menuItemId || null,
      pourSizeOz: form.pourSizeOz ? Number(form.pourSizeOz) : null,
      active: form.active,
      employeeId: employee?.id,
      locationId,
    }
    try {
      if (editingId) {
        const res = await fetch(`/api/berg/plu-mappings/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error()
        toast.success('Mapping updated')
      } else {
        const res = await fetch('/api/berg/plu-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error()
        toast.success('Mapping created')
      }
      setShowForm(false)
      setEditingId(null)
      await loadMappings()
    } catch {
      toast.error('Failed to save mapping')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this PLU mapping?')) return
    try {
      const res = await fetch(`/api/berg/plu-mappings/${id}?locationId=${locationId}&employeeId=${employee?.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      toast.success('Mapping deleted')
      await loadMappings()
    } catch {
      toast.error('Failed to delete mapping')
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Berg Controls</h1>
          <p className="text-gray-500">
            Compare Berg liquor system pours against POS sales data by mapping PLU numbers to menu items.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Enable Toggle */}
        <Card>
          <CardHeader><CardTitle>Berg Reports</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Enable Berg Comparison Reports</div>
                <div className="text-xs text-gray-400">Turn on to start mapping PLU numbers and running comparison reports.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={saving}
                onClick={() => handleToggle(!enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </CardContent>
        </Card>

        {!enabled && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-500">
            Enable Berg comparison reports to start mapping PLU numbers to your POS items.
          </div>
        )}

        {enabled && (
          <>
            {/* Link to report */}
            <div className="flex justify-end">
              <Link href="/reports/berg-comparison" className="text-blue-600 text-sm hover:underline font-medium">
                View Berg Comparison Report &rarr;
              </Link>
            </div>

            {/* PLU Mapping Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>PLU Mappings</CardTitle>
                  <Button onClick={openAdd} size="sm">Add Mapping</Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Add/Edit Form */}
                {showForm && (
                  <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                    <div className="text-sm font-medium text-gray-700 mb-2">{editingId ? 'Edit Mapping' : 'Add Mapping'}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">PLU Number</label>
                        <input
                          type="number"
                          value={form.pluNumber}
                          onChange={e => setForm(f => ({ ...f, pluNumber: e.target.value ? Number(e.target.value) : '' }))}
                          placeholder="e.g. 101"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <input
                          type="text"
                          value={form.description}
                          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="e.g. Tito's Vodka 1oz"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Menu Item ID</label>
                        <input
                          type="text"
                          value={form.menuItemId}
                          onChange={e => setForm(f => ({ ...f, menuItemId: e.target.value }))}
                          placeholder="Menu Item ID"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Pour Size Override (oz)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.pourSizeOz}
                          onChange={e => setForm(f => ({ ...f, pourSizeOz: e.target.value ? Number(e.target.value) : '' }))}
                          placeholder="e.g. 1.5"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      Active
                    </label>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={handleSubmit}>{editingId ? 'Update' : 'Save'}</Button>
                      <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditingId(null) }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Table */}
                {mappings.length === 0 ? (
                  <p className="text-sm text-gray-400">No PLU mappings yet. Click &quot;Add Mapping&quot; to get started.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="py-2 pr-3 font-medium">PLU #</th>
                          <th className="py-2 pr-3 font-medium">Description</th>
                          <th className="py-2 pr-3 font-medium">Mapped Item</th>
                          <th className="py-2 pr-3 font-medium">Pour Size (oz)</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {mappings.map(m => (
                          <tr key={m.id}>
                            <td className="py-2 pr-3 font-mono">{m.pluNumber}</td>
                            <td className="py-2 pr-3">{m.description}</td>
                            <td className="py-2 pr-3 text-gray-500">{m.menuItemId ?? '—'}</td>
                            <td className="py-2 pr-3">{m.pourSizeOz != null ? `${m.pourSizeOz} oz` : '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                {m.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                <button onClick={() => openEdit(m)} className="text-blue-600 hover:underline text-xs">Edit</button>
                                <button onClick={() => handleDelete(m.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
