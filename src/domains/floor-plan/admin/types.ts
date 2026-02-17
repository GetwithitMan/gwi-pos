/**
 * GWI POS - Floor Plan Domain
 * Admin Editor Types
 *
 * Editor-specific types for the floor plan admin interface.
 */

import type { FixtureType, FixtureCategory, Fixture, Point } from '../shared/types';

// Re-export types from shared for convenience
export type { FixtureType, Fixture, Point } from '../shared/types';

// =============================================================================
// TOOL MODES
// =============================================================================

export type EditorToolMode =
  | 'SELECT'
  | 'WALL'
  | 'RECTANGLE'
  | 'CIRCLE'
  | 'TABLE'
  | 'DELETE';

// =============================================================================
// DRAWING STATE
// =============================================================================

export interface DrawingState {
  mode: EditorToolMode;
  fixtureType: FixtureType;
  startPoint: Point | null;
  previewFixture: Fixture | null;
}

// =============================================================================
// SELECTION STATE
// =============================================================================

export interface SelectionState {
  selectedFixtureId: string | null;
  isDragging: boolean;
  dragOffset: Point | null;
}

// =============================================================================
// EDITOR STATE
// =============================================================================

export interface EditorState {
  drawing: DrawingState;
  selection: SelectionState;
  roomId: string;
}

// =============================================================================
// FIXTURE TYPE METADATA
// =============================================================================

export interface FixtureTypeMetadata {
  type: FixtureType;
  label: string;
  category: FixtureCategory;
  defaultColor: string;
  defaultThickness: number;
  icon: string;
}

// Fixture type definitions for the editor
export const FIXTURE_TYPES: FixtureTypeMetadata[] = [
  {
    type: 'wall',
    label: 'Wall',
    category: 'barrier',
    defaultColor: '#424242',
    defaultThickness: 0.5,
    icon: '▬',
  },
  {
    type: 'half_wall',
    label: 'Half Wall',
    category: 'barrier',
    defaultColor: '#757575',
    defaultThickness: 0.5,
    icon: '▬',
  },
  {
    type: 'pillar',
    label: 'Pillar',
    category: 'barrier',
    defaultColor: '#9E9E9E',
    defaultThickness: 0,
    icon: '●',
  },
  {
    type: 'bar_counter',
    label: 'Bar Counter',
    category: 'surface',
    defaultColor: '#8D6E63',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'service_counter',
    label: 'Service Counter',
    category: 'surface',
    defaultColor: '#A1887F',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'kitchen_boundary',
    label: 'Kitchen',
    category: 'zone',
    defaultColor: '#FFEB3B',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'restroom',
    label: 'Restroom',
    category: 'zone',
    defaultColor: '#B3E5FC',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'door',
    label: 'Door',
    category: 'passage',
    defaultColor: '#90CAF9',
    defaultThickness: 0.3,
    icon: '▬',
  },
  {
    type: 'window',
    label: 'Window',
    category: 'decorative',
    defaultColor: '#81D4FA',
    defaultThickness: 0.2,
    icon: '▬',
  },
  {
    type: 'railing',
    label: 'Railing',
    category: 'barrier',
    defaultColor: '#795548',
    defaultThickness: 0.3,
    icon: '▬',
  },
  {
    type: 'stairs',
    label: 'Stairs',
    category: 'passage',
    defaultColor: '#BCAAA4',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'stage_platform',
    label: 'Stage',
    category: 'zone',
    defaultColor: '#BA68C8',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'dance_floor',
    label: 'Dance Floor',
    category: 'zone',
    defaultColor: '#9C27B0',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'fire_exit',
    label: 'Fire Exit',
    category: 'clearance',
    defaultColor: '#F44336',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'ada_path',
    label: 'ADA Path',
    category: 'clearance',
    defaultColor: '#2196F3',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'planter_builtin',
    label: 'Planter',
    category: 'decorative',
    defaultColor: '#4CAF50',
    defaultThickness: 0,
    icon: '▭',
  },
  {
    type: 'custom_fixture',
    label: 'Custom',
    category: 'decorative',
    defaultColor: '#9E9E9E',
    defaultThickness: 0,
    icon: '▭',
  },
];

// Map for quick lookup
export const FIXTURE_TYPE_MAP: Record<FixtureType, FixtureTypeMetadata> = FIXTURE_TYPES.reduce(
  (acc, item) => {
    acc[item.type] = item;
    return acc;
  },
  {} as Record<FixtureType, FixtureTypeMetadata>
);

// Helper to get metadata for a fixture type
export function getFixtureTypeMetadata(type: FixtureType): FixtureTypeMetadata {
  return FIXTURE_TYPE_MAP[type] || FIXTURE_TYPES[FIXTURE_TYPES.length - 1];
}

// =============================================================================
// TABLE TYPES (for Editor Layer)
// =============================================================================

export type TableShape = 'square' | 'rectangle' | 'circle' | 'booth' | 'bar';

export type SeatPattern = 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside';

export interface EditorTable {
  id: string;
  name: string;
  abbreviation: string | null;
  capacity: number;
  posX: number; // pixels (same as fixtures in database)
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: TableShape;
  seatPattern: SeatPattern;
  sectionId: string | null;
  // Status fields
  status: string;
  isLocked: boolean;
  // Seats (optional, for rendering)
  seats?: EditorSeat[];
}

export interface EditorSeat {
  id: string;
  tableId: string;
  label: string;
  seatNumber: number;
  relativeX: number;
  relativeY: number;
  angle: number;
  seatType: string;
}

export interface TableTypeMetadata {
  shape: TableShape;
  label: string;
  defaultWidth: number;  // pixels
  defaultHeight: number; // pixels
  defaultCapacity: number;
  defaultSeatPattern: SeatPattern;
  icon: string;
}

// Table shape definitions for the editor
export const TABLE_SHAPES: TableTypeMetadata[] = [
  {
    shape: 'square',
    label: 'Square (4-top)',
    defaultWidth: 80,
    defaultHeight: 80,
    defaultCapacity: 4,
    defaultSeatPattern: 'all_around',
    icon: '⬜',
  },
  {
    shape: 'rectangle',
    label: 'Rectangle (6-top)',
    defaultWidth: 120,
    defaultHeight: 80,
    defaultCapacity: 6,
    defaultSeatPattern: 'all_around',
    icon: '▭',
  },
  {
    shape: 'circle',
    label: 'Round (4-top)',
    defaultWidth: 80,
    defaultHeight: 80,
    defaultCapacity: 4,
    defaultSeatPattern: 'all_around',
    icon: '⬤',
  },
  {
    shape: 'booth',
    label: 'Booth',
    defaultWidth: 120,
    defaultHeight: 80,
    defaultCapacity: 4,
    defaultSeatPattern: 'inside',
    icon: '⌒',
  },
  {
    shape: 'bar',
    label: 'Bar Section',
    defaultWidth: 200,
    defaultHeight: 40,
    defaultCapacity: 5,
    defaultSeatPattern: 'front_only',
    icon: '━',
  },
];

// Map for quick lookup
export const TABLE_SHAPE_MAP: Record<TableShape, TableTypeMetadata> = TABLE_SHAPES.reduce(
  (acc, item) => {
    acc[item.shape] = item;
    return acc;
  },
  {} as Record<TableShape, TableTypeMetadata>
);

// Helper to get metadata for a table shape
export function getTableShapeMetadata(shape: TableShape): TableTypeMetadata {
  return TABLE_SHAPE_MAP[shape] || TABLE_SHAPES[0];
}
