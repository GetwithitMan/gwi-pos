'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'

interface Room {
  id: string
  name: string
  color: string
  sortOrder?: number
}

interface SectionSettingsProps {
  isOpen: boolean
  onClose: () => void
  rooms: Room[]
  onReorder: (rooms: Room[]) => void
  onDelete: (roomId: string) => Promise<void>
  onRoomEdit?: (roomId: string, updates: { name?: string; color?: string }) => void
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

export function SectionSettings({
  isOpen,
  onClose,
  rooms,
  onReorder,
  onDelete,
  onRoomEdit,
}: SectionSettingsProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleReorder = useCallback((newOrder: Room[]) => {
    onReorder(newOrder)
  }, [onReorder])

  const handleDelete = useCallback(async (roomId: string) => {
    if (rooms.length <= 1) return // Prevent deleting last room

    if (confirmDeleteId !== roomId) {
      setConfirmDeleteId(roomId)
      setTimeout(() => setConfirmDeleteId(null), 3000)
      return
    }

    setDeletingId(roomId)
    try {
      await onDelete(roomId)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }, [rooms.length, confirmDeleteId, onDelete])

  const handleStartEdit = (room: Room) => {
    setEditingId(room.id)
    setEditName(room.name)
  }

  const handleSaveEdit = async (roomId: string) => {
    if (onRoomEdit && editName.trim()) {
      onRoomEdit(roomId, { name: editName.trim() })
    }
    setEditingId(null)
  }

  const handleColorChange = (roomId: string, color: string) => {
    if (onRoomEdit) {
      onRoomEdit(roomId, { color })
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-40"
          />

          {/* Panel */}
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
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/20">
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-indigo-400">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest text-white">
                  Manage Areas
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-slate-400">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Instructions */}
            <div className="px-5 py-3 border-b border-white/5">
              <p className="text-[10px] text-slate-500 italic font-bold uppercase tracking-tight">
                Drag to reorder tabs in POS view
              </p>
            </div>

            {/* Room List */}
            <div className="flex-1 overflow-y-auto p-4">
              <Reorder.Group axis="y" values={rooms} onReorder={handleReorder} className="space-y-3">
                {rooms.map((room) => (
                  <Reorder.Item
                    key={room.id}
                    value={room}
                    className="group"
                  >
                    <motion.div
                      layout
                      className="rounded-xl border transition-colors"
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderColor: editingId === room.id ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      <div className="flex items-center gap-3 p-3">
                        {/* Drag Handle */}
                        <div className="cursor-grab active:cursor-grabbing p-1">
                          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" className="text-slate-600">
                            <circle cx="9" cy="6" r="1.5" />
                            <circle cx="15" cy="6" r="1.5" />
                            <circle cx="9" cy="12" r="1.5" />
                            <circle cx="15" cy="12" r="1.5" />
                            <circle cx="9" cy="18" r="1.5" />
                            <circle cx="15" cy="18" r="1.5" />
                          </svg>
                        </div>

                        {/* Color Indicator */}
                        <button
                          onClick={() => {
                            const currentIndex = THEME_COLORS.indexOf(room.color || '#6366f1')
                            const nextIndex = (currentIndex + 1) % THEME_COLORS.length
                            handleColorChange(room.id, THEME_COLORS[nextIndex])
                          }}
                          className="w-4 h-4 rounded-full flex-shrink-0 transition-transform hover:scale-125"
                          style={{
                            backgroundColor: room.color || '#6366f1',
                            boxShadow: `0 0 10px ${room.color || '#6366f1'}60`,
                          }}
                          title="Click to change color"
                        />

                        {/* Name (editable) */}
                        {editingId === room.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => handleSaveEdit(room.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(room.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            autoFocus
                            className="flex-1 bg-transparent text-sm text-white outline-none border-b border-indigo-500/50"
                          />
                        ) : (
                          <span
                            className="flex-1 text-sm font-medium text-slate-200 cursor-pointer hover:text-white"
                            onClick={() => handleStartEdit(room)}
                            title="Click to rename"
                          >
                            {room.name}
                          </span>
                        )}

                        {/* Delete Button */}
                        <button
                          onClick={() => handleDelete(room.id)}
                          disabled={rooms.length <= 1 || deletingId === room.id}
                          className={`p-1.5 rounded-lg transition-all ${
                            confirmDeleteId === room.id
                              ? 'bg-red-500/20 text-red-400'
                              : 'opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-slate-500 hover:text-red-400'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                          title={
                            rooms.length <= 1
                              ? 'Cannot delete last room'
                              : confirmDeleteId === room.id
                                ? 'Click again to confirm'
                                : 'Delete room'
                          }
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </motion.div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>

              {rooms.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-slate-500 text-sm">No rooms created yet</p>
                </div>
              )}
            </div>

            {/* Footer Warning */}
            <div className="p-4 border-t border-white/10">
              <p className="text-[9px] text-slate-600 leading-relaxed uppercase font-bold tracking-tight">
                Note: Deleting an area will move its tables to &quot;No Section&quot; instead of deleting them.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
