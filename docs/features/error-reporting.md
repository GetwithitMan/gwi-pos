# Feature: Error Reporting

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Observability layer with hybrid storage (critical errors → DB, all errors → logs), severity-based alerting (SMS + Slack + email), throttled dispatch, React error boundaries, health monitoring, and performance tracking. Pivot-ready for Sentry/Datadog. Payment failures = CRITICAL, order mutations = HIGH.

## Status
`Active` (Phase 5 Complete: DB + Utilities + APIs + Alerting + Dashboard)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Error capture, alerting, health monitoring, admin dashboard | Full |
| `gwi-android-register` | Error reporting via API | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Error event ingestion | Partial |
| `gwi-mission-control` | Fleet health monitoring | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/monitoring` (error dashboard) | Managers |
| POS Web | ErrorBoundary (automatic fallback on React crash) | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/monitoring/error/route.ts` | POST log error (rate-limited: 30/min) |
| `src/app/api/monitoring/errors/route.ts` | GET error list with filters/pagination |
| `src/app/api/monitoring/performance/route.ts` | POST log slow operations |
| `src/app/api/monitoring/health-check/route.ts` | GET/POST health check logging |
| `src/lib/error-capture.ts` | `errorCapture` singleton — `critical()`, `high()`, `medium()`, `low()` |
| `src/lib/alert-service.ts` | Alert dispatch (email + Slack + SMS) with throttling |
| `src/lib/health-monitor.ts` | Periodic health checks (60s interval) |
| `src/lib/error-boundary.tsx` | React `<ErrorBoundary>` and `<SilentErrorBoundary>` |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/monitoring/error` | Rate-limited (30/min) | Log error with full context |
| `GET` | `/api/monitoring/errors` | Manager | List errors with filters, pagination, search |
| `POST` | `/api/monitoring/performance` | Employee PIN | Log slow operation |
| `GET/POST` | `/api/monitoring/health-check` | Employee PIN | Health check status |

---

## Socket Events

None — error reporting is a leaf node with no socket dependencies.

---

## Data Model

```
ErrorLog {
  id              String
  locationId      String
  severity        Enum              // CRITICAL | HIGH | MEDIUM | LOW
  errorType       String            // PAYMENT | ORDER | API | FRONTEND | DATABASE | NETWORK | BUSINESS_LOGIC | PERFORMANCE
  category        String?           // "payment-timeout", "order-validation"
  message         String
  stackTrace      String?
  errorCode       String?           // "PAY_001", "ORD_403"
  path            String            // URL/API route
  action          String            // human-readable action
  component       String?           // React component
  employeeId      String?
  orderId         String?
  paymentId       String?
  customerId      String?
  userAgent       String?
  responseTime    Int?              // milliseconds
  status          Enum              // NEW | INVESTIGATING | RESOLVED | IGNORED
  groupId         String?           // for grouping similar errors
  occurrenceCount Int               // deduplication counter
  alertSent       Boolean
  alertSentAt     DateTime?
  resolvedAt      DateTime?
  resolution      String?
}

PerformanceLog {
  id              String
  locationId      String
  operation       String            // "API: GET /api/orders"
  duration        Int               // milliseconds
  threshold       Int               // expected max
  context         String?           // JSON
  path            String?
}

