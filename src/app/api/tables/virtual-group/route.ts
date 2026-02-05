// src/app/api/tables/virtual-group/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { distributeSeatsOnPerimeter, getGroupBoundingBox, type TableRect } from '@/lib/table-geometry'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

type VirtualGroupAction = 'create' | 'add' | 'remove' | 'dissolve'

interface BaseBody {
  locationId: string
  employeeId?: string
  action: VirtualGroupAction
}

/**
 * CREATE: build a new virtual group from tableIds
 */
interface CreateVirtualGroupBody extends BaseBody {
  action: 'create'
  tableIds: string[] // physical tables
  primaryTableId: string // which one is the "main" virtual table
  name?: string
}

/**
 * ADD: add tableIds to an existing virtual group
 */
interface AddToVirtualGroupBody extends BaseBody {
  action: 'add'
  virtualGroupId: string
  tableIds: string[]
}

/**
 * REMOVE: remove specific tables from a virtual group
 */
interface RemoveFromVirtualGroupBody extends BaseBody {
  action: 'remove'
  virtualGroupId: string
  tableIds: string[]
}

/**
 * DISSOLVE: remove group from all tables
 */
interface DissolveVirtualGroupBody extends BaseBody {
  action: 'dissolve'
  virtualGroupId: string
}

type VirtualGroupBody =
  | CreateVirtualGroupBody
  | AddToVirtualGroupBody
  | RemoveFromVirtualGroupBody
  | DissolveVirtualGroupBody

/**
 * POST /api/tables/virtual-group
 *
 * Lightweight virtual grouping:
 * - Tables stay physically separate (no snap, no reposition)
 * - One "primary" virtual table for orders
 * - Seat layout handled via /api/tables/seats/reflow if needed
 */
