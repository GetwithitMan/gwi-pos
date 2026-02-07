'use client'

import { useState, useEffect, useRef } from 'react'

interface NoteEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (note: string) => void
  currentNote?: string
  itemName?: string
}

export function NoteEditModal({ isOpen, onClose, onSave, currentNote, itemName }: NoteEditModalProps) {
  const [text, setText] = useState(currentNote || '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset text when modal opens with new note
  useEffect(() => {
    if (isOpen) {
      setText(currentNote || '')
      // Auto-focus after a small delay for animation
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen, currentNote])

  if (!isOpen) return null

  const handleSave = () => {
    onSave(text.trim())
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(15, 23, 42, 0.98)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          padding: '24px',
          width: '100%',
          maxWidth: '400px',
          margin: '20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          animation: 'noteModalIn 0.15s ease-out',
        }}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9', marginBottom: '4px' }}>
          Kitchen Note
        </h3>
        {itemName && (
          <p style={{ fontSize: '13px', color: '#a78bfa', marginBottom: '12px', fontWeight: 500 }}>
            {itemName}
          </p>
        )}
        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
          This note will be sent to the kitchen with the order.
        </p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., No onions, extra pickles, allergic to nuts..."
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '12px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '10px',
            color: '#e2e8f0',
            fontSize: '14px',
            resize: 'vertical',
            outline: 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
          }}
          onKeyDown={handleKeyDown}
        />
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
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
            style={{
              flex: 1,
              padding: '12px',
              background: '#f59e0b',
              border: 'none',
              borderRadius: '10px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Save Note
          </button>
        </div>
        <p style={{ fontSize: '11px', color: '#475569', marginTop: '12px', textAlign: 'center' }}>
          Press ⌘+Enter to save • Esc to cancel
        </p>
      </div>

      <style>{`
        @keyframes noteModalIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
