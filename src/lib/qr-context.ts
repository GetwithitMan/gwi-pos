import crypto from 'crypto'

interface QRContextPayload {
  table: string
  section?: string
  slug: string
  mode: 'dine_in'
  iat: number
}

function getQRSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET || process.env.PROVISION_API_KEY
  if (!secret) throw new Error('QR_SIGNING_SECRET or PROVISION_API_KEY required')
  return secret
}

/** Sign a QR context for embedding in QR code URLs */
export function signQRContext(data: { table: string; section?: string; slug: string }): string {
  const secret = getQRSecret()
  const payload: QRContextPayload = {
    table: data.table,
    section: data.section,
    slug: data.slug,
    mode: 'dine_in',
    iat: Math.floor(Date.now() / 1000),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

/** Verify a signed QR context token — returns payload or null */
export function verifyQRContext(token: string): QRContextPayload | null {
  try {
    const secret = getQRSecret()
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
    if (expectedSig.length !== sig.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))) return null
    return JSON.parse(Buffer.from(encoded, 'base64url').toString()) as QRContextPayload
  } catch {
    return null
  }
}
