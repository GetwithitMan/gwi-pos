'use client';

/**
 * GWI POS - Floor Plan Domain
 * Floor Plan Editor (Database-Backed)
 *
 * Main editor interface for creating and editing floor plans.
 * Uses real API routes for persistence and socket events for real-time sync.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { EditorCanvasDB } from './EditorCanvasDB';
import { FixtureToolbar } from './FixtureToolbar';
import { FixturePropertiesDB } from './FixturePropertiesDB';
import type { EditorToolMode, FixtureType } from './types';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { toast } from '@/stores/toast-store';

// =============================================================================
// TYPES
// =============================================================================

interface Section {
  id: string;
  name: string;
  color: string | null;
  widthFeet: number;
  heightFeet: number;
  gridSizeFeet: number;
}

interface FloorPlanElement {
  id: string;
  name: string;
  elementType: string;
  visualType: string;
  sectionId: string | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  geometry: unknown;
  thickness: number;
  fillColor: string | null;
  strokeColor: string | null;
  opacity: number;
  isLocked: boolean;
  isVisible: boolean;
}

interface FloorPlanEditorDBProps {
  locationId: string;
  initialSectionId?: string;
  onSave?: () => void;
  onExit?: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FloorPlanEditorDB({
  locationId,
  initialSectionId,
  onSave,
  onExit,
}: FloorPlanEditorDBProps) {
  // Section (room) data
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>(initialSectionId || '');
  const [isLoading, setIsLoading] = useState(true);

  // Tool mode
  const [toolMode, setToolMode] = useState<EditorToolMode>('SELECT');
  const [fixtureType, setFixtureType] = useState<FixtureType>('bar_counter');

  // Selection
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // Elements (fixtures)
  const [elements, setElements] = useState<FloorPlanElement[]>([]);

  // Refresh key for immediate updates
  const [refreshKey, setRefreshKey] = useState(0);

  // =============================================================================
  // DATA LOADING
  // =============================================================================

  // Load sections
  useEffect(() => {
    async function loadSections() {
      try {
        const res = await fetch(`/api/sections?locationId=${locationId}`);
        if (!res.ok) throw new Error('Failed to load sections');
        const data = await res.json();
        setSections(data.sections || []);

        // Set initial section
        if (data.sections.length > 0) {
          const initialId = initialSectionId || data.sections[0].id;
          setSelectedSectionId(initialId);
        }
      } catch (error) {
        console.error('[FloorPlanEditorDB] Load sections error:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadSections();
  }, [locationId, initialSectionId]);

  // Load elements for selected section
  useEffect(() => {
    if (!selectedSectionId) return;

    async function loadElements() {
      try {
        const res = await fetch(`/api/floor-plan-elements?locationId=${locationId}&sectionId=${selectedSectionId}`);
        if (!res.ok) throw new Error('Failed to load elements');
        const data = await res.json();
        setElements(data.elements || []);
      } catch (error) {
        console.error('[FloorPlanEditorDB] Load elements error:', error);
      }
    }
    loadElements();
  }, [locationId, selectedSectionId, refreshKey]);

  // =============================================================================
  // HANDLERS
  // =============================================================================

  // Handle section change
  const handleSectionChange = useCallback((sectionId: string) => {
    setSelectedSectionId(sectionId);
    setSelectedElementId(null);
  }, []);

  // Handle tool change
  const handleToolChange = useCallback((tool: EditorToolMode) => {
    setToolMode(tool);
    setSelectedElementId(null);
  }, []);

  // Handle fixture type change
  const handleFixtureTypeChange = useCallback((type: FixtureType) => {
    setFixtureType(type);
  }, []);

  // Handle element selection
  const handleElementSelect = useCallback((elementId: string | null) => {
    setSelectedElementId(elementId);
    if (elementId) {
      setToolMode('SELECT');
    }
  }, []);

  // Handle element creation
  const handleElementCreate = useCallback(
    async (elementData: Partial<FloorPlanElement>) => {
      try {
        const res = await fetch('/api/floor-plan-elements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            sectionId: selectedSectionId,
            ...elementData,
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          console.error('[FloorPlanEditorDB] Create error:', error);
          return;
        }

        // Refresh elements
        setRefreshKey((prev) => prev + 1);

        // Dispatch socket event for real-time sync
        dispatchFloorPlanUpdate(locationId, { async: true });
      } catch (error) {
        console.error('[FloorPlanEditorDB] Create error:', error);
      }
    },
    [locationId, selectedSectionId]
  );

  // Handle element update
  const handleElementUpdate = useCallback(
    async (elementId: string, updates: Partial<FloorPlanElement>) => {
      try {
        const res = await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          const error = await res.json();
          console.error('[FloorPlanEditorDB] Update error:', error);
          return;
        }

        // Refresh elements
        setRefreshKey((prev) => prev + 1);
      } catch (error) {
        console.error('[FloorPlanEditorDB] Update error:', error);
      }
    },
    []
  );

  // Handle element deletion
  const handleElementDelete = useCallback(
    async (elementId: string) => {
      try {
        const res = await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const error = await res.json();
          console.error('[FloorPlanEditorDB] Delete error:', error);
          return;
        }

        setSelectedElementId(null);

        // Refresh elements
        setRefreshKey((prev) => prev + 1);

        // Dispatch socket event for real-time sync
        dispatchFloorPlanUpdate(locationId, { async: true });
      } catch (error) {
        console.error('[FloorPlanEditorDB] Delete error:', error);
      }
    },
    [locationId]
  );

  // Handle add section
  const handleAddSection = useCallback(async () => {
    const name = prompt('Enter room name:');
    if (!name) return;

    try {
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name,
          widthFeet: 40,
          heightFeet: 30,
          gridSizeFeet: 0.25,
        }),
      });

      if (!res.ok) throw new Error('Failed to create section');
      const data = await res.json();

      setSections((prev) => [...prev, data.section]);
      setSelectedSectionId(data.section.id);
    } catch (error) {
      console.error('[FloorPlanEditorDB] Add section error:', error);
      toast.error('Failed to create room');
    }
  }, [locationId]);

  // Handle save
  const handleSave = useCallback(() => {
    // Dispatch socket event to notify all terminals
    dispatchFloorPlanUpdate(locationId, { async: true });
    toast.success('Floor plan saved! All terminals will be updated.');
    if (onSave) onSave();
  }, [locationId, onSave]);

  // Handle reset
  const handleReset = useCallback(async () => {
    if (!window.confirm('Reset this room? This will delete all fixtures.')) return;

    try {
      // Delete all elements in this section
      for (const element of elements) {
        await fetch(`/api/floor-plan-elements/${element.id}`, { method: 'DELETE' });
      }

      setSelectedElementId(null);
      setRefreshKey((prev) => prev + 1);

      // Dispatch socket event for real-time sync
      dispatchFloorPlanUpdate(locationId, { async: true });
    } catch (error) {
      console.error('[FloorPlanEditorDB] Reset error:', error);
    }
  }, [elements, locationId]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Delete key: delete selected element
      if (event.key === 'Delete' && selectedElementId) {
        handleElementDelete(selectedElementId);
      }

      // Escape key: deselect
      if (event.key === 'Escape') {
        setSelectedElementId(null);
        setToolMode('SELECT');
      }

      // Number keys: quick tool select
      if (event.key === '1') setToolMode('SELECT');
      if (event.key === '2') setToolMode('WALL');
      if (event.key === '3') setToolMode('RECTANGLE');
      if (event.key === '4') setToolMode('CIRCLE');
      if (event.key === '5') setToolMode('DELETE');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, handleElementDelete]);

  // Get current section
  const currentSection = sections.find((s) => s.id === selectedSectionId);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #3498db',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <p style={{ color: '#666', fontSize: 14 }}>Loading Floor Plan Editor...</p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          Floor Plan Editor
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Save
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Reset
          </button>
          {onExit && (
            <button
              onClick={onExit}
              style={{
                padding: '8px 16px',
                backgroundColor: '#757575',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {/* Room Selector */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleSectionChange(section.id)}
            style={{
              minWidth: 120,
              padding: '8px 16px',
              borderRadius: 8,
              border: selectedSectionId === section.id ? '2px solid #3498db' : '1px solid #ccc',
              backgroundColor: selectedSectionId === section.id ? '#e3f2fd' : 'white',
              cursor: 'pointer',
              fontWeight: selectedSectionId === section.id ? 600 : 400,
              fontSize: 14,
            }}
          >
            {section.name}
          </button>
        ))}
        <button
          onClick={handleAddSection}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '2px dashed #3498db',
            backgroundColor: 'white',
            color: '#3498db',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          + Add Room
        </button>
      </div>

      {/* Main Layout */}
      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        {/* Left Panel: Toolbar */}
        <div style={{ width: 200, flexShrink: 0, position: 'relative', zIndex: 10 }}>
          <FixtureToolbar
            selectedTool={toolMode}
            selectedFixtureType={fixtureType}
            onToolSelect={handleToolChange}
            onFixtureTypeSelect={handleFixtureTypeChange}
          />
        </div>

        {/* Center: Canvas */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0, paddingLeft: 8 }}>
          {currentSection && (
            <EditorCanvasDB
              section={currentSection}
              elements={elements}
              toolMode={toolMode}
              fixtureType={fixtureType}
              selectedElementId={selectedElementId}
              onElementSelect={handleElementSelect}
              onElementUpdate={handleElementUpdate}
              onElementCreate={handleElementCreate}
              onElementDelete={handleElementDelete}
            />
          )}
        </div>

        {/* Right Panel: Properties */}
        <div style={{ width: 250, flexShrink: 0, position: 'relative', zIndex: 10 }}>
          <FixturePropertiesDB
            element={elements.find((e) => e.id === selectedElementId) || null}
            onUpdate={handleElementUpdate}
            onDelete={handleElementDelete}
          />
        </div>
      </div>

      {/* Keyboard Shortcuts Help */}
      <div
        style={{
          marginTop: 24,
          padding: 12,
          backgroundColor: '#f5f5f5',
          borderRadius: 8,
          fontSize: 11,
          color: '#666',
        }}
      >
        <strong>Keyboard Shortcuts:</strong>{' '}
        <span style={{ fontFamily: 'monospace' }}>
          1-5: Switch tools | Delete: Remove selected | Esc: Deselect
        </span>
      </div>
    </div>
  );
}

export default FloorPlanEditorDB;
