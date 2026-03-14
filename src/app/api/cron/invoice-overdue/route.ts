import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { sendEmail } from '@/lib/email-service'
import { mergeWithDefaults, DEFAULT_INVOICING } from '@/lib/settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BILLING_SOURCE = 'api' as never

// ─── GET /api/cron/invoice-overdue ──────────────────────────────────────────
// Cron endpoint to:
// 1. Find sent invoices past due date and flag as overdue (no separate status -- stays pending)
// 2. Send reminder emails for invoices approaching due date
// 3. Apply late fees if configured
export const GET = withVenue(async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const results = {
      overdueFound: 0,
      remindersSent: 0,
      lateFeesApplied: 0,
      errors: [] as string[],
    }

    // Get all locations (cron runs across all locations)
    const locations = await db.location.findMany({
      select: { id: true, settings: true },
    })

    for (const location of locations) {
      const settings = mergeWithDefaults(location.settings as any)
      const invSettings = settings.invoicing ?? DEFAULT_INVOICING

      if (!invSettings.enabled) continue

      const locationId = location.id

      // 1. Find overdue invoices (pending/approved, past due date)
      // We don't change their status since the enum doesn't have 'overdue'
      // but we can log them for reporting
      const overdueInvoices = await db.invoice.findMany({
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

      results.overdueFound += overdueInvoices.length

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
            await db.invoiceLineItem.create({
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
            await db.invoice.update({
              where: { id: inv.id },
              data: {
                subtotal: Number(inv.subtotal) + lateFee,
                totalAmount: newTotal,
                notes: currentNotes + `\n${lastFeeMarker}${thisMonth}]`,
              },
            })

            results.lateFeesApplied++
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error'
            results.errors.push(`Late fee error for ${inv.invoiceNumber}: ${msg}`)
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

          const upcomingInvoices = await db.invoice.findMany({
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
              }).catch(console.error)

              // Mark reminder sent
              await db.invoice.update({
                where: { id: inv.id },
                data: {
                  notes: (inv.notes || '') + `\n${reminderKey}`,
                },
              })

              results.remindersSent++
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error'
              results.errors.push(`Reminder error for ${inv.invoiceNumber}: ${msg}`)
            }
          }
        }
      }
    }

    return NextResponse.json({ data: results })
  } catch (error) {
    console.error('Invoice overdue cron error:', error)
    return NextResponse.json({ error: 'Failed to process overdue invoices' }, { status: 500 })
  }
})
