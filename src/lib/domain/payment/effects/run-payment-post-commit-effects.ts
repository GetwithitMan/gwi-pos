/**
 * Post-Commit Payment Effects — Orchestrator
 *
 * All fire-and-forget side effects that run AFTER the payment transaction commits.
 * Each subsection is independently try/caught — failures never cascade.
 *
 * Logic lives in focused sub-modules:
 *   - sync-and-outage.ts      — total drift dispatch, outage mode flagging + cloud sync
 *   - kitchen-and-fulfillment.ts — kitchen auto-send (unsent items)
 *   - customer-and-loyalty.ts — customer stats, loyalty accrual, tier promotion
 *   - financial-cleanup.ts    — PMS, split family, order update, inventory, commission, cash drawer, tips
 *   - notifications.ts        — audit logs, socket events, entertainment, table release, cloud events, receipts
 */
import { createChildLogger } from '@/lib/logger'

import { emitTotalDriftWarning, handleOutageModeSync } from './sync-and-outage'
import { autoSendUnsentItems } from './kitchen-and-fulfillment'
import { updateCustomerAndLoyalty } from './customer-and-loyalty'
import {
  finalizePmsAttempt,
  handleSplitFamilyClosure,
  runPostPaymentOrderUpdate,
  createInventoryDeductionOutbox,
  recalculateCommission,
  kickCashDrawerAndAudit,
  allocateTips,
} from './financial-cleanup'
import {
  createPaymentAuditLogs,
  emitParentClosureEvents,
  resetEntertainmentItems,
  releaseTable,
  emitSocketEvents,
  emitCloudEvents,
  autoSendEmailReceipt,
  handleCakeSettlement,
  handleCardRecognition,
  releaseOrderClaim,
  releaseNotificationAssignments,
  notifyCFDReceiptSent,
  triggerUpstreamSync,
} from './notifications'

const log = createChildLogger('payment-post-commit')

// ─── Params Type ──────────────────────────────────────────────────────────────

