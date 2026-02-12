// src/app/api/seats/bulk-operations/route.ts
// Bulk seat operations (combine repositioning, virtual labels) have been removed.
// This route returns 410 Gone.
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Bulk seat operations feature has been removed' },
    { status: 410 }
  )
}
