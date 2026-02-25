'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrashIcon,
  ArrowPathIcon,
  UserPlusIcon,
  UserMinusIcon,
  DocumentDuplicateIcon,
  XMarkIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import { FloorPlanTable, FloorPlanSection } from './use-floor-plan'

interface PropertiesSidebarProps {
  table: FloorPlanTable | null
  sections: FloorPlanSection[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (tableId: string, updates: Partial<FloorPlanTable>) => void
  onDelete: (tableId: string) => void
  onDuplicate: (tableId: string) => void
  onAddSeat: (tableId: string) => void
  onRemoveSeat: (tableId: string) => void
  onResetSeats?: (tableId: string) => void
  existingTableNames?: string[]
}

const SHAPES = [
  { value: 'rectangle', label: 'Rect' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Round' },
  { value: 'booth', label: 'Booth' },
  { value: 'bar', label: 'Bar' },
] as const

/**
 * PropertiesSidebar - Unified sidebar for table creation and editing
 *
 * Replaces modals with a persistent sidebar that:
 * - Slides in when a table is selected
 * - Shows live updates as you edit
 * - Handles both new and existing tables
 * - Provides manual seat building controls
 */
export function PropertiesSidebar({
  table,
  sections,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddSeat,
  onRemoveSeat,
  onResetSeats,
  existingTableNames = [],
}: PropertiesSidebarProps) {
  const [localName, setLocalName] = useState(table?.name || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear delete confirmation timeout on unmount
  useEffect(() => {
    return () => {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current)
    }
  }, [])

  // Check for duplicate name (case-insensitive, excluding current table)
  const isDuplicateName = localName.trim() !== '' && existingTableNames.some(
    n => n.toLowerCase() === localName.trim().toLowerCase() && n.toLowerCase() !== (table?.name || '').toLowerCase()
  )

  // Sync local name with table name
  useEffect(() => {
    if (table) {
      setLocalName(table.name)
    }
  }, [table?.id, table?.name])

  // Debounced name update — skip if duplicate
  useEffect(() => {
    if (!table || localName === table.name || isDuplicateName) return

    const timeout = setTimeout(() => {
      onUpdate(table.id, { name: localName })
    }, 300)

    return () => clearTimeout(timeout)
  }, [localName, table?.id, table?.name, onUpdate, isDuplicateName])

  const handleShapeChange = useCallback((shape: string) => {
    if (!table) return
    onUpdate(table.id, { shape: shape as FloorPlanTable['shape'] })
  }, [table, onUpdate])

  const handleRotate = useCallback((delta: number) => {
    if (!table) return
    const newRotation = ((table.rotation || 0) + delta + 360) % 360
    onUpdate(table.id, { rotation: newRotation })
  }, [table, onUpdate])

  const handleSectionChange = useCallback((sectionId: string) => {
    if (!table) return
    const section = sections.find(s => s.id === sectionId) || null
    onUpdate(table.id, { section })
  }, [table, sections, onUpdate])

  const handleDimensionChange = useCallback((dimension: 'width' | 'height', value: number) => {
    if (!table) return
    onUpdate(table.id, { [dimension]: Math.max(40, Math.min(300, value)) })
  }, [table, onUpdate])

  const handleDelete = useCallback(() => {
    if (!table) return
    if (confirmDelete) {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current)
      onDelete(table.id)
      onClose()
    } else {
      setConfirmDelete(true)
      deleteTimeoutRef.current = setTimeout(() => setConfirmDelete(false), 3000)
    }
  }, [table, confirmDelete, onDelete, onClose])

  return (
    <AnimatePresence>
      {isOpen && table && (
        <motion.aside
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed right-0 top-0 bottom-0 w-80 z-50 flex flex-col"
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-xs font-black uppercase tracking-widest text-indigo-400">
              Table Properties
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDuplicate(table.id)}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                title="Duplicate table"
              >
                <DocumentDuplicateIcon className="w-4 h-4 text-slate-400" />
              </button>
              <button
                onClick={handleDelete}
                className={`p-2 rounded-lg transition-colors ${
                  confirmDelete
                    ? 'bg-red-500/20 text-red-400'
                    : 'hover:bg-white/5 text-slate-400 hover:text-red-400'
                }`}
                title={confirmDelete ? 'Click again to confirm' : 'Delete table'}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <XMarkIcon className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Table Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Label
              </label>
              <input
                type="text"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder="Table 1, Booth A..."
                className="w-full px-3 py-2.5 rounded-lg text-sm text-slate-200 placeholder-slate-600"
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: isDuplicateName ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)',
                }}
              />
              {isDuplicateName && (
                <p className="text-[11px] text-red-400 mt-1">Name already in use</p>
              )}
            </div>

