import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST generate a new pairing code for this terminal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const terminal = await db.terminal.findUnique({ where: { id } })
    if (!terminal || terminal.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    // Generate 6-digit code
    const pairingCode = Math.random().toString().slice(2, 8)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    await db.terminal.update({
      where: { id },
      data: {
        pairingCode,
        pairingCodeExpiresAt: expiresAt,
        // Don't unpair existing device - code generation doesn't unpair
      },
    })

    return NextResponse.json({
      pairingCode,
      expiresAt: expiresAt.toISOString(),
      terminalName: terminal.name,
    })
  } catch (error) {
    console.error('Failed to generate pairing code:', error)
    return NextResponse.json({ error: 'Failed to generate pairing code' }, { status: 500 })
  }
}
