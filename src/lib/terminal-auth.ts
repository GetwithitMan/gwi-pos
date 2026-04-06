/**
 * Shared terminal authentication for sync API routes.
 *
 * Supports two auth methods:
 * 1. Stored device token (WiFi-paired terminals) — looks up Terminal table
 * 2. Cellular JWT (LTE-paired terminals) — verifies HMAC-signed JWT
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCellularToken } from '@/lib/cellular-auth'

export interface TerminalIdentity {
  id: string
  locationId: string
  name: string
  cfdTerminalId?: string | null
  defaultMode?: string | null
  receiptPrinterId?: string | null
  kitchenPrinterId?: string | null
  barPrinterId?: string | null
  scaleId?: string | null
}

type AuthSuccess = { terminal: TerminalIdentity; error?: never }
type AuthFailure = { terminal?: never; error: NextResponse }

export async function authenticateTerminal(
  request: Request
): Promise<AuthSuccess | AuthFailure> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return { error: NextResponse.json({ error: 'Authorization required' }, { status: 401 }) }
  }

  // Try stored device token first (WiFi-paired terminals)
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: {
      id: true,
      locationId: true,
      name: true,
      cfdTerminalId: true,
      defaultMode: true,
      receiptPrinterId: true,
      kitchenPrinterId: true,
      barPrinterId: true,
      scaleId: true,
    },
  })
  if (terminal) return { terminal }

  // Fallback: verify as cellular JWT (LTE-paired terminals)
  const cellularPayload = await verifyCellularToken(token)
  if (cellularPayload) {
    return {
      terminal: {
        id: cellularPayload.terminalId,
        locationId: cellularPayload.locationId,
        name: `Cellular-${cellularPayload.terminalId.slice(-6)}`,
        cfdTerminalId: null,
        defaultMode: null,
        receiptPrinterId: null,
        kitchenPrinterId: null,
        barPrinterId: null,
      },
    }
  }

  // Fallback: verify as POS session token (employee JWT sent by Android/PAX)
  // After login, native clients send the session JWT as Bearer. The session
  // contains employeeId + locationId — resolve the terminal from the device
  // token header or find any active terminal for that location.
  const { verifySessionToken } = await import('./auth-session')
  const sessionPayload = await verifySessionToken(token)
  if (sessionPayload?.locationId) {
    // Session-authenticated: use x-terminal-id header if provided, else find any terminal
    const terminalId = request.headers.get('x-terminal-id')
    const sessionTerminal = terminalId
      ? await db.terminal.findFirst({
          where: { id: terminalId, locationId: sessionPayload.locationId, deletedAt: null },
          select: { id: true, locationId: true, name: true, cfdTerminalId: true, defaultMode: true, receiptPrinterId: true, kitchenPrinterId: true, barPrinterId: true, scaleId: true },
        })
      : null
    return {
      terminal: sessionTerminal || {
        id: `session-${sessionPayload.employeeId.slice(-8)}`,
        locationId: sessionPayload.locationId,
        name: `Session-${sessionPayload.roleName || 'Employee'}`,
        cfdTerminalId: null,
        defaultMode: null,
        receiptPrinterId: null,
        kitchenPrinterId: null,
        barPrinterId: null,
      },
    }
  }

  return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
}
