/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Color Palette
 *
 * Manages color assignment and cycling for table groups
 */

import { GROUP_COLOR_PALETTE } from '../shared/types';

// Track which colors are currently in use
const usedColors = new Set<string>();

/**
 * Get the next available color from the palette
 * Cycles through if all colors are in use
 */
export function getNextAvailableColor(): string {
  // Find first unused color
  for (const color of GROUP_COLOR_PALETTE) {
    if (!usedColors.has(color)) {
      usedColors.add(color);
      return color;
    }
  }

  // All colors in use - cycle back to start
  const color = GROUP_COLOR_PALETTE[0];
  usedColors.add(color);
  return color;
}

/**
 * Mark a color as in use (when loading existing groups)
 */
export function markColorInUse(color: string): void {
  if ((GROUP_COLOR_PALETTE as readonly string[]).includes(color)) {
    usedColors.add(color);
  }
}

/**
 * Release a color back to available pool
 */
export function releaseColor(color: string): void {
  usedColors.delete(color);
}

/**
 * Clear all color assignments (for initialization)
 */
export function clearColorAssignments(): void {
  usedColors.clear();
}

/**
 * Get count of available colors
 */
export function getAvailableColorCount(): number {
  return GROUP_COLOR_PALETTE.length - usedColors.size;
}

/**
 * Check if a color is valid from the palette
 */
export function isValidGroupColor(color: string): boolean {
  return (GROUP_COLOR_PALETTE as readonly string[]).includes(color);
}
