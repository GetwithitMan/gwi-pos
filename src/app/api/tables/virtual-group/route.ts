// src/app/api/tables/virtual-group/route.ts
// Virtual group feature has been removed. This route returns 410 Gone.
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Virtual group feature has been removed' },
    { status: 410 }
  )
}
