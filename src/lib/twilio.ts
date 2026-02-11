/**
 * Twilio SMS Service for Remote Void Approvals (Skill 121)
 *
 * Handles sending SMS for void approval requests and approval codes,
 * plus webhook signature validation.
 */

import twilio from 'twilio'
import crypto from 'crypto'

// Environment variables (should be set in .env.local)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

// Initialize Twilio client (lazy)
let twilioClient: twilio.Twilio | null = null

function getClient(): twilio.Twilio {
  if (!twilioClient) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.')
    }
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  }
  return twilioClient
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER)
}

/**
 * Format phone number to E.164 format
 */
export function formatPhoneE164(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')

  // If already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // If 10 digits, assume US and add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }

  // Otherwise return as-is with + prefix
  return digits.startsWith('+') ? phone : `+${digits}`
}

/**
 * Mask phone number for display (e.g., "***-***-1234")
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 4) {
    return `***-***-${digits.slice(-4)}`
  }
  return '***-***-****'
}

interface SendVoidApprovalSMSParams {
  to: string
  serverName: string
  itemName: string
  amount: number
  reason: string
  orderNumber: number
  approvalToken: string
}

interface SMSResult {
  success: boolean
  messageSid?: string
  error?: string
}

/**
 * Send void approval request SMS to manager
 */
export async function sendVoidApprovalSMS(params: SendVoidApprovalSMSParams): Promise<SMSResult> {
  const { to, serverName, itemName, amount, reason, orderNumber, approvalToken } = params

  if (!isTwilioConfigured()) {
    console.warn('[Twilio] Not configured, skipping SMS')
    return { success: false, error: 'Twilio not configured' }
  }

  const approvalUrl = `${BASE_URL}/approve-void/${approvalToken}`

  const message = `[GWI POS] VOID REQUEST

Server: ${serverName}
Item: ${itemName} ($${amount.toFixed(2)})
Reason: ${reason}
Order #${orderNumber}

Reply YES to approve or NO to reject.

Or tap: ${approvalUrl}

Expires in 30 min.`

  try {
    const client = getClient()
    const result = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    console.error('[Twilio] Failed to send void approval SMS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

interface SendApprovalCodeSMSParams {
  to: string
  code: string
  serverName: string
}

/**
 * Send approval code SMS to manager after they approve
 */
export async function sendApprovalCodeSMS(params: SendApprovalCodeSMSParams): Promise<SMSResult> {
  const { to, code, serverName } = params

  if (!isTwilioConfigured()) {
    console.warn('[Twilio] Not configured, skipping SMS')
    return { success: false, error: 'Twilio not configured' }
  }

  const message = `[GWI POS] APPROVED

Code: ${code}

Give to ${serverName}. Valid 5 min.`

  try {
    const client = getClient()
    const result = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    console.error('[Twilio] Failed to send approval code SMS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

interface SendRejectionSMSParams {
  to: string
  serverName: string
  itemName: string
  amount: number
}

/**
 * Send rejection notification SMS (optional - confirms manager's rejection)
 */
export async function sendRejectionSMS(params: SendRejectionSMSParams): Promise<SMSResult> {
  const { to, serverName, itemName, amount } = params

  if (!isTwilioConfigured()) {
    return { success: false, error: 'Twilio not configured' }
  }

  const message = `[GWI POS] VOID REJECTED

You rejected the void request from ${serverName} for ${itemName} ($${amount.toFixed(2)}).`

  try {
    const client = getClient()
    const result = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    console.error('[Twilio] Failed to send rejection SMS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Validate Twilio webhook signature
 *
 * @param url - Full URL of the webhook endpoint
 * @param params - Request body parameters from Twilio
 * @param signature - X-Twilio-Signature header value
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!TWILIO_AUTH_TOKEN) {
    console.error('[Twilio] Cannot validate signature: Auth token not configured')
    return false
  }

  // Sort params alphabetically and concatenate
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], '')

  // Create HMAC-SHA1 signature
  const expectedSignature = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf-8'),
      Buffer.from(expectedSignature, 'utf-8')
    )
  } catch {
    return false
  }
}

/**
 * Generate a secure 6-digit approval code
 */
export function generateApprovalCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Generate a secure 32-character hex token for web approval links
 */
export function generateApprovalToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Parse SMS reply to determine approval action
 */
export function parseSMSReply(body: string): 'approve' | 'reject' | 'unknown' {
  const normalized = body.trim().toUpperCase()

  const approvalKeywords = ['YES', 'APPROVE', 'APPROVED', 'OK', 'Y', 'CONFIRM', 'ACCEPT']
  const rejectionKeywords = ['NO', 'REJECT', 'REJECTED', 'DENY', 'DENIED', 'N', 'DECLINE']

  if (approvalKeywords.includes(normalized)) {
    return 'approve'
  }

  if (rejectionKeywords.includes(normalized)) {
    return 'reject'
  }

  return 'unknown'
}

// ============================================
// Generic SMS Functions (for Error Alerts)
// ============================================

interface SendSMSParams {
  to: string
  body: string
}

/**
 * Send a generic SMS message
 * Used for error alerts and other notifications
 */
export async function sendSMS(params: SendSMSParams): Promise<SMSResult> {
  const { to, body } = params

  if (!isTwilioConfigured()) {
    console.warn('[Twilio] Not configured, skipping SMS')
    return { success: false, error: 'Twilio not configured' }
  }

  try {
    const client = getClient()
    const result = await client.messages.create({
      body,
      from: TWILIO_FROM_NUMBER,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    console.error('[Twilio] Failed to send SMS:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
