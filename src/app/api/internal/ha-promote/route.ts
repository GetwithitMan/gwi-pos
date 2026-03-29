/**
 * Internal HA Promotion API
 *
 * Receives PROMOTE fleet commands from MC (via heartbeat response or direct POST).
 * Triggers the full promotion sequence: fence old primary -> promote PG -> start POS.
 *
 * POST /api/internal/ha-promote
 * Body: {
 *   command: "PROMOTE",
 *   oldPrimaryNodeId: string,
 *   oldPrimaryIp: string,
 *   venueSlug: string,
 *   fenceCommandId: string,
 *   issuedAt?: string,
 *   expiresAt?: string
 * }
 *
 * Auth: INTERNAL_API_SECRET or HA_SHARED_SECRET (bearer token)
 *
 * GET /api/internal/ha-promote
 * Returns last promotion result + current status.
 *
 * See: docs/planning/ha-option-b-mc-arbitrated-failover.md (Section 3c)
 */

import { NextRequest, NextResponse } from 'next/server'
import { err, ok, unauthorized } from '@/lib/api-response'
import {
  handlePromotion,
  isPromotionInProgress,
  getLastPromotionResult,
  type PromotionCommand,
} from '@/lib/ha-promote'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('ha-promote-api')

export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)

  const internalSecret = process.env.INTERNAL_API_SECRET
  const haSecret = process.env.HA_SHARED_SECRET
  if (internalSecret && token === internalSecret) return true
  if (haSecret && token === haSecret) return true
  return false
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  // Reject if already promoting
  if (isPromotionInProgress()) {
    return NextResponse.json(
      { success: false, error: 'Promotion already in progress' },
      { status: 409 }
    )
  }

  let body: PromotionCommand
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body')
  }

  // Validate required fields
  if (!body.oldPrimaryIp || !body.fenceCommandId || !body.venueSlug) {
    return err('Missing required fields: oldPrimaryIp, fenceCommandId, venueSlug')
  }

  // Normalize command
  const command: PromotionCommand = {
    command: 'PROMOTE',
    oldPrimaryNodeId: body.oldPrimaryNodeId || 'unknown',
    oldPrimaryIp: body.oldPrimaryIp,
    venueSlug: body.venueSlug,
    fenceCommandId: body.fenceCommandId,
    issuedAt: body.issuedAt,
    expiresAt: body.expiresAt,
  }

  log.info({ venueSlug: command.venueSlug, oldPrimaryIp: command.oldPrimaryIp }, 'PROMOTE command received via API')

  // Fire-and-forget: start promotion in background, return immediately.
  // The promotion takes 30-120 seconds — we don't want to block the HTTP response.
  void handlePromotion(command).then(result => {
    if (result.success) {
      log.info({ durationMs: result.durationMs }, 'Promotion succeeded')
    } else {
      log.error({ error: result.error, steps: result.steps }, 'Promotion failed')
    }
  }).catch(promoteErr => {
    log.error({ err: promoteErr instanceof Error ? promoteErr.message : promoteErr }, 'Promotion threw unexpected error')
  })

  return ok({
    accepted: true,
    message: 'Promotion initiated',
    fenceCommandId: command.fenceCommandId,
    venueSlug: command.venueSlug,
  })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  const lastResult = getLastPromotionResult()

  return ok({
    isPromoting: isPromotionInProgress(),
    stationRole: process.env.STATION_ROLE || 'unknown',
    lastPromotion: lastResult,
  })
}
