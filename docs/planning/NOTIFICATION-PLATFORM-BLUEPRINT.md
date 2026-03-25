# Restaurant Notification Platform — Developer-Ready Handoff

## Final Master Blueprint

### Durable, Vendor-Neutral Notification Subsystem for GWI POS

This document is the implementation handoff version. It folds in all review fixes, removes prior contradictions, and locks the rules needed for engineering, ops, and phased rollout.

---

## 0. Executive Summary

We are building a durable, vendor-neutral notification subsystem for GWI POS.

It must support:
- JTECH first
- SMS as fallback/parallel provider
- LRS / Retekess later
- display projection later
- kiosk/shelf/tracker later as separate operational extensions

Core design rule:
- `notifyEvent()` never sends directly
- it only evaluates routing and enqueues durable jobs
- workers process jobs asynchronously
- API callers never block on delivery

This subsystem must survive:
- duplicate source events
- retries
- worker crashes
- provider outages
- race conditions
- partial rollouts
- legacy coexistence during migration

---

## 1. Locked Design Decisions

### 1.1 Core Principles
- KDS paging triggers on final bump only
- pager number is visible on web KDS and Android KDS
- provider model is vendor-neutral from day one
- NotificationTargetAssignment is the source of truth for who/what to notify
- Order.pagerNumber and WaitlistEntry.pagerNumber are cache-only
- all sends are driven by durable jobs
- all delivery executions are recorded as immutable attempts
- display projection is not treated as a standard messaging channel
- v1 scope is notification-centric only: pager, SMS, routing, queueing, auditing, inventory
- shelf, kiosk dispenser, tracker, telemetry, inbound webhooks are explicitly deferred

### 1.2 Rollout Ownership Model

Per location, notification ownership is controlled by:

```typescript
type NotificationMode = 'off' | 'shadow' | 'dry_run' | 'primary' | 'forced_legacy'
```

| Mode | New system | Legacy direct Twilio | Who sends |
|------|-----------|---------------------|-----------|
| off | disabled | active | legacy |
| shadow | evaluates/logs only | active | legacy |
| dry_run | enqueues/processes but skips live sends | active | legacy |
| primary | live sending | disabled for covered events | new system |
| forced_legacy | logs only | active | legacy |

Default during rollout: `off`

---

## 2. Canonical Enums and Types

These enums are canonical. Do not redefine them inline elsewhere.

### 2.1 ProviderType
```typescript
type ProviderType = 'jtech' | 'lrs' | 'retekess' | 'sms' | 'display' | 'shelf' | 'voice'
```

### 2.2 SubjectType
```typescript
type SubjectType = 'order' | 'waitlist_entry' | 'reservation' | 'staff_task'
```

### 2.3 TargetType
```typescript
type TargetType = 'guest_pager' | 'phone_sms' | 'phone_voice' | 'order_screen' | 'staff_pager' | 'table_locator'
```

### 2.4 NotificationMode
```typescript
type NotificationMode = 'off' | 'shadow' | 'dry_run' | 'primary' | 'forced_legacy'
```

### 2.5 JobStatus
```typescript
type JobStatus = 'pending' | 'claimed' | 'processing' | 'waiting_retry' | 'waiting_fallback' | 'completed' | 'failed' | 'cancelled' | 'suppressed' | 'dead_letter'
```

### 2.6 TerminalResult
```typescript
type TerminalResult = 'delivered' | 'failed' | 'timed_out_unknown' | 'suppressed' | 'deduplicated' | 'cancelled' | 'fallback_delivered'
```

### 2.7 AttemptResult
```typescript
type AttemptResult = 'success' | 'provider_failure' | 'timeout_unknown_delivery' | 'network_error' | 'validation_error' | 'suppressed' | 'deduplicated' | 'cancelled' | 'skipped_circuit_open' | 'skipped_rate_limited' | 'skipped_subject_closed' | 'skipped_target_released'
```

### 2.8 DeviceStatus (v1)
```typescript
type DeviceStatus = 'available' | 'assigned' | 'released' | 'returned_pending' | 'missing' | 'disabled' | 'retired'
```

