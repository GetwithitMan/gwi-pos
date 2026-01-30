import net from 'net'

/**
 * Test TCP connection to a printer
 * @param ipAddress - Printer IP address
 * @param port - Printer port (default 9100)
 * @param timeout - Connection timeout in ms (default 5000)
 * @returns Connection result with success status and response time
 */
export async function testPrinterConnection(
  ipAddress: string,
  port: number = 9100,
  timeout: number = 5000
): Promise<{ success: boolean; responseTime?: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      const responseTime = Date.now() - start
      socket.destroy()
      resolve({ success: true, responseTime })
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve({ success: false, error: 'Connection timed out' })
    })

    socket.on('error', (err) => {
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.connect(port, ipAddress)
  })
}

/**
 * Send data to a printer via TCP
 * @param ipAddress - Printer IP address
 * @param port - Printer port (default 9100)
 * @param data - Data buffer to send
 * @param timeout - Connection timeout in ms (default 10000)
 * @returns Send result with success status
 */
export async function sendToPrinter(
  ipAddress: string,
  port: number = 9100,
  data: Buffer | Uint8Array,
  timeout: number = 10000
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      socket.write(data, (err) => {
        socket.destroy()
        if (err) {
          resolve({ success: false, error: err.message })
        } else {
          resolve({ success: true })
        }
      })
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve({ success: false, error: 'Connection timed out' })
    })

    socket.on('error', (err) => {
      socket.destroy()
      resolve({ success: false, error: err.message })
    })

    socket.connect(port, ipAddress)
  })
}

/**
 * Validate IP address format
 */
export function isValidIPAddress(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (!ipv4Regex.test(ip)) return false

  const parts = ip.split('.')
  return parts.every((part) => {
    const num = parseInt(part, 10)
    return num >= 0 && num <= 255
  })
}

/**
 * Validate port number
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}
