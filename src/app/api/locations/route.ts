import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all locations
export async function GET() {
  try {
    const locations = await db.location.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        isActive: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ locations })
  } catch (error) {
    console.error('[locations] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch locations' },
      { status: 500 }
    )
  }
}
