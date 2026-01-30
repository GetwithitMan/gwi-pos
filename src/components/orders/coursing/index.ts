// Course Management Components
// T013 - Coursing System Implementation

export { CourseIndicator, CourseBadge, ASAPBadge, HoldBadge, CourseStatusBar } from '../CourseIndicator'
export { CourseSelectorDropdown, CourseButtons } from '../CourseSelectorDropdown'
export { CourseControlBar } from '../CourseControlBar'
export { CourseOverviewPanel } from '../CourseOverviewPanel'
export { SeatCourseHoldControls, ItemBadges } from '../SeatCourseHoldControls'

// Course types
export interface CourseInfo {
  courseNumber: number
  name: string
  displayName?: string
  color: string
  status: 'pending' | 'fired' | 'ready' | 'served' | 'held'
  itemCount: number
  firedCount: number
  readyCount: number
  servedCount: number
  heldCount: number
  items: CourseItem[]
}

export interface CourseItem {
  id: string
  name: string
  seatNumber: number | null
  courseStatus: string
  isHeld: boolean
  firedAt: string | null
}

export interface CourseConfig {
  id: string
  locationId: string
  courseNumber: number
  name: string
  displayName?: string
  color?: string
  autoFireDelay?: number
  sortOrder: number
  isActive: boolean
}

// Course constants
export const COURSE_COLORS = {
  0: '#EF4444', // ASAP - Red
  1: '#3B82F6', // Course 1 - Blue
  2: '#10B981', // Course 2 - Green
  3: '#F59E0B', // Course 3 - Amber
  4: '#EC4899', // Course 4 - Pink
  5: '#8B5CF6', // Course 5 - Violet
} as const

export const COURSE_NAMES = {
  0: 'ASAP',
  1: 'Appetizers',
  2: 'Soup/Salad',
  3: 'Entrees',
  4: 'Dessert',
  5: 'After-Dinner',
} as const

export const COURSE_STATUS = {
  PENDING: 'pending',
  FIRED: 'fired',
  READY: 'ready',
  SERVED: 'served',
  HELD: 'held',
} as const

// Special course values
export const SPECIAL_COURSES = {
  ASAP: 0,   // Fire immediately
  HOLD: -1,  // Hold until released
} as const

// Helper functions
export function getCourseColor(courseNumber: number): string {
  return COURSE_COLORS[courseNumber as keyof typeof COURSE_COLORS] || '#6B7280'
}

export function getCourseName(courseNumber: number): string {
  return COURSE_NAMES[courseNumber as keyof typeof COURSE_NAMES] || `Course ${courseNumber}`
}

export function getCourseStatusIcon(status: string): string {
  switch (status) {
    case 'fired': return '🔥'
    case 'ready': return '✓'
    case 'served': return '✓✓'
    case 'held': return '⏸'
    default: return '○'
  }
}
