import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET() {
  return NextResponse.json(
    { error: 'This feature has been removed' },
    { status: 410 }
  )
})

export const POST = withVenue(async function POST() {
  return NextResponse.json(
    { error: 'This feature has been removed' },
    { status: 410 }
  )
})
