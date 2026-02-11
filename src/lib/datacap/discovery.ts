// Datacap Direct API — UDP Device Discovery
// Broadcasts on port 9001 to find Datacap readers on the local network

import { DISCOVERY_PORT, DISCOVERY_RETRIES, DISCOVERY_RETRY_DELAY_MS } from './constants'
import type { DiscoveredDevice } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Discover a Datacap device by serial number via UDP broadcast.
 * Sends "Who has <SN>" on port 9001 and waits for "<SN> is at: <IP>".
 * Retries up to 30 times with 500ms delay between attempts.
 *
 * NOTE: This only works server-side (Node.js dgram). Browser cannot do UDP.
 */
export async function discoverDevice(serialNumber: string): Promise<DiscoveredDevice | null> {
  // Dynamic import — dgram is Node.js only
  let dgram: typeof import('dgram')
  try {
    dgram = await import('dgram')
  } catch {
    console.error('[Datacap Discovery] dgram not available — must run server-side')
    return null
  }

  for (let attempt = 0; attempt < DISCOVERY_RETRIES; attempt++) {
    try {
      const result = await new Promise<DiscoveredDevice | null>((resolve) => {
        const socket = dgram.createSocket('udp4')
        const timeout = setTimeout(() => {
          socket.close()
          resolve(null)
        }, DISCOVERY_RETRY_DELAY_MS)

        socket.on('message', (msg) => {
          clearTimeout(timeout)
          const response = msg.toString().trim()
          // Expected format: "<SN> is at: <IP>"
          const match = response.match(/^(.+?)\s+is at:\s*(.+)$/i)
          if (match && match[1] === serialNumber && match[2]) {
            socket.close()
            resolve({
              serialNumber,
              ipAddress: match[2].trim(),
              port: 8080, // Default — PAX uses 8080
            })
          } else {
            socket.close()
            resolve(null)
          }
        })

        socket.on('error', () => {
          clearTimeout(timeout)
          socket.close()
          resolve(null)
        })

        // Bind to any port, then broadcast
        socket.bind(() => {
          socket.setBroadcast(true)
          const message = Buffer.from(`Who has ${serialNumber}`)
          socket.send(message, 0, message.length, DISCOVERY_PORT, '255.255.255.255')
        })
      })

      if (result) {
        return result
      }
    } catch (error) {
      console.warn(`[Datacap Discovery] Attempt ${attempt + 1} failed:`, error)
    }

    if (attempt < DISCOVERY_RETRIES - 1) {
      await sleep(DISCOVERY_RETRY_DELAY_MS)
    }
  }

  console.warn(`[Datacap Discovery] Device ${serialNumber} not found after ${DISCOVERY_RETRIES} attempts`)
  return null
}
