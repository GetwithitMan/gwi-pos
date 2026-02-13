import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST() {
  return NextResponse.json(
    { error: 'This feature has been removed' },
    { status: 410 }
  )
})
