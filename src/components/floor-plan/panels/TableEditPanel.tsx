'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable, SeatPattern } from '../use-floor-plan'

interface Section {
  id: string
  name: string
  color: string
}

interface TableEditPanelProps {
  table: FloorPlanTable | null
  sections: Section[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (tableId: string, updates: Partial<FloorPlanTable>) => Promise<void>
  onDelete: (tableId: string) => Promise<void>
  onRegenerateSeats: (tableId: string, pattern: SeatPattern) => Promise<void>
  onAddSeat?: (tableId: string) => Promise<void>
  onDuplicate?: (tableId: string) => Promise<void>
  onRotate?: (tableId: string, deltaRotation: number) => Promise<void>
  existingTableNames?: string[]
}

const SEAT_PATTERNS: { value: SeatPattern; label: string; description: string }[] = [
  { value: 'all_around', label: 'All Around', description: 'Seats on all 4 sides' },
  { value: 'front_only', label: 'Front Only', description: 'Bar/counter style' },
  { value: 'three_sides', label: 'Three Sides', description: 'Against wall' },
  { value: 'two_sides', label: 'Two Sides', description: 'Corner booth' },
  { value: 'inside', label: 'Inside', description: 'Booth interior' },
]

const TABLE_SHAPES = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
  { value: 'booth', label: 'Booth' },
  { value: 'bar', label: 'Bar' },
]

