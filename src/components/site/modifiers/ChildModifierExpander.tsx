'use client'

/**
 * ChildModifierExpander — Expands inline when a parent modifier is selected
 * to show a nested modifier group.
 *
 * Renders another ModifierGroupRenderer at depth+1.
 * Depth guard at 5 levels shows "Additional options available in-store" fallback.
 */

import { useRef, useEffect, useState } from 'react'
import { ModifierGroupRenderer } from './ModifierGroupRenderer'
import type { ModifierGroupData, SelectedModifier } from './modifier-types'

interface ChildModifierExpanderProps {
  childGroup: ModifierGroupData
  parentModifierId: string
  selections: Map<string, SelectedModifier[]>
  onSelectionChange: (groupId: string, selections: SelectedModifier[]) => void
  depth: number
}

const MAX_DEPTH = 5

export function ChildModifierExpander({
  childGroup,
  parentModifierId,
  selections,
  onSelectionChange,
  depth,
}: ChildModifierExpanderProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  const [isVisible, setIsVisible] = useState(false)

  // Animate in on mount
  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight)
    }
    // Small delay to trigger CSS transition
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  // Update height when selections change (content might grow/shrink)
  useEffect(() => {
    if (contentRef.current && isVisible) {
      setHeight(contentRef.current.scrollHeight)
    }
  }, [selections, isVisible])

  if (depth >= MAX_DEPTH) {
    return (
      <div
        className="mt-2 rounded-lg px-4 py-3 text-sm italic"
        style={{
          marginLeft: depth * 8,
          backgroundColor: 'var(--site-surface)',
          color: 'var(--site-text-muted)',
        }}
      >
        Additional options available in-store
      </div>
    )
  }

  return (
    <div
      className="overflow-hidden transition-all duration-200 ease-out"
      style={{
        maxHeight: isVisible ? (height === 'auto' ? 'none' : height) : 0,
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div
        ref={contentRef}
        className="mt-2 rounded-lg border-l-2 pl-3"
        style={{
          borderColor: 'var(--site-brand)',
          marginLeft: Math.min(depth * 4, 16),
        }}
      >
        <ModifierGroupRenderer
          group={childGroup}
          selections={selections}
          onSelectionChange={onSelectionChange}
          depth={depth + 1}
        />
      </div>
    </div>
  )
}
