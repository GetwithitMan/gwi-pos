import { NextRequest } from 'next/server'
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
      },
    }),
  ])

  return ok({
      sections: sections.map(s => ({ ...s, assignedEmployeeIds: s.assignments.map(a => a.employeeId), assignments: undefined })),
      tables,
      floorPlanElements,
    })
})
