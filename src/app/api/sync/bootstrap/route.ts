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

  const [categories, employees, tables, orderTypes, location, paymentReaders, printers] = await Promise.all([
    db.category.findMany({
      where: { locationId, deletedAt: null },
      include: {
        menuItems: {
          where: { deletedAt: null, isActive: true },
          include: {
            ownedModifierGroups: {
              where: { deletedAt: null },
              include: { modifiers: { where: { deletedAt: null } } },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    db.employee.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      include: { role: { select: { id: true, name: true, permissions: true } } },
    }),
    db.table.findMany({ where: { locationId, deletedAt: null } }),
    db.orderType.findMany({ where: { locationId, deletedAt: null } }),
    db.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, settings: true, timezone: true },
    }),
    db.paymentReader.findMany({ where: { locationId, deletedAt: null } }),
    db.printer.findMany({ where: { locationId, deletedAt: null } }),
  ])

  const settings = (location?.settings || {}) as Record<string, unknown>
  const taxRate = ((settings?.tax as Record<string, unknown>)?.defaultRate as number ?? 0) / 100

  return NextResponse.json({
    data: {
      menu: { categories },
      employees: employees.map(e => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, displayName: e.displayName, pin: e.pin, locationId: e.locationId, role: e.role })),
      tables,
      orderTypes,
      taxRate,
      locationSettings: settings,
      paymentReaders,
      printers,
      syncVersion: Date.now(),
    },
  })
})
