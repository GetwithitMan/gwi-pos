'use client';

/**
 * GWI POS - Floor Plan Test Page (Frontend / FOH View)
 *
 * Visual test page for the Floor Plan domain components.
 * Access at: http://localhost:3000/test-floorplan
 *
 * This page receives real-time updates from the Editor via socket events.
 * Changes made in /test-floorplan/editor will appear here automatically.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { FloorCanvas, RoomSelector, FloorCanvasAPI } from '@/domains/floor-plan/canvas';
import { Table as TableComponent, SmartObject, TableAPI } from '@/domains/floor-plan/tables';
import { Seat, SeatAPI } from '@/domains/floor-plan/seats';
import type { Point, Table, Seat as SeatType, Fixture } from '@/domains/floor-plan/shared/types';
import { sampleFloorPlans, sampleFixtures, sampleTables } from './sampleData';
import { PIXELS_PER_FOOT } from '@/lib/floorplan/constants';

// =============================================================================
// DATABASE FIXTURE CONVERSION
// =============================================================================
// IMPORTANT: Database stores positions in PIXELS for direct rendering
// These fixtures are rendered DIRECTLY using pixel values (no feet conversion)

interface DbFloorPlanElement {
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
  sectionId: string | null;
}

interface DbSeat {
  id: string;
  label: string;
  seatNumber: number;
  relativeX: number;
  relativeY: number;
  angle: number;
  seatType: string;
}

interface DbTable {
  id: string;
  name: string;
  abbreviation: string | null;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: string;
  status: string;
  section: { id: string; name: string; color: string | null } | null;
  seats: DbSeat[];
}

// Convert database element to a "pixel fixture" for DIRECT rendering (no feet conversion)
// The returned fixture has geometry in PIXELS, not feet
interface PixelFixture {
  id: string;
  floorPlanId: string;
  roomId: string;
  type: string;
  category: string;
  label: string;
  geometry: {
    type: 'rectangle';
    position: { x: number; y: number };
    width: number;
    height: number;
    rotation: number;
  } | {
    type: 'circle';
    center: { x: number; y: number };
    radius: number;
  } | {
    type: 'line';
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  color: string;
  opacity: number;
  thickness: number;
  isActive: boolean;
}

function dbElementToPixelFixture(el: DbFloorPlanElement, roomId: string): PixelFixture {
  const geometry = el.geometry as { type: string; [key: string]: unknown } | null;

  let fixtureGeometry: PixelFixture['geometry'];
  if (geometry?.type === 'line') {
    fixtureGeometry = {
      type: 'line',
      start: (geometry.start as { x: number; y: number }) || { x: el.posX, y: el.posY },
      end: (geometry.end as { x: number; y: number }) || { x: el.posX + el.width, y: el.posY },
    };
  } else if (geometry?.type === 'circle') {
    // For circles, reconstruct from posX/posY/width/height (bounding box)
    const centerX = el.posX + el.width / 2;
    const centerY = el.posY + el.height / 2;
    const radius = el.width / 2;
    fixtureGeometry = {
      type: 'circle',
      center: { x: centerX, y: centerY },
      radius: radius,
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
    floorPlanId: roomId,
    roomId: roomId,
    type: el.visualType || 'custom_fixture',
    category: 'barrier',
    label: el.name,
    geometry: fixtureGeometry,
    color: el.fillColor || '#666666',
    opacity: el.opacity,
    thickness: el.thickness,
    isActive: true,
  };
}

// =============================================================================
// DATABASE FIXTURE RENDERER (PIXELS - NO CONVERSION)
// =============================================================================
// Renders fixtures using PIXEL coordinates directly from the database
// NO feetToPixels conversion because DB already stores pixels

interface DbFixtureRendererProps {
  fixture: PixelFixture;
  onClick?: () => void;
}

function DbFixtureRenderer({ fixture, onClick }: DbFixtureRendererProps) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: fixture.color,
    opacity: fixture.opacity,
    cursor: onClick ? 'pointer' : 'default',
    border: '1px solid rgba(0,0,0,0.2)',
  };

  // Render based on geometry type - using PIXEL values directly
  if (fixture.geometry.type === 'rectangle') {
    const { position, width, height, rotation } = fixture.geometry;
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: position.x,  // Already in pixels
          top: position.y,   // Already in pixels
          width: width,      // Already in pixels
          height: height,    // Already in pixels
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'circle') {
    const { center, radius } = fixture.geometry;
    const diameter = radius * 2;
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: center.x - radius,  // Already in pixels
          top: center.y - radius,   // Already in pixels
          width: diameter,          // Already in pixels
          height: diameter,         // Already in pixels
          borderRadius: '50%',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'line') {
    const { start, end } = fixture.geometry;
    const thickness = fixture.thickness || 10; // Default thickness in pixels
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: start.x,              // Already in pixels
          top: start.y - thickness / 2, // Already in pixels
          width: length,              // Already in pixels
          height: thickness,          // Already in pixels
          transform: `rotate(${angle}deg)`,
          transformOrigin: 'left center',
        }}
        title={fixture.label}
      />
    );
  }

  return null;
}

// =============================================================================
// DATABASE TABLE RENDERER
// =============================================================================

interface DbTableRendererProps {
  table: DbTable;
  showSeats?: boolean;
  onClick?: () => void;
}

function DbTableRenderer({ table, showSeats, onClick }: DbTableRendererProps) {
  const isRound = table.shape === 'round' || table.shape === 'circle';

  const tableCenterX = table.posX + table.width / 2;
  const tableCenterY = table.posY + table.height / 2;

  // Render seats with rotation
  const renderSeats = () => {
    if (!showSeats || !table.seats || table.seats.length === 0) return null;

    return table.seats.map((seat) => {
      // Apply table rotation to seat position
      const angleRad = (table.rotation * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);

      const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
      const rotatedY = seat.relativeX * sin + seat.relativeY * cos;

      const seatAbsX = tableCenterX + rotatedX;
      const seatAbsY = tableCenterY + rotatedY;

      // Smaller seats (24px) to prevent overlap and allow tapping
      const SEAT_SIZE = 24;
      const SEAT_HALF = SEAT_SIZE / 2;

      return (
        <div
          key={seat.id}
          onClick={(e) => {
            e.stopPropagation();
            // When we integrate with orders, this will select the seat
            console.log(`Seat ${seat.seatNumber} tapped on table ${table.name}`);
          }}
          style={{
            position: 'absolute',
            left: seatAbsX - SEAT_HALF,
            top: seatAbsY - SEAT_HALF,
            width: SEAT_SIZE,
            height: SEAT_SIZE,
            backgroundColor: '#fff',
            border: '2px solid #555',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            pointerEvents: 'auto',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'transform 0.1s, box-shadow 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.15)';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
            e.currentTarget.style.zIndex = '100';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
            e.currentTarget.style.zIndex = 'auto';
          }}
          title={`Seat ${seat.seatNumber}`}
        >
          {seat.seatNumber}
        </div>
      );
    });
  };

  return (
    <>
      <div
        onClick={onClick}
        style={{
          position: 'absolute',
          left: table.posX,
          top: table.posY,
          width: table.width,
          height: table.height,
          backgroundColor: table.status === 'occupied' ? '#ffcdd2' : '#e8f5e9',
          border: '2px solid #666',
          borderRadius: isRound ? '50%' : 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          transform: `rotate(${table.rotation}deg)`,
          transformOrigin: 'center center',
        }}
        title={`${table.name} (${table.capacity} seats)`}
      >
        {table.abbreviation || table.name}
      </div>
      {renderSeats()}
    </>
  );
}

// =============================================================================
// TABLE RENDERER - Using Layer 2 Components
// =============================================================================

// =============================================================================
// TEST PAGE COMPONENT
// =============================================================================

// Database section type
interface DbSection {
  id: string;
  name: string;
  widthFeet: number;
  heightFeet: number;
}

export default function TestFloorPlanPage() {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-main');
  const [clickedPosition, setClickedPosition] = useState<Point | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<SeatType | null>(null);

  // Database fixtures from FloorPlanElement table
  const [dbFixtures, setDbFixtures] = useState<PixelFixture[]>([]);
  const [dbSections, setDbSections] = useState<DbSection[]>([]);
  const [dbTables, setDbTables] = useState<DbTable[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isDbMode, setIsDbMode] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showDbSeats, setShowDbSeats] = useState(true);

  // Fetch database fixtures
  const fetchDbFixtures = useCallback(async (locId: string) => {
    try {
      const res = await fetch(`/api/floor-plan-elements?locationId=${locId}`);
      if (res.ok) {
        const data = await res.json();
        const fixtures = (data.elements || []).map((el: DbFloorPlanElement) =>
          dbElementToPixelFixture(el, el.sectionId || 'db-room')
        );
        setDbFixtures(fixtures);
        setIsDbMode(fixtures.length > 0);
        setLastUpdate(new Date());
        console.log(`[FOH] Loaded ${fixtures.length} fixtures from database`);
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch database fixtures:', error);
    }
  }, []);

  // Fetch database sections
  const fetchDbSections = useCallback(async (locId: string) => {
    try {
      const res = await fetch(`/api/sections?locationId=${locId}`);
      if (res.ok) {
        const data = await res.json();
        const sections = data.sections || [];
        setDbSections(sections);
        console.log(`[FOH] Loaded ${sections.length} sections from database`);
        // Auto-select first section if available
        if (sections.length > 0) {
          setSelectedRoomId(sections[0].id);
        }
        return sections;
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch sections:', error);
    }
    return [];
  }, []);

  // Fetch database tables
  const fetchDbTables = useCallback(async (locId: string, sectionId?: string) => {
    try {
      let url = `/api/tables?locationId=${locId}&includeSeats=true`;
      if (sectionId) {
        url += `&sectionId=${sectionId}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDbTables(data.tables || []);
        console.log(`[FOH] Loaded ${(data.tables || []).length} tables from database`);
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch database tables:', error);
    }
  }, []);

  // Get location ID and initialize
  useEffect(() => {
    async function init() {
      // Get location ID
      try {
        const res = await fetch('/api/locations');
        if (res.ok) {
          const data = await res.json();
          if (data.locations && data.locations.length > 0) {
            const locId = data.locations[0].id;
            setLocationId(locId);
            // Fetch database sections and fixtures
            const sections = await fetchDbSections(locId);
            await fetchDbFixtures(locId);
            await fetchDbTables(locId);
            // If we have sections, we're in DB mode
            if (sections.length > 0) {
              setIsDbMode(true);
            }
          }
        }
      } catch {
        console.log('[FOH] No locations API available');
      }

      // Initialize in-memory data as fallback
      if (FloorCanvasAPI.getAllRooms().length === 0) {
        FloorCanvasAPI.initializeFloorPlans(sampleFloorPlans, sampleFixtures);
      }

      // Only initialize tables if not already done
      if (TableAPI.getAllTables().length === 0) {
        TableAPI.initializeTables(sampleTables);

        // Generate seats for seatable tables
        sampleTables.forEach((table) => {
          if (table.category === 'seatable') {
            SeatAPI.generateSeatsForTable(
              table.id,
              table.defaultCapacity,
              table.shape
            );
          }
        });
      }

      // Only set to room-main if not already set to a DB section
      if (!isDbMode) {
        setSelectedRoomId('room-main');
      }
    }
    init();
  }, [fetchDbFixtures, fetchDbSections, fetchDbTables, isDbMode]);

  // Listen for floor-plan:updated socket events
  useEffect(() => {
    if (!locationId) return;

    // Set up EventSource for Server-Sent Events (simple polling fallback)
    // For a full implementation, use socket.io-client
    let intervalId: NodeJS.Timeout | null = null;

    // Poll for updates every 5 seconds (simple approach without socket.io)
    // Don't pass sectionId - fetch ALL tables and filter client-side
    // This prevents the "0 tables" bug when polling with wrong section filter
    intervalId = setInterval(() => {
      fetchDbFixtures(locationId);
      fetchDbTables(locationId); // No sectionId filter - client filters by section
    }, 5000);

    console.log('[FOH] Started polling for floor plan updates');

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        console.log('[FOH] Stopped polling');
      }
    };
  }, [locationId, fetchDbFixtures, fetchDbTables]);

  // Get tables for current room using TableAPI
  const tablesInRoom = TableAPI.getTablesForRoom(selectedRoomId);

  // Get all seats for tables in the current room
  const seatsInRoom: SeatType[] = [];
  tablesInRoom.forEach((table) => {
    const tableSeats = SeatAPI.getSeatsForTable(table.id);
    seatsInRoom.push(...tableSeats);
  });

  const handlePositionClick = (position: Point) => {
    setClickedPosition(position);
    setSelectedTable(null);
    setSelectedSeat(null);
  };

  const handleTableClick = (table: Table) => {
    setSelectedTable(table);
    setClickedPosition(null);
    setSelectedSeat(null);
  };

  const handleSeatClick = (seatId: string) => {
    const seat = SeatAPI.getSeat(seatId);
    if (seat) {
      setSelectedSeat(seat);
      setSelectedTable(null);
      setClickedPosition(null);
    }
  };

  const handleFixtureClick = (fixture: PixelFixture | Fixture) => {
    alert(`Fixture clicked: ${fixture.label} (${fixture.type})`);
  };

  // Combine in-memory fixtures with database fixtures for display
  const allFixtures = isDbMode ? dbFixtures : FloorCanvasAPI.getFixtures(selectedRoomId);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>Floor Plan Test Page (FOH View)</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        {isDbMode ? (
          <>Real-time sync enabled. Fixtures from database: <strong>{dbFixtures.length}</strong>
            {lastUpdate && <span style={{ marginLeft: 8, fontSize: 12 }}>(Updated: {lastUpdate.toLocaleTimeString()})</span>}
          </>
        ) : (
          'Using sample data. Create fixtures in Editor to enable database sync.'
        )}
      </p>

      {/* Room/Section Selector */}
      {isDbMode && dbSections.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {dbSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setSelectedRoomId(section.id)}
              style={{
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

          {/* Show/Hide Seats Toggle */}
          <button
            onClick={() => setShowDbSeats(!showDbSeats)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              backgroundColor: showDbSeats ? '#e3f2fd' : 'white',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: showDbSeats ? 600 : 400,
              marginLeft: 'auto',
            }}
          >
            {showDbSeats ? 'Hide Seats' : 'Show Seats'}
          </button>
        </div>
      ) : (
        <RoomSelector
          selectedRoomId={selectedRoomId}
          onRoomSelect={setSelectedRoomId}
        />
      )}

      {/* Main Canvas */}
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <FloorCanvas
            roomId={selectedRoomId}
            showGrid={!isDbMode} // Disable grid in DB mode (we render our own canvas)
            showFixtures={!isDbMode}
            // Pass dimensions from selected section for DB mode
            width={isDbMode ? (dbSections.find(s => s.id === selectedRoomId)?.widthFeet || 40) * 20 : undefined}
            height={isDbMode ? (dbSections.find(s => s.id === selectedRoomId)?.heightFeet || 30) * 20 : undefined}
            onPositionClick={handlePositionClick}
            onFixtureClick={handleFixtureClick}
          >
            {/* Render database fixtures when in DB mode - filter by selected section */}
            {isDbMode && dbFixtures
              .filter((fixture) => {
                // In DB mode, filter by sectionId (stored as roomId in PixelFixture)
                return fixture.roomId === selectedRoomId;
              })
              .map((fixture) => (
                <DbFixtureRenderer
                  key={fixture.id}
                  fixture={fixture}
                  onClick={() => handleFixtureClick(fixture)}
                />
              ))}

            {/* Render database tables when in DB mode - filter by selected section */}
            {/* Tables without a section will show in first section as fallback */}
            {isDbMode && dbTables
              .filter((table) => {
                // Show tables that match the selected section
                if (table.section?.id === selectedRoomId) return true;
                // Also show tables with no section in the first section
                if (!table.section && dbSections.length > 0 && dbSections[0].id === selectedRoomId) return true;
                return false;
              })
              .map((table) => (
                <DbTableRenderer
                  key={table.id}
                  table={table}
                  showSeats={showDbSeats}
                  onClick={() => alert(`Table: ${table.name}`)}
                />
              ))}

            {/* Render tables using Layer 2 components (SVG) */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              <g style={{ pointerEvents: 'auto' }}>
                {tablesInRoom.map((table) =>
                  table.category === 'seatable' ? (
                    <TableComponent
                      key={table.id}
                      table={table}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedTable?.id === table.id}
                      onSelect={(id) => {
                        const t = TableAPI.getTable(id);
                        if (t) setSelectedTable(t);
                      }}
                    />
                  ) : (
                    <SmartObject
                      key={table.id}
                      object={table}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedTable?.id === table.id}
                      onSelect={(id) => {
                        const t = TableAPI.getTable(id);
                        if (t) setSelectedTable(t);
                      }}
                    />
                  )
                )}

                {/* Render seats around tables */}
                {seatsInRoom.map((seat) => {
                  const table = TableAPI.getTable(seat.tableId);
                  if (!table) return null;

                  return (
                    <Seat
                      key={seat.id}
                      seat={seat}
                      tableX={table.positionX}
                      tableY={table.positionY}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedSeat?.id === seat.id}
                      onSelect={handleSeatClick}
                    />
                  );
                })}
              </g>
            </svg>
          </FloorCanvas>
        </div>

        {/* Info Panel */}
        <div style={{ width: 300 }}>
          <div
            style={{
              padding: 16,
              backgroundColor: '#f5f5f5',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Click Info</h3>
            {clickedPosition ? (
              <div>
                <p><strong>Position:</strong> ({clickedPosition.x.toFixed(1)}ft, {clickedPosition.y.toFixed(1)}ft)</p>
                <p><strong>Blocked:</strong> {FloorCanvasAPI.isPositionBlocked(selectedRoomId, clickedPosition, 3, 3) ? 'Yes' : 'No'}</p>
              </div>
            ) : selectedSeat ? (
              <div>
                <p><strong>Seat:</strong> #{selectedSeat.seatNumber}</p>
                <p><strong>Table:</strong> {(() => {
                  const table = TableAPI.getTable(selectedSeat.tableId);
                  return table ? table.label : 'Unknown';
                })()}</p>
                <p><strong>Position Index:</strong> {selectedSeat.positionIndex}</p>
                <p><strong>Offset:</strong> ({selectedSeat.offsetX.toFixed(2)}ft, {selectedSeat.offsetY.toFixed(2)}ft)</p>
                <p><strong>Occupied:</strong> {selectedSeat.isOccupied ? 'Yes' : 'No'}</p>
                <p><strong>Virtual:</strong> {selectedSeat.isVirtual ? 'Yes' : 'No'}</p>
              </div>
            ) : selectedTable ? (
              <div>
                <p><strong>Table:</strong> {selectedTable.label}</p>
                <p><strong>Type:</strong> {selectedTable.objectType}</p>
                <p><strong>Shape:</strong> {selectedTable.shape}</p>
                <p><strong>Capacity:</strong> {selectedTable.minCapacity}-{selectedTable.maxCapacity}</p>
                <p><strong>Position:</strong> ({selectedTable.positionX}ft, {selectedTable.positionY}ft)</p>
                <p><strong>Seats:</strong> {SeatAPI.getSeatsForTable(selectedTable.id).length}</p>
              </div>
            ) : (
              <p style={{ color: '#999' }}>Click on canvas, table, or seat</p>
            )}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: '#f5f5f5',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Room Info</h3>
            {(() => {
              const room = FloorCanvasAPI.getFloorPlan(selectedRoomId);
              if (!room) return <p>No room selected</p>;
              return (
                <div>
                  <p><strong>Name:</strong> {room.name}</p>
                  <p><strong>Type:</strong> {room.type}</p>
                  <p><strong>Size:</strong> {room.widthFeet}ft x {room.heightFeet}ft</p>
                  <p><strong>Grid:</strong> {room.gridSizeFeet}ft</p>
                  <p><strong>Tables:</strong> {tablesInRoom.length}</p>
                  <p><strong>Fixtures:</strong> {isDbMode ? dbFixtures.length : FloorCanvasAPI.getFixtures(selectedRoomId).length}</p>
                  {isDbMode && <p style={{ color: '#4caf50', fontSize: 12 }}>Database Mode Active</p>}
                </div>
              );
            })()}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: isDbMode ? '#e8f5e9' : '#e3f2fd',
              borderRadius: 8,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Sync Status</h3>
            {isDbMode ? (
              <>
                <p style={{ color: '#2e7d32' }}>Database Connected</p>
                <p style={{ fontSize: 12 }}>Fixtures: {dbFixtures.length}</p>
                <p style={{ fontSize: 12 }}>Polling: every 5s</p>
                {lastUpdate && (
                  <p style={{ fontSize: 11, color: '#666' }}>
                    Last: {lastUpdate.toLocaleTimeString()}
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ color: '#1976d2' }}>In-Memory Mode</p>
                <p style={{ fontSize: 12 }}>Using sample data</p>
                <p style={{ fontSize: 12 }}>Create fixtures in Editor to enable sync</p>
              </>
            )}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: '#fff3e0',
              borderRadius: 8,
              marginTop: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Test Pages</h3>
            <p><a href="/test-floorplan" style={{ color: '#e65100' }}>✓ Frontend Test (Current)</a></p>
            <p><a href="/test-floorplan/api" style={{ color: '#e65100' }}>Backend API Test</a></p>
            <p>
              <a
                href="/test-floorplan/editor"
                style={{
                  color: '#e65100',
                  fontWeight: 'bold',
                  textDecoration: 'none',
                  display: 'inline-block',
                  padding: '4px 8px',
                  backgroundColor: '#ffebee',
                  borderRadius: 4,
                }}
              >
                ✏️ Edit Floor Plan →
              </a>
            </p>
            <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
              {isDbMode
                ? 'Changes made in Editor will appear here automatically (5s polling)'
                : 'Create fixtures in Editor to enable real-time sync'}
            </p>
          </div>
        </div>
      </div>

      {/* Tables List */}
      <div style={{ marginTop: 24 }}>
        <h3>Tables in {FloorCanvasAPI.getFloorPlan(selectedRoomId)?.name || 'Room'}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tablesInRoom.map((table) => (
            <div
              key={table.id}
              onClick={() => handleTableClick(table)}
              style={{
                padding: '8px 16px',
                backgroundColor: selectedTable?.id === table.id ? '#3498db' : '#f5f5f5',
                color: selectedTable?.id === table.id ? 'white' : 'black',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {table.label} ({table.objectType})
            </div>
          ))}
          {tablesInRoom.length === 0 && (
            <p style={{ color: '#999' }}>No tables in this room</p>
          )}
        </div>
      </div>
    </div>
  );
}
