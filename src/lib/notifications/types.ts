/**
 * Notification Platform — Canonical Types
 *
 * These enums and interfaces are the single source of truth.
 * Do not redefine them inline elsewhere.
 */

// ─── Provider Types ──────────────────────────────────────────────────────────

export type ProviderType = 'jtech' | 'lrs' | 'retekess' | 'sms' | 'display' | 'shelf' | 'voice'

// ─── Subject Types ───────────────────────────────────────────────────────────

export type SubjectType = 'order' | 'waitlist_entry' | 'reservation' | 'staff_task'

// ─── Target Types ────────────────────────────────────────────────────────────

export type TargetType = 'guest_pager' | 'phone_sms' | 'phone_voice' | 'order_screen' | 'staff_pager' | 'table_locator'

// ─── Notification Mode ───────────────────────────────────────────────────────

export type NotificationMode = 'off' | 'shadow' | 'dry_run' | 'primary' | 'forced_legacy'

// ─── Job Status ──────────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'claimed'
  | 'processing'
  | 'waiting_retry'
  | 'waiting_fallback'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'suppressed'
  | 'dead_letter'

// ─── Terminal Result ─────────────────────────────────────────────────────────

export type TerminalResult =
  | 'delivered'
  | 'failed'
  | 'timed_out_unknown'
  | 'suppressed'
  | 'deduplicated'
  | 'cancelled'
  | 'fallback_delivered'

// ─── Attempt Result ──────────────────────────────────────────────────────────

export type AttemptResult =
  | 'success'
  | 'provider_failure'
  | 'timeout_unknown_delivery'
  | 'network_error'
  | 'validation_error'
  | 'suppressed'
  | 'deduplicated'
  | 'cancelled'
  | 'skipped_circuit_open'
  | 'skipped_rate_limited'
  | 'skipped_subject_closed'
  | 'skipped_target_released'

// ─── Device Status ───────────────────────────────────────────────────────────

export type DeviceStatus =
  | 'available'
  | 'assigned'
  | 'released'
  | 'returned_pending'
  | 'missing'
  | 'disabled'
  | 'retired'

// ─── Dispatch Origin ─────────────────────────────────────────────────────────

export type DispatchOrigin =
  | 'automatic'
  | 'manual_override'
  | 'system_retry'
  | 'system_fallback'
  | 'admin_replay'
  | 'system_probe'

// ─── Business Stage ──────────────────────────────────────────────────────────

export type BusinessStage = 'initial_ready' | 'second_call' | 'final_warning' | 'expired_notice'

// ─── Execution Stage ─────────────────────────────────────────────────────────

export type ExecutionStage = 'first_attempt' | 'retry_1' | 'retry_2' | 'retry_3' | 'fallback_1'

// ─── Criticality Class ──────────────────────────────────────────────────────

export type CriticalityClass = 'critical' | 'standard' | 'informational'

// ─── Notification Event Types ────────────────────────────────────────────────

export type NotificationEventType =
  | 'waitlist_added'
  | 'waitlist_ready'
  | 'waitlist_second_call'
  | 'waitlist_final_warning'
  | 'waitlist_expired'
  | 'order_created'
  | 'order_ready'
  | 'order_delayed'
  | 'order_picked_up'
  | 'order_cancelled'
  | 'order_recalled'
  | 'curbside_arrived'
  | 'server_needed'
  | 'expo_recall'
  | 'staff_alert'

// ─── Criticality Mapping ────────────────────────────────────────────────────

export const EVENT_CRITICALITY: Record<NotificationEventType, CriticalityClass> = {
  waitlist_added: 'informational',
  waitlist_ready: 'standard',
  waitlist_second_call: 'standard',
  waitlist_final_warning: 'standard',
  waitlist_expired: 'informational',
  order_created: 'informational',
  order_ready: 'standard',
  order_delayed: 'standard',
  order_picked_up: 'informational',
  order_cancelled: 'standard',
  order_recalled: 'standard',
  curbside_arrived: 'standard',
  server_needed: 'critical',
  expo_recall: 'standard',
  staff_alert: 'critical',
}

