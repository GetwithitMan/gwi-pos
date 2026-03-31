/**
 * Online Customer Lookup + System Employee Resolution
 *
 * Handles finding/creating the "Online Order" system employee
 * and resolving order types for online checkout.
 */

type PrismaClient = {
  employee: {
    findFirst: (args: any) => Promise<{ id: string } | null>
    create: (args: any) => Promise<{ id: string }>
  }
  role: {
    findFirst: (args: any) => Promise<{ id: string } | null>
  }
  orderType: {
    findFirst: (args: any) => Promise<{ id: string; slug: string } | null>
  }
}

/**
 * Find or create a dedicated system employee for online orders.
 * Returns null if the location has no roles (not configured for online ordering).
 */
export async function resolveOnlineEmployee(
  venueDb: PrismaClient,
  locationId: string,
): Promise<{ id: string } | null> {
  let systemEmployee = await venueDb.employee.findFirst({
    where: {
      locationId,
      isActive: true,
      deletedAt: null,
      OR: [
        { displayName: 'Online Order' },
        { firstName: 'Online' },
        { firstName: 'System' },
      ],
    },
    select: { id: true },
  })

  if (!systemEmployee) {
    const role = await venueDb.role.findFirst({
      where: { locationId },
      select: { id: true },
    })
    if (!role) return null

    systemEmployee = await venueDb.employee.create({
      data: {
        locationId,
        roleId: role.id,
        firstName: 'Online',
        lastName: 'Order',
        displayName: 'Online Order',
        pin: 'SYSTEM-NO-LOGIN',
        isActive: true,
      },
      select: { id: true },
    })
  }

  return systemEmployee
}

/**
 * Resolve the order type slug and ID from online settings + request.
 */
export async function resolveOrderType(
  venueDb: PrismaClient,
  locationId: string,
  requestedType: string | undefined,
  allowedOrderTypes: string[],
): Promise<{ orderType: string; orderTypeId: string | null }> {
  let orderType = 'takeout'
  let orderTypeId: string | null = null

  const resolvedType = requestedType && allowedOrderTypes.includes(requestedType)
    ? requestedType
    : 'takeout'

  const dbOrderType = await venueDb.orderType.findFirst({
    where: { locationId, slug: resolvedType, isActive: true },
    select: { id: true, slug: true },
  })

  if (dbOrderType) {
    orderType = dbOrderType.slug
    orderTypeId = dbOrderType.id
  }

  return { orderType, orderTypeId }
}
