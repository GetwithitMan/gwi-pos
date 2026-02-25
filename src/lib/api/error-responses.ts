/**
 * Standardized API Error Responses
 *
 * Provides consistent error format across all API endpoints.
 * FIX-007: Eliminates inconsistent error responses and missing error codes.
 *
 * Usage:
 *   return apiError.notFound('Order not found', 'ORDER_NOT_FOUND')
 *   return apiError.badRequest('Invalid quantity', 'INVALID_QUANTITY', { min: 1, max: 99 })
 */

import { NextResponse } from 'next/server'

// ============================================================================
// TYPES
// ============================================================================

export interface ApiErrorResponse {
  error: string           // Human-readable error message
  code: string            // Machine-readable error code (UPPER_SNAKE_CASE)
  details?: unknown       // Optional additional context
  timestamp: string       // ISO 8601 timestamp
}

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Standard error codes used across the API
 * Use these constants to ensure consistency
 */
export const ERROR_CODES = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // Orders
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_CLOSED: 'ORDER_CLOSED',
  ORDER_EMPTY: 'ORDER_EMPTY',
  INVALID_ORDER_STATUS: 'INVALID_ORDER_STATUS',
  ORDER_ALREADY_SENT: 'ORDER_ALREADY_SENT',

  // Items
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  PUT_WITH_ITEMS_DEPRECATED: 'PUT_WITH_ITEMS_DEPRECATED',

  // Tables
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  TABLE_OCCUPIED: 'TABLE_OCCUPIED',

  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INSUFFICIENT_PAYMENT: 'INSUFFICIENT_PAYMENT',

  // Modifiers
  MODIFIER_NOT_FOUND: 'MODIFIER_NOT_FOUND',
  MODIFIER_GROUP_NOT_FOUND: 'MODIFIER_GROUP_NOT_FOUND',

  // Missing Fields
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a standardized error response
 *
 * @param status - HTTP status code
 * @param message - Human-readable error message
 * @param code - Machine-readable error code (use ERROR_CODES constants)
 * @param details - Optional additional context
 */
export function createErrorResponse(
  status: number,
  message: string,
  code: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const errorResponse: ApiErrorResponse = {
    error: message,
    code,
    timestamp: new Date().toISOString(),
  }

  if (details !== undefined) {
    errorResponse.details = details
  }

  return NextResponse.json(errorResponse, { status })
}

// ============================================================================
// CONVENIENCE FUNCTIONS (by HTTP status)
// ============================================================================

/**
 * 400 Bad Request - Client sent invalid data
 *
 * Examples:
 * - Missing required fields
 * - Invalid field values
 * - Validation errors
 */
export function badRequest(
  message: string,
  code: string = ERROR_CODES.VALIDATION_ERROR,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(400, message, code, details)
}

/**
 * 401 Unauthorized - Authentication required
 *
 * Examples:
 * - Missing auth token
 * - Invalid auth token
 * - Expired session
 */
export function unauthorized(
  message: string = 'Authentication required',
  code: string = ERROR_CODES.UNAUTHORIZED,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(401, message, code, details)
}

/**
 * 403 Forbidden - Authenticated but lacks permission
 *
 * Examples:
 * - User lacks required permission
 * - Manager approval required
 */
export function forbidden(
  message: string = 'Permission denied',
  code: string = ERROR_CODES.FORBIDDEN,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(403, message, code, details)
}

/**
 * 404 Not Found - Resource does not exist
 *
 * Examples:
 * - Order not found
 * - Item not found
 * - Table not found
 */
export function notFound(
  message: string,
  code: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(404, message, code, details)
}

/**
 * 409 Conflict - Resource state conflict
 *
 * Examples:
 * - Order already closed
 * - Item already sent to kitchen
 * - Table already occupied
 */
export function conflict(
  message: string,
  code: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(409, message, code, details)
}

/**
 * 500 Internal Server Error - Unexpected server error
 *
 * Examples:
 * - Database connection failed
 * - Unexpected exception
 * - External service unavailable
 */
export function internalError(
  message: string = 'Internal server error',
  code: string = ERROR_CODES.INTERNAL_ERROR,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(500, message, code, details)
}

// ============================================================================
// NAMESPACE EXPORT
// ============================================================================

/**
 * Namespace for all API error functions
 *
 * Usage:
 *   import { apiError } from '@/lib/api/error-responses'
 *   return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
 */
export const apiError = {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
  // Also export create function for custom status codes
  create: createErrorResponse,
} as const

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * Extract error message from caught exception
 *
 * Use in catch blocks to safely get error message:
 *   catch (error) {
 *     return apiError.internalError(getErrorMessage(error))
 *   }
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error occurred'
}

/**
 * Check if caught error is a specific Prisma error
 *
 * Use for database-specific error handling:
 *   catch (error) {
 *     if (isPrismaError(error, 'P2025')) {
 *       return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
 *     }
 *   }
 */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}
