'use client'

import React from 'react'
import { EntertainmentVisual, ENTERTAINMENT_VISUAL_OPTIONS, type EntertainmentVisualType } from '@/components/floor-plan/entertainment-visuals'

interface EntertainmentPropertiesProps {
  element: {
    id: string
    name: string
    visualType: string
    linkedMenuItemId?: string
    linkedMenuItem?: { name: string; price: number; blockTimeMinutes?: number }
    width: number
    height: number
    rotation: number
    status?: string
  }
  onUpdate: (updates: Partial<{ visualType: string; width: number; height: number; rotation: number }>) => void
  onDelete: () => void
}

export function EntertainmentProperties({ element, onUpdate, onDelete }: EntertainmentPropertiesProps) {
  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        🎮 Entertainment Properties
      </h3>

      {/* Preview */}
      <div className="flex justify-center p-4 bg-slate-800 rounded-lg">
        <div style={{ width: 100, height: 60 }}>
          <EntertainmentVisual
            visualType={element.visualType as EntertainmentVisualType}
            status={(element.status as 'available' | 'in_use' | 'reserved' | 'maintenance') || 'available'}
            width={100}
            height={60}
          />
        </div>
      </div>

      {/* Name (read-only) */}
      <div>
        <label className="block text-sm text-slate-400 mb-1">Name</label>
        <div className="px-3 py-2 bg-slate-800 rounded text-white">{element.name}</div>
      </div>

      {/* Linked Menu Item */}
      {element.linkedMenuItem && (
        <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
          <div className="text-xs text-slate-400">Linked Menu Item</div>
          <div className="text-white font-medium">{element.linkedMenuItem.name}</div>
          <div className="text-green-400">${Number(element.linkedMenuItem.price ?? 0).toFixed(2)}</div>
          {element.linkedMenuItem.blockTimeMinutes && (
            <div className="text-slate-300 text-sm">{element.linkedMenuItem.blockTimeMinutes} min block</div>
          )}
        </div>
      )}

      {/* Visual Type Grid */}
      <div>
        <label className="block text-sm text-slate-400 mb-2">Visual Style</label>
        <div className="grid grid-cols-4 gap-2">
          {ENTERTAINMENT_VISUAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ visualType: opt.value })}
              className={`p-2 rounded-lg border-2 transition-colors ${
                element.visualType === opt.value
                  ? 'border-purple-500 bg-purple-500/20'
                  : 'border-slate-700 hover:border-slate-500'
              }`}
              title={opt.label}
            >
              <EntertainmentVisual visualType={opt.value} status="available" width={40} height={32} />
            </button>
          ))}
        </div>
      </div>

      {/* Dimensions */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Width</label>
          <input
            type="number"
            value={element.width}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Height</label>
          <input
            type="number"
            value={element.height}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
          />
        </div>
      </div>

      {/* Rotation */}
      <div>
        <label className="block text-sm text-slate-400 mb-1">Rotation: {element.rotation}°</label>
        <input
          type="range"
          min="0"
          max="360"
          step="15"
          value={element.rotation}
          onChange={(e) => onUpdate({ rotation: Number(e.target.value) })}
          className="w-full"
        />
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
      >
        Remove from Floor Plan
      </button>
      <p className="text-xs text-slate-500 text-center">Removes from floor plan only. Menu item remains.</p>
    </div>
  )
}