HealthCheck {
  id              String
  locationId      String
  checkType       String            // ORDER_CREATION | PAYMENT_PROCESSING | PRINTER_CONNECTION | DATABASE_QUERY | API_RESPONSE | KDS_CONNECTION | NETWORK_CONNECTIVITY
  status          Enum              // HEALTHY | DEGRADED | DOWN
  responseTime    Int?
  errorMessage    String?
}
```

---

## Business Logic

### Severity & Alert Rules
| Severity | Response | Alert Channels | Throttle |
|----------|----------|----------------|----------|
| CRITICAL | Immediate | SMS + Slack + Email | 5 min |
| HIGH | 5 minutes | Slack + Email | 15 min |
| MEDIUM | Hourly batch | Email only | 60 min |
| LOW | Dashboard only | None | N/A |

### Error Capture Flow
1. Error occurs (frontend/backend/payment)
2. Captured via ErrorBoundary (React), monitored fetch (API), or explicit `errorCapture.critical()`
3. `POST /api/monitoring/error` with full context
4. Stored in ErrorLog with auto-generated `groupId`
5. `occurrenceCount` incremented for duplicate groupId
6. Alert rules engine checks severity + throttle window
7. Dispatch to configured channels (fire-and-forget)

### Alert Throttling
- Checks if alert sent for `groupId` in last N minutes (per severity)
- Prevents alert spam for same recurring error
- Marks `alertSent: true` and `alertSentAt` in database

### Health Monitoring
- Periodic checks every 60 seconds (client-side)
- Check types: ORDER_CREATION, DATABASE_QUERY, NETWORK_CONNECTIVITY
- Status thresholds: HEALTHY (OK + fast), DEGRADED (OK + slow), DOWN (error)
- Critical systems going DOWN trigger alerts

### React Error Boundaries
- `<ErrorBoundary>` — full-screen fallback with glassmorphism UI, "Try Again" and "Reload" buttons
- `<SilentErrorBoundary>` — minimal fallback for non-critical sections
- Auto-logs to monitoring API on catch
- Wrapped at root layout for global coverage

### Error Type Categorization
| Type | Auto-Category Examples | Default Severity |
|------|----------------------|------------------|
| PAYMENT | payment-timeout, payment-declined, payment-network-error | CRITICAL |
| ORDER | order-timeout, order-validation, order-not-found | HIGH |
| DATABASE | db-timeout, db-connection, db-constraint | CRITICAL |
| API | api-500, api-timeout | HIGH |
| FRONTEND | React component errors | MEDIUM |
| NETWORK | connection-lost, timeout | HIGH |

### Edge Cases & Business Rules
- Rate limited: 30 requests/min per IP on error logging endpoint
- Sensitive data sanitized (password, pin, token, cardNumber stripped)
- Browser info auto-captured (userAgent, platform, screen resolution)
- `CRITICAL` errors also logged to console for local debugging
- Email templates color-coded by severity (red/orange/yellow/blue)
- Slack messages use emoji indicators per severity

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| None | Leaf node — observability layer only |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| All features | Every feature can emit errors |
| Payments | Payment failures = CRITICAL severity |
| Orders | Order mutations = HIGH severity |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Alert channels** — Resend (email), Twilio (SMS), Slack webhook configured
- [ ] **Rate limiting** — 30/min per IP on error endpoint
- [ ] **Throttling** — groupId-based throttle windows per severity

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View errors | Manager role | High |
| Resolve/Ignore errors | Manager role | High |

---

## Known Constraints & Limits
- Rate limit: 30 error logs per minute per IP
- Throttle windows: 5min (CRITICAL), 15min (HIGH), 60min (MEDIUM)
- Health check interval: 60 seconds
- Environment variables required: `RESEND_API_KEY`, `SLACK_WEBHOOK_URL`, `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`
- SMS only for CRITICAL (prevent SMS spam/cost)
- Pivot-ready: `errorCapture.log()` is single integration point for Sentry/Datadog

---

## Android-Specific Notes
- Errors reported via `POST /api/monitoring/error` from Android app
- Health check via native heartbeat endpoint

---

## Related Docs
- **Domain doc:** `docs/domains/ERROR-REPORTING-DOMAIN.md`
- **Error handling standards:** `docs/development/ERROR-HANDLING-STANDARDS.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Error Reporting row
- **Skills:** Skill 242 (Error Monitoring)
- **Changelog:** `docs/changelogs/ERROR-REPORTING-CHANGELOG.md`

---

*Last updated: 2026-03-03*
