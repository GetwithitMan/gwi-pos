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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// =============================================================================
// TYPES
// =============================================================================

interface TablePropertiesProps {
  table: EditorTable | null;
  onUpdate: (tableId: string, updates: Partial<EditorTable>) => void;
  onDelete: (tableId: string) => void;
  onRegenerateSeats: (tableId: string) => void;
  existingTableNames?: string[];
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TableProperties({ table, onUpdate, onDelete, onRegenerateSeats, existingTableNames = [] }: TablePropertiesProps) {
  // Local state for editing
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  // Check for duplicate name (case-insensitive, excluding current table)
  const isDuplicateName = name.trim() !== '' && existingTableNames.some(
    n => n.toLowerCase() === name.trim().toLowerCase() && n.toLowerCase() !== (table?.name || '').toLowerCase()
  );

  const handleNameChange = (newName: string) => {
    setName(newName);
    // Only push update to server if name is not a duplicate
    const wouldBeDuplicate = newName.trim() !== '' && existingTableNames.some(
      n => n.toLowerCase() === newName.trim().toLowerCase() && n.toLowerCase() !== (table?.name || '').toLowerCase()
    );
    if (!wouldBeDuplicate) {
      handleUpdate({ name: newName });
    }
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
    padding: '6px 8px',
    fontSize: 13,
    borderRadius: 4,
    border: '1px solid #ccc',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: '#555',
    marginBottom: 2,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: 8,
  };

  return (
    <div
      style={{
        padding: 12,
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        border: '1px solid #e0e0e0',
      }}
    >
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600, color: '#333' }}>
        Table Properties
      </h3>

      {/* Name & Abbreviation - side by side */}
      <div style={{ ...fieldStyle, display: 'flex', gap: 6 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Table name"
            style={{
              ...inputStyle,
              border: isDuplicateName ? '1px solid #ef4444' : '1px solid #ccc',
            }}
          />
          {isDuplicateName && (
            <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>
              Name already in use
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Abbr</label>
          <input
            type="text"
            value={abbreviation}
            onChange={(e) => handleAbbreviationChange(e.target.value)}
            placeholder="T1"
            maxLength={6}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Shape */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Shape</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {TABLE_SHAPES.map((shapeOption) => (
            <button
              key={shapeOption.shape}
              onClick={() => handleShapeChange(shapeOption.shape)}
              title={shapeOption.label}
              style={{
                padding: '4px 2px',
                fontSize: 16,
                borderRadius: 4,
                border: shape === shapeOption.shape ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: shape === shapeOption.shape ? '#e3f2fd' : 'white',
                cursor: 'pointer',
              }}
            >
              {shapeOption.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Capacity */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Capacity</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => handleCapacityChange(capacity - 1)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 16,
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
            style={{ ...inputStyle, width: 50, textAlign: 'center', padding: '4px' }}
          />
          <button
            onClick={() => handleCapacityChange(capacity + 1)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 16,
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
        <label style={labelStyle}>Size (W × H)</label>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number"
            value={width}
            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 40)}
            min={40}
            max={400}
            style={{ ...inputStyle, width: 60, textAlign: 'center', padding: '4px' }}
            title="Width"
          />
          <span style={{ color: '#999', fontSize: 12 }}>×</span>
          <input
            type="number"
            value={height}
            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 40)}
            min={40}
            max={400}
            style={{ ...inputStyle, width: 60, textAlign: 'center', padding: '4px' }}
            title="Height"
          />
        </div>
      </div>

      {/* Rotation */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Rotation</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => handleRotationChange(rotation - 5)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
            title="-5°"
          >
            -5
          </button>
          <input
            type="range"
            value={rotation}
            onChange={(e) => handleRotationChange(parseInt(e.target.value, 10))}
            min={0}
            max={360}
            step={5}
            style={{ flex: 1, height: 4 }}
          />
          <button
            onClick={() => handleRotationChange(rotation + 5)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid #ccc',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
            title="+5°"
          >
            +5
          </button>
          <span style={{ width: 32, fontSize: 11, textAlign: 'right' }}>{rotation}°</span>
        </div>
      </div>

      {/* Locked */}
      <div style={fieldStyle}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            checked={isLocked}
            onChange={(e) => handleLockedChange(e.target.checked)}
            style={{ width: 14, height: 14 }}
          />
          <span>Lock Position</span>
        </label>
      </div>

      {/* Action buttons - side by side */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onRegenerateSeats(table.id)}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 4,
            border: 'none',
            backgroundColor: '#ff9800',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Regen Seats
        </button>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 4,
            border: 'none',
            backgroundColor: '#f44336',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Table"
        description={`Delete table "${table.name}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { setShowDeleteConfirm(false); onDelete(table.id); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

export default TableProperties;
