import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

async function authenticateTerminal(request: NextRequest): Promise<{ terminal: { id: string; locationId: string; name: string }; error?: never } | { terminal?: never; error: NextResponse }> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return { error: NextResponse.json({ error: 'Authorization required' }, { status: 401 }) }
  }
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true, name: true },
  })
  if (!terminal) {
    return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
  }
  return { terminal }
}

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const [sections, tables, floorPlanElements] = await Promise.all([
    db.section.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, color: true, sortOrder: true },
    }),
    db.table.findMany({
      where: { locationId, deletedAt: null },
    }),
    db.floorPlanElement.findMany({
      where: { locationId, deletedAt: null, isVisible: true, elementType: 'entertainment' },
      select: {
        id: true, name: true, elementType: true, visualType: true,
        linkedMenuItemId: true, sectionId: true,
        posX: true, posY: true, width: true, height: true, rotation: true,
        fillColor: true, opacity: true, status: true, currentOrderId: true,
      },
    }),
  ])

  return NextResponse.json({
    data: { sections, tables, floorPlanElements },
  })
})
