'use client';

import React from 'react';

interface FixtureResizeHandlesProps {
  fixtureId: string;
  toolMode: string;
  isSelected: boolean;
  onResizeStart: (e: React.MouseEvent, fixtureId: string, handle: string) => void;
  color?: string;
  cornersOnly?: boolean;
}

const HANDLE_SIZE = 8;
const HANDLE_OFFSET = -4;

type HandleDef = {
  name: string;
  style: React.CSSProperties;
};

const CORNER_HANDLES: HandleDef[] = [
  { name: 'nw', style: { top: HANDLE_OFFSET, left: HANDLE_OFFSET, cursor: 'nw-resize' } },
  { name: 'ne', style: { top: HANDLE_OFFSET, right: HANDLE_OFFSET, cursor: 'ne-resize' } },
  { name: 'sw', style: { bottom: HANDLE_OFFSET, left: HANDLE_OFFSET, cursor: 'sw-resize' } },
  { name: 'se', style: { bottom: HANDLE_OFFSET, right: HANDLE_OFFSET, cursor: 'se-resize' } },
];

const EDGE_HANDLES: HandleDef[] = [
  { name: 'n', style: { top: HANDLE_OFFSET, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' } },
  { name: 's', style: { bottom: HANDLE_OFFSET, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' } },
  { name: 'e', style: { right: HANDLE_OFFSET, top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' } },
  { name: 'w', style: { left: HANDLE_OFFSET, top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' } },
];

export function FixtureResizeHandles({
  fixtureId,
  toolMode,
  isSelected,
  onResizeStart,
  color = '#3498db',
  cornersOnly = false,
}: FixtureResizeHandlesProps) {
  if (!isSelected || toolMode !== 'SELECT') return null;

  const handles = cornersOnly ? CORNER_HANDLES : [...CORNER_HANDLES, ...EDGE_HANDLES];

  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle.name}
          className={`resize-handle ${handle.name}`}
          onMouseDown={(e) => onResizeStart(e, fixtureId, handle.name)}
          style={{
            position: 'absolute',
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            background: 'white',
            border: `1px solid ${color}`,
            zIndex: 10,
            ...handle.style,
          }}
        />
      ))}
    </>
  );
}
