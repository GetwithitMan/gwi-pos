/**
 * Twilio SMS Service for Remote Void Approvals (Skill 121)
 *
 * Handles sending SMS for void approval requests and approval codes,
 * plus webhook signature validation.
 */

import twilio from 'twilio'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('twilio')

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`

// Cached credentials (loaded from DB or env)
let _cachedSid: string | null = null
let _cachedToken: string | null = null
let _cachedFromNumber: string | null = null
let _cachedAt = 0
const CACHE_TTL = 60_000 // 1 minute

// Initialize Twilio client (lazy, re-created if creds change)
let twilioClient: twilio.Twilio | null = null
let _clientSid: string | null = null

/**
 * Load Twilio credentials from DB settings, falling back to env vars.
 * Caches for 1 minute to avoid repeated DB reads.
 */
export async function loadCredentials(): Promise<{ sid: string | null; token: string | null; fromNumber: string | null }> {
  if (_cachedSid && Date.now() - _cachedAt < CACHE_TTL) {
    return { sid: _cachedSid, token: _cachedToken, fromNumber: _cachedFromNumber }
  }

  // Try DB settings first
  try {
    const location = await db.location.findFirst({ select: { settings: true } })
    if (location?.settings) {
      const settings = parseSettings(location.settings)
      if (settings.twilio?.accountSid && settings.twilio?.authToken && settings.twilio?.fromNumber) {
        _cachedSid = settings.twilio.accountSid
        _cachedToken = settings.twilio.authToken
        _cachedFromNumber = settings.twilio.fromNumber
        _cachedAt = Date.now()
        return { sid: _cachedSid, token: _cachedToken, fromNumber: _cachedFromNumber }
      }
    }
  } catch {
    // Fall through to env vars
  }

  // Fallback to env vars
  _cachedSid = process.env.TWILIO_ACCOUNT_SID || null
  _cachedToken = process.env.TWILIO_AUTH_TOKEN || null
  _cachedFromNumber = process.env.TWILIO_FROM_NUMBER || null
  _cachedAt = Date.now()
  return { sid: _cachedSid, token: _cachedToken, fromNumber: _cachedFromNumber }
}

/** Clear the credential cache (call after saving new creds) */
export function clearTwilioCache() {
  _cachedSid = null
  _cachedToken = null
  _cachedFromNumber = null
  _cachedAt = 0
  twilioClient = null
  _clientSid = null
}

export async function getClient(): Promise<twilio.Twilio> {
  const { sid, token } = await loadCredentials()
  if (!sid || !token) {
    throw new Error('Twilio credentials not configured.')
  }
  // Re-create client if SID changed
  if (!twilioClient || _clientSid !== sid) {
    twilioClient = twilio(sid, token)
    _clientSid = sid
  }
  return twilioClient
}

/**
 * Check if Twilio is configured (async — checks DB then env)
 */
export async function isTwilioConfiguredAsync(): Promise<boolean> {
  const { sid, token, fromNumber } = await loadCredentials()
  return !!(sid && token && fromNumber)
}

/**
 * Check if Twilio is configured (sync — env vars only, for backward compat)
 */
export function isTwilioConfigured(): boolean {
  // Check cached DB creds first, then env
  if (_cachedSid && _cachedToken && _cachedFromNumber) return true
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
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

  if (!(await isTwilioConfiguredAsync())) {
    log.warn('[Twilio] Not configured, skipping SMS')
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
    const client = await getClient()
    const result = await client.messages.create({
      body: message,
      from: (await loadCredentials()).fromNumber!,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    log.error({ err: error }, '[Twilio] Failed to send void approval SMS:')
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

  if (!(await isTwilioConfiguredAsync())) {
    log.warn('[Twilio] Not configured, skipping SMS')
    return { success: false, error: 'Twilio not configured' }
  }

  const message = `[GWI POS] APPROVED

Code: ${code}

Give to ${serverName}. Valid 5 min.`

  try {
    const client = await getClient()
    const result = await client.messages.create({
      body: message,
      from: (await loadCredentials()).fromNumber!,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    log.error({ err: error }, '[Twilio] Failed to send approval code SMS:')
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

  if (!(await isTwilioConfiguredAsync())) {
    return { success: false, error: 'Twilio not configured' }
  }

  const message = `[GWI POS] VOID REJECTED

You rejected the void request from ${serverName} for ${itemName} ($${amount.toFixed(2)}).`

  try {
    const client = await getClient()
    const result = await client.messages.create({
      body: message,
      from: (await loadCredentials()).fromNumber!,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    log.error({ err: error }, '[Twilio] Failed to send rejection SMS:')
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
export async function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): Promise<boolean> {
  const { token } = await loadCredentials()
  if (!token) {
    log.error('[Twilio] Cannot validate signature: Auth token not configured')
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
    .createHmac('sha1', token)
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

  if (!(await isTwilioConfiguredAsync())) {
    log.warn('[Twilio] Not configured, skipping SMS')
    return { success: false, error: 'Twilio not configured' }
  }

  try {
    const client = await getClient()
    const result = await client.messages.create({
      body,
      from: (await loadCredentials()).fromNumber!,
      to: formatPhoneE164(to),
    })

    return { success: true, messageSid: result.sid }
  } catch (error) {
    log.error({ err: error }, '[Twilio] Failed to send SMS:')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
