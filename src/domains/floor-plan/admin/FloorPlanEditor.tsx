'use client';

/**
 * GWI POS - Floor Plan Domain
 * Floor Plan Editor Component
 *
 * Main editor interface for creating and editing floor plans.
 * NOW WITH DATABASE PERSISTENCE!
 */

import React, { useState, useCallback, useEffect } from 'react';
import { FloorCanvasAPI, RoomSelector } from '../canvas';
import { EditorCanvas } from './EditorCanvas';
import { FixtureToolbar } from './FixtureToolbar';
import { FixtureProperties } from './FixtureProperties';
import type { EditorToolMode, FixtureType } from './types';
import type { Fixture } from '../shared/types';

// =============================================================================
// TYPES
// =============================================================================

interface FloorPlanEditorProps {
  initialRoomId?: string;
  locationId?: string;
  useDatabase?: boolean; // Toggle between in-memory and database mode
  onSave?: () => void;
  onExit?: () => void;
}

// Database element type
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

// Convert database element to Fixture
function elementToFixture(el: FloorPlanElement, sectionId: string): Fixture {
  const geometry = el.geometry as { type: string; [key: string]: unknown } | null;

  let fixtureGeometry: Fixture['geometry'];
  if (geometry?.type === 'line') {
    fixtureGeometry = {
      type: 'line',
      start: (geometry.start as { x: number; y: number }) || { x: el.posX, y: el.posY },
      end: (geometry.end as { x: number; y: number }) || { x: el.posX + el.width, y: el.posY },
    };
  } else if (geometry?.type === 'circle') {
    fixtureGeometry = {
      type: 'circle',
      center: (geometry.center as { x: number; y: number }) || { x: el.posX, y: el.posY },
      radius: (geometry.radius as number) || el.width / 2,
    };
  } else {
    fixtureGeometry = {
      type: 'rectangle',
      position: { x: el.posX, y: el.posY },
      width: el.width,
      height: el.height,
      rotation: el.rotation,
    };
  }

  return {
    id: el.id,
    floorPlanId: sectionId,
    roomId: sectionId,
    type: (el.visualType || 'custom_fixture') as Fixture['type'],
    category: 'barrier',
    label: el.name,
    geometry: fixtureGeometry,
    color: el.fillColor || '#666666',
    opacity: el.opacity,
    thickness: el.thickness,
    height: null,
    blocksPlacement: true,
    blocksMovement: true,
    snapTarget: false,
    isActive: true,
  };
}

