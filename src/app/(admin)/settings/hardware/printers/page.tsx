'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, hardwareSubNav } from '@/components/admin/AdminSubNav'
import { PrinterSettingsEditor } from '@/components/hardware/PrinterSettingsEditor'
import { ReceiptVisualEditor, type PrintTemplateSettings as VisualEditorSettings } from '@/components/hardware/ReceiptVisualEditor'
import type { PrinterSettings } from '@/types/printer-settings'
import type { TemplateType } from '@/types/routing'
import type { GlobalReceiptSettings } from '@/types/receipt-settings'
import { DEFAULT_GLOBAL_RECEIPT_SETTINGS } from '@/types/receipt-settings'

interface Printer {
  id: string
  name: string
  printerType: 'thermal' | 'impact'
  model: string | null
  ipAddress: string
  port: number
  printerRole: 'receipt' | 'kitchen' | 'bar' | 'entertainment'
  isDefault: boolean
  paperWidth: number
  supportsCut: boolean
  isActive: boolean
  lastPingOk: boolean
  lastPingAt: string | null
  sortOrder: number
  printSettings: VisualEditorSettings | PrinterSettings | null
}

interface PrinterFormData {
  name: string
  printerType: 'thermal' | 'impact'
  model: string
  ipAddress: string
  port: number
  printerRole: 'receipt' | 'kitchen' | 'bar' | 'entertainment'
  isDefault: boolean
  paperWidth: number
  supportsCut: boolean
}

const DEFAULT_FORM_DATA: PrinterFormData = {
  name: '',
  printerType: 'thermal',
  model: '',
  ipAddress: '',
  port: 9100,
  printerRole: 'kitchen',
  isDefault: false,
  paperWidth: 80,
  supportsCut: true,
}

