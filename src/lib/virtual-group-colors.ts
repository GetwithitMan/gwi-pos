// src/lib/virtual-group-colors.ts
// Virtual group color management

// Color palette for virtual groups (distinct from physical combine)
const VIRTUAL_GROUP_COLORS = [
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f472b6', // pink
  '#a855f7', // purple
  '#fb923c', // orange
  '#34d399', // emerald
  '#60a5fa', // blue
  '#fbbf24', // amber
]

/**
 * Get a consistent color for a virtual group based on its ID
 */
export function getVirtualGroupColor(groupId: string): string {
  let hash = 0
  for (let i = 0; i < groupId.length; i++) {
    hash = ((hash << 5) - hash) + groupId.charCodeAt(i)
    hash = hash & hash // Convert to 32bit integer
  }
  return VIRTUAL_GROUP_COLORS[Math.abs(hash) % VIRTUAL_GROUP_COLORS.length]
}
