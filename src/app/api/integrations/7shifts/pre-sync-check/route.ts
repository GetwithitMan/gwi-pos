import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId required' }, { status: 400 })
    }

    // Get location timezone
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = location?.timezone || 'America/New_York'

    // Compute yesterday's business date in the location timezone
    const now = new Date()
    const localeDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

    // Yesterday in location timezone
    const todayLocal = new Date(localeDate + 'T00:00:00')
    const yesterdayLocal = new Date(todayLocal)
    yesterdayLocal.setDate(yesterdayLocal.getDate() - 1)
    const businessDate = yesterdayLocal.toISOString().split('T')[0]

    // Compute UTC range for yesterday's business date
    // Start of yesterday in location timezone → UTC
    const startStr = `${businessDate}T00:00:00`
    const endStr = `${businessDate}T23:59:59`

    // Convert local times to UTC using offset estimation
    const startLocal = new Date(startStr)
    const endLocal = new Date(endStr)

    // Use Intl to find offset
    const offsetParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(startLocal)
    const offsetStr = offsetParts.find(p => p.type === 'timeZoneName')?.value || 'GMT'
    // Parse offset like "GMT-5" or "GMT+5:30"
    let offsetMinutes = 0
    const match = offsetStr.match(/GMT([+-]?)(\d+)(?::(\d+))?/)
    if (match) {
      const sign = match[1] === '-' ? -1 : 1
      const hours = parseInt(match[2]) || 0
      const mins = parseInt(match[3]) || 0
      offsetMinutes = sign * (hours * 60 + mins)
    }

    const startUTC = new Date(startLocal.getTime() - offsetMinutes * 60000)
    const endUTC = new Date(endLocal.getTime() - offsetMinutes * 60000)

    // Query time clock entries for yesterday's business date
    const entries = await db.timeClockEntry.findMany({
      where: {
        locationId,
        clockIn: { gte: startUTC, lte: endUTC },
        deletedAt: null,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            hourlyRate: true,
            sevenShiftsUserId: true,
          },
        },
      },
    })

    // Build issues
    const unmappedEmployeesMap = new Map<string, { employeeId: string; name: string; punchCount: number }>()
    const openPunches: Array<{ entryId: string; employeeName: string; clockIn: string }> = []
    const missingHourlyRates: Array<{ employeeId: string; name: string }> = []
    const missingRatesSet = new Set<string>()
    const breakAnomalies: Array<{ entryId: string; employeeName: string; shiftHours: number; breakMinutes: number; required: number }> = []

    let readyPunches = 0
    let alreadyPushed = 0
    let willSkip = 0

    for (const entry of entries) {
      const empName = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`
      const hasMapping = !!entry.employee.sevenShiftsUserId

      // Count status
      if (entry.sevenShiftsTimePunchId) {
        alreadyPushed++
      } else if (!hasMapping) {
        willSkip++
        // Track unmapped employees with punches
        const existing = unmappedEmployeesMap.get(entry.employee.id)
        if (existing) {
          existing.punchCount++
        } else {
          unmappedEmployeesMap.set(entry.employee.id, {
            employeeId: entry.employee.id,
            name: empName,
            punchCount: 1,
          })
        }
      } else if (!entry.clockOut) {
        // Has mapping but no clock out — counted as not ready
        openPunches.push({
          entryId: entry.id,
          employeeName: empName,
          clockIn: entry.clockIn.toISOString(),
        })
      } else {
        readyPunches++
      }

      // Check for open punches (regardless of mapping)
      if (!entry.clockOut && hasMapping) {
        // Already added above
      } else if (!entry.clockOut && !hasMapping) {
        openPunches.push({
          entryId: entry.id,
          employeeName: empName,
          clockIn: entry.clockIn.toISOString(),
        })
      }

      // Missing hourly rates
      if (!entry.employee.hourlyRate && !missingRatesSet.has(entry.employee.id)) {
        missingRatesSet.add(entry.employee.id)
        missingHourlyRates.push({ employeeId: entry.employee.id, name: empName })
      }

      // Break anomaly check
      if (entry.clockOut) {
        const shiftMs = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()
        const shiftHours = shiftMs / (1000 * 60 * 60)
        const breakMins = entry.breakMinutes || 0

        if (shiftHours > 8 && breakMins < 60) {
          breakAnomalies.push({
            entryId: entry.id,
            employeeName: empName,
            shiftHours: Math.round(shiftHours * 10) / 10,
            breakMinutes: breakMins,
            required: 60,
          })
        } else if (shiftHours > 6 && breakMins < 30) {
          breakAnomalies.push({
            entryId: entry.id,
            employeeName: empName,
            shiftHours: Math.round(shiftHours * 10) / 10,
            breakMinutes: breakMins,
            required: 30,
          })
        }
      }
    }

    const unmappedEmployeesWithPunches = Array.from(unmappedEmployeesMap.values())

    // Dedupe open punches (avoid counting unmapped open punches twice)
    const seenOpenEntries = new Set<string>()
    const dedupedOpenPunches = openPunches.filter(p => {
      if (seenOpenEntries.has(p.entryId)) return false
      seenOpenEntries.add(p.entryId)
      return true
    })

    const isReadyToSync = unmappedEmployeesWithPunches.length === 0 && dedupedOpenPunches.length === 0

    // Get last push info from settings
    const rawSettings = await getLocationSettings(locationId)
    const settings = parseSettings(rawSettings)
    const s7 = settings.sevenShifts || {} as Record<string, unknown>

    return NextResponse.json({
      data: {
        businessDate,
        issues: {
          unmappedEmployeesWithPunches,
          openPunches: dedupedOpenPunches,
          missingHourlyRates,
          breakAnomalies,
        },
        counts: {
          totalPunches: entries.length,
          readyPunches,
          alreadyPushed,
          willSkip,
        },
        isReadyToSync,
        lastPushAt: (s7 as Record<string, string | null>).lastPunchPushAt ?? null,
        lastPushStatus: (s7 as Record<string, string | null>).lastPunchPushStatus ?? null,
      },
    })
  } catch (error) {
    console.error('Pre-sync check error:', error)
    return NextResponse.json({ error: 'Failed to run pre-sync check' }, { status: 500 })
  }
})