export default function PrintersPage() {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null)
  const [formData, setFormData] = useState<PrinterFormData>(DEFAULT_FORM_DATA)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null)
  const [hardwareSettingsPrinter, setHardwareSettingsPrinter] = useState<Printer | null>(null)
  const [visualEditorPrinter, setVisualEditorPrinter] = useState<Printer | null>(null)
  const [globalReceiptSettings, setGlobalReceiptSettings] = useState<GlobalReceiptSettings>(DEFAULT_GLOBAL_RECEIPT_SETTINGS)

  const fetchPrinters = useCallback(async () => {
    try {
      const res = await fetch('/api/hardware/printers?locationId=loc-1')
      if (res.ok) {
        const data = await res.json()
        setPrinters(data.printers || [])
      }
    } catch (error) {
      console.error('Failed to fetch printers:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch global receipt settings from location
  const fetchGlobalSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        if (data.settings?.receiptDisplay) {
          setGlobalReceiptSettings(data.settings.receiptDisplay)
        }
      }
    } catch (error) {
      console.error('Failed to fetch global settings:', error)
    }
  }, [])

  useEffect(() => {
    fetchPrinters()
    fetchGlobalSettings()
  }, [fetchPrinters, fetchGlobalSettings])

  const handleAddPrinter = () => {
    setEditingPrinter(null)
    setFormData(DEFAULT_FORM_DATA)
    setError('')
    setShowModal(true)
  }

  const handleEditPrinter = (printer: Printer) => {
    setEditingPrinter(printer)
    setFormData({
      name: printer.name,
      printerType: printer.printerType,
      model: printer.model || '',
      ipAddress: printer.ipAddress,
      port: printer.port,
      printerRole: printer.printerRole,
      isDefault: printer.isDefault,
      paperWidth: printer.paperWidth,
      supportsCut: printer.supportsCut,
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    if (!formData.ipAddress.trim()) {
      setError('IP address is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editingPrinter
        ? `/api/hardware/printers/${editingPrinter.id}`
        : '/api/hardware/printers'
      const method = editingPrinter ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          locationId: 'loc-1',
        }),
      })

      if (res.ok) {
        setShowModal(false)
        fetchPrinters()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save printer')
      }
    } catch (error) {
      console.error('Failed to save printer:', error)
      setError('Failed to save printer')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (printer: Printer) => {
    if (!confirm(`Delete printer "${printer.name}"?`)) return

    try {
      const res = await fetch(`/api/hardware/printers/${printer.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        fetchPrinters()
      }
    } catch (error) {
      console.error('Failed to delete printer:', error)
    }
  }

  const handleTestConnection = async (printer: Printer) => {
    setTestingId(printer.id)
    setTestResult(null)

    try {
      const res = await fetch(`/api/hardware/printers/${printer.id}/ping`, {
        method: 'POST',
      })
      const data = await res.json()

      setTestResult({
        id: printer.id,
        success: data.success,
        message: data.success
          ? `Connected in ${data.responseTime}ms`
          : data.error || 'Connection failed',
      })

      fetchPrinters()
    } catch (error) {
      setTestResult({
        id: printer.id,
        success: false,
        message: 'Test failed',
      })
    } finally {
      setTestingId(null)
    }
  }

  const handlePrintTest = async (printer: Printer) => {
    setTestingId(printer.id)
    setTestResult(null)

    try {
      const res = await fetch(`/api/hardware/printers/${printer.id}/test`, {
        method: 'POST',
      })
      const data = await res.json()

      setTestResult({
        id: printer.id,
        success: data.success,
        message: data.success ? 'Test page sent!' : data.error || 'Print failed',
      })
    } catch (error) {
      setTestResult({
        id: printer.id,
        success: false,
        message: 'Print test failed',
      })
    } finally {
      setTestingId(null)
    }
  }

  const handleSaveHardwareSettings = async (settings: PrinterSettings) => {
    if (!hardwareSettingsPrinter) return

    try {
      const res = await fetch(`/api/hardware/printers/${hardwareSettingsPrinter.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printSettings: settings }),
      })

      if (res.ok) {
        setHardwareSettingsPrinter(null)
        fetchPrinters()
      }
    } catch (error) {
      console.error('Failed to save hardware settings:', error)
    }
  }

  const handleSaveVisualEditorSettings = async (settings: VisualEditorSettings) => {
    if (!visualEditorPrinter) return

    try {
      const res = await fetch(`/api/hardware/printers/${visualEditorPrinter.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printSettings: settings }),
      })

      if (res.ok) {
        setVisualEditorPrinter(null)
        fetchPrinters()
      }
    } catch (error) {
      console.error('Failed to save visual editor settings:', error)
    }
  }

  // Map printer role to template type for visual editor
  const getTemplateType = (role: string): TemplateType => {
    switch (role) {
      case 'bar':
        return 'BAR_TICKET'
      case 'receipt':
        return 'STANDARD_KITCHEN' // receipts use standard format
      case 'entertainment':
        return 'ENTERTAINMENT_TICKET'
      default:
        return 'STANDARD_KITCHEN'
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'receipt':
        return 'bg-blue-100 text-blue-800'
      case 'kitchen':
        return 'bg-orange-100 text-orange-800'
      case 'bar':
        return 'bg-purple-100 text-purple-800'
      case 'entertainment':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="Printers"
        subtitle="Configure receipt and kitchen printers"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
        actions={
          <button
            onClick={handleAddPrinter}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            + Add Printer
          </button>
        }
      />
      <AdminSubNav items={hardwareSubNav} basePath="/settings/hardware" />

      <div className="mx-auto max-w-4xl">
        {/* Printers List */}
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white shadow">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : printers.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">No printers configured</h3>
            <p className="mt-1 text-gray-500">Add your first printer to get started</p>
            <button
              onClick={handleAddPrinter}
              className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              Add Printer
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {printers.map((printer) => (
              <div
                key={printer.id}
                className={`rounded-xl bg-white p-4 shadow ${!printer.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3 w-3 rounded-full ${printer.lastPingOk ? 'bg-green-500' : 'bg-red-500'}`}
                      title={printer.lastPingOk ? 'Online' : 'Offline'}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{printer.name}</h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(printer.printerRole)}`}
                        >
                          {printer.printerRole}
                        </span>
                        {printer.isDefault && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Default
                          </span>
                        )}
                        {!printer.isActive && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {printer.ipAddress}:{printer.port} •{' '}
                        <span className="capitalize">{printer.printerType}</span>
                        {printer.model && ` • ${printer.model}`} • {printer.paperWidth}mm
                      </p>
                      {printer.lastPingAt && (
                        <p className="mt-1 text-xs text-gray-400">
                          Last ping: {new Date(printer.lastPingAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditPrinter(printer)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(printer)}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Test Result */}
                {testResult?.id === printer.id && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-lg p-2 text-sm ${
                      testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {testResult.success ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {testResult.message}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <button
                    onClick={() => handleTestConnection(printer)}
                    disabled={testingId === printer.id}
                    className="rounded bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {testingId === printer.id ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={() => handlePrintTest(printer)}
                    disabled={testingId === printer.id}
                    className="rounded bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                  >
                    Print Test Page
                  </button>
                  <button
                    onClick={() => setHardwareSettingsPrinter(printer)}
                    className="rounded bg-orange-100 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-200"
                  >
                    Text & Color
                  </button>
                  <button
                    onClick={() => setVisualEditorPrinter(printer)}
                    className="rounded bg-cyan-100 px-3 py-1.5 text-sm font-medium text-cyan-700 hover:bg-cyan-200"
                  >
                    Visual Editor
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">
              {editingPrinter ? 'Edit Printer' : 'Add Printer'}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="Kitchen Printer"
                />
              </div>

              {/* Type & Role */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
                  <select
                    value={formData.printerType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        printerType: e.target.value as 'thermal' | 'impact',
                        supportsCut: e.target.value === 'thermal',
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="thermal">Thermal (TM-T88)</option>
                    <option value="impact">Impact (TM-U220)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                  <select
                    value={formData.printerRole}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        printerRole: e.target.value as 'receipt' | 'kitchen' | 'bar' | 'entertainment',
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="kitchen">Kitchen</option>
                    <option value="bar">Bar</option>
                    <option value="receipt">Receipt</option>
                    <option value="entertainment">Entertainment</option>
                  </select>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Model</label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  placeholder="TM-T88VII"
                />
              </div>

              {/* IP & Port */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">IP Address</label>
                  <input
                    type="text"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                    placeholder="192.168.1.100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Port</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Paper Width */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Paper Width</label>
                <select
                  value={formData.paperWidth}
                  onChange={(e) => setFormData({ ...formData, paperWidth: parseInt(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value={80}>80mm (Standard)</option>
                  <option value={58}>58mm (Narrow)</option>
                  <option value={40}>40mm (Kitchen)</option>
                </select>
              </div>

              {/* Checkboxes */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Default for role</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.supportsCut}
                    onChange={(e) => setFormData({ ...formData, supportsCut: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Supports paper cut</span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingPrinter ? 'Save Changes' : 'Add Printer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hardware/Printer Settings Modal */}
      {hardwareSettingsPrinter && (
        <PrinterSettingsEditor
          settings={hardwareSettingsPrinter.printSettings as PrinterSettings | null}
          printerType={hardwareSettingsPrinter.printerType}
          printerName={hardwareSettingsPrinter.name}
          onSave={handleSaveHardwareSettings}
          onClose={() => setHardwareSettingsPrinter(null)}
        />
      )}

      {/* Visual Receipt Editor Modal */}
      {visualEditorPrinter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl">
            <ReceiptVisualEditor
              templateType={getTemplateType(visualEditorPrinter.printerRole)}
              printerType={visualEditorPrinter.printerType}
              printerRole={visualEditorPrinter.printerRole}
              initialSettings={visualEditorPrinter.printSettings as unknown as VisualEditorSettings | undefined}
              globalSettings={globalReceiptSettings}
              onSave={handleSaveVisualEditorSettings}
              onCancel={() => setVisualEditorPrinter(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
