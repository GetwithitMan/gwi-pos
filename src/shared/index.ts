/**
 * Shared Utilities
 *
 * This module contains utilities, types, hooks, and components
 * that are truly shared across multiple domains.
 *
 * IMPORTANT: Only add things here if they are:
 * 1. Used by 3+ domains
 * 2. Truly generic (not business-logic specific)
 * 3. Infrastructure-level (db, auth, realtime)
 */

// Database
export { db } from './lib/db'

// Utilities
export { cn, formatCurrency, formatDateTime, formatDate, formatTime } from './lib/utils'

// Types
export type { ApiResponse, PaginatedResponse } from './types'

// Components
// Shared UI components will be imported from @/components/ui
