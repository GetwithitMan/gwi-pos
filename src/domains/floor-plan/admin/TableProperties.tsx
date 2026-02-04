'use client';

/**
 * GWI POS - Floor Plan Domain
 * Table Properties Panel Component
 *
 * Properties panel for editing selected tables in the Floor Plan Editor.
 */

import React, { useState, useEffect } from 'react';
import type { EditorTable, TableShape, SeatPattern } from './types';
import { TABLE_SHAPES } from './types';

// =============================================================================
// TYPES
// =============================================================================

interface TablePropertiesProps {
  table: EditorTable | null;
  onUpdate: (tableId: string, updates: Partial<EditorTable>) => void;
  onDelete: (tableId: string) => void;
  onRegenerateSeats: (tableId: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TableProperties({ table, onUpdate, onDelete, onRegenerateSeats }: TablePropertiesProps) {
  // Local state for editing
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [shape, setShape] = useState<TableShape>('rectangle');
  const [seatPattern, setSeatPattern] = useState<SeatPattern>('all_around');
  const [isLocked, setIsLocked] = useState(false);

  // Sync with selected table
  useEffect(() => {
    if (table) {
      setName(table.name);
      setAbbreviation(table.abbreviation || '');
      setCapacity(table.capacity);
      setWidth(table.width);
      setHeight(table.height);
      setRotation(table.rotation);
      setShape(table.shape as TableShape);
      setSeatPattern(table.seatPattern as SeatPattern);
      setIsLocked(table.isLocked);
    }
  }, [table]);

  if (!table) {
    return (
      <div
        style={{
          padding: 16,
          backgroundColor: '#f9f9f9',
          borderRadius: 8,
          border: '1px solid #e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#333' }}>
          Table Properties
        </h3>
        <p style={{ fontSize: 14, color: '#666', margin: 0 }}>
          Select a table to edit its properties.
        </p>
      </div>
    );
  }

  const handleUpdate = (updates: Partial<EditorTable>) => {
    onUpdate(table.id, updates);
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    handleUpdate({ name: newName });
  };

  const handleAbbreviationChange = (newAbbr: string) => {
    setAbbreviation(newAbbr);
    handleUpdate({ abbreviation: newAbbr || null });
  };

  const handleCapacityChange = (newCapacity: number) => {
    const capped = Math.max(1, Math.min(20, newCapacity));
    setCapacity(capped);
    handleUpdate({ capacity: capped });
  };

  const handleWidthChange = (newWidth: number) => {
    const capped = Math.max(40, Math.min(400, newWidth));
    setWidth(capped);
    handleUpdate({ width: capped });
  };

  const handleHeightChange = (newHeight: number) => {
    const capped = Math.max(40, Math.min(400, newHeight));
    setHeight(capped);
    handleUpdate({ height: capped });
  };

  const handleRotationChange = (newRotation: number) => {
    const normalized = ((newRotation % 360) + 360) % 360;
    setRotation(normalized);
    handleUpdate({ rotation: normalized });
  };

  const handleShapeChange = (newShape: TableShape) => {
    setShape(newShape);
    const shapeDefaults = TABLE_SHAPES.find(s => s.shape === newShape);
    if (shapeDefaults) {
      // Also update default dimensions and seat pattern for the shape
      setWidth(shapeDefaults.defaultWidth);
      setHeight(shapeDefaults.defaultHeight);
      setSeatPattern(shapeDefaults.defaultSeatPattern);
      handleUpdate({
        shape: newShape,
        width: shapeDefaults.defaultWidth,
        height: shapeDefaults.defaultHeight,
        seatPattern: shapeDefaults.defaultSeatPattern,
      });
    } else {
      handleUpdate({ shape: newShape });
    }
  };

  const handleSeatPatternChange = (newPattern: SeatPattern) => {
    setSeatPattern(newPattern);
    handleUpdate({ seatPattern: newPattern });
  };

  const handleLockedChange = (locked: boolean) => {
    setIsLocked(locked);
    handleUpdate({ isLocked: locked });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #ccc',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#555',
    marginBottom: 4,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: 16,
  };

  return (
    <div
      style={{
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        border: '1px solid #e0e0e0',
      }}
    >
      <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600, color: '#333' }}>
        Table Properties
      </h3>

      {/* Name */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Table name"
          style={inputStyle}
        />
      </div>

      {/* Abbreviation */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Abbreviation (shown on table)</label>
        <input
          type="text"
          value={abbreviation}
          onChange={(e) => handleAbbreviationChange(e.target.value)}
          placeholder="T1, B2, etc."
          maxLength={6}
          style={inputStyle}
        />
      </div>

      {/* Shape */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Shape</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {TABLE_SHAPES.map((shapeOption) => (
            <button
              key={shapeOption.shape}
              onClick={() => handleShapeChange(shapeOption.shape)}
              style={{
                padding: '8px 4px',
                fontSize: 12,
                borderRadius: 6,
                border: shape === shapeOption.shape ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: shape === shapeOption.shape ? '#e3f2fd' : 'white',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span style={{ fontSize: 18 }}>{shapeOption.icon}</span>
              <span>{shapeOption.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Capacity */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Capacity (seats)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => handleCapacityChange(capacity - 1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            -
          </button>
          <input
            type="number"
            value={capacity}
            onChange={(e) => handleCapacityChange(parseInt(e.target.value, 10) || 1)}
            min={1}
            max={20}
            style={{ ...inputStyle, width: 60, textAlign: 'center' }}
          />
          <button
            onClick={() => handleCapacityChange(capacity + 1)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Seat Pattern */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Seat Arrangement</label>
        <select
          value={seatPattern}
          onChange={(e) => handleSeatPatternChange(e.target.value as SeatPattern)}
          style={inputStyle}
        >
          <option value="all_around">All Around</option>
          <option value="front_only">Front Only (Bar)</option>
          <option value="three_sides">Three Sides (U-shape)</option>
          <option value="two_sides">Two Sides (Corner)</option>
          <option value="inside">Inside (Booth)</option>
        </select>
      </div>

      {/* Dimensions */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Size (pixels)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <input
              type="number"
              value={width}
              onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 40)}
              min={40}
              max={400}
              style={{ ...inputStyle, textAlign: 'center' }}
              title="Width"
            />
            <span style={{ fontSize: 10, color: '#888', display: 'block', textAlign: 'center' }}>W</span>
          </div>
          <span style={{ lineHeight: '38px', color: '#999' }}>x</span>
          <div style={{ flex: 1 }}>
            <input
              type="number"
              value={height}
              onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 40)}
              min={40}
              max={400}
              style={{ ...inputStyle, textAlign: 'center' }}
              title="Height"
            />
            <span style={{ fontSize: 10, color: '#888', display: 'block', textAlign: 'center' }}>H</span>
          </div>
        </div>
      </div>

      {/* Rotation */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Rotation</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            value={rotation}
            onChange={(e) => handleRotationChange(parseInt(e.target.value, 10))}
            min={0}
            max={360}
            step={15}
            style={{ flex: 1 }}
          />
          <span style={{ width: 40, fontSize: 12, textAlign: 'right' }}>{rotation}°</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {[0, 45, 90, 180, 270].map((angle) => (
            <button
              key={angle}
              onClick={() => handleRotationChange(angle)}
              style={{
                flex: 1,
                padding: '4px 0',
                fontSize: 11,
                borderRadius: 4,
                border: rotation === angle ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: rotation === angle ? '#e3f2fd' : 'white',
                cursor: 'pointer',
              }}
            >
              {angle}°
            </button>
          ))}
        </div>
      </div>

      {/* Locked */}
      <div style={fieldStyle}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={isLocked}
            onChange={(e) => handleLockedChange(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span>Lock Position (prevent moving)</span>
        </label>
      </div>

      {/* Regenerate Seats */}
      <button
        onClick={() => onRegenerateSeats(table.id)}
        style={{
          width: '100%',
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 6,
          border: 'none',
          backgroundColor: '#ff9800',
          color: 'white',
          cursor: 'pointer',
          marginBottom: 8,
        }}
      >
        Regenerate Seats
      </button>

      {/* Delete */}
      <button
        onClick={() => {
          if (window.confirm(`Delete table "${table.name}"?`)) {
            onDelete(table.id);
          }
        }}
        style={{
          width: '100%',
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 6,
          border: 'none',
          backgroundColor: '#f44336',
          color: 'white',
          cursor: 'pointer',
        }}
      >
        Delete Table
      </button>
    </div>
  );
}

export default TableProperties;
