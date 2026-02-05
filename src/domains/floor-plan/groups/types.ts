/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Types
 */

import { Point } from '../shared/types';

/**
 * Detection result for physical merge snap opportunity
 */
export interface MergeDetection {
  canMerge: boolean;
  snapPosition: Point | null;
  snapEdge: 'top' | 'bottom' | 'left' | 'right' | null;
  snapDistance: number; // Distance in feet
}

/**
 * Virtual group selection state for long-hold flow
 */
export interface VirtualGroupSelection {
  isSelecting: boolean;
  selectedTableIds: string[];
  startedAt: Date | null;
}

/**
 * Group creation parameters
 */
export interface CreateGroupParams {
  tableIds: string[];
  isVirtual: boolean;
  identifier?: string;
  createdBy: string; // Staff ID
  locationId: string;
}

/**
 * Merge result with updated positions
 */
export interface MergeResult {
  groupId: string;
  tablePositions: Map<string, Point>; // tableId → new position
  seatRenumbering: Map<string, number>; // seatId → new seat number
}

/**
 * Constants for merge detection
 */
export const MERGE_CONSTANTS = {
  SNAP_DISTANCE_FEET: 1.0, // Tables within 1 foot can snap
  SNAP_ALIGN_TOLERANCE: 0.25, // Alignment tolerance in feet
  LONG_HOLD_DURATION_MS: 750, // Duration for long-hold gesture (FOH view)
} as const;

/**
 * Table data for perimeter seat calculation
 */
export interface TableForPerimeter {
  id: string;
  name: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  seats: Array<{
    id: string;
    seatNumber: number;
    label: string;
    relativeX: number;
    relativeY: number;
  }>;
}

/**
 * Perimeter seat calculation result
 */
export interface PerimeterSeatResult {
  seatId: string;
  tableId: string;
  tableName: string;
  originalNumber: number;
  perimeterNumber: number;
  originalLabel: string;
  perimeterLabel: string;
}

/**
 * Color family name for virtual groups
 */
export type ColorFamilyName = 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'rose';

/**
 * Color assignment for a table in a virtual group
 */
export interface TableColorAssignment {
  tableId: string;
  tableColor: string;
  seatColor: string;
  familyName: ColorFamilyName;
}

/**
 * Edge direction for snap calculations
 */
export type SnapEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Snap preview result
 */
export interface SnapPreview {
  targetTableId: string;
  targetEdge: SnapEdge;
  snapPosition: { x: number; y: number };
  edgeOffset: number;
  snapDistance: number;
  isValid: boolean;
}

/**
 * Configuration for snap behavior
 */
export interface SnapConfig {
  snapTriggerDistance: number;
  maxOffsetPercent: number;
  minOverlap: number;
}
