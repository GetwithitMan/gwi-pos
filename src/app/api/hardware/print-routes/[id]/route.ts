import { NextRequest, NextResponse } from 'next/server'

// GET single print route (stub)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // TODO: Implement when PrintRoute model is added to schema
  return NextResponse.json({ route: null, error: 'Not implemented' }, { status: 501 })
}

// PUT update print route (stub)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // TODO: Implement when PrintRoute model is added to schema
  const mockRoute = {
    id,
    ...body,
    printer: { id: body.printerId, name: 'Mock Printer', printerType: 'thermal', ipAddress: '0.0.0.0', port: 9100, isActive: true },
    backupPrinter: null,
  }

  return NextResponse.json({ route: mockRoute })
}

// DELETE print route (stub)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // TODO: Implement when PrintRoute model is added to schema
  return NextResponse.json({ success: true })
}
