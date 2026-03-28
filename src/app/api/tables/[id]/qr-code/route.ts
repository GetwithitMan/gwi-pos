/**
 * Table QR Code Generation API
 *
 * GET /api/tables/[id]/qr-code — generate/return QR code data for a table
 *
 * Generates a short alphanumeric order code for the table if one doesn't exist,
 * then returns the QR data URL and ordering URL.
 *
 * Uses raw SQL for the qrOrderCode column (added via migration 027, not in Prisma schema).
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// Generate a short alphanumeric code (6 chars, no confusable characters)
function generateOrderCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/I/1
  let code = ''
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  for (let i = 0; i < 6; i++) {
    code += chars[array[i] % chars.length]
  }
  return code
}

export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await context.params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Permission check
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Get table
    const table = await db.table.findFirst({
      where: {
        id: tableId,
        locationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        locationId: true,
      },
    })

    if (!table) {
      return notFound('Table not found')
    }

    // Get location slug
    const location = await db.location.findFirst({
      where: { id: locationId, isActive: true },
      select: { slug: true },
    })

    if (!location?.slug) {
      return err('Location not configured for QR ordering')
    }

    // Check if table already has a qrOrderCode
    const existingCodeRows = await db.$queryRawUnsafe<{ qrOrderCode: string | null }[]>(
      `SELECT "qrOrderCode" FROM "Table" WHERE "id" = $1 LIMIT 1`,
      tableId
    )

    let tableCode = existingCodeRows[0]?.qrOrderCode

    // Generate a new code if none exists
    if (!tableCode) {
      // Retry loop to handle uniqueness collisions
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidateCode = generateOrderCode()
        try {
          await db.$executeRawUnsafe(
            `UPDATE "Table" SET "qrOrderCode" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            candidateCode,
            tableId
          )
          tableCode = candidateCode
          break
        } catch (err: unknown) {
          // Unique constraint violation — try again
          if ((err as { code?: string }).code === '23505') continue
          throw err
        }
      }

      if (!tableCode) {
        return err('Failed to generate unique order code', 500)
      }
    }

    // Build the QR ordering URL
    // Format: {origin}/order?code={tableCode}&slug={locationSlug}
    const origin = request.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://ordercontrolcenter.com'
    const orderUrl = `${origin}/order?code=${tableCode}&slug=${location.slug}`

    // Generate a simple SVG-based QR code representation
    // For production, the client should use a proper QR library to render from the URL
    const qrCodeDataUrl = `data:text/plain;base64,${Buffer.from(orderUrl).toString('base64')}`

    return ok({
        tableId: table.id,
        tableName: table.name,
        tableCode,
        orderUrl,
        qrCodeUrl: qrCodeDataUrl,
        slug: location.slug,
      })
  } catch (error) {
    console.error('[GET /api/tables/[id]/qr-code] Error:', error)
    return err('Failed to generate QR code', 500)
  }
}))
