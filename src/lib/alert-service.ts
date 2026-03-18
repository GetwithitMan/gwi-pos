/**
 * Alert Service
 *
 * Centralized alert dispatch system with rules engine and throttling.
 * Sends alerts via Email, Slack, and SMS based on severity and configuration.
 *
 * Alert Rules:
 * - CRITICAL: SMS + Slack + Email (immediate)
 * - HIGH: Slack + Email (5 minute throttle)
 * - MEDIUM: Email only (hourly batch)
 * - LOW: Dashboard only (no alerts)
 *
 * Throttling:
 * - Same error (by groupId) won't alert more than once per throttle window
 * - Critical errors: 5 minute throttle
 * - High errors: 15 minute throttle
 * - Medium errors: 1 hour throttle
 */

import { db } from './db'
import { getLocationSettings } from './location-cache'
import { parseSettings } from './settings'
import { logVenueEvent } from './venue-logger'
import type { VenueLogLevel, VenueLogCategory } from './venue-logger'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('alert-service')

// ============================================
// Type Definitions
// ============================================

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AlertChannel = 'email' | 'slack' | 'sms'

export interface AlertPayload {
  severity: AlertSeverity
  errorType: string
  category: string
  message: string

  // Context
  locationId?: string
  employeeId?: string
  orderId?: string
  paymentId?: string

  // Error details
  stackTrace?: string
  errorCode?: string
  path?: string
  action?: string

  // For grouping/throttling
  groupId?: string
  errorLogId?: string
}

export interface AlertRule {
  severity: AlertSeverity
  channels: AlertChannel[]
  throttleMinutes: number
}

// ============================================
// Alert Rules Configuration
// ============================================

const ALERT_RULES: AlertRule[] = [
  {
    severity: 'CRITICAL',
    channels: ['sms', 'slack', 'email'],
    throttleMinutes: 5, // Max once per 5 minutes for same error
  },
  {
    severity: 'HIGH',
    channels: ['slack', 'email'],
    throttleMinutes: 15, // Max once per 15 minutes
  },
  {
    severity: 'MEDIUM',
    channels: ['email'],
    throttleMinutes: 60, // Max once per hour
  },
  {
    severity: 'LOW',
    channels: [], // No alerts, dashboard only
    throttleMinutes: 0,
  },
]

// ============================================
// Throttling System
// ============================================

/**
 * Check if an alert should be throttled (already sent recently)
 */
async function shouldThrottle(
  groupId: string,
  severity: AlertSeverity
): Promise<boolean> {
  const rule = ALERT_RULES.find(r => r.severity === severity)
  if (!rule || rule.throttleMinutes === 0) return false

  // Check if this error group has been alerted recently
  const throttleWindow = new Date()
  throttleWindow.setMinutes(throttleWindow.getMinutes() - rule.throttleMinutes)

  const recentAlert = await db.errorLog.findFirst({
    where: {
      groupId,
      alertSent: true,
      alertSentAt: {
        gte: throttleWindow,
      },
    },
  })

  return !!recentAlert
}

/**
 * Mark alert as sent in the database
 */
async function markAlertSent(errorLogId: string): Promise<void> {
  await db.errorLog.update({
    where: { id: errorLogId },
    data: {
      alertSent: true,
      alertSentAt: new Date(),
    },
  })
}

// ============================================
// Alert Dispatch
// ============================================

/**
 * Dispatch alert to appropriate channels based on severity
 */