            {/* Section Assignment */}
            {sections.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Section
                </label>
                <select
                  value={table.section?.id || ''}
                  onChange={(e) => handleSectionChange(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-slate-200"
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <option value="">No Section</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Shape Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Shape
              </label>
              <div className="grid grid-cols-5 gap-2">
                {SHAPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleShapeChange(value)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all ${
                      table.shape === value
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                        : 'bg-black/20 border-white/5 text-slate-500 hover:bg-white/5 hover:text-slate-300'
                    }`}
                    style={{ border: '1px solid' }}
                  >
                    <span className="text-[10px] font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Dimensions */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Dimensions
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-600 uppercase">Width</span>
                  <input
                    type="number"
                    min={40}
                    max={300}
                    value={table.width}
                    onChange={(e) => handleDimensionChange('width', parseInt(e.target.value) || 80)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-slate-200"
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-600 uppercase">Height</span>
                  <input
                    type="number"
                    min={40}
                    max={300}
                    value={table.height}
                    onChange={(e) => handleDimensionChange('height', parseInt(e.target.value) || 80)}
                    className="w-full px-3 py-2 rounded-lg text-sm text-slate-200"
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Rotation */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Rotation
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRotate(-45)}
                  className="p-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 transition-colors"
                >
                  <ArrowPathIcon className="w-4 h-4 text-slate-400" />
                </button>
                <input
                  type="number"
                  value={table.rotation || 0}
                  onChange={(e) => onUpdate(table.id, { rotation: parseInt(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 rounded-lg text-sm text-slate-200 text-center"
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                />
                <span className="text-slate-500 text-sm">°</span>
                <button
                  onClick={() => handleRotate(45)}
                  className="p-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 transition-colors"
                >
                  <ArrowPathIcon className="w-4 h-4 text-slate-400 transform scale-x-[-1]" />
                </button>
              </div>
            </div>

            <hr className="border-white/10" />

            {/* Manual Seat Builder */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Manual Seating
                </label>
                <span className="text-xs font-bold text-indigo-400">
                  {table.seats?.length || table.capacity || 0} seats
                </span>
              </div>

              <div
                className="p-4 rounded-xl text-center space-y-4"
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div className="text-[10px] text-slate-500 space-y-1">
                  <p className="font-medium text-indigo-400">Drag seats to position them</p>
                  <p className="italic">Click to select • Arrow keys to fine-tune</p>
                  {(table.seats?.length || 0) > 8 && (
                    <p className="text-amber-400">Seats auto-scale when &gt;8</p>
                  )}
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  {/* Add Seat - Always enabled ("Pull Up a Chair") */}
                  <button
                    onClick={() => onAddSeat(table.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
                    style={{
                      background: 'rgba(34, 197, 94, 0.1)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: '#4ade80',
                    }}
                    title="Add a seat (smart placement)"
                  >
                    <UserPlusIcon className="w-4 h-4" />
                    + Seat
                  </button>
                  {/* Remove Seat - Disabled at 0 */}
                  <button
                    onClick={() => onRemoveSeat(table.id)}
                    disabled={(table.seats?.length || table.capacity || 0) === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                    }}
                  >
                    <UserMinusIcon className="w-4 h-4" />
                    Remove
                  </button>
                  {/* Reset Seats to Auto Layout */}
                  {onResetSeats && (table.seats?.length || 0) > 0 && (
                    <button
                      onClick={() => onResetSeats(table.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: 'rgba(99, 102, 241, 0.1)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        color: '#a5b4fc',
                      }}
                      title="Reset all seats to orbital positions"
                    >
                      <Squares2X2Icon className="w-3 h-3" />
                      Reset Layout
                    </button>
                  )}
                </div>
              </div>

              {/* Seat Preview Dots - Dynamic sizing */}
              {(table.seats?.length || table.capacity || 0) > 0 && (
                <div className="flex flex-wrap gap-2 justify-center p-3 rounded-lg bg-black/20">
                  {Array.from({ length: table.seats?.length || table.capacity || 0 }).map((_, i) => {
                    const seatCount = table.seats?.length || table.capacity || 0
                    // Dynamic seat size: shrink if >8 seats
                    const seatSize = seatCount > 12 ? 18 : seatCount > 8 ? 20 : 24
                    const fontSize = seatCount > 12 ? 7 : seatCount > 8 ? 8 : 9
                    return (
                      <div
                        key={i}
                        className="rounded-full flex items-center justify-center font-bold"
                        style={{
                          width: seatSize,
                          height: seatSize,
                          fontSize: `${fontSize}px`,
                          background: 'rgba(99, 102, 241, 0.2)',
                          border: '2px solid rgba(99, 102, 241, 0.5)',
                          color: '#a5b4fc',
                        }}
                      >
                        {i + 1}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Footer with keyboard shortcuts */}
          <div className="p-4 border-t border-white/10 space-y-2">
            <p className="text-[10px] text-slate-500 font-medium text-center">Keyboard Shortcuts</p>
            <div className="grid grid-cols-2 gap-1 text-[9px] text-slate-600">
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">←→↑↓</span>
                <span>Nudge 1px</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">⇧+←</span>
                <span>Nudge 10px</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">Esc</span>
                <span>Deselect</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">⌘⌫</span>
                <span>Delete</span>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
