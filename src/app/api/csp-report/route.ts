import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const report = await request.json()
    console.warn('[CSP-VIOLATION]', JSON.stringify(report))
  } catch {
    // Invalid report body — ignore
  }
  return new NextResponse(null, { status: 204 })
}
