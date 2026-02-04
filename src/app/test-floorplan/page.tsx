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

// =============================================================================
// DATABASE FIXTURE CONVERSION
// =============================================================================

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

// Convert database element to Fixture for display
function dbElementToFixture(el: DbFloorPlanElement, roomId: string): Fixture {
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
    floorPlanId: roomId,
    roomId: roomId,
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

// =============================================================================
// DATABASE FIXTURE RENDERER
// =============================================================================

interface DbFixtureRendererProps {
  fixture: Fixture;
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

  // Render based on geometry type
  if (fixture.geometry.type === 'rectangle') {
    const { position, width, height, rotation } = fixture.geometry;
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: FloorCanvasAPI.feetToPixels(position.x),
          top: FloorCanvasAPI.feetToPixels(position.y),
          width: FloorCanvasAPI.feetToPixels(width),
          height: FloorCanvasAPI.feetToPixels(height),
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
          left: FloorCanvasAPI.feetToPixels(center.x - radius),
          top: FloorCanvasAPI.feetToPixels(center.y - radius),
          width: FloorCanvasAPI.feetToPixels(diameter),
          height: FloorCanvasAPI.feetToPixels(diameter),
          borderRadius: '50%',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'line') {
    const { start, end } = fixture.geometry;
    const thickness = fixture.thickness || 0.5;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: FloorCanvasAPI.feetToPixels(start.x),
          top: FloorCanvasAPI.feetToPixels(start.y - thickness / 2),
          width: FloorCanvasAPI.feetToPixels(length),
          height: FloorCanvasAPI.feetToPixels(thickness),
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
// TABLE RENDERER - Using Layer 2 Components
// =============================================================================

const PIXELS_PER_FOOT = 40;

// =============================================================================
// TEST PAGE COMPONENT
// =============================================================================

export default function TestFloorPlanPage() {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-main');
  const [clickedPosition, setClickedPosition] = useState<Point | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<SeatType | null>(null);

  // Database fixtures from FloorPlanElement table
  const [dbFixtures, setDbFixtures] = useState<Fixture[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isDbMode, setIsDbMode] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Fetch database fixtures
  const fetchDbFixtures = useCallback(async (locId: string) => {
    try {
      const res = await fetch(`/api/floor-plan-elements?locationId=${locId}`);
      if (res.ok) {
        const data = await res.json();
        const fixtures = (data.elements || []).map((el: DbFloorPlanElement) =>
          dbElementToFixture(el, el.sectionId || 'db-room')
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

  // Get location ID and initialize
  useEffect(() => {
    async function init() {
      // Get location ID
      try {
        const res = await fetch('/api/locations');
        if (res.ok) {
          const data = await res.json();
          if (data.locations && data.locations.length > 0) {
            setLocationId(data.locations[0].id);
            // Fetch database fixtures
            await fetchDbFixtures(data.locations[0].id);
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

      setSelectedRoomId('room-main');
    }
    init();
  }, [fetchDbFixtures]);

  // Listen for floor-plan:updated socket events
  useEffect(() => {
    if (!locationId) return;

    // Set up EventSource for Server-Sent Events (simple polling fallback)
    // For a full implementation, use socket.io-client
    let intervalId: NodeJS.Timeout | null = null;

    // Poll for updates every 5 seconds (simple approach without socket.io)
    intervalId = setInterval(() => {
      fetchDbFixtures(locationId);
    }, 5000);

    console.log('[FOH] Started polling for floor plan updates');

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        console.log('[FOH] Stopped polling');
      }
    };
  }, [locationId, fetchDbFixtures]);

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

  const handleFixtureClick = (fixture: Fixture) => {
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

      {/* Room Selector */}
      <RoomSelector
        selectedRoomId={selectedRoomId}
        onRoomSelect={setSelectedRoomId}
      />

      {/* Main Canvas */}
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <FloorCanvas
            roomId={selectedRoomId}
            showGrid={true}
            showFixtures={!isDbMode}
            onPositionClick={handlePositionClick}
            onFixtureClick={handleFixtureClick}
          >
            {/* Render database fixtures when in DB mode */}
            {isDbMode && dbFixtures.map((fixture) => (
              <DbFixtureRenderer
                key={fixture.id}
                fixture={fixture}
                onClick={() => handleFixtureClick(fixture)}
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