export function TableEditPanel({
  table,
  sections,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  onRegenerateSeats,
  onAddSeat,
  onDuplicate,
  onRotate,
  existingTableNames = [],
}: TableEditPanelProps) {
  const [name, setName] = useState('')
  const [abbreviation, setAbbreviation] = useState('')
  const [capacity, setCapacity] = useState(4)
  const [shape, setShape] = useState<string>('rectangle')
  const [seatPattern, setSeatPattern] = useState<SeatPattern>('all_around')
  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(100)
  const [sectionId, setSectionId] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)

  // Check for duplicate name (case-insensitive, excluding current table)
  const isDuplicateName = name.trim() !== '' && existingTableNames.some(
    n => n.toLowerCase() === name.trim().toLowerCase() && n.toLowerCase() !== (table?.name || '').toLowerCase()
  )

  // Sync local state with table prop
  useEffect(() => {
    if (table) {
      setName(table.name)
      setAbbreviation(table.abbreviation || '')
      setCapacity(table.capacity)
      setShape(table.shape)
      setSeatPattern(table.seatPattern)
      setWidth(table.width)
      setHeight(table.height)
      setSectionId(table.section?.id || '')
    }
  }, [table])

  const handleSave = async () => {
    if (!table) return
    setIsSaving(true)
    try {
      await onUpdate(table.id, {
        name,
        abbreviation: abbreviation || null,
        capacity,
        shape: shape as FloorPlanTable['shape'],
        seatPattern,
        width,
        height,
        section: sectionId ? sections.find(s => s.id === sectionId) || null : null,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRegenerateSeats = async () => {
    if (!table) return
    setIsRegenerating(true)
    try {
      await onRegenerateSeats(table.id, seatPattern)
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleDelete = async () => {
    if (!table) return
    if (!confirm(`Delete ${table.name}? This cannot be undone.`)) return
    await onDelete(table.id)
    onClose()
  }

  const seatCount = table?.seats?.length || 0

  return (
    <AnimatePresence>
      {isOpen && table && (
        <motion.div
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed right-0 top-0 bottom-0 w-96 z-50"
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9' }}>
              Edit Table
            </h2>
            <button
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '20px', overflowY: 'auto', height: 'calc(100% - 140px)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Name and Abbreviation */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                    Table Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: isDuplicateName ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#f1f5f9',
                      fontSize: '14px',
                    }}
                  />
                  {isDuplicateName && (
                    <div style={{ fontSize: '11px', color: '#f87171', marginTop: '4px' }}>
                      Name already in use
                    </div>
                  )}
                </div>
                <div style={{ width: '80px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                    Abbrev.
                  </label>
                  <input
                    type="text"
                    value={abbreviation}
                    onChange={(e) => setAbbreviation(e.target.value.slice(0, 4))}
                    placeholder="T1"
                    maxLength={4}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#f1f5f9',
                      fontSize: '14px',
                      textAlign: 'center',
                    }}
                    title="Short name shown on floor plan (e.g., T1, B2, PA)"
                  />
                </div>
              </div>

              {/* Capacity */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  Capacity (# of seats)
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={capacity}
                  onChange={(e) => setCapacity(parseInt(e.target.value) || 1)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f1f5f9',
                    fontSize: '14px',
                  }}
                />
              </div>

              {/* Shape */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  Shape
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {TABLE_SHAPES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setShape(s.value)}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: shape === s.value ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        border: shape === s.value ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                        color: shape === s.value ? '#818cf8' : '#94a3b8',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  Section
                </label>
                <select
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f1f5f9',
                    fontSize: '14px',
                  }}
                >
                  <option value="">No Section</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dimensions */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                  Dimensions
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                      Width
                    </label>
                    <input
                      type="number"
                      min={40}
                      max={300}
                      value={width}
                      onChange={(e) => setWidth(parseInt(e.target.value) || 40)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f1f5f9',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                      Height
                    </label>
                    <input
                      type="number"
                      min={40}
                      max={300}
                      value={height}
                      onChange={(e) => setHeight(parseInt(e.target.value) || 40)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f1f5f9',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Rotation */}
              {onRotate && table && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
                    Rotation
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#64748b' }}>
                      ({table.rotation || 0}°)
                    </span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <button
                      onClick={() => onRotate(table.id, -90)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#94a3b8',
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Rotate 90° counter-clockwise"
                    >
                      ↺ 90°
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={table.rotation || 0}
                      onChange={(e) => {
                        const newRotation = parseInt(e.target.value) || 0
                        const currentRotation = table.rotation || 0
                        onRotate(table.id, newRotation - currentRotation)
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f1f5f9',
                        fontSize: '13px',
                        textAlign: 'center',
                      }}
                    />
                    <button
                      onClick={() => onRotate(table.id, 90)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#94a3b8',
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Rotate 90° clockwise"
                    >
                      ↻ 90°
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={table.rotation || 0}
                    onChange={(e) => {
                      const newRotation = parseInt(e.target.value) || 0
                      const currentRotation = table.rotation || 0
                      onRotate(table.id, newRotation - currentRotation)
                    }}
                    style={{
                      width: '100%',
                      height: '6px',
                      borderRadius: '3px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      cursor: 'pointer',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>0°</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>R = 90° • Shift+R = 15°</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>359°</span>
                  </div>
                </div>
              )}

              {/* Seat Pattern */}
              <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <label style={{ fontSize: '13px', color: '#94a3b8' }}>
                    Seat Pattern
                  </label>
                  <span
                    style={{
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: seatCount === capacity ? 'rgba(34, 197, 94, 0.2)' : seatCount === 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)',
                      color: seatCount === capacity ? '#22c55e' : seatCount === 0 ? '#ef4444' : '#fbbf24',
                    }}
                  >
                    {seatCount}/{capacity} seats
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {SEAT_PATTERNS.map((pattern) => (
                    <button
                      key={pattern.value}
                      onClick={() => setSeatPattern(pattern.value)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: seatPattern === pattern.value ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        border: seatPattern === pattern.value ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: '13px', color: seatPattern === pattern.value ? '#a5b4fc' : '#e2e8f0', fontWeight: 500 }}>
                        {pattern.label}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        {pattern.description}
                      </div>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={handleRegenerateSeats}
                    disabled={isRegenerating}
                    style={{
                      flex: 1,
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'rgba(99, 102, 241, 0.2)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#a5b4fc',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: isRegenerating ? 'not-allowed' : 'pointer',
                      opacity: isRegenerating ? 0.6 : 1,
                    }}
                  >
                    {isRegenerating ? 'Generating...' : `Generate ${capacity}`}
                  </button>
                  {onAddSeat && table && (
                    <button
                      onClick={() => onAddSeat(table.id)}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        color: '#4ade80',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title="Add a new seat to this table"
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Seat
                    </button>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Duplicate */}
                {onDuplicate && table && (
                  <button
                    onClick={() => onDuplicate(table.id)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'rgba(99, 102, 241, 0.1)',
                      border: '1px solid rgba(99, 102, 241, 0.2)',
                      color: '#a5b4fc',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                    title="Duplicate table (Ctrl+D)"
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Duplicate Table
                  </button>
                )}

                {/* Delete */}
                <button
                  onClick={handleDelete}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Delete Table
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '16px 20px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(15, 23, 42, 0.95)',
              display: 'flex',
              gap: '12px',
            }}
          >
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isDuplicateName}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                background: isDuplicateName ? 'rgba(100, 100, 100, 0.3)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: (isSaving || isDuplicateName) ? 'not-allowed' : 'pointer',
                opacity: (isSaving || isDuplicateName) ? 0.6 : 1,
              }}
            >
              {isSaving ? 'Saving...' : isDuplicateName ? 'Duplicate Name' : 'Save Changes'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
