import { NextResponse } from 'next/server'

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init)
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 })
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function err(message: string, status: number = 400, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status })
}

export function notFound(message = 'Not found') {
  return err(message, 404)
}

export function unauthorized(message = 'Unauthorized') {
  return err(message, 401)
}

export function forbidden(message = 'Forbidden') {
  return err(message, 403)
}
