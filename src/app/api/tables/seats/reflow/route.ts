// src/app/api/tables/seats/reflow/route.ts
// Seat reflow (perimeter redistribution) has been removed. This route returns 410 Gone.
import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST() {
  return NextResponse.json(
    { error: 'Seat reflow feature has been removed' },
    { status: 410 }
  )
})
