/**
 * Error Sanitization Utility for Client Responses
 *
 * FINDING #22: Strips internal field names, stack traces, and database details
 * from error messages before sending to clients. Prevents information leakage about
 * database schema, validation rules, and internal implementation details.
 *
 * Usage:
 *   catch (error) {
 *     const sanitized = sanitizeErrorForClient(error)
 *     return NextResponse.json({ error: sanitized }, { status: 500 })
 *   }
 */

/** Structural stand-in for Prisma's PrismaClientKnownRequestError (avoids hard import). */
interface PrismaKnownError extends Error {
  code: string
  meta?: Record<string, unknown>
}

/**
 * Detect if an error is a Prisma error by checking for Prisma error properties.
 * Handles both CommonJS and ESM imports.
 */
function isPrismaClientKnownRequestError(error: unknown): error is PrismaKnownError {
  return (
    error instanceof Error &&
    'code' in error &&
    'meta' in error &&
    typeof (error as any).code === 'string' &&
    (error as any).code.startsWith('P')
  )
}

function isPrismaClientValidationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.includes('Invalid `prisma.')
  )
}

/**
 * Map Prisma error codes to user-friendly messages.
 * Prevents exposing database schema details like table names, field names, or constraints.
 */
function mapPrismaErrorCode(code: string, meta?: Record<string, any>): string {
  switch (code) {
    case 'P2000':
      return 'The provided value is too long'
    case 'P2001':
      return 'Record not found'
    case 'P2002':
      return 'A record with this value already exists'
    case 'P2003':
      return 'Referenced record does not exist'
    case 'P2004':
      return 'Operation could not be completed due to missing dependencies'
    case 'P2005':
      return 'Invalid data in database'
    case 'P2006':
      return 'Invalid value provided'
    case 'P2007':
      return 'Invalid data format'
    case 'P2008':
      return 'Invalid request format'
    case 'P2009':
      return 'Invalid query'
    case 'P2010':
      return 'Database query failed'
    case 'P2011':
      return 'Required field missing'
    case 'P2012':
      return 'Missing required information'
    case 'P2013':
      return 'Missing required argument'
    case 'P2014':
      return 'This operation would violate required relationships'
    case 'P2015':
      return 'Related record not found'
    case 'P2016':
      return 'Query could not be processed'
    case 'P2017':
      return 'Relationship validation failed'
    case 'P2018':
      return 'Required relationship missing'
    case 'P2019':
      return 'Invalid input'
    case 'P2020':
      return 'Value out of valid range'
    case 'P2021':
      return 'Database structure mismatch'
    case 'P2022':
      return 'Database structure mismatch'
    case 'P2023':
      return 'Data consistency error'
    case 'P2024':
      return 'Database connection timeout'
    case 'P2025':
      return 'Record not found'
    case 'P2026':
      return 'Database operation not supported'
    case 'P2027':
      return 'Multiple validation errors occurred'
    case 'P2028':
      return 'Transaction failed'
    case 'P2029':
      return 'Request too large'
    case 'P2030':
      return 'Search not available'
    case 'P2031':
      return 'Invalid argument'
    case 'P2032':
      return 'Invalid argument type'
    case 'P2033':
      return 'Invalid number format'
    case 'P2034':
      return 'Transaction failed due to conflict'
    case 'P2035':
      return 'Assertion failed'
    default:
      return 'Database operation failed'
  }
}

/**
 * Sanitize error messages for client responses.
 *
 * Strips:
 * - Database field names and table names
 * - Stack traces
 * - SQL queries and internal queries
 * - Validation rules and constraints
 * - File paths and implementation details
 *
 * Maps known errors to user-friendly messages instead.
 *
 * @param error - The error to sanitize (can be any type)
 * @returns A safe error message for the client
 */
export function sanitizeErrorForClient(error: unknown): string {
  // Handle Prisma known request errors (constraint violations, not found, etc.)
  if (isPrismaClientKnownRequestError(error)) {
    const code = (error as any).code as string
    const meta = (error as any).meta
    return mapPrismaErrorCode(code, meta)
  }

  // Handle Prisma validation errors (schema mismatch, etc.)
  if (isPrismaClientValidationError(error)) {
    return 'Invalid request format'
  }

  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message

    // Reject messages that expose internal details
    const hasSensitivePatterns = [
      /Unique constraint/i,
      /Foreign key/i,
      /field.*constraint/i,
      /table.*does not exist/i,
      /column.*does not exist/i,
      /invalid prisma/i,
      /at Prisma\./,
      /at async/,
      /\[Error\]/,
      /\.ts:\d+/,  // File paths with line numbers
    ].some(pattern => pattern.test(message))

    if (hasSensitivePatterns) {
      // Message contains database-specific or stack trace details
      return 'An unexpected error occurred'
    }

    // Generic error messages (e.g., "Invalid request", "Not found") are safe
    if (message && message.length < 200) {
      return message
    }

    // Long error messages are suspicious
    return 'An unexpected error occurred'
  }

  // Unknown error type
  return 'An unexpected error occurred'
}

/**
 * Sanitize error for logging while keeping details for debugging.
 * Use this internally; use sanitizeErrorForClient for client responses.
 */
export function sanitizeErrorForLogging(error: unknown): { message: string; details: any } {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: {
        name: error.name,
        stack: error.stack,
        ...(isPrismaClientKnownRequestError(error) && {
          code: (error as any).code,
          meta: (error as any).meta,
        }),
      },
    }
  }

  return {
    message: String(error),
    details: error,
  }
}
