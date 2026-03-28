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

