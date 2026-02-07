# Error Reporting Domain (Domain 16)

**Code**: ER
**PM Trigger**: `PM Mode: Error Reporting`
**Status**: ✅ Database Layer Complete

---

## Mission

**Catch and diagnose issues before merchants know there's a problem.**

Primary Focus: **Orders and Payments** (critical path preventing revenue)
Secondary Focus: **Full system observability** for all domains

---

## Architecture Overview

### Storage Strategy: Hybrid (Pivot-Ready)

```
┌─────────────────────────────────────────────────────────────┐
│                    ERROR REPORTING SYSTEM                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Frontend Errors ──┐                                        │
│  Backend Errors ───┼──→ Error Capture ──→ Classification   │
│  API Failures ─────┤         ↓                              │
│  Performance ──────┘    Severity Level                      │
│                            ↓                                 │
│                     ┌──────┴────────┐                       │
│                     │               │                       │
│               CRITICAL/HIGH     MEDIUM/LOW                  │
│                     │               │                       │
│                     ↓               ↓                       │
│              Database Storage   Log Files                   │
│              (searchable)      (detailed)                   │
│                     │               │                       │
│                     └───────┬───────┘                       │
│                             ↓                               │
│                      Alert Engine                           │
│                             ↓                               │
│                   ┌─────────┼─────────┐                    │
│                   │         │         │                    │
│                  SMS     Email     Slack                    │
│              (Critical)  (All)  (Dashboard)                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Today**: Database + Log Files
**Tomorrow**: Easy pivot to Sentry, LogRocket, Datadog, etc.
(Schema designed for export compatibility)

---

## Database Schema

### ErrorLog
**Purpose**: Searchable storage for all errors with full context

| Field | Type | Description |
|-------|------|-------------|
| `severity` | String | CRITICAL, HIGH, MEDIUM, LOW |
| `errorType` | String | PAYMENT, ORDER, API, FRONTEND, DATABASE, etc. |
| `category` | String | Grouping key (e.g., "payment-timeout") |
| `message` | String | Error message |
| `stackTrace` | String? | Full stack trace |
| `errorCode` | String? | Custom codes (PAY_001, ORD_403) |
| **Context** | | |
| `locationId` | String | Which merchant |
| `employeeId` | String? | Who was logged in |
| `path` | String | URL or API route |
| `action` | String | What they were doing |
| `component` | String? | React component if frontend |
| **Business Context** | | |
| `orderId` | String? | Link to order |
| `tableId` | String? | Link to table |
| `paymentId` | String? | Link to payment |
| `customerId` | String? | Link to customer |
| **Technical** | | |
| `userAgent` | String? | Browser info |
| `browserInfo` | String? | Parsed details (JSON) |
| `requestBody` | String? | Sanitized request |
| `responseBody` | String? | API response |
| `responseTime` | Int? | Milliseconds |
| **Resolution** | | |
| `status` | String | NEW, INVESTIGATING, RESOLVED, IGNORED |
| `groupId` | String? | Link similar errors |
| `occurrenceCount` | Int | How many times |
| `firstOccurred` | DateTime | First occurrence |
| `lastOccurred` | DateTime | Most recent |
| `resolvedAt` | DateTime? | When fixed |
| `resolution` | String? | How it was fixed |
| `notes` | String? | Developer notes |
| **Alerting** | | |
| `alertSent` | Boolean | Alert sent? |
| `alertSentAt` | DateTime? | When sent |

### PerformanceLog
**Purpose**: Track slow operations

| Field | Type | Description |
|-------|------|-------------|
| `operation` | String | Description (e.g., "API: GET /api/orders") |
| `duration` | Int | Milliseconds |
| `threshold` | Int | Expected max (alert if exceeded) |
| `context` | String? | Additional context (JSON) |
| `stackTrace` | String? | Where called from |

### HealthCheck
**Purpose**: Monitor critical systems

| Field | Type | Description |
|-------|------|-------------|
| `checkType` | String | ORDER_CREATION, PAYMENT_PROCESSING, etc. |
| `status` | String | HEALTHY, DEGRADED, DOWN |
| `responseTime` | Int? | Milliseconds |
| `errorMessage` | String? | If not healthy |

---

## Severity Levels

| Level | Description | Response Time | Alert Method |
|-------|-------------|---------------|--------------|
| **CRITICAL** | Orders/payments blocked | Immediate | SMS + Slack + Email |
| **HIGH** | Degraded functionality | 5 minutes | Email + Slack |
| **MEDIUM** | Minor issues | Hourly batch | Email |
| **LOW** | Warnings, info | Daily/weekly | Dashboard only |

---

## Error Types

| Type | Examples | Critical? |
|------|----------|-----------|
| **PAYMENT** | Card declined, processor timeout | ✅ Yes |
| **ORDER** | Creation failed, item not found | ✅ Yes |
| **API** | Route error, timeout, 500 | Depends |
| **FRONTEND** | React crash, component error | Depends |
| **DATABASE** | Query timeout, connection lost | ✅ Yes |
| **NETWORK** | Lost connection, timeout | Depends |
| **BUSINESS_LOGIC** | Validation failed, rule violated | No |
| **PERFORMANCE** | Slow query, slow API | No |

---

## Critical Path Monitoring

### Orders
- Order creation success rate
- Average creation time
- Failed order attempts

### Payments
- Payment success rate
- Average processing time
- Processor timeout rate
- Card decline rate

### Operations
- Table operation success
- Print job success rate
- Menu loading performance
- Database query performance

---

## Implementation Phases

### ✅ Phase 1: Database Layer (COMPLETE)
- [x] Create ErrorLog schema
- [x] Create PerformanceLog schema
- [x] Create HealthCheck schema
- [x] Add relations to Location and Employee
- [x] Document domain architecture

### ⏳ Phase 2: Error Capture Utility
- [ ] Create `errorCapture` service
- [ ] Add React Error Boundary
- [ ] Create API endpoint: `POST /api/monitoring/error`
- [ ] Create API endpoint: `POST /api/monitoring/performance`
- [ ] Create API endpoint: `POST /api/monitoring/health-check`

### ⏳ Phase 3: Integration
- [ ] API call interceptors (catch all API failures)
- [ ] Database query monitoring
- [ ] Critical path monitoring (orders/payments)
- [ ] Frontend error boundary integration

### ⏳ Phase 4: Alerting
- [ ] Email notification service
- [ ] Slack webhook integration
- [ ] SMS via Twilio (critical only)
- [ ] Alert rules engine
- [ ] Alert throttling (prevent spam)

### ⏳ Phase 5: Dashboard
- [ ] Error list view with search/filter
- [ ] Error grouping display
- [ ] Critical path health dashboard
- [ ] Performance monitoring view
- [ ] Resolution workflow UI
- [ ] Export functionality

---

## Usage Examples

### Capturing an Error
```typescript
import { errorCapture } from '@/lib/error-capture'

