/**
 * Alert Dispatch Utility (W4-6)
 *
 * Checks action thresholds from location settings and dispatches
 * `location:alert` socket events + persists to AuditLog when exceeded.
 *
 * Usage from any API route:
 * ```typescript
 * import { checkAndDispatchAlerts } from '@/lib/alert-dispatch'
 *
 * // After a void is processed:
 * void checkAndDispatchAlerts(locationId, 'void', {
 *   employeeId, employeeName, orderId, orderNumber, amount,
 * }).catch(console.error)
 * ```
 *
 * Supported actions: void, discount, frequent_discount, overtime_warning, cash_drawer
 */

import { dispatchLocationAlert } from '@/lib/socket-dispatch'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { db } from '@/lib/db'

export interface AlertDetails {
  employeeId?: string
  employeeName?: string
  orderId?: string
  orderNumber?: number
  amount?: number
  count?: number
  /** Extra context displayed in the alert message */
  context?: string
}

export type AlertAction =
  | 'void'
  | 'discount'
  | 'frequent_discount'
  | 'overtime_warning'
  | 'cash_drawer'

/**
 * Check thresholds from location settings and dispatch an alert if exceeded.
 * Fire-and-forget — call with `void checkAndDispatchAlerts(...)`.
 */
export async function checkAndDispatchAlerts(
  locationId: string,
  action: AlertAction,
  details: AlertDetails
): Promise<void> {
  try {
    const settings = parseSettings(await getLocationSettings(locationId))
    const alertSettings = settings.alerts

    if (!alertSettings?.enabled) return

    let shouldAlert = false
    let alertType: 'warning' | 'error' = 'warning'
    let title = ''
    let message = ''

    switch (action) {
      case 'void': {
        if (details.amount && details.amount >= alertSettings.largeVoidThreshold) {
          shouldAlert = true
          alertType = 'error'
          title = 'Large Void'
          message = `${details.employeeName || 'Unknown'} voided $${details.amount.toFixed(2)} on order #${details.orderNumber || '?'}`
        }
        break
      }

      case 'discount': {
        if (details.amount && details.amount >= alertSettings.largeDiscountThreshold) {
          shouldAlert = true
          alertType = 'warning'
          title = 'Large Discount'
          message = `${details.employeeName || 'Unknown'} applied $${details.amount.toFixed(2)} discount on order #${details.orderNumber || '?'}`
        }
        break
      }

      case 'frequent_discount': {
        if (details.count && details.count >= alertSettings.frequentDiscountLimit) {
          shouldAlert = true
          alertType = 'warning'
          title = 'Frequent Discounts'
          message = `${details.employeeName || 'Unknown'} has applied ${details.count} discounts today`
        }
        break
      }

      case 'overtime_warning': {
        shouldAlert = true
        alertType = 'warning'
        title = 'Overtime Warning'
        message = `${details.employeeName || 'Unknown'} is approaching overtime (${alertSettings.overtimeWarningMinutes} min remaining)`
        break
      }

      case 'cash_drawer': {
        if (alertSettings.cashDrawerAlertEnabled) {
          shouldAlert = true
          alertType = 'warning'
          title = 'Cash Drawer Opened'
          message = `${details.employeeName || 'Unknown'} opened the cash drawer${details.context ? ` — ${details.context}` : ''}`
        }
        break
      }
    }

    if (!shouldAlert) return

    // Fire-and-forget: dispatch socket event to all terminals
    void dispatchLocationAlert(locationId, {
      type: alertType,
      title,
      message,
      dismissable: true,
    }, { async: true })

    // Persist to AuditLog for dashboard history
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: details.employeeId || null,
        action: `alert_${action}`,
        entityType: 'alert',
        entityId: details.orderId || null,
        details: JSON.parse(JSON.stringify({
          alertType,
          title,
          message,
          threshold: getThresholdForAction(alertSettings, action),
          actualValue: details.amount ?? details.count ?? null,
          employeeName: details.employeeName,
          orderNumber: details.orderNumber,
        })),
      },
    }).catch(err => console.error('[AlertDispatch] Failed to persist alert:', err))
  } catch (error) {
    console.error('[AlertDispatch] Failed to check/dispatch alerts:', error)
  }
}

function getThresholdForAction(
  alertSettings: { largeVoidThreshold: number; largeDiscountThreshold: number; frequentDiscountLimit: number; overtimeWarningMinutes: number },
  action: AlertAction
): number {
  switch (action) {
    case 'void': return alertSettings.largeVoidThreshold
    case 'discount': return alertSettings.largeDiscountThreshold
    case 'frequent_discount': return alertSettings.frequentDiscountLimit
    case 'overtime_warning': return alertSettings.overtimeWarningMinutes
    default: return 0
  }
}
