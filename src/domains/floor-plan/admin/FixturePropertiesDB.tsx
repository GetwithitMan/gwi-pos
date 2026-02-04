'use client';

/**
 * GWI POS - Floor Plan Domain
 * Fixture Properties Panel (Database-Backed)
 *
 * Shows and allows editing of selected element properties.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FIXTURE_TYPE_MAP, FixtureType } from './types';

// =============================================================================
// TYPES
// =============================================================================

interface FloorPlanElement {
  id: string;
  name: string;
  elementType: string;
  visualType: string;
  geometry: unknown;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  thickness: number;
  fillColor: string | null;
  opacity: number;
  isLocked: boolean;
}

interface FixturePropertiesDBProps {
  element: FloorPlanElement | null;
  onUpdate: (elementId: string, updates: Partial<FloorPlanElement>) => void;
  onDelete: (elementId: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FixturePropertiesDB({
  element,
  onUpdate,
  onDelete,
}: FixturePropertiesDBProps) {
  const [localColor, setLocalColor] = useState(element?.fillColor || '#666');
  const [localOpacity, setLocalOpacity] = useState(element?.opacity || 1);
  const [localRotation, setLocalRotation] = useState(0);
  const [localRadius, setLocalRadius] = useState(1);
  const [localThickness, setLocalThickness] = useState(0.5);

  // Interval ref for hold-to-repeat
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update local state when element changes
  useEffect(() => {
    if (element) {
      setLocalColor(element.fillColor || '#666');
      setLocalOpacity(element.opacity);
      setLocalThickness(element.thickness || 0.5);

      // Extract rotation from geometry or element
      if (element.geometry) {
        const geo = element.geometry as { type: string; radius?: number };
        if (geo.type === 'circle' && geo.radius) {
          setLocalRadius(geo.radius);
        }
      }
      setLocalRotation(element.rotation);
    }
  }, [element]);

  // Handle color change
  const handleColorChange = useCallback(
    (color: string) => {
      setLocalColor(color);
      if (element) {
        onUpdate(element.id, { fillColor: color });
      }
    },
    [element, onUpdate]
  );

  // Handle opacity change
  const handleOpacityChange = useCallback(
    (opacity: number) => {
      setLocalOpacity(opacity);
      if (element) {
        onUpdate(element.id, { opacity });
      }
    },
    [element, onUpdate]
  );

  // Handle rotation change
  const handleRotationChange = useCallback(
    (rotation: number) => {
      const normalizedRotation = ((rotation % 360) + 360) % 360;
      setLocalRotation(normalizedRotation);
      if (element) {
        onUpdate(element.id, { rotation: normalizedRotation });
      }
    },
    [element, onUpdate]
  );

  // Handle radius change (for circles)
  const handleRadiusChange = useCallback(
    (radius: number) => {
      setLocalRadius(radius);
      if (element && element.geometry) {
        const geo = element.geometry as { type: string; x: number; y: number };
        if (geo.type === 'circle') {
          onUpdate(element.id, {
            geometry: { ...geo, radius },
          });
        }
      }
    },
    [element, onUpdate]
  );

  // Handle thickness change (for walls)
  const handleThicknessChange = useCallback(
    (thickness: number) => {
      setLocalThickness(thickness);
      if (element) {
        onUpdate(element.id, { thickness });
      }
    },
    [element, onUpdate]
  );

  // Handle type change
  const handleTypeChange = useCallback(
    (newType: FixtureType) => {
      if (element) {
        const metadata = FIXTURE_TYPE_MAP[newType];
        onUpdate(element.id, {
          name: metadata.label,
          visualType: newType,
          fillColor: metadata.defaultColor,
        });
      }
    },
    [element, onUpdate]
  );

  // Fine rotation control with hold-to-repeat
  const startRotationAdjust = useCallback(
    (delta: number) => {
      if (!element) return;

      // Immediate adjustment
      handleRotationChange(localRotation + delta);

      // Start interval for hold-to-repeat
      intervalRef.current = setInterval(() => {
        setLocalRotation((prev) => {
          const newValue = ((prev + delta) % 360 + 360) % 360;
          if (element) {
            onUpdate(element.id, { rotation: newValue });
          }
          return newValue;
        });
      }, 100);
    },
    [element, localRotation, handleRotationChange, onUpdate]
  );

  const stopRotationAdjust = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Get geometry type
  const getGeometryType = (): 'line' | 'rectangle' | 'circle' | null => {
    if (!element?.geometry) return null;
    return (element.geometry as { type: string }).type as 'line' | 'rectangle' | 'circle';
  };

  const geometryType = getGeometryType();

  if (!element) {
    return (
      <div
        style={{
          padding: 16,
          backgroundColor: '#f9f9f9',
          borderRadius: 8,
          border: '1px solid #ddd',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 }}>
          Properties
        </h3>
        <p style={{ color: '#666', fontSize: 13 }}>
          Select an element to edit its properties
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        border: '1px solid #ddd',
      }}
    >
      <h3 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 600 }}>
        Properties
      </h3>

      {/* Name */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Name
        </label>
        <div style={{ fontSize: 14, color: '#333' }}>{element.name}</div>
      </div>

      {/* Type Selector */}
      {geometryType === 'rectangle' && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Type
          </label>
          <select
            value={element.visualType}
            onChange={(e) => handleTypeChange(e.target.value as FixtureType)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              fontSize: 14,
            }}
          >
            {Object.entries(FIXTURE_TYPE_MAP).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Color */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Color
        </label>
        <input
          type="color"
          value={localColor}
          onChange={(e) => handleColorChange(e.target.value)}
          style={{
            width: '100%',
            height: 40,
            border: '1px solid #ccc',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        />
      </div>

      {/* Opacity */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Opacity: {(localOpacity * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={localOpacity}
          onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Rotation (for rectangles) */}
      {geometryType === 'rectangle' && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Rotation: {localRotation}°
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={localRotation}
              onChange={(e) => handleRotationChange(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              min={0}
              max={359}
              value={localRotation}
              onChange={(e) => handleRotationChange(parseInt(e.target.value) || 0)}
              style={{
                width: 60,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ccc',
                fontSize: 12,
              }}
            />
          </div>
          {/* Fine rotation buttons */}
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            <button
              onMouseDown={() => startRotationAdjust(-5)}
              onMouseUp={stopRotationAdjust}
              onMouseLeave={stopRotationAdjust}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #ccc',
                backgroundColor: '#fff',
                cursor: 'pointer',
              }}
            >
              -5°
            </button>
            <button
              onMouseDown={() => startRotationAdjust(-1)}
              onMouseUp={stopRotationAdjust}
              onMouseLeave={stopRotationAdjust}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #ccc',
                backgroundColor: '#fff',
                cursor: 'pointer',
              }}
            >
              -1°
            </button>
            <button
              onMouseDown={() => startRotationAdjust(1)}
              onMouseUp={stopRotationAdjust}
              onMouseLeave={stopRotationAdjust}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #ccc',
                backgroundColor: '#fff',
                cursor: 'pointer',
              }}
            >
              +1°
            </button>
            <button
              onMouseDown={() => startRotationAdjust(5)}
              onMouseUp={stopRotationAdjust}
              onMouseLeave={stopRotationAdjust}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #ccc',
                backgroundColor: '#fff',
                cursor: 'pointer',
              }}
            >
              +5°
            </button>
          </div>
        </div>
      )}

      {/* Radius (for circles) */}
      {geometryType === 'circle' && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Radius: {localRadius.toFixed(2)} ft
          </label>
          <input
            type="range"
            min={0.25}
            max={10}
            step={0.1}
            value={localRadius}
            onChange={(e) => handleRadiusChange(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Thickness (for walls) */}
      {geometryType === 'line' && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Thickness: {localThickness.toFixed(2)} ft
          </label>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={localThickness}
            onChange={(e) => handleThicknessChange(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Lock toggle */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={element.isLocked}
            onChange={(e) => onUpdate(element.id, { isLocked: e.target.checked })}
          />
          <span style={{ fontSize: 12 }}>Lock Position</span>
        </label>
      </div>

      {/* Delete Button */}
      <button
        onClick={() => onDelete(element.id)}
        style={{
          width: '100%',
          padding: '10px 16px',
          backgroundColor: '#f44336',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Delete Element
      </button>
    </div>
  );
}

export default FixturePropertiesDB;