try {
  await processPayment(orderId, amount)
} catch (error) {
  await errorCapture.log({
    severity: 'CRITICAL',
    errorType: 'PAYMENT',
    category: 'payment-timeout',
    message: 'Payment processor timeout',
    action: `Processing payment for Order #${orderNumber}`,
    orderId,
    tableId,
    error, // Automatically extracts stack trace
  })

  // Show user-friendly message
  toast.error('Payment failed. Please try again.')
}
```

### Performance Monitoring
```typescript
import { performanceMonitor } from '@/lib/performance-monitor'

const startTime = Date.now()
const orders = await db.order.findMany({ where: { ... } })
const duration = Date.now() - startTime

if (duration > 2000) { // Threshold: 2 seconds
  await performanceMonitor.log({
    operation: 'Database: findMany orders',
    duration,
    threshold: 2000,
    context: { filterCount: orders.length },
  })
}
```

### Health Check
```typescript
import { healthCheck } from '@/lib/health-check'

// Periodic health check
setInterval(async () => {
  try {
    const startTime = Date.now()
    await fetch('/api/orders?locationId=test')
    const responseTime = Date.now() - startTime

    await healthCheck.record({
      checkType: 'ORDER_CREATION',
      status: 'HEALTHY',
      responseTime,
    })
  } catch (error) {
    await healthCheck.record({
      checkType: 'ORDER_CREATION',
      status: 'DOWN',
      errorMessage: error.message,
    })
  }
}, 60000) // Every minute
```

---

## Alert Configuration

### Alert Rules (Future)
```typescript
{
  // Immediate SMS for critical payment/order failures
  rules: [
    {
      condition: 'severity === CRITICAL && errorType === PAYMENT',
      action: 'sms',
      throttle: '5 minutes', // Max 1 SMS per 5 min for same error
    },
    {
      condition: 'severity === CRITICAL && errorType === ORDER',
      action: 'sms + slack',
      throttle: '5 minutes',
    },
    {
      condition: 'severity === HIGH',
      action: 'email + slack',
      throttle: '15 minutes',
    },
    {
      condition: 'errorType === PERFORMANCE && duration > 5000',
      action: 'email',
      throttle: '1 hour',
    },
  ]
}
```

---

## Pivot Strategy

### Current: Hybrid Storage
```
CRITICAL/HIGH errors → Database (searchable, persistent)
All errors → Log files (detailed, 7-day rotation)
```

### Future: External Service
```typescript
// Easy pivot - just change the transport
export const errorCapture = {
  async log(error: ErrorData) {
    // Still log to database for critical
    if (error.severity === 'CRITICAL' || error.severity === 'HIGH') {
      await db.errorLog.create({ data: error })
    }

    // Export to external service
    await sentry.captureException(error)
    // OR
    await logRocket.log(error)
    // OR
    await datadog.log(error)
  }
}
```

Schema is designed to export in formats compatible with:
- Sentry
- LogRocket
- Datadog
- CloudWatch
- Custom logging services

---

## Key Metrics to Track

### System Health
- Error rate per hour/day
- Error rate by location
- Error rate by severity
- Most common error categories

### Critical Path
- Order creation success rate (target: 99.9%)
- Payment success rate (target: 99.5%)
- Average order creation time (target: <500ms)
- Average payment processing time (target: <2s)

### Performance
- Slow API calls (>2s)
- Slow database queries (>1s)
- Frontend render time
- Network latency

---

## Next Steps

1. **Run Database Migration**
   ```bash
   npm run db:push
   # or
   npx prisma migrate dev --name add-error-reporting
   ```

2. **Start Phase 2**: Build error capture utility
3. **Integrate**: Add error boundaries and interceptors
4. **Configure Alerts**: Set up notification channels
5. **Build Dashboard**: Create monitoring UI

---

## Domain Ownership

**PM**: Error Reporting PM
**Priority**: P0 (Critical for production deployment)
**Dependencies**: None (foundational system)
**Blocks**: Production deployment readiness

---

## Related Documentation

- `/docs/changelogs/ERROR-REPORTING-CHANGELOG.md` - Session history
- `/docs/skills/` - Error reporting skills
- `CLAUDE.md` - Domain registry

---

**Last Updated**: 2026-02-07
**Status**: Database layer complete, ready for Phase 2
