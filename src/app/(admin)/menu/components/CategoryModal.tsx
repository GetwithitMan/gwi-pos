'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { CATEGORY_TYPES } from '../types'
import type { Category, Printer, KDSScreen, PrintDestination } from '../types'

interface CategoryModalProps {
  category: Category | null
  printers: Printer[]
  kdsScreens: KDSScreen[]
  onSave: (data: Partial<Category>) => void
  onClose: () => void
}

export function CategoryModal({
  category,
  printers,
  kdsScreens,
  onSave,
  onClose,
}: CategoryModalProps) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#3b82f6')
  const [categoryType, setCategoryType] = useState(category?.categoryType || 'food')
  const [printerIds, setPrinterIds] = useState<string[]>(category?.printerIds || [])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Combine printers and KDS screens into destinations
  const printDestinations: PrintDestination[] = [
    ...printers.filter(p => p.isActive).map(p => ({
      id: p.id,
      name: p.name,
      type: 'printer' as const,
      role: p.printerRole,
      isActive: p.isActive
    })),
    ...kdsScreens.filter(k => k.isActive).map(k => ({
      id: k.id,
      name: k.name,
      type: 'kds' as const,
      role: k.screenType,
      isActive: k.isActive
    }))
  ]

  const selectedDestinations = printDestinations.filter(d => printerIds.includes(d.id))

  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'
  ]

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={category ? 'Edit Category' : 'New Category'}
      size="md"
    >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Appetizers"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Category Type</label>
            <div className="space-y-2">
              {CATEGORY_TYPES.map(type => (
                <label
                  key={type.value}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border-2 transition-all ${
                    categoryType === type.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="categoryType"
                    value={type.value}
                    checked={categoryType === type.value}
                    onChange={(e) => setCategoryType(e.target.value)}
                    className="w-4 h-4"
                  />
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: type.color }}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{type.label}</p>
                    <p className="text-xs text-gray-500">{type.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Print Destinations - Multiple (Dropdown with checkboxes) */}
          {printDestinations.length > 0 && (
            <div className="relative">
              <label className="block text-sm font-medium mb-2">Default Print Destinations</label>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full px-3 py-2 border rounded-lg text-left flex items-center justify-between bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span className={selectedDestinations.length === 0 ? 'text-gray-500' : ''}>
                  {selectedDestinations.length === 0
                    ? 'Select destinations...'
                    : selectedDestinations.map(d => d.name).join(', ')}
                </span>
                <span className="text-gray-400">{isDropdownOpen ? '▲' : '▼'}</span>
              </button>

              {isDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                  {printDestinations.length === 0 ? (
                    <div className="px-3 py-2 text-gray-500 text-sm">No destinations available</div>
                  ) : (
                    <>
                      {printers.filter(p => p.isActive).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                          Printers
                        </div>
                      )}
                      {printers.filter(p => p.isActive).map(printer => (
                        <label
                          key={printer.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={printerIds.includes(printer.id)}
                            onChange={() => {
                              setPrinterIds(prev =>
                                prev.includes(printer.id)
                                  ? prev.filter(id => id !== printer.id)
                                  : [...prev, printer.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="flex-1">{printer.name}</span>
                          <span className="text-xs text-gray-400">{printer.printerRole}</span>
                        </label>
                      ))}
                      {kdsScreens.filter(k => k.isActive).length > 0 && (
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-t">
                          KDS Screens
                        </div>
                      )}
                      {kdsScreens.filter(k => k.isActive).map(screen => (
                        <label
                          key={screen.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={printerIds.includes(screen.id)}
                            onChange={() => {
                              setPrinterIds(prev =>
                                prev.includes(screen.id)
                                  ? prev.filter(id => id !== screen.id)
                                  : [...prev, screen.id]
                              )
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="flex-1">{screen.name}</span>
                          <span className="text-xs text-gray-400">{screen.screenType}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {printerIds.length === 0
                  ? 'Using system default'
                  : `Sending to ${printerIds.length} destination(s)`}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`w-10 h-10 rounded-lg ${color === c ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!name.trim()}
              onClick={() => onSave({ name, color, categoryType, printerIds: printerIds.length > 0 ? printerIds : null })}
            >
              {category ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </div>
    </Modal>
  )
}
