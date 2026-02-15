/**
 * Performance timing wrapper for API routes.
 *
 * Automatically adds Server-Timing headers to responses
 * and logs slow requests. Composable with withVenue().
 *
 * Usage:
 *   export const POST = withVenue(withTiming(async function POST(req) {
 *     const timing = getTimingFromRequest(req)
 *     timing.start('db')
 *     const data = await db.order.create(...)
 *     timing.end('db', 'Database create')
 *     return NextResponse.json({ data })
 *   }, 'orders-create'))
 */

import { NextRequest, NextResponse } from 'next/server'

// Store timing context per-request using a WeakMap keyed on the request object
const requestTimings = new WeakMap<NextRequest, ReturnType<typeof createTiming>>()

function createTiming() {
  const marks = new Map<string, number>()
  const entries: Array<{ name: string; dur: number; desc?: string }> = []

  return {
    start(name: string) {
      marks.set(name, performance.now())
    },
    end(name: string, desc?: string) {
      const start = marks.get(name)
      if (start !== undefined) {
        entries.push({ name, dur: Math.round((performance.now() - start) * 10) / 10, desc })
        marks.delete(name)
      }
    },
    add(name: string, dur: number, desc?: string) {
      entries.push({ name, dur, desc })
    },
    toHeader(): string {
      return entries
        .map(e => {
          let s = e.name
          if (e.desc) s += `;desc="${e.desc}"`
          s += `;dur=${e.dur}`
          return s
        })
        .join(', ')
    },
    entries,
  }
}

/**
 * Get the timing context for the current request.
 * Call timing.start('name') and timing.end('name') to measure spans.
 */
export function getTimingFromRequest(req: NextRequest): ReturnType<typeof createTiming> {
  let timing = requestTimings.get(req)
  if (!timing) {
    timing = createTiming()
    requestTimings.set(req, timing)
  }
  return timing
}

// Slow request thresholds (ms)
const SLOW_THRESHOLDS: Record<string, number> = {
  'orders-create': 200,
  'orders-pay': 500,
  'orders-send': 200,
  'orders-items': 200,
  'orders-comp-void': 300,
  'menu-load': 300,
  'floorplan-snapshot': 200,
  'orders-open': 200,
}
const DEFAULT_SLOW_THRESHOLD = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: NextRequest, context?: any) => Promise<NextResponse | Response>

/**
 * Wrap an API route handler with automatic performance timing.
 * Adds Server-Timing header and logs slow requests.
 */
export function withTiming(handler: RouteHandler, routeName?: string): RouteHandler {
  return async (req: NextRequest, context?: unknown) => {
    const totalStart = performance.now()
    const timing = createTiming()
    requestTimings.set(req, timing)

    try {
      const response = await handler(req, context)
      const totalDur = Math.round((performance.now() - totalStart) * 10) / 10

      // Add total timing
      timing.add('total', totalDur, routeName || 'Total')

      // Set Server-Timing header
      const headerValue = timing.toHeader()
      if (headerValue && response instanceof NextResponse) {
        response.headers.set('Server-Timing', headerValue)
      }

      // Log slow requests
      const threshold = (routeName && SLOW_THRESHOLDS[routeName]) || DEFAULT_SLOW_THRESHOLD
      if (totalDur > threshold) {
        console.warn(`[Perf] SLOW ${req.method} ${routeName || req.nextUrl?.pathname || '?'}: ${totalDur}ms (threshold: ${threshold}ms)`)
      }

      return response
    } finally {
      requestTimings.delete(req)
    }
  }
}
