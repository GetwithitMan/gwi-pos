import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all tables for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const sectionId = searchParams.get('sectionId')
    const status = searchParams.get('status')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const tables = await db.table.findMany({
      where: {
        locationId,
        isActive: true,
        ...(sectionId ? { sectionId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
        orders: {
          where: { status: 'open' },
          select: {
            id: true,
            orderNumber: true,
            guestCount: true,
            total: true,
            createdAt: true,
            employee: {
              select: { displayName: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: [
        { section: { name: 'asc' } },
        { name: 'asc' },
      ],
    })

    return NextResponse.json({
      tables: tables.map(table => ({
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        shape: table.shape,
        status: table.status,
        section: table.section,
        // Current order info
        currentOrder: table.orders[0] ? {
          id: table.orders[0].id,
          orderNumber: table.orders[0].orderNumber,
          guestCount: table.orders[0].guestCount,
          total: Number(table.orders[0].total),
          openedAt: table.orders[0].createdAt.toISOString(),
          server: table.orders[0].employee?.displayName ||
            `${table.orders[0].employee?.firstName || ''} ${table.orders[0].employee?.lastName || ''}`.trim(),
        } : null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch tables:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tables' },
      { status: 500 }
    )
  }
}

// POST - Create a new table
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      sectionId,
      name,
      capacity,
      posX,
      posY,
      width,
      height,
      shape,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    const table = await db.table.create({
      data: {
        locationId,
        sectionId: sectionId || null,
        name,
        capacity: capacity || 4,
        posX: posX || 0,
        posY: posY || 0,
        width: width || 100,
        height: height || 100,
        shape: shape || 'rectangle',
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
      },
    })

    return NextResponse.json({
      table: {
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        shape: table.shape,
        status: table.status,
        section: table.section,
        currentOrder: null,
      },
    })
  } catch (error) {
    console.error('Failed to create table:', error)
    return NextResponse.json(
      { error: 'Failed to create table' },
      { status: 500 }
    )
  }
}
