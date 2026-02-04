import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

// PUT - Reorder sections by updating sortOrder
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { roomIds } = body

    if (!roomIds || !Array.isArray(roomIds)) {
      return NextResponse.json({ error: 'roomIds array required' }, { status: 400 })
    }

    // Update sortOrder for each section in order
    await db.$transaction(
      roomIds.map((id: string, index: number) =>
        db.section.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[sections/reorder] PUT error:', error)
    return NextResponse.json({ error: 'Failed to reorder sections' }, { status: 500 })
  }
}