// Convert Fixture to database element format
function fixtureToElement(fixture: Omit<Fixture, 'id'> | Fixture): Partial<FloorPlanElement> & { geometry: unknown } {
  let posX = 0, posY = 0, width = 1, height = 1;

  if (fixture.geometry.type === 'rectangle') {
    posX = fixture.geometry.position.x;
    posY = fixture.geometry.position.y;
    width = fixture.geometry.width;
    height = fixture.geometry.height;
  } else if (fixture.geometry.type === 'circle') {
    posX = fixture.geometry.center.x - fixture.geometry.radius;
    posY = fixture.geometry.center.y - fixture.geometry.radius;
    width = fixture.geometry.radius * 2;
    height = fixture.geometry.radius * 2;
  } else if (fixture.geometry.type === 'line') {
    posX = Math.min(fixture.geometry.start.x, fixture.geometry.end.x);
    posY = Math.min(fixture.geometry.start.y, fixture.geometry.end.y);
    width = Math.abs(fixture.geometry.end.x - fixture.geometry.start.x) || 1;
    height = Math.abs(fixture.geometry.end.y - fixture.geometry.start.y) || fixture.thickness;
  }

  return {
    name: fixture.label,
    elementType: 'fixture',
    visualType: fixture.type,
    geometry: fixture.geometry,
    posX,
    posY,
    width,
    height,
    rotation: fixture.geometry.type === 'rectangle' ? fixture.geometry.rotation : 0,
    thickness: fixture.thickness,
    fillColor: fixture.color,
    opacity: fixture.opacity,
    isLocked: false,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FloorPlanEditor({
  initialRoomId,
  locationId,
  useDatabase = false,
  onSave,
  onExit,
}: FloorPlanEditorProps) {
  // Room selection - in database mode, start empty and wait for sections to load
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    useDatabase ? (initialRoomId || '') : (initialRoomId || FloorCanvasAPI.getActiveRoom() || '')
  );

  // Tool mode
  const [toolMode, setToolMode] = useState<EditorToolMode>('SELECT');
  const [fixtureType, setFixtureType] = useState<FixtureType>('bar_counter');

  // Selection
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);

  // Force refresh key for immediate updates (eliminates polling lag)
  const [refreshKey, setRefreshKey] = useState(0);

  // Database state
  const [dbElements, setDbElements] = useState<FloorPlanElement[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Database sections (rooms)
  interface DbSection {
    id: string;
    name: string;
    color: string | null;
    widthFeet: number;
    heightFeet: number;
    gridSizeFeet: number;
  }
  const [dbSections, setDbSections] = useState<DbSection[]>([]);

  // Fetch sections from database
  const fetchSections = useCallback(async () => {
    if (!useDatabase || !locationId) return;

    try {
      const response = await fetch(`/api/sections?locationId=${locationId}`);
      if (response.ok) {
        const data = await response.json();
        setDbSections(data.sections || []);
        // Auto-select first section if none selected
        if (data.sections?.length > 0 && !selectedRoomId) {
          setSelectedRoomId(data.sections[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch sections:', error);
    }
  }, [useDatabase, locationId, selectedRoomId]);

  // Load sections when in database mode
  useEffect(() => {
    if (useDatabase) {
      fetchSections();
    }
  }, [useDatabase, fetchSections]);

  // Fetch elements from database
  const fetchElements = useCallback(async () => {
    if (!useDatabase || !selectedRoomId || !locationId) return;

    try {
      const response = await fetch(`/api/floor-plan-elements?locationId=${locationId}&sectionId=${selectedRoomId}`);
      if (response.ok) {
        const data = await response.json();
        setDbElements(data.elements || []);
      }
    } catch (error) {
      console.error('Failed to fetch floor plan elements:', error);
    }
  }, [useDatabase, selectedRoomId, locationId]);

  // Load elements when room changes (database mode)
  useEffect(() => {
    if (useDatabase) {
      fetchElements();
    }
  }, [useDatabase, fetchElements]);

  // Handle room change
  const handleRoomChange = useCallback((roomId: string) => {
    setSelectedRoomId(roomId);
    if (!useDatabase) {
      FloorCanvasAPI.setActiveRoom(roomId);
    }
    setSelectedFixtureId(null);
  }, [useDatabase]);

  // Handle tool change
  const handleToolChange = useCallback((tool: EditorToolMode) => {
    setToolMode(tool);
    setSelectedFixtureId(null);
  }, []);

  // Handle fixture type change
  const handleFixtureTypeChange = useCallback((type: FixtureType) => {
    setFixtureType(type);
  }, []);

  // Handle fixture selection
  const handleFixtureSelect = useCallback((fixtureId: string | null) => {
    setSelectedFixtureId(fixtureId);
    if (fixtureId) {
      setToolMode('SELECT');
    }
  }, []);

  // Handle fixture creation
  const handleFixtureCreate = useCallback(
    async (fixture: Omit<Fixture, 'id'>) => {
      if (useDatabase) {
        try {
          const elementData = fixtureToElement(fixture);
          const response = await fetch('/api/floor-plan-elements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sectionId: selectedRoomId,
              locationId: locationId || '',
              ...elementData,
            }),
          });
          if (response.ok) {
            await fetchElements();
            setRefreshKey((prev) => prev + 1);
          }
        } catch (error) {
          console.error('Failed to create element:', error);
        }
      } else {
        FloorCanvasAPI.addFixture(fixture);
      }
      setSelectedFixtureId(null);
    },
    [useDatabase, selectedRoomId, locationId, fetchElements]
  );

  // Handle fixture update
  const handleFixtureUpdate = useCallback(
    async (fixtureId: string, updates: Partial<Fixture>) => {
      if (useDatabase) {
        try {
          // Get current element to merge updates
          const currentElement = dbElements.find(el => el.id === fixtureId);
          if (!currentElement) return;

          // Convert current element to fixture, apply updates, then convert back
          const currentFixture = elementToFixture(currentElement, selectedRoomId);
          const updatedFixture = { ...currentFixture, ...updates };

          // If geometry is being updated, merge it properly
          if (updates.geometry) {
            updatedFixture.geometry = updates.geometry;
          }

          const elementData = fixtureToElement(updatedFixture);

          const response = await fetch(`/api/floor-plan-elements/${fixtureId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(elementData),
          });

          if (response.ok) {
            // Update local state immediately for responsiveness
            setDbElements(prev => prev.map(el =>
              el.id === fixtureId
                ? { ...el, ...elementData } as FloorPlanElement
                : el
            ));
            setRefreshKey((prev) => prev + 1);
          }
        } catch (error) {
          console.error('Failed to update element:', error);
        }
      } else {
        FloorCanvasAPI.updateFixture(fixtureId, updates);
        setRefreshKey((prev) => prev + 1);
      }
    },
    [useDatabase, dbElements, selectedRoomId]
  );

  // Handle fixture deletion
  const handleFixtureDelete = useCallback(
    async (fixtureId: string) => {
      if (useDatabase) {
        try {
          const response = await fetch(`/api/floor-plan-elements/${fixtureId}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            setDbElements(prev => prev.filter(el => el.id !== fixtureId));
            setRefreshKey((prev) => prev + 1);
          }
        } catch (error) {
          console.error('Failed to delete element:', error);
        }
      } else {
        FloorCanvasAPI.removeFixture(fixtureId);
      }
      setSelectedFixtureId(null);
    },
    [useDatabase]
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (useDatabase) {
      alert('Floor plan is automatically saved to the database!');
    } else {
      alert('Floor plan saved! (In production, this would save to the database)');
    }
    if (onSave) onSave();
  }, [onSave, useDatabase]);

  // Handle reset
  const handleReset = useCallback(async () => {
    if (window.confirm('Reset the floor plan to default? This will delete all fixtures.')) {
      if (useDatabase) {
        // Delete all elements
        for (const el of dbElements) {
          await fetch(`/api/floor-plan-elements/${el.id}`, { method: 'DELETE' });
        }
        setDbElements([]);
      } else {
        const fixtures = FloorCanvasAPI.getFixtures(selectedRoomId);
        fixtures.forEach((f) => FloorCanvasAPI.removeFixture(f.id));
      }
      setSelectedFixtureId(null);
      setRefreshKey((prev) => prev + 1);
    }
  }, [selectedRoomId, useDatabase, dbElements]);

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Delete key: delete selected fixture
      if (event.key === 'Delete' && selectedFixtureId) {
        handleFixtureDelete(selectedFixtureId);
      }

      // Escape key: deselect
      if (event.key === 'Escape') {
        setSelectedFixtureId(null);
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
  }, [selectedFixtureId, handleFixtureDelete]);

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
          {useDatabase && (
            <span style={{
              fontSize: 12,
              fontWeight: 400,
              marginLeft: 12,
              padding: '2px 8px',
              backgroundColor: '#e8f5e9',
              color: '#2e7d32',
              borderRadius: 4
            }}>
              Database Mode
            </span>
          )}
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

      {/* Room Selector - Database mode shows sections, in-memory mode shows FloorCanvasAPI rooms */}
      {useDatabase ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {dbSections.length === 0 ? (
            <div style={{ padding: '8px 16px', color: '#666', fontSize: 14 }}>
              No sections found.{' '}
              <button
                onClick={async () => {
                  const name = prompt('Enter section name:', 'Main Floor');
                  if (name && locationId) {
                    try {
                      const res = await fetch('/api/sections', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ locationId, name }),
                      });
                      if (res.ok) {
                        fetchSections();
                      }
                    } catch (e) {
                      console.error('Failed to create section:', e);
                    }
                  }
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #3498db',
                  backgroundColor: '#e3f2fd',
                  color: '#3498db',
                  cursor: 'pointer',
                }}
              >
                + Create Section
              </button>
            </div>
          ) : (
            <>
              {dbSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleRoomChange(section.id)}
                  style={{
                    minWidth: 120,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: selectedRoomId === section.id ? '2px solid #3498db' : '1px solid #ccc',
                    backgroundColor: selectedRoomId === section.id ? '#e3f2fd' : 'white',
                    cursor: 'pointer',
                    fontWeight: selectedRoomId === section.id ? 600 : 400,
                    fontSize: 14,
                  }}
                >
                  {section.name}
                </button>
              ))}
              <button
                onClick={async () => {
                  const name = prompt('Enter section name:');
                  if (name && locationId) {
                    try {
                      const res = await fetch('/api/sections', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ locationId, name }),
                      });
                      if (res.ok) {
                        fetchSections();
                      }
                    } catch (e) {
                      console.error('Failed to create section:', e);
                    }
                  }
                }}
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
            </>
          )}
        </div>
      ) : (
        <RoomSelector
          selectedRoomId={selectedRoomId}
          onRoomSelect={handleRoomChange}
        />
      )}

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
          <EditorCanvas
            roomId={selectedRoomId}
            toolMode={toolMode}
            fixtureType={fixtureType}
            selectedFixtureId={selectedFixtureId}
            refreshKey={refreshKey}
            onFixtureSelect={handleFixtureSelect}
            onFixtureUpdate={handleFixtureUpdate}
            onFixtureCreate={handleFixtureCreate}
            onFixtureDelete={handleFixtureDelete}
            // Database mode props
            useDatabase={useDatabase}
            dbFixtures={useDatabase ? dbElements.map(el => elementToFixture(el, selectedRoomId)) : undefined}
            dbFloorPlan={useDatabase ? (() => {
              const section = dbSections.find(s => s.id === selectedRoomId);
              if (!section) return undefined;
              return {
                id: section.id,
                name: section.name,
                widthFeet: section.widthFeet || 40,
                heightFeet: section.heightFeet || 30,
                gridSizeFeet: section.gridSizeFeet || 0.25,
              };
            })() : undefined}
          />
        </div>

        {/* Right Panel: Properties */}
        <div style={{ width: 250, flexShrink: 0, position: 'relative', zIndex: 10 }}>
          <FixtureProperties
            fixtureId={selectedFixtureId}
            onUpdate={handleFixtureUpdate}
            onDelete={handleFixtureDelete}
            // Database mode props
            useDatabase={useDatabase}
            dbFixtures={useDatabase ? dbElements.map(el => elementToFixture(el, selectedRoomId)) : undefined}
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

export default FloorPlanEditor;
