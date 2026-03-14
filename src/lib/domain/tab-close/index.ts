/**
 * Tab Close Domain Module
 *
 * Business logic for closing bar tabs (pre-auth capture flow).
 * Follows 3-phase locking architecture: validate -> Datacap calls -> record.
 *
 * Three-bucket classification:
 * - Pure policy: parseTipSuggestions, computePurchaseAmount, resolveCardsToCharge,
 *   resolveAutoGratuity, buildZeroTabResponse
 * - Orchestration (TxClient param): validateTabForClose, recordZeroTabResult,
 *   recordCaptureFailure, recordCaptureSuccess
 * - Infrastructure (stays in route): Datacap API calls, socket dispatch,
 *   entertainment cleanup, tip allocation, outage queue writes
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  TxClient,
  TabCloseInput,
  TabCloseValidationResult,
  TabCloseOrder,
  TabCloseCard,
  CardResolutionResult,
  ZeroTabReleaseResult,
  CaptureFailureResult,
  CaptureSuccessInput,
  BottleServiceTier,
} from './types'

// ─── Validation (Phase 1) ───────────────────────────────────────────────────

export { validateTabForClose } from './validation'

// ─── Pure Computation ───────────────────────────────────────────────────────

export {
  parseTipSuggestions,
  computePurchaseAmount,
  resolveCardsToCharge,
  resolveAutoGratuity,
} from './compute'

// ─── Zero-Tab Handling ──────────────────────────────────────────────────────

export { recordZeroTabResult, buildZeroTabResponse } from './zero-tab'

// ─── Capture Recording (Phase 3) ───────────────────────────────────────────

export { recordCaptureFailure, recordCaptureSuccess } from './capture-recording'