### 2.9 DispatchOrigin
```typescript
type DispatchOrigin = 'automatic' | 'manual_override' | 'system_retry' | 'system_fallback' | 'admin_replay' | 'system_probe'
```

### 2.10 BusinessStage
```typescript
type BusinessStage = 'initial_ready' | 'second_call' | 'final_warning' | 'expired_notice'
```

### 2.11 ExecutionStage
```typescript
type ExecutionStage = 'first_attempt' | 'retry_1' | 'retry_2' | 'retry_3' | 'fallback_1'
```

### 2.12 CriticalityClass
```typescript
type CriticalityClass = 'critical' | 'standard' | 'informational'
```

---

## 3. Data Model

### 3.1 NotificationJob

One row per logical workflow.

```prisma
model NotificationJob {
  id                  String   @id @default(cuid())
  locationId          String
  eventType           String
  subjectType         String
  subjectId           String
  status              String
  currentAttempt      Int      @default(0)
  maxAttempts         Int      @default(3)
  terminalResult      String?
  dispatchOrigin      String
  businessStage       String
  executionStage      String
  routingRuleId       String?
  providerId          String
  fallbackProviderId  String?
  targetType          String
  targetValue         String
  scheduledFor        DateTime?
  availableAt         DateTime @default(now())
  executionZone       String   @default("any")
  claimedByWorkerId   String?
  claimedAt           DateTime?
  processingTimeoutAt DateTime?
  contextSnapshot     Json
  messageTemplate     String?
  messageRendered     String?
  policySnapshot      Json
  ruleExplainSnapshot Json?
  subjectVersion      Int
  isProbe             Boolean  @default(false)
  sourceSystem        String
  sourceEventId       String
  sourceEventVersion  Int      @default(1)
  idempotencyKey      String
  correlationId       String
  parentJobId         String?
  notificationEngine  String
  lastAttemptAt       DateTime?
  resolvedAt          DateTime?
  resolvedByEmployeeId String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  completedAt         DateTime?

  @@unique([locationId, sourceSystem, sourceEventId, sourceEventVersion])
  @@index([correlationId])
  @@index([subjectType, subjectId])
}
```

**Required DB rules (raw SQL migration):**

```sql
ALTER TABLE "NotificationJob"
  ADD CONSTRAINT "NotificationJob_policySnapshot_not_null"
  CHECK ("policySnapshot" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "NotificationJob_worker_query"
ON "NotificationJob" ("locationId", "status", "availableAt", "executionZone")
WHERE status = 'pending';
```

Probe uniqueness: only one active probe per provider/location via Redis lock `notification:probe:{providerId}` with TTL = cooldown window.

### 3.2 NotificationAttempt

Immutable delivery execution log. One row per send attempt.

```prisma
model NotificationAttempt {
  id                 String   @id @default(cuid())
  jobId              String
  providerId         String
  providerType       String
  targetType         String
  targetValue        String
  messageRendered    String?
  attemptNumber      Int
  startedAt          DateTime
  completedAt        DateTime?
  result             String
  latencyMs          Int?
  rawResponse        String?
  providerMessageId  String?
  providerStatusCode String?
  deliveryConfidence String?
  errorCode          String?
  normalizedError    String?
  isManual           Boolean  @default(false)
  isRetry            Boolean  @default(false)

  @@index([jobId])
  @@index([providerId, startedAt])
}
```

`rawResponse` must be truncated to 500 chars before persistence.

### 3.3 NotificationProvider

```prisma
model NotificationProvider {
  id                      String   @id @default(cuid())
  locationId              String
  providerType            String
  name                    String
  isActive                Boolean  @default(true)
  isDefault               Boolean  @default(false)
  priority                Int      @default(0)
  executionZone           String   @default("any")
  config                  Json
  configVersion           Int      @default(1)
  lastValidatedAt         DateTime?
  lastValidationResult    String?
  capabilities            Json
  healthStatus            String   @default("healthy")
  lastHealthCheckAt       DateTime?
  consecutiveFailures     Int      @default(0)
  circuitBreakerOpenUntil DateTime?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  deletedAt               DateTime?

  @@index([locationId, isActive])
}
```