export async function POST(request: NextRequest) {
  let body: VirtualGroupBody
  try {
    body = (await request.json()) as VirtualGroupBody
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid JSON in request body', details: String(err) },
      { status: 400 }
    )
  }

  const { locationId, action } = body

  if (!locationId || !action) {
    return NextResponse.json(
      { error: 'locationId and action are required' },
      { status: 400 }
    )
  }

  try {
    switch (action) {
      case 'create':
        return await handleCreate(body as CreateVirtualGroupBody)
      case 'add':
        return await handleAdd(body as AddToVirtualGroupBody)
      case 'remove':
        return await handleRemove(body as RemoveFromVirtualGroupBody)
      case 'dissolve':
        return await handleDissolve(body as DissolveVirtualGroupBody)
      default:
        return NextResponse.json(
          { error: `Unsupported action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        error: 'Virtual group operation failed',
        details: msg,
        stack,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

async function handleCreate(body: CreateVirtualGroupBody) {
  const { locationId, employeeId, tableIds, primaryTableId, name } = body

  if (!tableIds || tableIds.length < 2) {
    return NextResponse.json(
      { error: 'At least 2 tableIds are required to create a virtual group' },
      { status: 400 }
    )
  }
  if (!primaryTableId || !tableIds.includes(primaryTableId)) {
    return NextResponse.json(
      { error: 'primaryTableId must be one of tableIds' },
      { status: 400 }
    )
  }

  const tables = await db.table.findMany({
    where: { id: { in: tableIds }, locationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      virtualGroupId: true,
      virtualGroupPrimary: true,
      posX: true,
      posY: true,
      width: true,
      height: true,
    },
  })

  if (tables.length !== tableIds.length) {
    return NextResponse.json(
      { error: 'One or more tables not found for this location' },
      { status: 404 }
    )
  }

  // Prevent mixing tables already in different virtual groups
  const existingGroups = new Set(
    tables.map(t => t.virtualGroupId).filter(Boolean) as string[]
  )
  if (existingGroups.size > 0) {
    return NextResponse.json(
      { error: 'Some tables are already part of another virtual group' },
      { status: 400 }
    )
  }

  const groupName =
    name ||
    tables
      .map(t => t.name)
      .sort()
      .join('+')

  const result = await db.$transaction(async tx => {
    const virtualGroup = await tx.virtualGroup.create({
      data: {
        locationId,
        name: groupName,
        primaryTableId,
      },
    })

    const color = '#38bdf8' // cyan-ish highlight

    for (const t of tables) {
      await tx.table.update({
        where: { id: t.id },
        data: {
          virtualGroupId: virtualGroup.id,
          virtualGroupPrimary: t.id === primaryTableId,
          virtualGroupColor: color,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId ?? null,
        action: 'virtual_group_created',
        entityType: 'virtual_group',
        entityId: virtualGroup.id,
        details: {
          tableIds,
          primaryTableId,
          name: groupName,
        },
      },
    })

    return { virtualGroup, color }
  })

  // Notify POS terminals of virtual group creation
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      virtualGroupId: result.virtualGroup.id,
      primaryTableId,
      name: result.virtualGroup.name,
      color: result.color,
      tableIds,
      message: 'Virtual group created',
    },
  })
}

async function handleAdd(body: AddToVirtualGroupBody) {
  const { locationId, employeeId, virtualGroupId, tableIds } = body

  if (!virtualGroupId) {
    return NextResponse.json(
      { error: 'virtualGroupId is required for add action' },
      { status: 400 }
    )
  }
  if (!tableIds || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds are required for add action' },
      { status: 400 }
    )
  }

  const group = await db.virtualGroup.findFirst({
    where: { id: virtualGroupId, locationId, deletedAt: null },
  })
  if (!group) {
    return NextResponse.json(
      { error: 'Virtual group not found' },
      { status: 404 }
    )
  }

  const tablesToAdd = await db.table.findMany({
    where: {
      id: { in: tableIds },
      locationId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      virtualGroupId: true,
    },
  })

  if (tablesToAdd.length === 0) {
    return NextResponse.json(
      { error: 'No tables found to add' },
      { status: 404 }
    )
  }

  const conflicts = tablesToAdd.filter(
    t => t.virtualGroupId && t.virtualGroupId !== virtualGroupId
  )
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: 'Some tables are already in a different virtual group' },
      { status: 400 }
    )
  }

  const color = '#38bdf8'

  await db.$transaction(async tx => {
    for (const t of tablesToAdd) {
      await tx.table.update({
        where: { id: t.id },
        data: {
          virtualGroupId,
          virtualGroupPrimary: false,
          virtualGroupColor: color,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId ?? null,
        action: 'virtual_group_tables_added',
        entityType: 'virtual_group',
        entityId: virtualGroupId,
        details: {
          tableIds: tablesToAdd.map(t => t.id),
        },
      },
    })
  })

  // Notify POS terminals of tables added to virtual group
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      virtualGroupId,
      addedTableIds: tablesToAdd.map(t => t.id),
      color,
      message: 'Tables added to virtual group',
    },
  })
}

async function handleRemove(body: RemoveFromVirtualGroupBody) {
  const { locationId, employeeId, virtualGroupId, tableIds } = body

  if (!virtualGroupId) {
    return NextResponse.json(
      { error: 'virtualGroupId is required for remove action' },
      { status: 400 }
    )
  }
  if (!tableIds || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds are required for remove action' },
      { status: 400 }
    )
  }

  const group = await db.virtualGroup.findFirst({
    where: { id: virtualGroupId, locationId, deletedAt: null },
  })
  if (!group) {
    return NextResponse.json(
      { error: 'Virtual group not found' },
      { status: 404 }
    )
  }

  const tables = await db.table.findMany({
    where: {
      id: { in: tableIds },
      virtualGroupId,
      locationId,
      deletedAt: null,
    },
    select: {
      id: true,
      virtualGroupPrimary: true,
    },
  })

  if (tables.length === 0) {
    return NextResponse.json(
      { error: 'No tables from this group match given tableIds' },
      { status: 404 }
    )
  }

  const primaryIds = tables.filter(t => t.virtualGroupPrimary).map(t => t.id)

  await db.$transaction(async tx => {
    await tx.table.updateMany({
      where: { id: { in: tables.map(t => t.id) } },
      data: {
        virtualGroupId: null,
        virtualGroupPrimary: false,
        virtualGroupColor: null,
      },
    })

    // If we removed the primary, pick another remaining table as primary
    if (primaryIds.length > 0) {
      const remainingTables = await tx.table.findMany({
        where: { virtualGroupId, locationId, deletedAt: null },
        select: { id: true },
      })

      if (remainingTables.length > 0) {
        const newPrimaryId = remainingTables[0].id
        await tx.virtualGroup.update({
          where: { id: virtualGroupId },
          data: { primaryTableId: newPrimaryId },
        })
        await tx.table.update({
          where: { id: newPrimaryId },
          data: { virtualGroupPrimary: true },
        })
      } else {
        // No tables left; mark group deleted
        await tx.virtualGroup.update({
          where: { id: virtualGroupId },
          data: { deletedAt: new Date() },
        })
      }
    }

    await tx.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId ?? null,
        action: 'virtual_group_tables_removed',
        entityType: 'virtual_group',
        entityId: virtualGroupId,
        details: {
          tableIds: tables.map(t => t.id),
        },
      },
    })
  })

  // Notify POS terminals of tables removed from virtual group
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      virtualGroupId,
      removedTableIds: tables.map(t => t.id),
      message: 'Tables removed from virtual group',
    },
  })
}

async function handleDissolve(body: DissolveVirtualGroupBody) {
  const { locationId, employeeId, virtualGroupId } = body

  if (!virtualGroupId) {
    return NextResponse.json(
      { error: 'virtualGroupId is required for dissolve action' },
      { status: 400 }
    )
  }

  const group = await db.virtualGroup.findFirst({
    where: { id: virtualGroupId, locationId, deletedAt: null },
  })
  if (!group) {
    return NextResponse.json(
      { error: 'Virtual group not found' },
      { status: 404 }
    )
  }

  await db.$transaction(async tx => {
    await tx.table.updateMany({
      where: { virtualGroupId, locationId, deletedAt: null },
      data: {
        virtualGroupId: null,
        virtualGroupPrimary: false,
        virtualGroupColor: null,
      },
    })

    await tx.virtualGroup.update({
      where: { id: virtualGroupId },
      data: { deletedAt: new Date() },
    })

    await tx.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId ?? null,
        action: 'virtual_group_dissolved',
        entityType: 'virtual_group',
        entityId: virtualGroupId,
        details: {},
      },
    })
  })

  // Notify POS terminals of virtual group dissolution
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      virtualGroupId,
      message: 'Virtual group dissolved',
    },
  })
}
