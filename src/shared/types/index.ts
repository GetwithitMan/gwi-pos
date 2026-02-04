/**
 * Shared Types
 *
 * Types used across multiple domains.
 */

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
  }
}

/**
 * Common sort options
 */
export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * Common filter options
 */
export interface FilterOptions {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'
  value: string | number | boolean | string[] | number[]
}

/**
 * Date range filter
 */
export interface DateRange {
  start: Date
  end: Date
}

/**
 * Soft-deletable entity
 */
export interface SoftDeletable {
  deletedAt: Date | null
}

/**
 * Auditable entity
 */
export interface Auditable {
  createdAt: Date
  updatedAt: Date
  createdBy?: string
  updatedBy?: string
}

/**
 * Syncable entity (for offline support)
 */
export interface Syncable {
  syncedAt: Date | null
  syncStatus: 'synced' | 'pending' | 'conflict'
}