**NotificationCapabilities:**
```typescript
interface NotificationCapabilities {
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
```

### 3.4 NotificationDevice

```prisma
model NotificationDevice {
  id                    String    @id @default(cuid())
  locationId            String
  providerId            String
  deviceNumber          String
  humanLabel            String?
  deviceType            String
  status                String
  assignedToSubjectType String?
  assignedToSubjectId   String?
  assignedAt            DateTime?
  releasedAt            DateTime?
  returnedAt            DateTime?
  batteryLevel          Int?
  lastSeenAt            DateTime?
  lastSignalState       String?
  capcode               String?
  firmwareVersion       String?
  dockId                String?
  dockSlot              String?
  metadata              Json?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?
}
```

**v1 state machine — only these transitions are valid:**
- `available` → `assigned`
- `assigned` → `released`
- `released` → `returned_pending`
- `returned_pending` → `available` (physical confirmation only)
- `assigned` → `missing`
- `missing` → `available` (manual "found" action only)
- any → `disabled`
- any → `retired`

**Invalid v1 transitions:**
- `missing` → `assigned`
- `retired` → anything
- `available` → `released`
- `released` → `assigned` without going through `available`

**DB constraint:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDevice_active_unique"
ON "NotificationDevice" ("locationId", "deviceNumber")
WHERE "deletedAt" IS NULL AND status NOT IN ('retired', 'disabled');
```

### 3.5 NotificationDeviceEvent

```prisma
model NotificationDeviceEvent {
  id          String   @id @default(cuid())
  deviceId    String
  locationId  String
  eventType   String
  subjectType String?
  subjectId   String?
  employeeId  String?
  metadata    Json?
  createdAt   DateTime @default(now())

  @@index([deviceId, createdAt])
}
```

Event types: `assigned`, `released`, `returned`, `marked_lost`, `found`, `docked`, `undocked`, `retired`, `battery_low`, `signal_lost`, `signal_recovered`, `maintenance_start`, `maintenance_end`, `force_override`

### 3.6 NotificationTargetAssignment

```prisma
model NotificationTargetAssignment {
  id                  String    @id @default(cuid())
  locationId          String
  subjectType         String
  subjectId           String
  targetType          String
  targetValue         String
  providerId          String?
  priority            Int       @default(0)
  isPrimary           Boolean   @default(false)
  source              String
  status              String
  assignedAt          DateTime  @default(now())
  releasedAt          DateTime?
  expiresAt           DateTime?
  releaseReason       String?
  createdByEmployeeId String?
  lastUsedAt          DateTime?
  metadata            Json?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([subjectType, subjectId, status])
}
```

**DB constraint:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationTargetAssignment_active_unique"
ON "NotificationTargetAssignment" ("subjectType", "subjectId", "targetType", "targetValue")
WHERE status = 'active';
```

**Primary target family rules:**
- Primary is scoped per family: `pager` (guest_pager, staff_pager), `phone` (phone_sms, phone_voice), `display` (order_screen), `location` (table_locator)
- At most one active primary per family per subject
- Setting `isPrimary=true` must unset other primaries in same family in the same transaction
- Tie-breaker: same family + same priority → newest active assignment wins

### 3.7 NotificationRoutingRule

```prisma
model NotificationRoutingRule {
  id                        String    @id @default(cuid())
  locationId                String
  eventType                 String
  providerId                String
  targetType                String
  enabled                   Boolean   @default(true)
  priority                  Int       @default(0)
  messageTemplateId         String?
  condFulfillmentMode       String?
  condHasPager              Boolean?
  condHasPhone              Boolean?
  condMinPartySize          Int?
  condOrderTypes            String[]?
  condDuringBusinessHours   Boolean?
  retryMaxAttempts          Int       @default(2)
  retryDelayMs              Int       @default(2000)
  retryBackoffMultiplier    Float     @default(1.5)
  retryOnTimeout            Boolean   @default(false)
  fallbackProviderId        String?
  escalateToStaff           Boolean   @default(false)
  alsoEmitDisplayProjection Boolean   @default(false)
  stopProcessingAfterMatch  Boolean   @default(false)
  cooldownSeconds           Int       @default(0)
  allowManualOverride       Boolean   @default(true)
  criticalityClass          String    @default("standard")
  effectiveStartAt          DateTime?
  effectiveEndAt            DateTime?
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt
  deletedAt                 DateTime?

  @@index([locationId, eventType, enabled])
}
```

