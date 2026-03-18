export const MAIN_HOSTNAMES = new Set([
  'localhost',
  'gwi-pos.vercel.app',
  'barpos.restaurant',
  'www.barpos.restaurant',
  'ordercontrolcenter.com',
  'www.ordercontrolcenter.com',
])

/** Check if hostname is a private/local IP (terminals connecting to NUC server) */
export function isLocalNetworkHost(hostname: string): boolean {
  // IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x, 127.x
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(hostname)) return true
  // IPv6 loopback
  if (hostname === '::1') return true
  return false
}

/** Parent domains that support venue subdomains */
export const VENUE_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

/** Cloud venue domains (owner admin access via MC) */
export const CLOUD_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

export function isVercelPreview(hostname: string): boolean {
  return hostname.endsWith('.vercel.app') && hostname !== 'gwi-pos.vercel.app'
}

export function extractVenueSlug(hostname: string): string | null {
  for (const parent of VENUE_PARENT_DOMAINS) {
    if (hostname.endsWith(parent)) {
      const slug = hostname.slice(0, -parent.length)
      if (slug && !slug.includes('.') && slug !== 'www') {
        return slug
      }
    }
  }
  return null
}

/** Check if hostname is a cloud venue (not localhost or local network) */
export function isCloudVenueHost(hostname: string): boolean {
  for (const parent of CLOUD_PARENT_DOMAINS) {
    if (hostname.endsWith(parent)) {
      const slug = hostname.slice(0, -parent.length)
      if (slug && !slug.includes('.') && slug !== 'www') {
        return true
      }
    }
  }
  return false
}
