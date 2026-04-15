import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { authenticateTerminal } from '@/lib/terminal-auth'
import { ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const [sections, tables, floorPlanElements] = await Promise.all([
    db.section.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, color: true, sortOrder: true, assignments: { select: { employeeId: true } } },
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
        sessionStartedAt: true, sessionExpiresAt: true,
      },
    }),
  ])

  // Deterministic layout-only hash — excludes table.status (handled by table:status-changed delta).
  // Sorted by ID for stability. Includes section assignments (affects "My Sections" visibility).
  const hashPayload = JSON.stringify({
    s: sections.sort((a, b) => a.id.localeCompare(b.id)).map(s => [
      s.id, s.name, s.color, s.sortOrder,
      s.assignments.map(a => a.employeeId).sort(),
    ]),
    t: tables.sort((a, b) => a.id.localeCompare(b.id)).map(t => [
      t.id, t.sectionId, t.name, t.capacity, t.posX, t.posY,
      t.width, t.height, t.rotation, t.shape, t.seatPattern, t.abbreviation, t.isActive,
    ]),
    e: floorPlanElements.sort((a, b) => a.id.localeCompare(b.id)).map(e => [
      e.id, e.posX, e.posY, e.width, e.height, e.rotation, e.sectionId,
    ]),
  })
  const floorPlanHash = crypto.createHash('md5').update(hashPayload).digest('hex')

  return ok({
    sections: sections.map(s => ({ ...s, assignedEmployeeIds: s.assignments.map(a => a.employeeId), assignments: undefined })),
    tables,
    floorPlanElements,
    floorPlanHash,
  })
})
