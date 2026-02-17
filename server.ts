/**
 * Custom Next.js Server with Socket.io
 *
 * This wraps the standard Next.js server to add Socket.io support.
 * Socket.io runs on the SAME port as Next.js (no separate process needed).
 *
 * Usage:
 *   Development: npm run dev   (runs this via tsx)
 *   Production:  npm start     (runs this via node on the built output)
 */

import { createServer } from 'http'
import next from 'next'
import { initializeSocketServer } from './src/lib/socket-server'
import { requestStore } from './src/lib/request-context'
import { getDbForVenue, masterClient } from './src/lib/db'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || 'localhost'
const port = parseInt(process.env.PORT || '3005', 10)

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()

  const httpServer = createServer((req, res) => {
    // Multi-tenant: wrap request in AsyncLocalStorage with the correct
    // PrismaClient so that `import { db } from '@/lib/db'` automatically
    // routes to the venue's Neon database.
    const slug = req.headers['x-venue-slug'] as string | undefined
    if (slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      const prisma = getDbForVenue(slug)
      requestStore.run({ slug, prisma }, () => handle(req, res))
    } else {
      // Local/NUC mode (no slug header): still wrap in requestStore so
      // withVenue() fast-path fires and skips await headers() entirely.
      requestStore.run({ slug: '', prisma: masterClient }, () => handle(req, res))
    }
  })

  // Initialize Socket.io (skip if standalone ws-server handles sockets)
  if (process.env.WS_STANDALONE === 'true') {
    console.log(`[Server] Socket.io disabled (WS_STANDALONE=true, using ws-server on ${process.env.WS_SERVER_URL || 'localhost:3001'})`)
  } else {
    try {
      await initializeSocketServer(httpServer)
      console.log(`[Server] Socket.io initialized on path ${process.env.SOCKET_PATH || '/api/socket'}`)
    } catch (err) {
      console.error('[Server] Failed to initialize Socket.io:', err)
      // Continue without sockets — POS will fall back to polling
    }
  }

  httpServer.listen(port, () => {
    console.log(`[Server] GWI POS ready on http://${hostname}:${port}`)
    console.log(`[Server] Socket.io: ws://${hostname}:${port}/api/socket`)
    console.log(`[Server] Mode: ${dev ? 'development' : 'production'}`)
  })
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})
