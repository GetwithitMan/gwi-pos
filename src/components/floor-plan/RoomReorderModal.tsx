'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'

interface Room {
  id: string
  name: string
  color?: string
}

interface RoomReorderModalProps {
  isOpen: boolean
  onClose: () => void
  rooms: Room[]
  currentOrder: string[] // Current preferred order (room IDs)
  onSave: (orderedRoomIds: string[]) => void
}

export function RoomReorderModal({
  isOpen,
  onClose,
  rooms,
  currentOrder,
  onSave,
}: RoomReorderModalProps) {
  const [orderedRooms, setOrderedRooms] = useState<Room[]>([])

  // Initialize order when modal opens
  useEffect(() => {
    if (isOpen) {
      // Sort rooms based on currentOrder preference
      const sorted = [...rooms].sort((a, b) => {
        const aIndex = currentOrder.indexOf(a.id)
        const bIndex = currentOrder.indexOf(b.id)

        // Rooms in preferred order come first, in that order
        // Rooms not in preferred order come after, in original order
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
        if (aIndex >= 0) return -1
        if (bIndex >= 0) return 1
        return 0
      })
      setOrderedRooms(sorted)
    }
  }, [isOpen, rooms, currentOrder])

  const handleSave = () => {
    onSave(orderedRooms.map(r => r.id))
    onClose()
  }

  const handleReset = () => {
    // Reset to original room order (by name or creation order)
    setOrderedRooms([...rooms])
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '400px',
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#f1f5f9' }}>
                  Reorder Rooms
                </h2>
                <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  Drag to set your preferred room order
                </p>
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Room List */}
            <div style={{ padding: '16px 24px', maxHeight: '400px', overflowY: 'auto' }}>
              {orderedRooms.length === 0 ? (
                <p style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>
                  No rooms to reorder
                </p>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={orderedRooms}
                  onReorder={setOrderedRooms}
                  style={{ listStyle: 'none', margin: 0, padding: 0 }}
                >
                  {orderedRooms.map((room, index) => (
                    <Reorder.Item
                      key={room.id}
                      value={room}
                      style={{
                        marginBottom: '8px',
                        cursor: 'grab',
                      }}
                    >
                      <motion.div
                        whileDrag={{ scale: 1.02, boxShadow: '0 8px 20px rgba(0,0,0,0.3)' }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 16px',
                          borderRadius: '10px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        {/* Drag Handle */}
                        <div style={{ color: '#64748b', flexShrink: 0 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="2" />
                            <circle cx="15" cy="6" r="2" />
                            <circle cx="9" cy="12" r="2" />
                            <circle cx="15" cy="12" r="2" />
                            <circle cx="9" cy="18" r="2" />
                            <circle cx="15" cy="18" r="2" />
                          </svg>
                        </div>

                        {/* Order Number */}
                        <span
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            background: 'rgba(99, 102, 241, 0.2)',
                            color: '#a5b4fc',
                            fontSize: '12px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {index + 1}
                        </span>

                        {/* Color Indicator */}
                        {room.color && (
                          <div
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              background: room.color,
                              boxShadow: `0 0 8px ${room.color}`,
                              flexShrink: 0,
                            }}
                          />
                        )}

                        {/* Room Name */}
                        <span
                          style={{
                            flex: 1,
                            fontSize: '14px',
                            fontWeight: 500,
                            color: '#e2e8f0',
                          }}
                        >
                          {room.name}
                        </span>
                      </motion.div>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                gap: '12px',
                justifyContent: 'space-between',
              }}
            >
              <button
                onClick={handleReset}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Reset Order
              </button>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={onClose}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    border: 'none',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Save Order
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
