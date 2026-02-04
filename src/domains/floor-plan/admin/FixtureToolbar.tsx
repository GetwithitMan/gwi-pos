'use client';

/**
 * GWI POS - Floor Plan Domain
 * Fixture Toolbar Component
 *
 * Toolbar for selecting editor tools and fixture types.
 */

import React from 'react';
import type { EditorToolMode, FixtureType } from './types';
import { FIXTURE_TYPES } from './types';

// =============================================================================
// TYPES
// =============================================================================

interface FixtureToolbarProps {
  selectedTool: EditorToolMode;
  selectedFixtureType: FixtureType;
  onToolSelect: (tool: EditorToolMode) => void;
  onFixtureTypeSelect: (type: FixtureType) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FixtureToolbar({
  selectedTool,
  selectedFixtureType,
  onToolSelect,
  onFixtureTypeSelect,
}: FixtureToolbarProps) {
  const tools: { mode: EditorToolMode; label: string; icon: string }[] = [
    { mode: 'SELECT', label: 'Select', icon: '⇪' },
    { mode: 'WALL', label: 'Wall', icon: '▬' },
    { mode: 'RECTANGLE', label: 'Rectangle', icon: '▭' },
    { mode: 'CIRCLE', label: 'Circle', icon: '●' },
    { mode: 'DELETE', label: 'Delete', icon: '🗑' },
  ];

  // Debug logging for tool selection
  React.useEffect(() => {
    console.log('[FixtureToolbar] selectedTool:', selectedTool);
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
              <li>Click to select a fixture</li>
              <li>Drag to move it</li>
              <li>Press Delete to remove</li>
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
