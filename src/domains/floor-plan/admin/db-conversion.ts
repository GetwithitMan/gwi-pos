/**
 * GWI POS - Floor Plan Domain
 * Database ↔ Editor Conversion Utilities
 *
 * Database stores positions in PIXELS for direct FOH rendering.
 * Editor canvas works in FEET (uses FloorCanvasAPI.feetToPixels for display).
 * We convert: DB (pixels) ↔ Editor (feet) using PIXELS_PER_FOOT from constants.
 */

import { PIXELS_PER_FOOT } from '@/lib/floorplan/constants';
import type { Fixture } from '../shared/types';

// Database element type
export interface FloorPlanElement {
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

export function pixelsToFeet(pixels: number): number {
  return pixels / PIXELS_PER_FOOT;
}

export function feetToPixels(feet: number): number {
  return feet * PIXELS_PER_FOOT;
}

// Convert database element (PIXELS) to Fixture (FEET) for Editor
export function elementToFixture(el: FloorPlanElement, sectionId: string): Fixture {
  // For database mode, we use posX/posY/width/height as the source of truth
  // The geometry field may be out of sync, so we reconstruct it from posX/posY/width/height
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
export function fixtureToElement(fixture: Omit<Fixture, 'id'> | Fixture): Partial<FloorPlanElement> & { geometry: unknown } {
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
