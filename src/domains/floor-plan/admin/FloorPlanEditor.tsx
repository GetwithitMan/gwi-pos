'use client';

/**
 * GWI POS - Floor Plan Domain
 * Floor Plan Editor Component
 *
 * Main editor interface for creating and editing floor plans.
 * NOW WITH DATABASE PERSISTENCE!
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { FloorCanvasAPI, RoomSelector } from '../canvas';
import { EditorCanvas } from './EditorCanvas';
import { FixtureToolbar } from './FixtureToolbar';
import { FixtureProperties } from './FixtureProperties';
import { TableProperties } from './TableProperties';
import { EntertainmentProperties } from './EntertainmentProperties';
import { AddEntertainmentPalette } from '@/components/floor-plan/AddEntertainmentPalette';
import type { EditorToolMode, FixtureType, EditorTable, TableShape } from './types';
import type { Fixture } from '../shared/types';
import {
  PIXELS_PER_FOOT,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
} from '@/lib/floorplan/constants';

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
  // Entertainment-specific fields
  linkedMenuItemId?: string;
  linkedMenuItem?: { name: string; price: number; blockTimeMinutes?: number };
  status?: string;
}

// =============================================================================
// DATABASE ↔ EDITOR CONVERSION
// =============================================================================
// Database stores positions in PIXELS for direct FOH rendering
// Editor canvas works in FEET (uses FloorCanvasAPI.feetToPixels for display)
// We convert: DB (pixels) ↔ Editor (feet) using PIXELS_PER_FOOT from constants

function pixelsToFeet(pixels: number): number {
  return pixels / PIXELS_PER_FOOT;
}

function feetToPixels(feet: number): number {
  return feet * PIXELS_PER_FOOT;
}

// Convert database element (PIXELS) to Fixture (FEET) for Editor
function elementToFixture(el: FloorPlanElement, sectionId: string): Fixture {
  // For database mode, we use posX/posY/width/height as the source of truth
  // The geometry field may be out of sync, so we reconstruct it from posX/posY/width/height
  const elementType = el.elementType || 'fixture';
  const geometry = el.geometry as { type: string; [key: string]: unknown } | null;
  const geoType = geometry?.type;

  let fixtureGeometry: Fixture['geometry'];

  if (geoType === 'line') {
    // For lines, use the geometry start/end if available, otherwise derive from posX/posY/width/height
    const geoStart = geometry?.start as { x: number; y: number } | undefined;
    const geoEnd = geometry?.end as { x: number; y: number } | undefined;

    // Convert from pixels to feet
    fixtureGeometry = {
      type: 'line',
      start: geoStart
        ? { x: pixelsToFeet(geoStart.x), y: pixelsToFeet(geoStart.y) }
        : { x: pixelsToFeet(el.posX), y: pixelsToFeet(el.posY) },
      end: geoEnd
        ? { x: pixelsToFeet(geoEnd.x), y: pixelsToFeet(geoEnd.y) }
        : { x: pixelsToFeet(el.posX + el.width), y: pixelsToFeet(el.posY) },
    };
  } else if (geoType === 'circle') {
    // For circles, reconstruct from posX/posY/width/height (more reliable)
    // posX/posY is top-left of bounding box, width=height=diameter
    const centerX = el.posX + el.width / 2;
    const centerY = el.posY + el.height / 2;
    const radius = el.width / 2;

    fixtureGeometry = {
      type: 'circle',
      center: { x: pixelsToFeet(centerX), y: pixelsToFeet(centerY) },
      radius: pixelsToFeet(radius),
    };
  } else {
    // Rectangle - use posX/posY/width/height (always reliable)
    fixtureGeometry = {
      type: 'rectangle',
      position: { x: pixelsToFeet(el.posX), y: pixelsToFeet(el.posY) },
      width: pixelsToFeet(el.width),
      height: pixelsToFeet(el.height),
      rotation: el.rotation || 0,
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
    thickness: pixelsToFeet(el.thickness || 10), // Convert thickness too
    height: null,
    blocksPlacement: true,
    blocksMovement: true,
    snapTarget: false,
    isActive: true,
  };
}

// Convert Fixture (FEET) to database element (PIXELS) for storage
function fixtureToElement(fixture: Omit<Fixture, 'id'> | Fixture): Partial<FloorPlanElement> & { geometry: unknown } {
  let posX = 0, posY = 0, width = 1, height = 1;

  // Extract positions in feet from fixture geometry
  if (fixture.geometry.type === 'rectangle') {
    posX = fixture.geometry.position.x;
    posY = fixture.geometry.position.y;
    width = fixture.geometry.width;
    height = fixture.geometry.height;
  } else if (fixture.geometry.type === 'circle') {
    // For circle, posX/posY should be top-left of bounding box
    posX = fixture.geometry.center.x - fixture.geometry.radius;
    posY = fixture.geometry.center.y - fixture.geometry.radius;
    width = fixture.geometry.radius * 2;
    height = fixture.geometry.radius * 2;
  } else if (fixture.geometry.type === 'line') {
    posX = Math.min(fixture.geometry.start.x, fixture.geometry.end.x);
    posY = Math.min(fixture.geometry.start.y, fixture.geometry.end.y);
    width = Math.abs(fixture.geometry.end.x - fixture.geometry.start.x) || 0.05; // minimum 1px
    height = Math.abs(fixture.geometry.end.y - fixture.geometry.start.y) || (fixture.thickness || 0.5);
  }

  // Build geometry in PIXELS for storage
  let dbGeometry: unknown;
  if (fixture.geometry.type === 'line') {
    dbGeometry = {
      type: 'line',
      start: {
        x: feetToPixels(fixture.geometry.start.x),
        y: feetToPixels(fixture.geometry.start.y),
      },
      end: {
        x: feetToPixels(fixture.geometry.end.x),
        y: feetToPixels(fixture.geometry.end.y),
      },
    };
  } else if (fixture.geometry.type === 'circle') {
    dbGeometry = {
      type: 'circle',
      center: {
        x: feetToPixels(fixture.geometry.center.x),
        y: feetToPixels(fixture.geometry.center.y),
      },
      radius: feetToPixels(fixture.geometry.radius),
    };
  } else if (fixture.geometry.type === 'rectangle') {
    dbGeometry = {
      type: 'rectangle',
      position: {
        x: feetToPixels(fixture.geometry.position.x),
        y: feetToPixels(fixture.geometry.position.y),
      },
      width: feetToPixels(fixture.geometry.width),
      height: feetToPixels(fixture.geometry.height),
      rotation: fixture.geometry.rotation || 0,
    };
  } else {
    // Fallback for other geometry types (polygon, arc) - store as-is
    dbGeometry = fixture.geometry;
  }

  const rotation = fixture.geometry.type === 'rectangle' ? (fixture.geometry.rotation || 0) : 0;

  return {
    name: fixture.label,
    elementType: 'fixture',
    visualType: fixture.type,
    geometry: dbGeometry,
    posX: feetToPixels(posX),
    posY: feetToPixels(posY),
    width: feetToPixels(width),
    height: feetToPixels(height),
    rotation,
    thickness: fixture.thickness ? feetToPixels(fixture.thickness) : undefined,
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
  const [tableShape, setTableShape] = useState<TableShape>('rectangle');

  // Selection
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);

  // Entertainment palette state
  const [isEntertainmentPaletteOpen, setIsEntertainmentPaletteOpen] = useState(false);
  const [placedEntertainmentIds, setPlacedEntertainmentIds] = useState<string[]>([]);

  // Force refresh key for immediate updates (eliminates polling lag)
  const [refreshKey, setRefreshKey] = useState(0);

  // Zoom control state and ref
  const [currentZoom, setCurrentZoom] = useState(1);
  const zoomControlRef = useRef<{
    fitToScreen: () => void;
    resetZoom: () => void;
    setZoom: (z: number) => void;
    zoom: number;
  } | null>(null);

  // Database state
  const [dbElements, setDbElements] = useState<FloorPlanElement[]>([]);
  const [dbTables, setDbTables] = useState<EditorTable[]>([]);
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

  // Check if selected fixture is entertainment
  const selectedEntertainmentElement = useMemo(() => {
    if (!selectedFixtureId) return null;

    // Check dbElements for entertainment type
    const element = dbElements.find(el =>
      el.id === selectedFixtureId &&
      el.elementType === 'entertainment'
    );

    return element || null;
  }, [selectedFixtureId, dbElements]);

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

  // Fetch tables from database
  const fetchTables = useCallback(async () => {
    if (!useDatabase || !selectedRoomId || !locationId) return;

    try {
      const response = await fetch(`/api/tables?locationId=${locationId}&sectionId=${selectedRoomId}&includeSeats=true`);
      if (response.ok) {
        const data = await response.json();
        // Map API response to EditorTable format
        const editorTables: EditorTable[] = (data.tables || []).map((t: Record<string, unknown>) => ({
          id: t.id as string,
          name: t.name as string,
          abbreviation: t.abbreviation as string | null,
          capacity: t.capacity as number,
          posX: t.posX as number,
          posY: t.posY as number,
          width: t.width as number,
          height: t.height as number,
          rotation: t.rotation as number,
          shape: (t.shape as TableShape) || 'rectangle',
          seatPattern: (t.seatPattern as EditorTable['seatPattern']) || 'all_around',
          sectionId: t.section ? (t.section as { id: string }).id : null,
          status: (t.status as string) || 'available',
          isLocked: (t.isLocked as boolean) || false,
          seats: (t.seats as EditorTable['seats']) || [],
        }));
        setDbTables(editorTables);
      }
    } catch (error) {
      console.error('Failed to fetch tables:', error);
    }
  }, [useDatabase, selectedRoomId, locationId]);

  // Load tables when room changes (database mode)
  useEffect(() => {
    if (useDatabase) {
      fetchTables();
    }
  }, [useDatabase, fetchTables]);

  // Handle room change
  const handleRoomChange = useCallback((roomId: string) => {
    setSelectedRoomId(roomId);
    if (!useDatabase) {
      FloorCanvasAPI.setActiveRoom(roomId);
    }
    setSelectedFixtureId(null);
  }, [useDatabase]);

  // Track which entertainment items are already placed
  useEffect(() => {
    if (useDatabase) {
      const entertainmentIds = dbElements
        .filter(el => el.linkedMenuItemId)
        .map(el => el.linkedMenuItemId as string);
      setPlacedEntertainmentIds(entertainmentIds);
    } else {
      const fixtures = FloorCanvasAPI.getFixtures(selectedRoomId);
      const entertainmentIds = fixtures
        .filter(f => f.type === 'entertainment' && (f as any).linkedMenuItemId)
        .map(f => (f as any).linkedMenuItemId as string);
      setPlacedEntertainmentIds(entertainmentIds);
    }
  }, [useDatabase, dbElements, selectedRoomId]);

  // Handle tool change
  const handleToolChange = useCallback((tool: EditorToolMode) => {
    setToolMode(tool);
    setSelectedFixtureId(null);
    setSelectedTableId(null);
  }, []);

  // Handle fixture type change
  const handleFixtureTypeChange = useCallback((type: FixtureType) => {
    setFixtureType(type);
  }, []);

  // Handle table shape change
  const handleTableShapeChange = useCallback((shape: TableShape) => {
    setTableShape(shape);
  }, []);

  // Handle fixture selection
  const handleFixtureSelect = useCallback((fixtureId: string | null) => {
    setSelectedFixtureId(fixtureId);
    if (fixtureId) {
      setToolMode('SELECT');
      setSelectedTableId(null); // Deselect table when fixture selected
    }
  }, []);

  // Handle table selection
  const handleTableSelect = useCallback((tableId: string | null) => {
    setSelectedTableId(tableId);
    if (tableId) {
      setToolMode('SELECT');
      setSelectedFixtureId(null); // Deselect fixture when table selected
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
            body: JSON.stringify({
              locationId: locationId || '',
              ...elementData,
            }),
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
    [useDatabase, dbElements, selectedRoomId, locationId]
  );

  // Handle fixture deletion
  const handleFixtureDelete = useCallback(
    async (fixtureId: string) => {
      if (useDatabase) {
        try {
          const response = await fetch(`/api/floor-plan-elements/${fixtureId}?locationId=${locationId}`, {
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
    [useDatabase, locationId]
  );

  // Handle entertainment update
  const handleEntertainmentUpdate = useCallback(async (updates: {
    visualType?: string;
    width?: number;
    height?: number;
    rotation?: number;
  }) => {
    if (!selectedEntertainmentElement || !locationId) return;

    try {
      const response = await fetch(`/api/floor-plan-elements/${selectedEntertainmentElement.id}?locationId=${locationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          ...updates,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setDbElements(prev => prev.map(el =>
          el.id === selectedEntertainmentElement.id ? { ...el, ...data.element } : el
        ));
        setRefreshKey(prev => prev + 1);
      }
    } catch (error) {
      console.error('Failed to update entertainment:', error);
    }
  }, [selectedEntertainmentElement, locationId]);

  // Handle entertainment delete
  const handleEntertainmentDelete = useCallback(async () => {
    if (!selectedEntertainmentElement || !locationId) return;

    try {
      const response = await fetch(`/api/floor-plan-elements/${selectedEntertainmentElement.id}?locationId=${locationId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Remove from local state
        setDbElements(prev => prev.filter(el => el.id !== selectedEntertainmentElement.id));
        // Remove from placed IDs
        if (selectedEntertainmentElement.linkedMenuItemId) {
          setPlacedEntertainmentIds(prev =>
            prev.filter(id => id !== selectedEntertainmentElement.linkedMenuItemId)
          );
        }
        // Clear selection
        setSelectedFixtureId(null);
        setRefreshKey(prev => prev + 1);
      }
    } catch (error) {
      console.error('Failed to delete entertainment:', error);
    }
  }, [selectedEntertainmentElement, locationId]);

  // Handle adding entertainment element from palette
  const handleAddEntertainment = useCallback(async (element: {
    name: string;
    visualType: string;
    linkedMenuItemId: string;
    width: number;
    height: number;
  }) => {
    if (!locationId) return;

    try {
      const response = await fetch('/api/floor-plan-elements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          sectionId: selectedRoomId,
          name: element.name,
          elementType: 'entertainment',
          visualType: element.visualType,
          linkedMenuItemId: element.linkedMenuItemId,
          posX: 200,
          posY: 200,
          width: element.width,
          height: element.height,
          rotation: 0,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newFixture = elementToFixture(data.element, selectedRoomId || '');
        setDbElements(prev => [...prev, data.element]);
        setPlacedEntertainmentIds(prev => [...prev, element.linkedMenuItemId]);
        setRefreshKey((prev) => prev + 1);
      }
    } catch (error) {
      console.error('Failed to add entertainment:', error);
    }
  }, [locationId, selectedRoomId]);

  // Handle table creation
  const handleTableCreate = useCallback(
    async (tableData: Omit<EditorTable, 'id'>) => {
      if (!useDatabase || !locationId) return;

      try {
        const response = await fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            sectionId: selectedRoomId,
            name: tableData.name,
            abbreviation: tableData.abbreviation,
            capacity: tableData.capacity,
            posX: tableData.posX,
            posY: tableData.posY,
            width: tableData.width,
            height: tableData.height,
            rotation: tableData.rotation,
            shape: tableData.shape,
            seatPattern: tableData.seatPattern,
            skipSeatGeneration: true,
          }),
        });

        if (response.ok) {
          await fetchTables();
          setRefreshKey((prev) => prev + 1);
        }
      } catch (error) {
        console.error('Failed to create table:', error);
      }
    },
    [useDatabase, locationId, selectedRoomId, fetchTables]
  );

  // Handle table update
  const handleTableUpdate = useCallback(
    async (tableId: string, updates: Partial<EditorTable>) => {
      if (!useDatabase) return;

      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (response.ok) {
          // Update local state immediately for responsiveness
          setDbTables(prev => prev.map(t =>
            t.id === tableId ? { ...t, ...updates } : t
          ));
          setRefreshKey((prev) => prev + 1);
        }
      } catch (error) {
        console.error('Failed to update table:', error);
      }
    },
    [useDatabase]
  );

  // Handle table deletion
  const handleTableDelete = useCallback(
    async (tableId: string) => {
      if (!useDatabase) return;

      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          setDbTables(prev => prev.filter(t => t.id !== tableId));
          setSelectedTableId(null);
          setRefreshKey((prev) => prev + 1);
        }
      } catch (error) {
        console.error('Failed to delete table:', error);
      }
    },
    [useDatabase]
  );

  // Handle regenerate seats for a table
  const handleRegenerateSeats = useCallback(
    async (tableId: string) => {
      if (!useDatabase) return;

      // Get the current table to use its capacity and pattern
      const table = dbTables.find(t => t.id === tableId);
      if (!table) return;

      // Clear any selected seat for this table to prevent stale references
      setSelectedSeatId(null);

      try {
        const response = await fetch(`/api/tables/${tableId}/seats/auto-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            count: table.capacity,
            seatPattern: table.seatPattern,
            replaceExisting: true,
            checkCollisions: true,
            forceGenerate: false, // Will prompt user if collisions detected
          }),
        });

        const data = await response.json();

        if (response.status === 409 && data.warning) {
          // Collision detected - ask user if they want to force generate
          const collisionCount = data.collisions?.length || 0;
          const collisionTypes = data.collisions?.map((c: { collidedWith: string }) => c.collidedWith).slice(0, 3).join(', ');
          const confirmed = window.confirm(
            `⚠️ Seat Collision Warning\n\n` +
            `${collisionCount} seat(s) would collide with: ${collisionTypes}${collisionCount > 3 ? '...' : ''}\n\n` +
            `Options:\n` +
            `• Click "Cancel" to abort and move/resize the table first\n` +
            `• Click "OK" to generate seats anyway (they may overlap)`
          );

          if (confirmed) {
            // Force generate despite collisions
            const forceResponse = await fetch(`/api/tables/${tableId}/seats/auto-generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                count: table.capacity,
                seatPattern: table.seatPattern,
                replaceExisting: true,
                checkCollisions: true,
                forceGenerate: true,
              }),
            });

            if (forceResponse.ok) {
              await fetchTables();
              setTimeout(() => setRefreshKey((prev) => prev + 1), 50);
            }
          }
          return;
        }

        if (response.ok) {
          // Check if there was a collision warning even with successful generation
          if (data.warning && data.collisions?.length > 0) {
            console.warn('Seats generated with collisions:', data.collisions);
          }
          // Refresh tables first, then increment key to trigger re-render
          await fetchTables();
          // Small delay to ensure state has propagated
          setTimeout(() => {
            setRefreshKey((prev) => prev + 1);
          }, 50);
        } else {
          console.error('Failed to regenerate seats:', data);
          alert('Failed to regenerate seats: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to regenerate seats:', error);
        alert('Failed to regenerate seats. Check console for details.');
      }
    },
    [useDatabase, dbTables, fetchTables]
  );

  // Handle seat reflow when table is resized
  const handleSeatsReflow = useCallback(
    async (tableId: string, dimensions: {
      oldWidth: number;
      oldHeight: number;
      newWidth: number;
      newHeight: number;
    }) => {
      if (!useDatabase) return;

      try {
        const response = await fetch(`/api/tables/${tableId}/seats/reflow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dimensions),
        });

        if (response.ok) {
          await fetchTables();
          setRefreshKey((prev) => prev + 1);
        }
      } catch (error) {
        console.error('Failed to reflow seats:', error);
      }
    },
    [useDatabase, fetchTables]
  );

  // Handle seat update (for manual dragging)
  const handleSeatUpdate = useCallback(
    async (seatId: string, updates: { relativeX?: number; relativeY?: number }) => {
      if (!useDatabase) return;

      try {
        const response = await fetch(`/api/seats/${seatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (response.ok) {
          await fetchTables();
          setRefreshKey((prev) => prev + 1);
        }
      } catch (error) {
        console.error('Failed to update seat:', error);
      }
    },
    [useDatabase, fetchTables]
  );

  // Extract flat seats array from tables for EditorCanvas
  const dbSeats = React.useMemo(() => {
    if (!useDatabase) return undefined;
    return dbTables.flatMap(table =>
      (table.seats || []).map(seat => ({
        ...seat,
        tableId: table.id,
      }))
    );
  }, [useDatabase, dbTables]);

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
      // Delete key: delete selected fixture or table
      if (event.key === 'Delete') {
        if (selectedFixtureId) {
          handleFixtureDelete(selectedFixtureId);
        } else if (selectedTableId) {
          handleTableDelete(selectedTableId);
        }
      }

      // Escape key: deselect
      if (event.key === 'Escape') {
        setSelectedFixtureId(null);
        setSelectedTableId(null);
        setToolMode('SELECT');
      }

      // Number keys: quick tool select
      if (event.key === '1') setToolMode('SELECT');
      if (event.key === '2') setToolMode('TABLE');
      if (event.key === '3') setToolMode('WALL');
      if (event.key === '4') setToolMode('RECTANGLE');
      if (event.key === '5') setToolMode('CIRCLE');
      if (event.key === '6') setToolMode('DELETE');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFixtureId, selectedTableId, handleFixtureDelete, handleTableDelete]);

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

          {/* Add Entertainment Button */}
          {useDatabase && (
            <button
              onClick={() => setIsEntertainmentPaletteOpen(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#9333ea',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🎮</span>
              <span>Add Entertainment</span>
            </button>
          )}

          {/* Zoom Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 16,
            padding: '4px 12px',
            backgroundColor: '#f5f5f5',
            borderRadius: 6,
          }}>
            <button
              onClick={() => zoomControlRef.current?.setZoom(Math.max(ZOOM_MIN, currentZoom - ZOOM_STEP))}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 4,
                backgroundColor: '#e0e0e0',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 'bold',
              }}
              title="Zoom Out"
            >
              −
            </button>

            <span style={{
              minWidth: 50,
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 500,
            }}>
              {Math.round(currentZoom * 100)}%
            </span>

            <button
              onClick={() => zoomControlRef.current?.setZoom(Math.min(ZOOM_MAX, currentZoom + ZOOM_STEP))}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 4,
                backgroundColor: '#e0e0e0',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 'bold',
              }}
              title="Zoom In"
            >
              +
            </button>

            <div style={{ width: 1, height: 20, backgroundColor: '#ccc', margin: '0 4px' }} />

            <button
              onClick={() => zoomControlRef.current?.fitToScreen()}
              style={{
                padding: '4px 8px',
                border: 'none',
                borderRadius: 4,
                backgroundColor: '#e0e0e0',
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Fit to Screen"
            >
              Fit
            </button>

            <button
              onClick={() => zoomControlRef.current?.resetZoom()}
              style={{
                padding: '4px 8px',
                border: 'none',
                borderRadius: 4,
                backgroundColor: '#e0e0e0',
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Reset to 100%"
            >
              100%
            </button>
          </div>
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
            selectedTableShape={tableShape}
            onToolSelect={handleToolChange}
            onFixtureTypeSelect={handleFixtureTypeChange}
            onTableShapeSelect={handleTableShapeChange}
          />
        </div>

        {/* Center: Canvas */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0, paddingLeft: 8 }}>
          <EditorCanvas
            roomId={selectedRoomId}
            toolMode={toolMode}
            fixtureType={fixtureType}
            tableShape={tableShape}
            selectedFixtureId={selectedFixtureId}
            selectedTableId={selectedTableId}
            refreshKey={refreshKey}
            onFixtureSelect={handleFixtureSelect}
            onFixtureUpdate={handleFixtureUpdate}
            onFixtureCreate={handleFixtureCreate}
            onFixtureDelete={handleFixtureDelete}
            // Table handling
            onTableSelect={handleTableSelect}
            onTableCreate={handleTableCreate}
            onTableUpdate={handleTableUpdate}
            onTableDelete={handleTableDelete}
            // Seat handling
            dbSeats={dbSeats}
            onSeatSelect={setSelectedSeatId}
            onSeatUpdate={handleSeatUpdate}
            onSeatsReflow={handleSeatsReflow}
            // Database mode props
            useDatabase={useDatabase}
            dbFixtures={useDatabase ? dbElements.map(el => elementToFixture(el, selectedRoomId)) : undefined}
            dbTables={useDatabase ? dbTables : undefined}
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
            // Zoom control props
            onZoomChange={setCurrentZoom}
            zoomControlRef={zoomControlRef}
          />
        </div>

        {/* Right Panel: Properties */}
        <div style={{ width: 250, flexShrink: 0, position: 'relative', zIndex: 10 }}>
          {/* Show TableProperties when a table is selected, EntertainmentProperties when entertainment selected, otherwise FixtureProperties */}
          {selectedTableId ? (
            <TableProperties
              table={dbTables.find(t => t.id === selectedTableId) || null}
              onUpdate={handleTableUpdate}
              onDelete={handleTableDelete}
              onRegenerateSeats={handleRegenerateSeats}
            />
          ) : selectedEntertainmentElement ? (
            <EntertainmentProperties
              element={{
                id: selectedEntertainmentElement.id,
                name: selectedEntertainmentElement.name || '',
                visualType: selectedEntertainmentElement.visualType || 'game_table',
                linkedMenuItemId: selectedEntertainmentElement.linkedMenuItemId,
                linkedMenuItem: selectedEntertainmentElement.linkedMenuItem,
                width: selectedEntertainmentElement.width || 100,
                height: selectedEntertainmentElement.height || 60,
                rotation: selectedEntertainmentElement.rotation || 0,
                status: selectedEntertainmentElement.status,
              }}
              onUpdate={handleEntertainmentUpdate}
              onDelete={handleEntertainmentDelete}
            />
          ) : (
            <FixtureProperties
              fixtureId={selectedFixtureId}
              onUpdate={handleFixtureUpdate}
              onDelete={handleFixtureDelete}
              // Database mode props
              useDatabase={useDatabase}
              dbFixtures={useDatabase ? dbElements.map(el => elementToFixture(el, selectedRoomId)) : undefined}
            />
          )}
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
          1: Select | 2: Table | 3: Wall | 4: Fixture | 5: Circle | 6: Delete | Del: Remove | Esc: Deselect
        </span>
      </div>

      {/* Entertainment Palette Modal */}
      {useDatabase && (
        <AddEntertainmentPalette
          isOpen={isEntertainmentPaletteOpen}
          onClose={() => setIsEntertainmentPaletteOpen(false)}
          locationId={locationId || ''}
          selectedSectionId={selectedRoomId}
          placedMenuItemIds={placedEntertainmentIds}
          onAddElement={handleAddEntertainment}
        />
      )}
    </div>
  );
}

export default FloorPlanEditor;
