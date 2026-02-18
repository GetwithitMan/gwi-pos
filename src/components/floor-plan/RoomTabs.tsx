'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'

interface Room {
  id: string
  name: string
  color?: string
}

interface RoomTabsProps {
  rooms: Room[]
  selectedRoomId: string | null  // null = "All" view
  onRoomSelect: (roomId: string | null) => void
  tableCountByRoom?: Map<string, number>  // Optional count display
  showAddButton?: boolean  // Admin only
  onAddRoom?: () => void
  showAllTab?: boolean  // Whether to show the "All" tab (default: true)
  showSettingsButton?: boolean  // Whether to show settings gear button for room ordering (POS only)
  onOpenSettings?: () => void  // Callback for settings button
}

export const RoomTabs = memo(function RoomTabs({
  rooms,
  selectedRoomId,
  onRoomSelect,
  tableCountByRoom,
  showAddButton = false,
  onAddRoom,
  showAllTab = true,
  showSettingsButton = false,
  onOpenSettings,
}: RoomTabsProps) {
  // Calculate total tables
  const totalTables = tableCountByRoom
    ? Array.from(tableCountByRoom.values()).reduce((sum, count) => sum + count, 0)
    : undefined

  // If no rooms and showAllTab is false, show a helpful message
  if (rooms.length === 0 && !showAllTab) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          background: 'rgba(0, 0, 0, 0.2)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <span style={{ color: '#64748b', fontSize: '14px' }}>
          No rooms/sections created yet.
        </span>
        {showAddButton && (
          <button
            onClick={onAddRoom}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              border: 'none',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create First Section
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        background: 'rgba(0, 0, 0, 0.2)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        overflowX: 'auto',
        flexWrap: 'nowrap',
        minHeight: '48px',
        scrollbarWidth: 'none',
      }}
    >
      {/* Settings Button (POS only) */}
      {showSettingsButton && onOpenSettings && (
        <>
          <button
            onClick={onOpenSettings}
            style={{
              padding: '8px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            title="Reorder Rooms"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div
            style={{
              width: '1px',
              height: '24px',
              background: 'rgba(255, 255, 255, 0.15)',
              flexShrink: 0,
            }}
          />
        </>
      )}

      {/* All Rooms Tab - only show if showAllTab is true */}
      {showAllTab && (
        <>
          <RoomTab
            room={{ id: 'all', name: 'All' }}
            isSelected={selectedRoomId === null}
            onClick={() => onRoomSelect(null)}
            count={totalTables}
          />

          {/* Divider */}
          {rooms.length > 0 && (
            <div
              style={{
                width: '1px',
                height: '24px',
                background: 'rgba(255, 255, 255, 0.15)',
                flexShrink: 0,
              }}
            />
          )}
        </>
      )}

      {/* Individual Room Tabs */}
      {rooms.map((room) => (
        <RoomTab
          key={room.id}
          room={room}
          isSelected={selectedRoomId === room.id}
          onClick={() => onRoomSelect(room.id)}
          count={tableCountByRoom?.get(room.id)}
        />
      ))}

      {/* Add Room Button (Admin only) */}
      {showAddButton && (
        <>
          <div
            style={{
              width: '1px',
              height: '24px',
              background: 'rgba(255, 255, 255, 0.15)',
            }}
          />
          <button
            onClick={onAddRoom}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px dashed rgba(255, 255, 255, 0.2)',
              color: '#64748b',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Section
          </button>
        </>
      )}
    </div>
  )
})

interface RoomTabProps {
  room: Room
  isSelected: boolean
  onClick: () => void
  count?: number
}

const RoomTab = memo(function RoomTab({ room, isSelected, onClick, count }: RoomTabProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      style={{
        position: 'relative',
        padding: '8px 16px',
        borderRadius: '8px',
        background: isSelected
          ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(139, 92, 246, 0.3) 100%)'
          : 'rgba(255, 255, 255, 0.05)',
        border: isSelected
          ? '1px solid rgba(99, 102, 241, 0.5)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        color: isSelected ? '#a5b4fc' : '#94a3b8',
        fontSize: '13px',
        fontWeight: isSelected ? 600 : 400,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Color indicator */}
      {room.color && room.id !== 'all' && (
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: room.color,
            boxShadow: `0 0 6px ${room.color}`,
          }}
        />
      )}

      {room.name}

      {/* Table count badge */}
      {count !== undefined && (
        <span
          style={{
            padding: '2px 6px',
            borderRadius: '4px',
            background: isSelected ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
            fontSize: '11px',
            color: isSelected ? '#c7d2fe' : '#64748b',
          }}
        >
          {count}
        </span>
      )}

      {/* Selected indicator */}
      {isSelected && (
        <motion.div
          layoutId="roomTabIndicator"
          style={{
            position: 'absolute',
            bottom: '-1px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '24px',
            height: '2px',
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            borderRadius: '1px',
          }}
        />
      )}
    </motion.button>
  )
})
