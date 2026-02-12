// src/app/api/tables/combine/route.ts
// Combine feature has been removed. This route returns 410 Gone.
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Table combine feature has been removed' },
    { status: 410 }
  )
}
