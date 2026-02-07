# Error Reporting Domain - Changelog

**Domain**: Error Reporting (Domain 16)
**PM Trigger**: `PM Mode: Error Reporting`
**Status**: ✅ Database Layer Complete

---

## Session 1: Foundation - 2026-02-07

### Completed

#### Database Layer (Phase 1)
- ✅ Created `ErrorLog` model with comprehensive fields
  - Classification: severity, errorType, category
  - Error details: message, stackTrace, errorCode
  - Context: locationId, employeeId, path, action, component
  - Business context: orderId, tableId, paymentId, customerId
  - Technical context: userAgent, browserInfo, requestBody, responseBody
  - Performance: responseTime
  - Resolution tracking: status, groupId, occurrenceCount, timestamps
  - Alerting: alertSent, alertSentAt
- ✅ Created `PerformanceLog` model
  - operation, duration, threshold
  - Context and stack trace
- ✅ Created `HealthCheck` model
  - checkType, status, responseTime, errorMessage
- ✅ Added relations to `Location` model
  - errorLogs, performanceLogs, healthChecks
- ✅ Added relation to `Employee` model
  - errorLogs (optional foreign key)
- ✅ Created domain documentation at `/docs/domains/ERROR-REPORTING-DOMAIN.md`
- ✅ Updated CLAUDE.md domain registry
  - Added Domain 16 to registry table
  - Added detailed domain section with layers

### Architecture Decisions

1. **Hybrid Storage Strategy**
   - Critical/High errors → Database (searchable, persistent)
   - All errors → Log files (detailed traces, 7-day rotation)
   - Rationale: Balance between query performance and detail retention
   - Pivot path: Easy export to external services (Sentry, LogRocket, etc.)

2. **Severity-Based Alerting**
   - CRITICAL: SMS + Slack + Email (immediate)
   - HIGH: Email + Slack (5 minutes)
   - MEDIUM: Email (hourly batch)
   - LOW: Dashboard only (daily/weekly digest)

3. **Critical Path Focus**
   - Primary: Orders and Payments (revenue-blocking issues)
   - Secondary: Full system observability
   - Rationale: Catch merchant-impacting issues before they know

4. **Schema Design**
   - Rich context fields for quick diagnosis
   - Compatible with external logging formats
   - Error grouping support (deduplication)
   - Resolution workflow tracking

### Files Created

```
/prisma/schema.prisma                                     # Added 3 models + relations
/docs/domains/ERROR-REPORTING-DOMAIN.md                  # Domain documentation
/docs/changelogs/ERROR-REPORTING-CHANGELOG.md            # This file
CLAUDE.md                                                # Updated domain registry
```

### Schema Changes

```prisma
// Added to schema.prisma
model ErrorLog { ... }          # 40+ fields
model PerformanceLog { ... }    # 8 fields
model HealthCheck { ... }       # 7 fields

// Updated Location model
errorLogs       ErrorLog[]
performanceLogs PerformanceLog[]
healthChecks    HealthCheck[]

// Updated Employee model
errorLogs ErrorLog[]
```

### Next Steps (Phase 2)

1. **Error Capture Utility**
   - Create `/src/lib/error-capture.ts`
   - Centralized error logging function
   - Automatic context extraction
   - Severity classification helper

2. **React Error Boundary**
   - Create `/src/lib/error-boundary.tsx`
   - Catch React component errors
   - Display user-friendly fallback UI
   - Log to ErrorLog table

3. **API Endpoints**
   - `POST /api/monitoring/error` - Log error
   - `POST /api/monitoring/performance` - Log slow operation
   - `POST /api/monitoring/health-check` - Record health status
   - `GET /api/monitoring/errors` - List/search errors
   - `PUT /api/monitoring/errors/[id]` - Update error status

4. **Integration Points**
   - API call interceptors
   - Database query monitoring
   - Critical path tracking (orders/payments)

---

## Migration Command

```bash
# Run migration to create tables
npx prisma migrate dev --name add-error-reporting

# Or push schema changes
npm run db:push
```

---

## Domain Structure

