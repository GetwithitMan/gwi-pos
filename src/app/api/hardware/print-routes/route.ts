import { NextResponse } from 'next/server'

// GET - List print routes (stub - returns empty for now)
export async function GET() {
  // TODO: Implement when PrintRoute model is added to schema
  return NextResponse.json({ routes: [] })
}

// POST - Create print route (stub)
export async function POST() {
  // TODO: Implement when PrintRoute model is added to schema
  return NextResponse.json(
    { error: 'Print routes not implemented - PrintRoute model not in schema' },
    { status: 501 }
  )
}
