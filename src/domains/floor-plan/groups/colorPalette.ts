/**
 * Color Palette for Virtual Table Groups
 *
 * Provides color families with multiple shades so each table in a combined
 * group can have a distinct but related color. Seats are slightly lighter
 * than their parent table.
 */

export type ColorFamilyName = 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'rose';

export interface ColorFamily {
  name: ColorFamilyName;
  displayName: string;
  // Shades from darkest to lightest (for tables)
  tableShades: string[];
  // Corresponding seat shades (lighter than table)
  seatShades: string[];
  // Base color for the family (used for group outline)
  base: string;
}

/**
 * Color families optimized for visual distinction on floor plan
 * Each family has 6 shades to support up to 6 tables per group
 */
export const COLOR_FAMILIES: Record<ColorFamilyName, ColorFamily> = {
  blue: {
    name: 'blue',
    displayName: 'Blue',
    base: '#3B82F6',
    tableShades: ['#1E40AF', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD'],
    seatShades: ['#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE', '#EFF6FF'],
  },
  green: {
    name: 'green',
    displayName: 'Green',
    base: '#22C55E',
    tableShades: ['#14532D', '#15803D', '#16A34A', '#22C55E', '#4ADE80', '#86EFAC'],
    seatShades: ['#22C55E', '#4ADE80', '#86EFAC', '#BBF7D0', '#DCFCE7', '#F0FDF4'],
  },
  purple: {
    name: 'purple',
    displayName: 'Purple',
    base: '#A855F7',
    tableShades: ['#581C87', '#7E22CE', '#9333EA', '#A855F7', '#C084FC', '#D8B4FE'],
    seatShades: ['#A855F7', '#C084FC', '#D8B4FE', '#E9D5FF', '#F3E8FF', '#FAF5FF'],
  },
  amber: {
    name: 'amber',
    displayName: 'Amber',
    base: '#F59E0B',
    tableShades: ['#78350F', '#92400E', '#B45309', '#D97706', '#F59E0B', '#FBBF24'],
    seatShades: ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A', '#FEF3C7', '#FFFBEB'],
  },
  teal: {
    name: 'teal',
    displayName: 'Teal',
    base: '#14B8A6',
    tableShades: ['#134E4A', '#115E59', '#0F766E', '#0D9488', '#14B8A6', '#2DD4BF'],
    seatShades: ['#14B8A6', '#2DD4BF', '#5EEAD4', '#99F6E4', '#CCFBF1', '#F0FDFA'],
  },
  rose: {
    name: 'rose',
    displayName: 'Rose',
    base: '#F43F5E',
    tableShades: ['#881337', '#9F1239', '#BE123C', '#E11D48', '#F43F5E', '#FB7185'],
    seatShades: ['#F43F5E', '#FB7185', '#FDA4AF', '#FECDD3', '#FFE4E6', '#FFF1F2'],
  },
};

/**
 * Get all available color family names
 */
export function getColorFamilyNames(): ColorFamilyName[] {
  return Object.keys(COLOR_FAMILIES) as ColorFamilyName[];
}

/**
 * Get a color family by name
 */
export function getColorFamily(name: ColorFamilyName): ColorFamily {
  return COLOR_FAMILIES[name];
}

/**
 * Get a color family for a group based on group index
 * Cycles through families if more groups than families
 */
export function getColorFamilyForGroup(groupIndex: number): ColorFamily {
  const families = getColorFamilyNames();
  const familyName = families[groupIndex % families.length];
  return COLOR_FAMILIES[familyName];
}

/**
 * Get table color within a family based on table index in group
 * @param family - The color family
 * @param tableIndex - 0-based index of table within the group
 */
export function getTableColor(family: ColorFamily, tableIndex: number): string {
  const shades = family.tableShades;
  return shades[tableIndex % shades.length];
}

/**
 * Get seat color for a table (lighter than the table color)
 * @param family - The color family
 * @param tableIndex - 0-based index of table within the group
 */
export function getSeatColor(family: ColorFamily, tableIndex: number): string {
  const shades = family.seatShades;
  return shades[tableIndex % shades.length];
}

/**
 * Get the group outline/glow color (base color of family)
 */
export function getGroupOutlineColor(family: ColorFamily): string {
  return family.base;
}

/**
 * Generate color assignments for all tables in a group
 * Returns a map of tableId → { tableColor, seatColor }
 */
export interface TableColorAssignment {
  tableId: string;
  tableColor: string;
  seatColor: string;
  familyName: ColorFamilyName;
}

export function assignColorsToGroup(
  tableIds: string[],
  groupIndex: number = 0
): TableColorAssignment[] {
  const family = getColorFamilyForGroup(groupIndex);

  return tableIds.map((tableId, index) => ({
    tableId,
    tableColor: getTableColor(family, index),
    seatColor: getSeatColor(family, index),
    familyName: family.name,
  }));
}

/**
 * Create a lookup map from tableId to colors
 */
export function createColorLookup(
  assignments: TableColorAssignment[]
): Map<string, { tableColor: string; seatColor: string }> {
  return new Map(
    assignments.map((a) => [a.tableId, { tableColor: a.tableColor, seatColor: a.seatColor }])
  );
}

/**
 * Get a semi-transparent version of a color for overlays/glows
 * @param hexColor - Hex color string (e.g., '#3B82F6')
 * @param opacity - Opacity value 0-1 (default 0.3)
 */
export function getColorWithOpacity(hexColor: string, opacity: number = 0.3): string {
  // Convert opacity to hex (0-255)
  const alphaHex = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hexColor}${alphaHex}`;
}

/**
 * Get CSS box-shadow for group glow effect
 */
export function getGroupGlowStyle(family: ColorFamily): string {
  const color = family.base;
  return `0 0 20px ${getColorWithOpacity(color, 0.4)}, 0 0 40px ${getColorWithOpacity(color, 0.2)}`;
}

/**
 * Get CSS border style for a table in a group
 */
export function getTableBorderStyle(tableColor: string): string {
  return `3px solid ${tableColor}`;
}

// =============================================================================
// LEGACY COMPATIBILITY FUNCTIONS
// These functions support the older tableGroupAPI.ts which uses a different
// color assignment approach (single color per group vs per-table shades)
// =============================================================================

// Track which colors are in use (for legacy API)
const colorsInUse = new Set<string>();

// Simple color list for legacy API (one color per group)
const LEGACY_GROUP_COLORS = [
  '#3B82F6', // blue
  '#22C55E', // green
  '#A855F7', // purple
  '#F59E0B', // amber
  '#14B8A6', // teal
  '#F43F5E', // rose
  '#6366F1', // indigo
  '#EC4899', // pink
];

/**
 * Get the next available color for a group (legacy API)
 */
export function getNextAvailableColor(): string {
  for (const color of LEGACY_GROUP_COLORS) {
    if (!colorsInUse.has(color)) {
      return color;
    }
  }
  // If all colors in use, return a random one
  return LEGACY_GROUP_COLORS[Math.floor(Math.random() * LEGACY_GROUP_COLORS.length)];
}

/**
 * Mark a color as in use (legacy API)
 */
export function markColorInUse(color: string): void {
  colorsInUse.add(color);
}

/**
 * Release a color back to the pool (legacy API)
 */
export function releaseColor(color: string): void {
  colorsInUse.delete(color);
}

/**
 * Clear all color assignments (legacy API)
 */
export function clearColorAssignments(): void {
  colorsInUse.clear();
}
