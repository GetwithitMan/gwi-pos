'use client'

import { useState, useCallback } from 'react'

const COMMON_ALLERGIES = ['Gluten', 'Dairy', 'Nuts', 'Shellfish', 'Soy', 'Egg']

interface SeatAllergyModalProps {
  seatNumber: number
  currentNotes: string
  position: { x: number; y: number }
  onSave: (seatNumber: number, notes: string) => void
  onClose: () => void
}

export function SeatAllergyModal({
  seatNumber,
  currentNotes,
  position,
  onSave,
  onClose,
}: SeatAllergyModalProps) {
  const [notes, setNotes] = useState(currentNotes)

  const toggleChip = useCallback((allergy: string) => {
    setNotes(prev => {
      const existing = prev.split(',').map(s => s.trim()).filter(Boolean)
      if (existing.includes(allergy)) {
        return existing.filter(a => a !== allergy).join(', ')
      }
      return [...existing, allergy].join(', ')
    })
  }, [])

  const activeAllergies = notes.split(',').map(s => s.trim()).filter(Boolean)

  // Clamp to viewport
  const left = Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 600) - 300)
  const top = Math.min(position.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 350)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0, 0, 0, 0.3)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left,
          top,
          zIndex: 9999,
          width: '280px',
          background: '#1e293b',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          padding: '16px',
          color: '#e2e8f0',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700 }}>
            Seat {seatNumber} — Allergies
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '18px' }}
          >
            x
          </button>
        </div>

        {/* Quick chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {COMMON_ALLERGIES.map(allergy => {
            const isActive = activeAllergies.includes(allergy)
            return (
              <button
                key={allergy}
                onClick={() => toggleChip(allergy)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  border: `1px solid ${isActive ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.3)'}`,
                  background: isActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(148, 163, 184, 0.08)',
                  color: isActive ? '#f87171' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {allergy}
              </button>
            )
          })}
        </div>

        {/* Text area */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Additional allergy notes..."
          style={{
            width: '100%',
            minHeight: '60px',
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '8px',
            padding: '8px',
            color: '#e2e8f0',
            fontSize: '12px',
            resize: 'vertical',
            outline: 'none',
          }}
        />

        {/* Save button */}
        <button
          onClick={() => {
            onSave(seatNumber, notes)
            onClose()
          }}
          style={{
            width: '100%',
            marginTop: '10px',
            padding: '8px',
            borderRadius: '8px',
            border: 'none',
            background: notes.trim() ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
            color: notes.trim() ? '#f87171' : '#60a5fa',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {notes.trim() ? 'Save Allergy Notes' : 'Clear & Close'}
        </button>
      </div>
    </div>
  )
}
