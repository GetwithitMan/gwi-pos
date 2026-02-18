'use client';

/**
 * GWI POS - Floor Plan Domain
 * Fixture Properties Panel
 *
 * Panel for editing selected fixture properties.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Fixture } from '../shared/types';
import { FloorCanvasAPI } from '../canvas';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FIXTURE_TYPES, getFixtureTypeMetadata } from './types';

// =============================================================================
// TYPES
// =============================================================================

interface FixturePropertiesProps {
  fixtureId: string | null;
  onUpdate: (fixtureId: string, updates: Partial<Fixture>) => void;
  onDelete: (fixtureId: string) => void;
  // Database mode props
  useDatabase?: boolean;
  dbFixtures?: Fixture[];
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FixtureProperties({
  fixtureId,
  onUpdate,
  onDelete,
  useDatabase = false,
  dbFixtures,
}: FixturePropertiesProps) {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [label, setLabel] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [color, setColor] = useState('#424242');
  const [thickness, setThickness] = useState(0.5);
  const [opacity, setOpacity] = useState(1);
  const rotationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load fixture data when selection changes
  useEffect(() => {
    if (!fixtureId) {
      setFixture(null);
      return;
    }

    let foundFixture: Fixture | null = null;

    if (useDatabase && dbFixtures) {
      // Database mode: find from props
      foundFixture = dbFixtures.find((f) => f.id === fixtureId) || null;
    } else {
      // In-memory mode: find from API
      const allRooms = FloorCanvasAPI.getAllRooms();
      for (const room of allRooms) {
        const fixtures = FloorCanvasAPI.getFixtures(room.id);
        foundFixture = fixtures.find((f) => f.id === fixtureId) || null;
        if (foundFixture) break;
      }
    }

    if (foundFixture) {
      setFixture(foundFixture);
      setLabel(foundFixture.label);
      setColor(foundFixture.color);
      setThickness(foundFixture.thickness);
      setOpacity(foundFixture.opacity);
    }
  }, [fixtureId, useDatabase, dbFixtures]);

  // Keep fixture state fresh with fast polling (for slider thumb to move) - in-memory mode only
  useEffect(() => {
    if (!fixtureId) return;
    if (useDatabase) return; // Database mode uses dbFixtures prop

    const intervalId = setInterval(() => {
      const allRooms = FloorCanvasAPI.getAllRooms();
      let foundFixture: Fixture | null = null;

      for (const room of allRooms) {
        const fixtures = FloorCanvasAPI.getFixtures(room.id);
        foundFixture = fixtures.find((f) => f.id === fixtureId) || null;
        if (foundFixture) break;
      }

      if (foundFixture) {
        setFixture(foundFixture);
      }
    }, 50); // Fast polling to keep slider thumb position updated

    return () => clearInterval(intervalId);
  }, [fixtureId, useDatabase]);

  // Handle property updates
  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (fixtureId) {
      onUpdate(fixtureId, { label: value });
    }
  };

  const handleColorChange = (value: string) => {
    setColor(value);
    if (fixtureId) {
      onUpdate(fixtureId, { color: value });
    }
  };

  const handleThicknessChange = (value: number) => {
    setThickness(value);
    if (fixtureId) {
      onUpdate(fixtureId, { thickness: value });
    }
  };

  const handleOpacityChange = (value: number) => {
    setOpacity(value);
    if (fixtureId) {
      onUpdate(fixtureId, { opacity: value });
    }
  };

  const handleRotationChange = (value: number) => {
    if (fixtureId && fixture && fixture.geometry.type === 'rectangle') {
      onUpdate(fixtureId, {
        geometry: {
          ...fixture.geometry,
          rotation: value,
        },
      });
    }
  };

  const handleRadiusChange = (value: number) => {
    if (fixtureId && fixture && fixture.geometry.type === 'circle') {
      onUpdate(fixtureId, {
        geometry: {
          ...fixture.geometry,
          radius: value,
        },
      });
    }
  };

  const handleTypeChange = (newType: string) => {
    if (fixtureId) {
      const metadata = getFixtureTypeMetadata(newType as any);
      onUpdate(fixtureId, {
        type: newType as any,
        label: metadata.label,
      });
    }
  };

  // Rotation adjustment functions - fetches current state to avoid stale closure
  const adjustRotation = useCallback((delta: number) => {
    if (!fixtureId || !fixture) return;

    let currentFixture: Fixture | null = null;

    if (useDatabase && dbFixtures) {
      // Database mode: find from props
      currentFixture = dbFixtures.find((f) => f.id === fixtureId) || null;
    } else {
      // In-memory mode: Get CURRENT rotation from the fixture (not from closure)
      const allRooms = FloorCanvasAPI.getAllRooms();
      for (const room of allRooms) {
        const fixtures = FloorCanvasAPI.getFixtures(room.id);
        currentFixture = fixtures.find((f) => f.id === fixtureId) || null;
        if (currentFixture) break;
      }
    }

    if (!currentFixture || currentFixture.geometry.type !== 'rectangle') return;

    const currentRotation = currentFixture.geometry.rotation || 0;
    let newRotation = currentRotation + delta;

    // Normalize to 0-360 range
    if (newRotation < 0) newRotation += 360;
    if (newRotation >= 360) newRotation -= 360;

    onUpdate(fixtureId, {
      geometry: { ...currentFixture.geometry, rotation: newRotation },
    });
  }, [fixtureId, fixture, onUpdate, useDatabase, dbFixtures]);

  const startContinuousRotation = useCallback((delta: number) => {
    // Fire immediately
    adjustRotation(delta);

    // Clear any existing interval
    if (rotationIntervalRef.current) {
      clearInterval(rotationIntervalRef.current);
    }

    // Start new interval for continuous rotation
    rotationIntervalRef.current = setInterval(() => {
      adjustRotation(delta);
    }, 50); // 50ms = 20 updates per second for smooth feel
  }, [adjustRotation]);

  const stopContinuousRotation = useCallback(() => {
    if (rotationIntervalRef.current) {
      clearInterval(rotationIntervalRef.current);
      rotationIntervalRef.current = null;
    }
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current);
      }
    };
  }, []);

  const handleDelete = () => {
    if (fixtureId) {
      setShowDeleteConfirm(true);
    }
  };

  if (!fixture) {
    return (
      <div
        style={{
          padding: 16,
          backgroundColor: '#f5f5f5',
          borderRadius: 8,
          height: '100%',
        }}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>
          Properties
        </h3>
        <p style={{ color: '#999', fontSize: 12 }}>
          No fixture selected. Click a fixture to edit its properties.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        Properties
      </h3>

      {/* Fixture Type */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Type
        </label>
        <select
          value={fixture.type}
          onChange={(e) => handleTypeChange(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {FIXTURE_TYPES.map((ft) => (
            <option key={ft.type} value={ft.type}>
              {ft.label}
            </option>
          ))}
        </select>
      </div>

      {/* Label */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 12,
          }}
        />
      </div>

      {/* Color */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Color
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={color}
            onChange={(e) => handleColorChange(e.target.value)}
            style={{
              width: 40,
              height: 32,
              border: '1px solid #ccc',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          />
          <input
            type="text"
            value={color}
            onChange={(e) => handleColorChange(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 8px',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
        </div>
      </div>

      {/* Thickness (for lines/walls) */}
      {fixture.geometry.type === 'line' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Thickness (feet)
          </label>
          <input
            type="number"
            value={thickness}
            onChange={(e) => handleThicknessChange(parseFloat(e.target.value) || 0)}
            step={0.1}
            min={0.1}
            max={5}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: 12,
            }}
          />
        </div>
      )}

      {/* Opacity */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Opacity: {Math.round(opacity * 100)}%
        </label>
        <input
          type="range"
          value={opacity}
          onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
          min={0.1}
          max={1}
          step={0.1}
          style={{
            width: '100%',
            accentColor: '#3498db',
            cursor: 'pointer',
          }}
        />
      </div>

      {/* Radius (for circles) */}
      {fixture.geometry.type === 'circle' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Radius: {fixture.geometry.radius.toFixed(1)} ft
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="range"
              value={fixture.geometry.radius}
              onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
              min={0.25}
              max={10}
              step={0.1}
              style={{
                flex: 1,
                accentColor: '#3498db',
                cursor: 'pointer',
              }}
            />
            <input
              type="number"
              value={fixture.geometry.radius}
              onChange={(e) => handleRadiusChange(parseFloat(e.target.value) || 0.25)}
              min={0.25}
              max={10}
              step={0.1}
              style={{
                width: 60,
                padding: '4px 6px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 12,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 12, color: '#666' }}>ft</span>
          </div>
        </div>
      )}

      {/* Dimensions (for rectangles) */}
      {fixture.geometry.type === 'rectangle' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Dimensions
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 2 }}>
                Width (ft)
              </label>
              <input
                type="number"
                value={fixture.geometry.width}
                onChange={(e) => {
                  const newWidth = parseFloat(e.target.value) || 0.5;
                  if (fixtureId && fixture.geometry.type === 'rectangle') {
                    onUpdate(fixtureId, {
                      geometry: {
                        type: 'rectangle',
                        position: fixture.geometry.position,
                        width: newWidth,
                        height: fixture.geometry.height,
                        rotation: fixture.geometry.rotation,
                      },
                    });
                  }
                }}
                min={0.5}
                max={50}
                step={0.5}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  fontSize: 12,
                  textAlign: 'center',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 2 }}>
                Height (ft)
              </label>
              <input
                type="number"
                value={fixture.geometry.height}
                onChange={(e) => {
                  const newHeight = parseFloat(e.target.value) || 0.5;
                  if (fixtureId && fixture.geometry.type === 'rectangle') {
                    onUpdate(fixtureId, {
                      geometry: {
                        type: 'rectangle',
                        position: fixture.geometry.position,
                        width: fixture.geometry.width,
                        height: newHeight,
                        rotation: fixture.geometry.rotation,
                      },
                    });
                  }
                }}
                min={0.5}
                max={50}
                step={0.5}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  fontSize: 12,
                  textAlign: 'center',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Rotation (for rectangles) */}
      {fixture.geometry.type === 'rectangle' && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Rotation: {fixture.geometry.rotation || 0}°
          </label>

          {/* Fine Control Buttons + Slider + Number Input */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginBottom: 8 }}>
            <button
              onMouseDown={() => startContinuousRotation(-5)}
              onMouseUp={stopContinuousRotation}
              onMouseLeave={stopContinuousRotation}
              style={{
                flex: 1,
                padding: '4px 2px',
                fontSize: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                backgroundColor: 'white',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              -5°
            </button>
            <button
              onMouseDown={() => startContinuousRotation(-1)}
              onMouseUp={stopContinuousRotation}
              onMouseLeave={stopContinuousRotation}
              style={{
                flex: 1,
                padding: '4px 2px',
                fontSize: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                backgroundColor: 'white',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              -1°
            </button>
            <input
              type="range"
              value={fixture.geometry.rotation || 0}
              onChange={(e) => handleRotationChange(parseInt(e.target.value))}
              min={0}
              max={360}
              step={1}
              style={{
                flex: 2,
                accentColor: '#3498db',
                cursor: 'pointer',
              }}
            />
            <button
              onMouseDown={() => startContinuousRotation(1)}
              onMouseUp={stopContinuousRotation}
              onMouseLeave={stopContinuousRotation}
              style={{
                flex: 1,
                padding: '4px 2px',
                fontSize: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                backgroundColor: 'white',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              +1°
            </button>
            <button
              onMouseDown={() => startContinuousRotation(5)}
              onMouseUp={stopContinuousRotation}
              onMouseLeave={stopContinuousRotation}
              style={{
                flex: 1,
                padding: '4px 2px',
                fontSize: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                backgroundColor: 'white',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              +5°
            </button>
          </div>

          {/* Number Input + Degree Symbol on separate row */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="number"
              value={fixture.geometry.rotation || 0}
              onChange={(e) => handleRotationChange(parseInt(e.target.value) || 0)}
              min={0}
              max={360}
              style={{
                flex: 1,
                padding: '4px 6px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 12,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 12, color: '#666' }}>°</span>
          </div>

          {/* Quick Angle Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <button
                key={angle}
                onClick={() => handleRotationChange(angle)}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  backgroundColor: (fixture.geometry.type === 'rectangle' && fixture.geometry.rotation === angle) ? '#e3f2fd' : 'white',
                  cursor: 'pointer',
                  fontWeight: (fixture.geometry.type === 'rectangle' && fixture.geometry.rotation === angle) ? 600 : 400,
                }}
              >
                {angle}°
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Geometry Info */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Geometry
        </label>
        <div
          style={{
            padding: '6px 8px',
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {fixture.geometry.type === 'line' && (
            <>
              Start: ({fixture.geometry.start.x.toFixed(1)}, {fixture.geometry.start.y.toFixed(1)})<br />
              End: ({fixture.geometry.end.x.toFixed(1)}, {fixture.geometry.end.y.toFixed(1)})
            </>
          )}
          {fixture.geometry.type === 'rectangle' && (
            <>
              Position: ({fixture.geometry.position.x.toFixed(1)}, {fixture.geometry.position.y.toFixed(1)})<br />
              Size: {fixture.geometry.width.toFixed(1)} x {fixture.geometry.height.toFixed(1)}
            </>
          )}
          {fixture.geometry.type === 'circle' && (
            <>
              Center: ({fixture.geometry.center.x.toFixed(1)}, {fixture.geometry.center.y.toFixed(1)})<br />
              Radius: {fixture.geometry.radius.toFixed(1)}
            </>
          )}
        </div>
      </div>

      {/* Delete Button */}
      <button
        onClick={handleDelete}
        style={{
          marginTop: 'auto',
          padding: '8px 16px',
          backgroundColor: '#f44336',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Delete Fixture
      </button>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Fixture"
        description="Delete this fixture?"
        confirmLabel="Delete"
        destructive
        onConfirm={() => { setShowDeleteConfirm(false); if (fixtureId) onDelete(fixtureId); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

export default FixtureProperties;