Rule evaluation: load enabled rules → sort by priority → evaluate conditions → enqueue or suppress → stop if `stopProcessingAfterMatch`.

### 3.8 NotificationTemplate

```prisma
model NotificationTemplate {
  id                String   @id @default(cuid())
  locationId        String
  name              String
  eventType         String
  channelType       String
  body              String
  locale            String   @default("en")
  maxLength         Int?
  version           Int      @default(1)
  isDefault         Boolean  @default(false)
  requiredVariables String[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
}
```

Variables: `{{orderNumber}}`, `{{customerName}}`, `{{partySize}}`, `{{locationName}}`, `{{fulfillmentMode}}`, `{{waitMinutes}}`, `{{pagerNumber}}`

### 3.9 Order Model Additions

```prisma
  pagerNumber       String?
  fulfillmentMode   String?
  readyCycleCounter Int      @default(0)
```

**Invariants:**
- `pagerNumber` is cache-only. Source of truth = NotificationTargetAssignment
- Order APIs never accept raw pagerNumber as authoritative input
- Legacy clients sending pagerNumber → ignored with deprecation warning
- `readyCycleCounter` increments on send-to-kitchen after recall/remake only

### 3.10 WaitlistEntry Additions

```
pagerNumber TEXT
version     INT DEFAULT 1
```

**Invariants:** Same cache-only rules as Order.pagerNumber.

---

## 4. Source Event Identity and Idempotency

### 4.1 Deterministic source IDs
- KDS bump: `kds_bump:{orderId}:{screenId}:{order.version}`
- Waitlist notify: `waitlist_notify:{entryId}:{entry.version}`
- Manual page: `manual_page:{subjectId}:{uuid}` (unique per click)
- Order ready remake: `order_ready:{orderId}:{readyCycleCounter}`

### 4.2 Layer 1: source dedup
Unique key: `(locationId, sourceSystem, sourceEventId, sourceEventVersion)`
Evaluated once per `notifyEvent()` call.

### 4.3 Layer 2: workflow dedup
`idempotencyKey = hash(locationId + eventType + subjectId + targetType + targetValue + businessStage)`
If existing active job exists with same key (status not in failed/dead_letter/cancelled) → deduplicated.

### 4.4 Manual overrides
Always generate unique source event IDs. Bypass workflow dedup. Must create auditable source event trail.

---

## 5. Source of Truth Hierarchy

1. Active NotificationTargetAssignment
2. Order.pagerNumber / WaitlistEntry.pagerNumber cache
3. Provider capability compatibility
4. Channel formatter output rules
5. Subject lifecycle revalidation
6. Device status gating
7. policySnapshot for retry/fallback behavior

---

## 6. Notification Engine

### 6.1 Criticality mapping

| Event | Criticality |
|-------|------------|
| waitlist_added | informational |
| waitlist_ready | standard |
| waitlist_second_call | standard |
| waitlist_final_warning | standard |
| waitlist_expired | informational |
| order_created | informational |
| order_ready | standard |
| order_delayed | standard |
| order_picked_up | informational |
| order_cancelled | standard |
| order_recalled | standard |
| curbside_arrived | standard |
| server_needed | critical |
| expo_recall | standard |
| staff_alert | critical |

### 6.2 Critical event enqueue rule

Critical events do NOT roll back the source action.
- Source commits first
- Enqueue runs in separate transaction immediately after
- If enqueue fails: log CRITICAL, fire fallback direct Twilio SMS, create manual-repair audit entry

