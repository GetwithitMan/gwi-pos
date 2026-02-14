/**
 * Lightweight Server-Timing header utility.
 *
 * Adds Server-Timing headers to responses so timing data
 * shows up in browser DevTools -> Network -> Timing tab.
 *
 * Usage:
 *   const timing = createServerTiming()
 *   timing.start('db')
 *   const data = await db.query(...)
 *   timing.end('db', 'Database query')
 *   return timing.apply(NextResponse.json(data))
 */

import type { NextResponse } from 'next/server'

export function createServerTiming() {
  const marks = new Map<string, number>()
  const entries: Array<{ name: string; dur: number; desc?: string }> = []

  return {
    /** Mark the start of a named span */
    start(name: string) {
      marks.set(name, performance.now())
    },

    /** End a named span and record its duration */
    end(name: string, desc?: string) {
      const start = marks.get(name)
      if (start !== undefined) {
        entries.push({ name, dur: Math.round((performance.now() - start) * 10) / 10, desc })
        marks.delete(name)
      }
    },

    /** Add a pre-computed timing entry */
    add(name: string, dur: number, desc?: string) {
      entries.push({ name, dur, desc })
    },

    /** Format as Server-Timing header value */
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

    /** Set Server-Timing header on response and return it */
    apply<T extends NextResponse>(response: T): T {
      if (entries.length > 0) {
        response.headers.set('Server-Timing', this.toHeader())
      }
      return response
    },
  }
}
