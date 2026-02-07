'use client';

/**
 * GWI POS - Floor Plan Domain
 * Fixture Toolbar Component
 *
 * Toolbar for selecting editor tools and fixture types.
 */

import React from 'react';
import type { EditorToolMode, FixtureType, TableShape } from './types';
import { FIXTURE_TYPES, TABLE_SHAPES } from './types';
import { logger } from '@/lib/logger';

// =============================================================================
// TYPES
// =============================================================================

interface FixtureToolbarProps {
  selectedTool: EditorToolMode;
  selectedFixtureType: FixtureType;
  selectedTableShape?: TableShape;
  onToolSelect: (tool: EditorToolMode) => void;
  onFixtureTypeSelect: (type: FixtureType) => void;
  onTableShapeSelect?: (shape: TableShape) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FixtureToolbar({
  selectedTool,
  selectedFixtureType,
  selectedTableShape = 'rectangle',
  onToolSelect,
  onFixtureTypeSelect,
  onTableShapeSelect,
}: FixtureToolbarProps) {
  const tools: { mode: EditorToolMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'SELECT', label: 'Select', icon: '⇪' },
    {
      mode: 'TABLE',
      label: 'Table',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="8" width="18" height="3" rx="1" />
          <rect x="5" y="11" width="2" height="8" />
          <rect x="17" y="11" width="2" height="8" />
        </svg>
      )
    },
    { mode: 'WALL', label: 'Wall', icon: '▬' },
    { mode: 'RECTANGLE', label: 'Fixture', icon: '▭' },
    { mode: 'CIRCLE', label: 'Circle', icon: '●' },
    { mode: 'DELETE', label: 'Delete', icon: '🗑' },
  ];

  // Debug logging for tool selection
  React.useEffect(() => {
    logger.log('[FixtureToolbar] selectedTool:', selectedTool);
  }, [selectedTool]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tool Mode Selector */}
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>
          Tool Mode
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {tools.map((tool) => (
            <button
              key={tool.mode}
              onClick={() => onToolSelect(tool.mode)}
              style={{
                padding: '8px 4px',
                border: selectedTool === tool.mode ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: selectedTool === tool.mode ? '#e3f2fd' : 'white',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: selectedTool === tool.mode ? 600 : 400,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 18 }}>{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table Shape Selector (shown for TABLE mode) */}
      {selectedTool === 'TABLE' && onTableShapeSelect && (
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>
            Table Shape
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {TABLE_SHAPES.map((tableShape) => (
              <button
                key={tableShape.shape}
                onClick={() => onTableShapeSelect(tableShape.shape)}
                style={{
                  padding: '6px 8px',
                  border: selectedTableShape === tableShape.shape ? '2px solid #3498db' : '1px solid #ccc',
                  backgroundColor: selectedTableShape === tableShape.shape ? '#e3f2fd' : 'white',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: selectedTableShape === tableShape.shape ? 600 : 400,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 16 }}>{tableShape.icon}</span>
                <span>{tableShape.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fixture Type Selector (shown for RECTANGLE and CIRCLE modes) */}
      {(selectedTool === 'RECTANGLE' || selectedTool === 'CIRCLE') && (
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>
            Fixture Type
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {FIXTURE_TYPES.filter((ft) => {
              // Only show rectangle types for RECTANGLE tool
              if (selectedTool === 'RECTANGLE') {
                return !['pillar'].includes(ft.type);
              }
              // Only show circle types for CIRCLE tool
              if (selectedTool === 'CIRCLE') {
                return ['pillar'].includes(ft.type);
              }
              return true;
            }).map((fixtureType) => (
              <button
                key={fixtureType.type}
                onClick={() => onFixtureTypeSelect(fixtureType.type)}
                style={{
                  padding: '6px 8px',
                  border: selectedFixtureType === fixtureType.type ? '2px solid #3498db' : '1px solid #ccc',
                  backgroundColor: selectedFixtureType === fixtureType.type ? '#e3f2fd' : 'white',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: selectedFixtureType === fixtureType.type ? 600 : 400,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 16,
                    height: 16,
                    backgroundColor: fixtureType.defaultColor,
                    borderRadius: fixtureType.type === 'pillar' ? '50%' : 2,
                  }}
                />
                <span>{fixtureType.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hints */}
      <div
        style={{
          padding: 8,
          backgroundColor: '#f5f5f5',
          borderRadius: 4,
          fontSize: 11,
          color: '#666',
        }}
      >
        <strong>Hints:</strong>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: 16 }}>
          {selectedTool === 'SELECT' && (
            <>
              <li>Click to select fixture/table</li>
              <li>Drag to move it</li>
              <li>Press Delete to remove</li>
            </>
          )}
          {selectedTool === 'TABLE' && (
            <>
              <li>Choose shape, then click to place</li>
              <li>Seats auto-generated</li>
              <li>Edit properties on right</li>
            </>
          )}
          {selectedTool === 'WALL' && (
            <>
              <li>Click for start point</li>
              <li>Click again for end point</li>
            </>
          )}
          {selectedTool === 'RECTANGLE' && (
            <>
              <li>Click and drag to draw</li>
              <li>Release to create</li>
            </>
          )}
          {selectedTool === 'CIRCLE' && (
            <>
              <li>Click to place circle</li>
              <li>Default radius: 1 foot</li>
            </>
          )}
          {selectedTool === 'DELETE' && (
            <>
              <li>Click a fixture to delete it</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

export default FixtureToolbar;
