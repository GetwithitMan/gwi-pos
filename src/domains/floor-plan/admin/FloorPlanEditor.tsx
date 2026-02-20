'use client';

/**
 * GWI POS - Floor Plan Domain
 * Floor Plan Editor Component
 *
 * Main editor interface for creating and editing floor plans.
 * NOW WITH DATABASE PERSISTENCE!
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
} from '@/lib/floorplan/constants';
import { logger } from '@/lib/logger';
import { toast } from '@/stores/toast-store';
import { type FloorPlanElement, elementToFixture, fixtureToElement } from './db-conversion';

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
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null);
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
      logger.error('Failed to fetch sections:', error);
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
      logger.error('Failed to fetch floor plan elements:', error);
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
      logger.error('Failed to fetch tables:', error);
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
        .filter(f => (f as any).linkedMenuItemId)
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
          logger.error('Failed to create element:', error);
          toast.error('Failed to create element');
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
        // Capture original state for rollback
        let originalElements: FloorPlanElement[] = [];
        let currentElement: FloorPlanElement | undefined;

        setDbElements(prev => {
          originalElements = prev;
          currentElement = prev.find(el => el.id === fixtureId);
          return prev;
        });

        if (!currentElement) return;

        try {
          // Convert current element to fixture, apply updates, then convert back
          const currentFixture = elementToFixture(currentElement, selectedRoomId);
          const updatedFixture = { ...currentFixture, ...updates };

          // If geometry is being updated, merge it properly
          if (updates.geometry) {
            updatedFixture.geometry = updates.geometry;
          }

          const elementData = fixtureToElement(updatedFixture);

          // Optimistic update - update UI immediately
          setDbElements(prev => prev.map(el =>
            el.id === fixtureId
              ? { ...el, ...elementData } as FloorPlanElement
              : el
          ));

          const response = await fetch(`/api/floor-plan-elements/${fixtureId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationId: locationId || '',
              ...elementData,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Failed to update fixture (HTTP ${response.status})`);
          }

          setRefreshKey((prev) => prev + 1);
          // Note: No success toast for drag operations to avoid spam
        } catch (error) {
          // Rollback on failure
          setDbElements(originalElements);

          // Show error to user
          toast.error(`Failed to save fixture: ${error instanceof Error ? error.message : 'Unknown error'}`);

          // Log for debugging
          logger.error('Fixture update failed:', { fixtureId, updates, error });
        }
      } else {
        FloorCanvasAPI.updateFixture(fixtureId, updates);
        setRefreshKey((prev) => prev + 1);
      }
    },
    [useDatabase, selectedRoomId, locationId]
  );

  // Handle fixture deletion
  const handleFixtureDelete = useCallback(
    async (fixtureId: string) => {
      if (useDatabase) {
        // Capture original state for rollback
        let originalElements: FloorPlanElement[] = [];
        let originalSelectedFixtureId: string | null = null;

        // Optimistic update - remove from UI immediately and capture state
        setDbElements(prev => {
          originalElements = prev;
          return prev.filter(el => el.id !== fixtureId);
        });
        setSelectedFixtureId(prev => {
          originalSelectedFixtureId = prev;
          return null;
        });

        try {
          const response = await fetch(`/api/floor-plan-elements/${fixtureId}?locationId=${locationId}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Failed to delete fixture (HTTP ${response.status})`);
          }

          setRefreshKey((prev) => prev + 1);
          toast.success('Fixture deleted');
        } catch (error) {
          // Rollback on failure
          setDbElements(originalElements);
          setSelectedFixtureId(originalSelectedFixtureId);

          // Show error to user
          toast.error(`Failed to delete fixture: ${error instanceof Error ? error.message : 'Unknown error'}`);

          // Log for debugging
          logger.error('Fixture delete failed:', { fixtureId, error });
        }
      } else {
        FloorCanvasAPI.removeFixture(fixtureId);
        setSelectedFixtureId(null);
      }
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

    // Capture original state for rollback
    let originalElements: FloorPlanElement[] = [];

    // Optimistic update and capture previous state
    setDbElements(prev => {
      originalElements = prev;
      return prev.map(el =>
        el.id === selectedEntertainmentElement.id ? { ...el, ...updates } : el
      );
    });

    try {
      const response = await fetch(`/api/floor-plan-elements/${selectedEntertainmentElement.id}?locationId=${locationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          ...updates,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Failed to update entertainment (HTTP ${response.status})`);
      }

      setRefreshKey(prev => prev + 1);
      // Note: No success toast for drag/resize operations to avoid spam
    } catch (error) {
      // Rollback on failure
      setDbElements(originalElements);

      // Show error to user
      toast.error(`Failed to save entertainment: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Log for debugging
      logger.error('Entertainment update failed:', { elementId: selectedEntertainmentElement.id, updates, error });
    }
  }, [selectedEntertainmentElement, locationId]);

  // Handle entertainment delete
  const handleEntertainmentDelete = useCallback(async () => {
    if (!selectedEntertainmentElement || !locationId) return;

    // Capture original state for rollback
    let originalElements: FloorPlanElement[] = [];
    let originalPlacedIds: string[] = [];
    let originalSelectedFixtureId: string | null = null;

    // Optimistic update and capture state
    setDbElements(prev => {
      originalElements = prev;
      return prev.filter(el => el.id !== selectedEntertainmentElement.id);
    });

    if (selectedEntertainmentElement.linkedMenuItemId) {
      setPlacedEntertainmentIds(prev => {
        originalPlacedIds = prev;
        return prev.filter(id => id !== selectedEntertainmentElement.linkedMenuItemId);
      });
    }

    setSelectedFixtureId(prev => {
      originalSelectedFixtureId = prev;
      return null;
    });

    try {
      const response = await fetch(`/api/floor-plan-elements/${selectedEntertainmentElement.id}?locationId=${locationId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Failed to delete entertainment (HTTP ${response.status})`);
      }

      setRefreshKey(prev => prev + 1);
      toast.success('Entertainment element deleted');
    } catch (error) {
      // Rollback on failure
      setDbElements(originalElements);
      setPlacedEntertainmentIds(originalPlacedIds);
      setSelectedFixtureId(originalSelectedFixtureId);

      // Show error to user
      toast.error(`Failed to delete entertainment: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Log for debugging
      logger.error('Entertainment delete failed:', { elementId: selectedEntertainmentElement.id, error });
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
      logger.error('Failed to add entertainment:', error);
      toast.error('Failed to add entertainment element');
    }
  }, [locationId, selectedRoomId]);

  // Handle table creation — retries with incremented name on duplicate (409)
  const handleTableCreate = useCallback(
    async (tableData: Omit<EditorTable, 'id'>) => {
      if (!useDatabase || !locationId) return;

      let name = tableData.name;
      let abbreviation = tableData.abbreviation;
      let attempts = 0;
      const MAX_ATTEMPTS = 50;

      while (attempts < MAX_ATTEMPTS) {
        try {
          const response = await fetch('/api/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationId,
              sectionId: selectedRoomId,
              name,
              abbreviation,
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
            return;
          }

          if (response.status === 409) {
            // Duplicate name — increment and retry
            attempts++;
            const match = name.match(/^(.+?)(\d+)$/);
            if (match) {
              const num = parseInt(match[2], 10) + 1;
              name = `${match[1]}${num}`;
              abbreviation = `T${num}`;
            } else {
              name = `${name} ${attempts + 1}`;
              abbreviation = `${abbreviation}${attempts + 1}`;
            }
            continue;
          }

          // Other error
          const errData = await response.json().catch(() => ({}));
          logger.error('Failed to create table:', errData.error || response.statusText);
          toast.error(`Failed to create table: ${errData.error || response.statusText}`);
          return;
        } catch (error) {
          logger.error('Failed to create table:', error);
          toast.error('Failed to create table');
          return;
        }
      }
    },
    [useDatabase, locationId, selectedRoomId, fetchTables]
  );

  // Handle table update
  const handleTableUpdate = useCallback(
    async (tableId: string, updates: Partial<EditorTable>) => {
      if (!useDatabase) return;

      // Capture original state in closure for rollback
      let originalTables: EditorTable[] = [];

      // Optimistic update - update UI immediately and capture previous state
      setDbTables(prev => {
        originalTables = prev; // Capture before update
        return prev.map(t => t.id === tableId ? { ...t, ...updates } : t);
      });

      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...updates, locationId }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Failed to update table (HTTP ${response.status})`);
        }

        setRefreshKey((prev) => prev + 1);
        // Note: No success toast for drag operations to avoid spam
      } catch (error) {
        // Rollback to original state on failure
        setDbTables(originalTables);

        // Show error to user
        toast.error(`Failed to save table: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Log for debugging
        logger.error('Table update failed:', { tableId, updates, error });
      }
    },
    [useDatabase]
  );

  // Handle table deletion
  const handleTableDelete = useCallback(
    async (tableId: string) => {
      if (!useDatabase) return;

      // Capture original state for rollback
      let originalTables: EditorTable[] = [];
      let originalSelectedTableId: string | null = null;

      // Optimistic update - remove from UI immediately and capture state
      setDbTables(prev => {
        originalTables = prev;
        return prev.filter(t => t.id !== tableId);
      });
      setSelectedTableId(prev => {
        originalSelectedTableId = prev;
        return null;
      });

      try {
        const response = await fetch(`/api/tables/${tableId}?locationId=${locationId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Failed to delete table (HTTP ${response.status})`);
        }

        setRefreshKey((prev) => prev + 1);
        toast.success('Table deleted');
      } catch (error) {
        // Rollback on failure
        setDbTables(originalTables);
        setSelectedTableId(originalSelectedTableId);

        // Show error to user
        toast.error(`Failed to delete table: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Log for debugging
        logger.error('Table delete failed:', { tableId, error });
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
          setConfirmAction({
            title: 'Seat Collision Warning',
            message: `${collisionCount} seat(s) would collide with: ${collisionTypes}${collisionCount > 3 ? '...' : ''}\n\nGenerate seats anyway? They may overlap.`,
            action: async () => {
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
            },
          });
          return;
        }

        if (response.ok) {
          // Check if there was a collision warning even with successful generation
          if (data.warning && data.collisions?.length > 0) {
            logger.warn('Seats generated with collisions:', data.collisions);
          }
          // Refresh tables first, then increment key to trigger re-render
          await fetchTables();
          // Small delay to ensure state has propagated
          setTimeout(() => {
            setRefreshKey((prev) => prev + 1);
          }, 50);
        } else {
          logger.error('Failed to regenerate seats:', data);
          toast.error('Failed to regenerate seats: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        logger.error('Failed to regenerate seats:', error);
        toast.error('Failed to regenerate seats');
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

      // Capture original state for rollback
      let originalTables: EditorTable[] = [];
      setDbTables(prev => {
        originalTables = prev;
        return prev;
      });

      try {
        const response = await fetch(`/api/tables/${tableId}/seats/reflow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dimensions),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Failed to reflow seats (HTTP ${response.status})`);
        }

        await fetchTables();
        setRefreshKey((prev) => prev + 1);
      } catch (error) {
        // Rollback by restoring original tables
        setDbTables(originalTables);

        // Show error to user
        toast.error(`Failed to reflow seats: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Log for debugging
        logger.error('Seat reflow failed:', { tableId, dimensions, error });
      }
    },
    [useDatabase, fetchTables]
  );

  // Handle seat update (for manual dragging)
  const handleSeatUpdate = useCallback(
    async (seatId: string, updates: { relativeX?: number; relativeY?: number }) => {
      if (!useDatabase) return;

      // Capture original state for rollback
      let originalTables: EditorTable[] = [];
      setDbTables(prev => {
        originalTables = prev;
        return prev;
      });

      try {
        const response = await fetch(`/api/seats/${seatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Failed to update seat (HTTP ${response.status})`);
        }

        await fetchTables();
        setRefreshKey((prev) => prev + 1);
        // Note: No success toast for drag operations to avoid spam
      } catch (error) {
        // Rollback by restoring original tables
        setDbTables(originalTables);

        // Show error to user
        toast.error(`Failed to save seat position: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Log for debugging
        logger.error('Seat update failed:', { seatId, updates, error });
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
      toast.success('Floor plan is automatically saved to the database');
    } else {
      toast.success('Floor plan saved');
    }
    if (onSave) onSave();
  }, [onSave, useDatabase]);

  // Handle reset
  const handleReset = useCallback(() => {
    setConfirmAction({
      title: 'Reset Floor Plan',
      message: 'Reset the floor plan to default? This will delete all fixtures.',
      action: async () => {
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
      },
    });
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
                      logger.error('Failed to create section:', e);
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
                      logger.error('Failed to create section:', e);
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
              existingTableNames={dbTables.map(t => t.name)}
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

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm'}
        description={confirmAction?.message}
        confirmLabel="Confirm"
        destructive
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

export default FloorPlanEditor;
