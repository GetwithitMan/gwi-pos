import crypto from 'crypto'

function getOrderViewSecret(): string {
  const secret = process.env.ORDER_VIEW_SECRET || process.env.PROVISION_API_KEY
  if (!secret) throw new Error('ORDER_VIEW_SECRET or PROVISION_API_KEY required')
  return secret
}

export function generateOrderViewToken(orderId: string): string {
  return crypto.createHmac('sha256', getOrderViewSecret()).update(orderId).digest('hex')
}

export function verifyOrderViewToken(orderId: string, token: string): boolean {
  const expected = generateOrderViewToken(orderId)
  if (expected.length !== token.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}