// ─── Capabilities ────────────────────────────────────────────────────────────

export interface NotificationCapabilities {
  canPageNumeric: boolean
  canPageAlpha: boolean
  canSms: boolean
  canVoice: boolean
  canDisplayPush: boolean
  canDeviceInventory: boolean
  canDeviceAssignment: boolean
  canDeviceRecall: boolean
  canOutOfRangeDetection: boolean
  canBatteryTelemetry: boolean
  canTracking: boolean
  canKioskDispense: boolean
  canCancellation: boolean
  canDeliveryConfirmation: boolean
}

// ─── Input / Context / Result ────────────────────────────────────────────────

export interface NotificationInput {
  locationId: string
  eventType: NotificationEventType
  subjectType: SubjectType
  subjectId: string
  subjectVersion: number
  sourceSystem: string
  sourceEventId: string
  sourceEventVersion?: number
  dispatchOrigin: DispatchOrigin
  businessStage: BusinessStage
  correlationId?: string
  contextSnapshot: Record<string, unknown>
  isProbe?: boolean
}

export interface NotificationContext {
  orderNumber?: number
  customerName?: string
  partySize?: number
  locationName?: string
  fulfillmentMode?: string
  waitMinutes?: number
  pagerNumber?: string
  phone?: string
  tableName?: string
}

export interface NotificationResult {
  jobsEnqueued: number
  jobIds: string[]
  suppressed: number
  deduplicated: number
  errors: number
}

export interface TestResult {
  success: boolean
  latencyMs: number
  capabilities: NotificationCapabilities
  error?: string
  rawResponse?: string
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface NotificationProvider {
  /** Unique provider type identifier */
  readonly type: ProviderType

  /** Send a notification to a target */
  send(params: {
    targetType: TargetType
    targetValue: string
    message: string
    providerId: string
    config: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<{
    success: boolean
    providerMessageId?: string
    providerStatusCode?: string
    deliveryConfidence?: string
    rawResponse?: string
    errorCode?: string
    normalizedError?: string
    latencyMs: number
  }>

  /** Test the connection and detect capabilities */
  testConnection(config: Record<string, unknown>): Promise<TestResult>

  /** Return the provider's capabilities based on config */
  getCapabilities(config: Record<string, unknown>): NotificationCapabilities

  /** Optional: Cancel a previously sent notification */
  cancel?(params: {
    providerMessageId: string
    config: Record<string, unknown>
  }): Promise<{ success: boolean; error?: string }>

  /** Optional: Recall/vibrate a physical device */
  recallDevice?(params: {
    deviceNumber: string
    config: Record<string, unknown>
  }): Promise<{ success: boolean; error?: string }>
}

// ─── Policy Snapshot ─────────────────────────────────────────────────────────

export interface NotificationPolicySnapshot {
  retryMaxAttempts: number
  retryDelayMs: number
  retryBackoffMultiplier: number
  retryOnTimeout: boolean
  fallbackProviderId: string | null
  escalateToStaff: boolean
  criticalityClass: CriticalityClass
  cooldownSeconds: number
  allowManualOverride: boolean
  notificationMode: NotificationMode
  providerHealthStatus: string
  providerCapabilities: NotificationCapabilities
}

// ─── Normalized Error Codes ──────────────────────────────────────────────────

export type NormalizedErrorCode =
  | 'AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'DEVICE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN'

// ─── Terminal job status set (for dedup checks) ─────────────────────────────

export const TERMINAL_JOB_STATUSES: Set<JobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'dead_letter',
])

export const NON_TERMINAL_JOB_STATUSES: Set<JobStatus> = new Set([
  'pending',
  'claimed',
  'processing',
  'waiting_retry',
  'waiting_fallback',
  'suppressed',
])