export interface PostCommitEffectsParams {
  orderId: string
  order: any
  ingestResult: any
  settings: any
  payments: any
  employeeId: string | null
  terminalId: string | null
  allPendingPayments: any[]
  totalTips: number
  newTipTotal: number
  newPaidTotal: number
  effectiveTotal: number
  paidTolerance: number
  orderIsPaid: boolean
  updateData: any
  pointsEarned: number
  newAverageTicket: number | null
  loyaltyEarningBase: number
  shouldUpdateCustomerStats: boolean
  pmsAttemptId: string | null
  pmsTransactionNo: string | null
  unsentItems: any[]
  businessDayStart: string | null
  paymentMutationOrigin: string
  hasCash: boolean
  autoGratApplied: boolean
  autoGratNote: string | null
  isTrainingPayment: boolean
  giftCardBalanceChanges: any[]
  isSplitPayRemaining: boolean
  totalDriftWarning: any
  loyaltyTierMultiplier: number
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function runPaymentPostCommitEffects(params: PostCommitEffectsParams): void {
  const {
    orderId, order, ingestResult, settings, employeeId, terminalId,
    totalTips, newTipTotal, newPaidTotal, effectiveTotal, orderIsPaid,
    updateData, pointsEarned, newAverageTicket, loyaltyEarningBase,
    shouldUpdateCustomerStats, pmsAttemptId, pmsTransactionNo,
    unsentItems, businessDayStart, paymentMutationOrigin, hasCash,
    autoGratApplied, autoGratNote, isTrainingPayment,
    giftCardBalanceChanges, isSplitPayRemaining, totalDriftWarning,
    loyaltyTierMultiplier,
  } = params

  // 1. Total drift socket dispatch
  emitTotalDriftWarning(order, orderId, terminalId, totalDriftWarning)

  // 2. Outage mode payment flagging + cloud sync
  handleOutageModeSync(order, orderId, ingestResult)

  // 3. Kitchen auto-send (unsent items)
  autoSendUnsentItems(order, orderId, unsentItems)

  // 4. PMS attempt finalization
  finalizePmsAttempt(pmsAttemptId, pmsTransactionNo)

  // 5-16. Async effects (split family feeds into remaining)
  void handleAsyncEffects(params).catch(err =>
    log.warn({ err }, 'split family + remaining effects failed')
  )
}

// ─── Async Effects (split family result feeds into later effects) ────────────

async function handleAsyncEffects(params: PostCommitEffectsParams): Promise<void> {
  const {
    orderId, order, ingestResult, settings, employeeId, terminalId,
    totalTips, newTipTotal, newPaidTotal, orderIsPaid, updateData,
    pointsEarned, newAverageTicket, loyaltyEarningBase,
    shouldUpdateCustomerStats, businessDayStart, paymentMutationOrigin,
    hasCash, autoGratApplied, isTrainingPayment,
    giftCardBalanceChanges, isSplitPayRemaining, loyaltyTierMultiplier,
  } = params

  // 5. Split family closure
  const { parentWasMarkedPaid, parentTableId } = await handleSplitFamilyClosure(order, orderId, orderIsPaid, isSplitPayRemaining)

  // 6. Customer & loyalty updates
  updateCustomerAndLoyalty(order, orderId, orderIsPaid, shouldUpdateCustomerStats, pointsEarned, newAverageTicket, loyaltyEarningBase, loyaltyTierMultiplier, employeeId)

  // 7. Audit logs (payment + closure)
  createPaymentAuditLogs(order, orderId, ingestResult, employeeId, orderIsPaid, newPaidTotal)

  // 8. Post-payment order update (businessDayDate, tipTotal, version)
  await runPostPaymentOrderUpdate(order, orderId, orderIsPaid, updateData, businessDayStart, newTipTotal, paymentMutationOrigin)

  // Dispatch socket events when parent order was auto-closed
  emitParentClosureEvents(order, terminalId, parentWasMarkedPaid, parentTableId)

  // 9. Entertainment reset (timed_rental items, floor plan)
  if (orderIsPaid) await resetEntertainmentItems(order, orderId)

  // 10. Inventory deduction outbox
  if (orderIsPaid) await createInventoryDeductionOutbox(order, orderId, ingestResult)

  // 11. Commission recalculation
  if (orderIsPaid) recalculateCommission(order, orderId, paymentMutationOrigin)

  // 12. Cash drawer kick + audit
  if (orderIsPaid && hasCash) kickCashDrawerAndAudit(order, orderId, employeeId, terminalId)

  // 13. Tip allocation
  if (orderIsPaid) await allocateTips(order, orderId, ingestResult, settings, employeeId, totalTips, autoGratApplied, isTrainingPayment)

  // 14. Table release
  if (orderIsPaid) releaseTable(order, orderId, orderIsPaid)

  // 15. Socket emissions (totals, payment processed, gift card, order closed)
  emitSocketEvents(order, orderId, ingestResult, employeeId, terminalId, totalTips, newTipTotal, orderIsPaid, giftCardBalanceChanges, parentWasMarkedPaid)

  // Release order claim after successful payment
  releaseOrderClaim(order, orderId, orderIsPaid)

  // Notification Platform: auto-release pager assignments
  releaseNotificationAssignments(order, employeeId, orderIsPaid)

  // Notify CFD that receipt was sent
  notifyCFDReceiptSent(order, orderIsPaid)

  // 16. Cloud events, integrations, upstream sync, receipt
  emitCloudEvents(order, orderId, ingestResult, settings, employeeId, newTipTotal, orderIsPaid, pointsEarned)

  // Auto-send email receipt for online orders
  autoSendEmailReceipt(order, orderIsPaid)

  // Cake settlement post-payment hook
  handleCakeSettlement(order, ingestResult, orderIsPaid)

  // Trigger upstream sync (debounced)
  triggerUpstreamSync()

  // Card recognition
  handleCardRecognition(order, orderId, ingestResult, settings)
}