export async function dispatchAlert(payload: AlertPayload): Promise<{
  sent: boolean
  channels: AlertChannel[]
  throttled: boolean
}> {
  try {
    // Get alert rule for this severity
    const rule = ALERT_RULES.find(r => r.severity === payload.severity)
    if (!rule || rule.channels.length === 0) {
      return { sent: false, channels: [], throttled: false }
    }

    // Check throttling (if groupId provided)
    if (payload.groupId) {
      const throttled = await shouldThrottle(payload.groupId, payload.severity)
      if (throttled) {
        return { sent: false, channels: [], throttled: true }
      }
    }

    // Write a VenueLog entry for every alert dispatch (fire-and-forget)
    const severityToLevel: Record<string, VenueLogLevel> = {
      CRITICAL: 'critical', HIGH: 'error', MEDIUM: 'warn', LOW: 'info',
    }
    const categoryMap: Record<string, VenueLogCategory> = {
      PAYMENT: 'payment', ORDER: 'order', NETWORK: 'sync',
      DATABASE: 'system', FRONTEND: 'system', API: 'system',
      BUSINESS_LOGIC: 'order', PERFORMANCE: 'system',
    }
    void logVenueEvent({
      level: severityToLevel[payload.severity] || 'info',
      source: 'server',
      category: categoryMap[payload.errorType] || 'system',
      message: `[Alert] ${payload.errorType}: ${payload.message}`,
      details: {
        errorCode: payload.errorCode,
        path: payload.path,
        action: payload.action,
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        groupId: payload.groupId,
      },
      employeeId: payload.employeeId,
      locationId: payload.locationId,
    }).catch((err) => log.error({ err }, 'operation failed'))

    // Send alerts to all configured channels
    const results = await Promise.allSettled(
      rule.channels.map(async (channel) => {
        switch (channel) {
          case 'email':
            return sendEmailAlert(payload)
          case 'slack':
            return sendSlackAlert(payload)
          case 'sms':
            return sendSMSAlert(payload)
        }
      })
    )

    // Check if any alerts succeeded
    const successfulChannels = results
      .map((result, index) => {
        if (result.status === 'fulfilled') {
          return rule.channels[index]
        }
        return null
      })
      .filter((c): c is AlertChannel => c !== null)

    // Mark alert as sent if any channel succeeded
    if (successfulChannels.length > 0 && payload.errorLogId) {
      await markAlertSent(payload.errorLogId)
    }

    return {
      sent: successfulChannels.length > 0,
      channels: successfulChannels,
      throttled: false,
    }

  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch alert:')
    return { sent: false, channels: [], throttled: false }
  }
}

// ============================================
// Email Alerts
// ============================================

/**
 * Send email alert
 */