```
/src/
├── lib/
│   ├── error-capture.ts           # Phase 2: Error capture utility
│   ├── error-boundary.tsx         # Phase 2: React error boundary
│   ├── performance-monitor.ts     # Phase 2: Performance tracking
│   ├── health-check.ts            # Phase 2: Health monitoring
│   └── alert-service.ts           # Phase 4: Alert notifications
├── app/
│   ├── api/
│   │   └── monitoring/
│   │       ├── error/route.ts              # Phase 2: Log error
│   │       ├── performance/route.ts        # Phase 2: Log performance
│   │       ├── health-check/route.ts       # Phase 2: Health check
│   │       ├── errors/
│   │       │   ├── route.ts                # Phase 5: List errors
│   │       │   └── [id]/
│   │       │       ├── route.ts            # Phase 5: Update error
│   │       │       ├── resolve/route.ts    # Phase 5: Mark resolved
│   │       │       └── notes/route.ts      # Phase 5: Add notes
│   │       ├── dashboard/route.ts          # Phase 5: Summary stats
│   │       └── alerts/
│   │           ├── rules/route.ts          # Phase 4: Alert rules
│   │           └── test/route.ts           # Phase 4: Test alert
│   └── (admin)/
│       └── monitoring/
│           ├── page.tsx                    # Phase 5: Dashboard
│           ├── errors/page.tsx             # Phase 5: Error list
│           ├── groups/page.tsx             # Phase 5: Error groups
│           ├── performance/page.tsx        # Phase 5: Performance view
│           ├── health/page.tsx             # Phase 5: Health status
│           └── alerts/page.tsx             # Phase 5: Alert config
└── components/
    └── monitoring/
        ├── ErrorList.tsx                   # Phase 5: Error table
        ├── ErrorGroupCard.tsx              # Phase 5: Grouped errors
        ├── PerformanceChart.tsx            # Phase 5: Performance graph
        ├── HealthStatusCard.tsx            # Phase 5: System health
        └── AlertRuleEditor.tsx             # Phase 5: Alert config UI
```

---

## Key Metrics (To Be Tracked)

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

## Alert Configuration (Future)

```typescript
{
  rules: [
    {
      name: 'Critical Payment Failure',
      condition: 'severity === CRITICAL && errorType === PAYMENT',
      action: 'sms + slack + email',
      throttle: '5 minutes',
    },
    {
      name: 'Order Creation Down',
      condition: 'severity === CRITICAL && errorType === ORDER',
      action: 'sms + slack',
      throttle: '5 minutes',
    },
    {
      name: 'High Severity Issues',
      condition: 'severity === HIGH',
      action: 'email + slack',
      throttle: '15 minutes',
    },
    {
      name: 'Slow Performance',
      condition: 'errorType === PERFORMANCE && duration > 5000',
      action: 'email',
      throttle: '1 hour',
    },
  ]
}
```

---

## Related Skills

None yet - this is the foundation

---

## EOD Summary - 2026-02-07

### What Was Completed
- [x] Designed Error Reporting domain architecture
- [x] Created database schema (ErrorLog, PerformanceLog, HealthCheck)
- [x] Added relations to Location and Employee models
- [x] Created comprehensive domain documentation
- [x] Updated CLAUDE.md domain registry
- [x] Created changelog file

### What's Next
- [ ] Phase 2: Build error capture utility and API endpoints
- [ ] Phase 3: Integrate error capture across application
- [ ] Phase 4: Implement alerting system
- [ ] Phase 5: Build monitoring dashboard

### Files Modified
```
prisma/schema.prisma
docs/domains/ERROR-REPORTING-DOMAIN.md (NEW)
docs/changelogs/ERROR-REPORTING-CHANGELOG.md (NEW)
CLAUDE.md
```

### Resume Tomorrow
1. Say: `PM Mode: Error Reporting`
2. Review domain documentation
3. Start Phase 2: Error capture utility
4. Create `/src/lib/error-capture.ts`
5. Create API endpoint: `POST /api/monitoring/error`

---

**Last Updated**: 2026-02-07
**Status**: Phase 1 Complete, Ready for Phase 2
