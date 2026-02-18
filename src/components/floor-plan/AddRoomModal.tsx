'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'

interface AddRoomModalProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  onRoomCreated: (room: { id: string; name: string; color: string; sortOrder: number }) => void
}

const THEME_COLORS = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#84cc16', // Lime
]

export function AddRoomModal({ isOpen, onClose, locationId, onRoomCreated }: AddRoomModalProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please enter a room name')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, name: name.trim(), color }),
      })

      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        onRoomCreated(data.section)
        setName('')
        setColor('#6366f1')
        onClose()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create room')
      }
    } catch (err) {
      setError('Network error - please try again')
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Floor Plan Area" size="sm" variant="default">
              <div className="space-y-5">
                {/* Room Name */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Room Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. Back Patio, Bar Area, VIP Lounge..."
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-600"
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  />
                </div>

                {/* Theme Color */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Theme Color
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {THEME_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className="relative w-9 h-9 rounded-full transition-all"
                        style={{
                          backgroundColor: c,
                          transform: color === c ? 'scale(1.15)' : 'scale(1)',
                          boxShadow: color === c ? `0 0 20px ${c}80` : 'none',
                        }}
                      >
                        {color === c && (
                          <div
                            className="absolute inset-0 flex items-center justify-center"
                          >
                            <svg width="16" height="16" fill="none" stroke="white" viewBox="0 0 24 24" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !name.trim()}
                  className="w-full py-3.5 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                  }}
                >
                  {isCreating ? 'Creating...' : 'Create Room'}
                </button>
              </div>
    </Modal>
  )
}
