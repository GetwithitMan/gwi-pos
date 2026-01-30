import { NextRequest, NextResponse } from 'next/server'

// POST test print route (stub)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // TODO: Implement when PrintRoute model is added to schema
  return NextResponse.json({
    success: false,
    error: 'Print route testing not implemented. PrintRoute model not in schema.',
  })
}
