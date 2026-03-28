import { NextRequest } from 'next/server'
import { sendEmail } from '@/lib/email-service'
import { mergeWithDefaults, DEFAULT_INVOICING } from '@/lib/settings'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { createChildLogger } from '@/lib/logger'
import { ok } from '@/lib/api-response'
const log = createChildLogger('cron-invoice-overdue')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BILLING_SOURCE = 'api' as never

// ─── GET /api/cron/invoice-overdue ──────────────────────────────────────────
// Cron endpoint to:
// 1. Find sent invoices past due date and flag as overdue (no separate status -- stays pending)
// 2. Send reminder emails for invoices approaching due date
// 3. Apply late fees if configured
export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults = {
    overdueFound: 0,
    remindersSent: 0,
    lateFeesApplied: 0,
    errors: [] as string[],
  }

  const summary = await forAllVenues(async (venueDb, slug) => {
    const now = new Date()

    // Get all locations (cron runs across all locations)
    const locations = await venueDb.location.findMany({
      select: { id: true, settings: true },
    })

    for (const location of locations) {
      const settings = mergeWithDefaults(location.settings as any)
      const invSettings = settings.invoicing ?? DEFAULT_INVOICING

      if (!invSettings.enabled) continue

      const locationId = location.id

      // 1. Find overdue invoices (pending/approved, past due date)
      const overdueInvoices = await venueDb.invoice.findMany({
        where: {
          locationId,
          deletedAt: null,
          source: BILLING_SOURCE,
          status: { in: ['pending' as never, 'approved' as never] },
          dueDate: { lt: now },
        },
        include: {
          vendor: { select: { name: true, email: true } },
        },
      })

      allResults.overdueFound += overdueInvoices.length

      // 2. Apply late fees if configured
      if (invSettings.lateFeePercent > 0) {
        for (const inv of overdueInvoices) {
          try {
            const currentNotes = inv.notes || ''
            const lastFeeMarker = '[LATE_FEE_APPLIED:'

            // Check if late fee was already applied this month
            const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
            if (currentNotes.includes(`${lastFeeMarker}${thisMonth}`)) continue

            // Calculate late fee
            const balance = Number(inv.totalAmount) - Number(inv.shippingCost)
            if (balance <= 0) continue

            const lateFee = (balance * invSettings.lateFeePercent) / 100
            const newTotal = Number(inv.totalAmount) + lateFee

            // Add late fee as a line item
            await venueDb.invoiceLineItem.create({
              data: {
                locationId,
                invoiceId: inv.id,
                description: `Late fee (${invSettings.lateFeePercent}% - ${thisMonth})`,
                quantity: 1,
                unit: 'taxable',
                unitCost: lateFee,
                totalCost: lateFee,
              },
            })

            // Update invoice total and mark fee applied
            await venueDb.invoice.update({
              where: { id: inv.id },
              data: {
                subtotal: Number(inv.subtotal) + lateFee,
                totalAmount: newTotal,
                notes: currentNotes + `\n${lastFeeMarker}${thisMonth}]`,
              },
            })

            allResults.lateFeesApplied++
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            allResults.errors.push(`[${slug}] Late fee error for ${inv.invoiceNumber}: ${msg}`)
          }
        }
      }

      // 3. Send reminder emails for invoices approaching due date
      if (invSettings.reminderDays?.length > 0) {
        for (const daysBeforeDue of invSettings.reminderDays) {
          const reminderDate = new Date(now)
          reminderDate.setDate(reminderDate.getDate() + daysBeforeDue)

          // Find invoices due on the reminder date (within a 24hr window)
          const startOfDay = new Date(reminderDate)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(reminderDate)
          endOfDay.setHours(23, 59, 59, 999)

          const upcomingInvoices = await venueDb.invoice.findMany({
            where: {
              locationId,
              deletedAt: null,
              source: BILLING_SOURCE,
              status: { in: ['pending' as never, 'approved' as never] },
              dueDate: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            include: {
              vendor: { select: { name: true, email: true } },
            },
          })

          for (const inv of upcomingInvoices) {
            const email = inv.vendor?.email
            if (!email) continue

            const balance = Number(inv.totalAmount) - Number(inv.shippingCost)
            if (balance <= 0) continue

            // Check if reminder was already sent for this period
            const reminderKey = `[REMINDER:${daysBeforeDue}d:${inv.dueDate?.toISOString().split('T')[0]}]`
            if (inv.notes?.includes(reminderKey)) continue

            try {
              const companyName = invSettings.companyInfo.name || 'GWI POS'
              void sendEmail({
                to: email,
                subject: `Reminder: Invoice ${inv.invoiceNumber} due in ${daysBeforeDue} day${daysBeforeDue !== 1 ? 's' : ''}`,
                html: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                    <h2 style="color: #111827;">Payment Reminder</h2>
                    <p style="color: #374151; font-size: 16px;">
                      Hi ${inv.vendor?.name || 'there'},
                    </p>
                    <p style="color: #374151; font-size: 16px;">
                      This is a friendly reminder that invoice <strong>${inv.invoiceNumber}</strong> for
                      <strong>$${balance.toFixed(2)}</strong> is due on
                      <strong>${inv.dueDate?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>.
                    </p>
                    <p style="color: #6b7280; font-size: 14px;">
                      If you have already sent payment, please disregard this reminder.
                    </p>
                    <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                      Thank you,<br>${companyName}
                    </p>
                  </div>
                `,
              }).catch(err => log.warn({ err }, 'Background task failed'))

              // Mark reminder sent
              await venueDb.invoice.update({
                where: { id: inv.id },
                data: {
                  notes: (inv.notes || '') + `\n${reminderKey}`,
                },
              })

              allResults.remindersSent++
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error'
              allResults.errors.push(`[${slug}] Reminder error for ${inv.invoiceNumber}: ${msg}`)
            }
          }
        }
      }
    }
  }, { label: 'cron:invoice-overdue' })

  return ok(allResults)
}
