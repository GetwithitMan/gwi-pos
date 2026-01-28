import { NextResponse } from 'next/server'

// ============================================
// Custom error classes
// ============================================

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

// ============================================
// Error response handler
// ============================================

interface ErrorResponse {
  error: string
  code?: string
  details?: unknown
}

export function handleApiError(error: unknown, defaultMessage: string = 'Internal server error'): NextResponse<ErrorResponse> {
  console.error('API Error:', error)

  // Handle known ApiError instances
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }

  // Handle Prisma unique constraint violations
  if (error instanceof Error && error.message.includes('Unique constraint')) {
    return NextResponse.json(
      { error: 'A record with this value already exists', code: 'DUPLICATE' },
      { status: 409 }
    )
  }

  // Handle Prisma foreign key constraint violations
  if (error instanceof Error && error.message.includes('Foreign key constraint')) {
    return NextResponse.json(
      { error: 'Referenced record does not exist', code: 'FOREIGN_KEY' },
      { status: 400 }
    )
  }

  // Handle generic errors
  if (error instanceof Error) {
    // In production, don't expose internal error messages
    const message = process.env.NODE_ENV === 'development' ? error.message : defaultMessage
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }

  // Unknown error type
  return NextResponse.json(
    { error: defaultMessage },
    { status: 500 }
  )
}

// ============================================
// Success response helpers
// ============================================

export function successResponse<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function createdResponse<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 })
}

export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 })
}