async function sendEmailAlert(payload: AlertPayload): Promise<void> {
  // Check if email service is configured
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_TO) {
    log.warn('Email alerts not configured (missing EMAIL_FROM or EMAIL_TO)')
    return
  }

  try {
    // Import email service dynamically (will create this next)
    const { sendEmail } = await import('./email-service')

    const subject = `[${payload.severity}] ${payload.errorType}: ${payload.message.slice(0, 50)}${payload.message.length > 50 ? '...' : ''}`

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${getSeverityColor(payload.severity)}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">${payload.severity} Error</h1>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">${payload.errorType} - ${payload.category}</p>
        </div>

        <div style="background: #f5f5f5; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="margin-top: 0;">Error Details</h2>
          <p><strong>Message:</strong> ${payload.message}</p>
          ${payload.action ? `<p><strong>Action:</strong> ${payload.action}</p>` : ''}
          ${payload.path ? `<p><strong>Path:</strong> <code>${payload.path}</code></p>` : ''}
          ${payload.errorCode ? `<p><strong>Error Code:</strong> ${payload.errorCode}</p>` : ''}

          ${payload.orderId || payload.paymentId ? '<h3>Business Context</h3>' : ''}
          ${payload.orderId ? `<p><strong>Order ID:</strong> ${payload.orderId}</p>` : ''}
          ${payload.paymentId ? `<p><strong>Payment ID:</strong> ${payload.paymentId}</p>` : ''}

          ${payload.stackTrace ? `
            <h3>Stack Trace</h3>
            <pre style="background: white; padding: 10px; border: 1px solid #ddd; border-radius: 4px; overflow-x: auto; font-size: 12px;">${payload.stackTrace}</pre>
          ` : ''}

          <p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Location ID: ${payload.locationId || 'Unknown'}<br>
            Group ID: ${payload.groupId || 'None'}
          </p>
        </div>
      </div>
    `

    await sendEmail({
      to: process.env.EMAIL_TO,
      subject,
      html,
    })

  } catch (error) {
    log.error({ err: error }, 'Failed to send email alert:')
    throw error
  }
}

// ============================================
// Slack Alerts
// ============================================

/**
 * Resolve Slack webhook URL from location settings (DB) or env var fallback.
 */
export async function resolveSlackWebhookUrl(locationId?: string): Promise<string | undefined> {
  // 1. Try DB settings (per-location, no restart required)
  if (locationId) {
    try {
      const raw = await getLocationSettings(locationId)
      const settings = parseSettings(raw)
      if (settings.alerts?.slackWebhookUrl) {
        return settings.alerts.slackWebhookUrl
      }
    } catch {
      // Non-fatal — fall through to env var
    }
  }
  // 2. Fallback: env var
  return process.env.SLACK_WEBHOOK_URL || undefined
}

/**
 * Send Slack alert via webhook
 */
async function sendSlackAlert(payload: AlertPayload): Promise<void> {
  const webhookUrl = await resolveSlackWebhookUrl(payload.locationId)

  if (!webhookUrl) {
    log.warn('Slack alerts not configured (set webhook URL in Settings > Integrations > Slack, or SLACK_WEBHOOK_URL env var)')
    return
  }

  try {
    const color = getSeverityColor(payload.severity)
    const emoji = getSeverityEmoji(payload.severity)

    const slackPayload = {
      attachments: [
        {
          color,
          fallback: `${payload.severity}: ${payload.message}`,
          pretext: `${emoji} *${payload.severity} Error Detected*`,
          title: `${payload.errorType}: ${payload.category}`,
          text: payload.message,
          fields: [
            ...(payload.action ? [{ title: 'Action', value: payload.action, short: false }] : []),
            ...(payload.path ? [{ title: 'Path', value: `\`${payload.path}\``, short: true }] : []),
            ...(payload.errorCode ? [{ title: 'Error Code', value: payload.errorCode, short: true }] : []),
            ...(payload.orderId ? [{ title: 'Order ID', value: payload.orderId, short: true }] : []),
            ...(payload.paymentId ? [{ title: 'Payment ID', value: payload.paymentId, short: true }] : []),
          ],
          footer: 'GWI POS Error Monitoring',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}`)
    }

  } catch (error) {
    log.error({ err: error }, 'Failed to send Slack alert:')
    throw error
  }
}

// ============================================
// SMS Alerts
// ============================================

/**
 * Send SMS alert via Twilio (CRITICAL errors only)
 */
async function sendSMSAlert(payload: AlertPayload): Promise<void> {
  // Only send SMS for CRITICAL errors
  if (payload.severity !== 'CRITICAL') {
    return
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_FROM_NUMBER
  const toNumber = process.env.TWILIO_TO_NUMBER

  if (!accountSid || !authToken || !fromNumber || !toNumber) {
    log.warn('SMS alerts not configured (missing Twilio credentials)')
    return
  }

  try {
    // Import Twilio service dynamically
    const { sendSMS } = await import('./twilio')

    const message = `🚨 CRITICAL ERROR - ${payload.errorType}
${payload.message.slice(0, 100)}${payload.message.length > 100 ? '...' : ''}
${payload.orderId ? `Order: ${payload.orderId}` : ''}
${payload.paymentId ? `Payment: ${payload.paymentId}` : ''}`

    await sendSMS({
      to: toNumber,
      body: message,
    })

  } catch (error) {
    log.error({ err: error }, 'Failed to send SMS alert:')
    throw error
  }
}

// ============================================
// Helper Functions
// ============================================

function getSeverityColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return '#dc2626' // Red
    case 'HIGH':
      return '#f97316' // Orange
    case 'MEDIUM':
      return '#eab308' // Yellow
    case 'LOW':
      return '#3b82f6' // Blue
    default:
      return '#6b7280' // Gray
  }
}

function getSeverityEmoji(severity: AlertSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return '🚨'
    case 'HIGH':
      return '⚠️'
    case 'MEDIUM':
      return '⚡'
    case 'LOW':
      return 'ℹ️'
    default:
      return '❓'
  }
}
