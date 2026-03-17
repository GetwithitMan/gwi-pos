/**
 * ICS (iCalendar) Generator for Reservations
 *
 * Generates RFC 5545 compliant .ics files for reservation calendar invites.
 * Attached to confirmation and modification emails.
 */

// ============================================
// Types
// ============================================

interface ICSParams {
  reservation: {
    id: string
    guestName: string
    reservationDate: Date
    reservationTime: string  // HH:MM
    duration: number         // minutes
    partySize: number
    specialRequests?: string
  }
  venueName: string
  venueSlug: string
  venueEmail?: string
  venueAddress?: string
  timezone: string           // e.g., "America/New_York"
  sequence?: number          // for updates, increment
}

// ============================================
// ICS Generation
// ============================================

/**
 * Generate a valid ICS (iCalendar) string for a reservation.
 *
 * UID is stable across modifications (based on reservation ID + venue slug).
 * Increment `sequence` for updates to existing calendar entries.
 */
export function generateICS(params: ICSParams): string {
  const { reservation, venueName, venueSlug, venueEmail, venueAddress, timezone, sequence = 0 } =
    params

  const uid = `reservation-${reservation.id}@${venueSlug}.thepasspos.com`
  const now = formatDateUTC(new Date())

  // Parse reservation date + time into a Date object
  const [hours, minutes] = reservation.reservationTime.split(':').map(Number)
  const startDate = new Date(reservation.reservationDate)
  startDate.setHours(hours, minutes, 0, 0)

  const endDate = new Date(startDate.getTime() + reservation.duration * 60_000)

  const dtStart = formatDateLocal(startDate)
  const dtEnd = formatDateLocal(endDate)

  // Build description
  let description = `Party of ${reservation.partySize}`
  if (reservation.specialRequests) {
    description += `\\nSpecial Requests: ${escapeICSText(reservation.specialRequests)}`
  }

  const organizer = venueEmail
    ? `ORGANIZER;CN=${escapeICSText(venueName)}:MAILTO:${venueEmail}`
    : `ORGANIZER;CN=${escapeICSText(venueName)}:MAILTO:reservations@${venueSlug}.thepasspos.com`

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GWI POS//Reservations//EN',
    'METHOD:REQUEST',
    'CALSCALE:GREGORIAN',
    // VTIMEZONE
    ...buildVTimezone(timezone),
    // VEVENT
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${timezone}:${dtStart}`,
    `DTEND;TZID=${timezone}:${dtEnd}`,
    `SUMMARY:${escapeICSText(`Reservation at ${venueName}`)}`,
    `DESCRIPTION:${escapeICSText(description)}`,
    organizer,
    `SEQUENCE:${sequence}`,
    'STATUS:CONFIRMED',
    `X-MICROSOFT-CDO-BUSYSTATUS:BUSY`,
  ]

  if (venueAddress) {
    lines.push(`LOCATION:${escapeICSText(venueAddress)}`)
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  // Apply line folding (75 octet limit per RFC 5545)
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

// ============================================
// Helpers
// ============================================

/**
 * Format a Date as UTC timestamp: 20260316T143000Z
 */
function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = pad(date.getUTCMonth() + 1)
  const d = pad(date.getUTCDate())
  const h = pad(date.getUTCHours())
  const min = pad(date.getUTCMinutes())
  const s = pad(date.getUTCSeconds())
  return `${y}${m}${d}T${h}${min}${s}Z`
}

/**
 * Format a Date as local timestamp (no Z): 20260316T143000
 */
function formatDateLocal(date: Date): string {
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const min = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}${m}${d}T${h}${min}${s}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Escape text for ICS content fields.
 * Commas, semicolons, and backslashes must be escaped.
 * Newlines become literal \n.
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Fold long lines at 75 octets per RFC 5545.
 * Continuation lines start with a single space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line

  const parts: string[] = []
  // First line: up to 75 chars
  parts.push(line.slice(0, 75))
  let pos = 75

  // Continuation lines: space + up to 74 chars
  while (pos < line.length) {
    parts.push(' ' + line.slice(pos, pos + 74))
    pos += 74
  }

  return parts.join('\r\n')
}

/**
 * Build a minimal VTIMEZONE component.
 *
 * We use a simplified representation with US-style DST rules.
 * Most calendar clients will look up the TZID by name anyway,
 * but including VTIMEZONE ensures basic standalone compatibility.
 */
function buildVTimezone(tzid: string): string[] {
  // Common US timezone offsets
  const tzData: Record<string, { standard: string; daylight: string; stdName: string; dstName: string }> = {
    'America/New_York': { standard: '-0500', daylight: '-0400', stdName: 'EST', dstName: 'EDT' },
    'America/Chicago': { standard: '-0600', daylight: '-0500', stdName: 'CST', dstName: 'CDT' },
    'America/Denver': { standard: '-0700', daylight: '-0600', stdName: 'MST', dstName: 'MDT' },
    'America/Los_Angeles': { standard: '-0800', daylight: '-0700', stdName: 'PST', dstName: 'PDT' },
    'America/Phoenix': { standard: '-0700', daylight: '-0700', stdName: 'MST', dstName: 'MST' },
    'Pacific/Honolulu': { standard: '-1000', daylight: '-1000', stdName: 'HST', dstName: 'HST' },
    'America/Anchorage': { standard: '-0900', daylight: '-0800', stdName: 'AKST', dstName: 'AKDT' },
  }

  const tz = tzData[tzid]

  // If we don't have data for this timezone, emit a minimal VTIMEZONE
  if (!tz) {
    return [
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      `X-LIC-LOCATION:${tzid}`,
      'BEGIN:STANDARD',
      `TZNAME:${tzid}`,
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0000',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]
  }

  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    `X-LIC-LOCATION:${tzid}`,
    'BEGIN:STANDARD',
    `TZNAME:${tz.stdName}`,
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    `TZOFFSETFROM:${tz.daylight}`,
    `TZOFFSETTO:${tz.standard}`,
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    `TZNAME:${tz.dstName}`,
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    `TZOFFSETFROM:${tz.standard}`,
    `TZOFFSETTO:${tz.daylight}`,
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ]
}