### 6.3 Dispatcher flow

1. Check notification mode for location
2. Evaluate source-event dedup once
3. Load enabled routing rules for event
4. Evaluate conditions, sort by priority
5. For each matched rule: compute idempotency, snapshot policy, render template, persist job, emit NOTIFY
6. Stop on `stopProcessingAfterMatch`
7. If zero rules matched: log explain, increment `notification.rule_match.none` metric

---

## 7. Worker Model

### 7.1 Deployment
Always-on worker required (NUC or dedicated server). Vercel Cron is emergency cloud-only fallback.

### 7.2 Redis
Required for: worker registry, heartbeat, circuit breaker, rate limiting, collision windows.
HA: Redis Sentinel or Cluster. Fallback: in-memory (local only) with admin banner.

### 7.3 Pre-send revalidation

| Event | Allowed states | Suppress states |
|-------|---------------|-----------------|
| waitlist_ready | waiting, notified | seated, cancelled, expired |
| order_ready | in_progress, open, sent | paid, voided, cancelled, closed |
| order_cancelled | cancelled | (always send) |
| staff_alert | any | (never suppress) |

### 7.4 Rate limit precedence
1. Mode / kill switch → 2. Subject lifecycle → 3. Provider health → 4. Target validity → 5. Rule cooldown → 6. Device cooldown → 7. Provider rate limit → 8. Send

### 7.5 Circuit breaker
AUTH_FAILED → immediate open. RATE_LIMITED → no trip. NETWORK_ERROR → increment. DEVICE_NOT_FOUND → no trip.

---

## 8. JTECH Provider

Three transports: CloudAlert, Direct SMS, Local HTTP.
- `local_http` → `executionZone: 'local_nuc'`
- Cloud methods → `executionZone: 'any'`
- SSRF: private subnet IPs only, limited ports, short timeouts

---

## 9. Device Inventory

### Auto-assign: `FOR UPDATE SKIP LOCKED` in transaction
### Return: conservative default — `returned_pending` → `available` only via physical confirmation
### Override: requires `force: true` + employeeId + audit log

---

## 10. Integration Rules

### Order/Waitlist routes
- Accept `assignPager: true`, NOT raw `pagerNumber`
- Legacy pagerNumber in body → ignored with deprecation warning

### KDS
- Final bump only. Atomic commit with job enqueue.

### Manual page
- Separate transaction, unique sourceEventId, bypass workflow dedup

---

## 11. Display Boundary
Display is a parallel subsystem. Rules may emit display projection events via `alsoEmitDisplayProjection`, but display does not create NotificationAttempt records.

---

## 12. Non-Negotiable Invariants

1. One logical workflow = one NotificationJob
2. One delivery execution = one NotificationAttempt
3. No job executes without policySnapshot
4. Manual override always creates unique auditable source event
5. Released/expired targets are never deliverable
6. Cache fields are never source of truth
7. One active device cannot belong to two live subjects simultaneously
8. One active primary target per family per subject
9. Circuit-open provider only processes probe jobs
10. Pager/SMS timeout_unknown is never auto-retried by default
11. Device transitions must follow v1 state machine
12. Legacy direct path disabled when mode=primary
13. Critical enqueue fallback path is mandatory if enqueue fails

---

## 13. Build Plan

**Phase 1**: Schema, repository, dispatcher, worker, template engine, JTECH provider, SMS provider, simulator
**Phase 2**: Assignment APIs, routing rules API, waitlist/KDS/order integration, manual page, ghost reaper
**Phase 3**: Admin UI, DLQ UI, order panel, receipts, KDS pager badge (web + Android)
**Phase 4**: Audit hardening, RBAC, retention/archive, explain inspector, observability
**Phase 5**: LRS, Retekess, voice, display projection, kiosk dispenser, advanced mappings

---

## 14. Security
- pgcrypto encryption for sensitive config fields
- Masked on API GET, write-only updates
- Target-type-aware PII masking and retention
- Full admin audit trail for all config changes
