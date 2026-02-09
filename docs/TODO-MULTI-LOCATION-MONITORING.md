# Multi-Location Monitoring - TODO List

**Priority:** P2 (Build after Admin Console and Deployment Infrastructure)
**Estimated Time:** 2-3 days
**Dependencies:** Error Reporting Domain (Phase 1-5 complete ✅)

---

## Overview

The error reporting system is **fully multi-tenant ready** at the database and API level. However, the UI and alert routing currently support only single-location monitoring. This document outlines the work needed to support 100+ locations across the organization.

**What's Already Multi-Tenant:**
- ✅ Database schema (locationId on all tables)
- ✅ API endpoints (filter by locationId)
- ✅ Error capture (auto-includes locationId)

**What Needs to Be Built:**
- ❌ Organization-level dashboard
- ❌ Location selector/filter in UI
- ❌ Per-location alert routing
- ❌ Cross-location health monitoring
- ❌ Role-based access control

---

## Phase 1: Database Schema Updates

### Add Location Alert Configuration

**File:** `prisma/schema.prisma`

```prisma
model Location {
  // ... existing fields ...

  // Alert Configuration (per location)
  alertEmail       String?   // Manager email for this location
  alertSlackUrl    String?   // Slack webhook for this location
  alertPhoneNumber String?   // On-call phone for this location
  alertSettings    Json?     // Custom alert rules per location

  // Monitoring Settings
  healthCheckInterval Int @default(60)  // Seconds between health checks
  alertThrottleMinutes Json?            // Override default throttle per severity
}
```

**Tasks:**
- [ ] Add alert fields to Location model
- [ ] Run migration: `npx prisma migrate dev --name add-location-alerts`
- [ ] Update seed data with sample alert configs
- [ ] Test migration on dev database

---

## Phase 2: Organization Dashboard

### 2.1 Organization Overview Page

**File:** `src/app/(admin)/monitoring/organization/page.tsx`

**Features:**
- [ ] Map view of all locations (color-coded by health)
- [ ] Total error count across all locations (24h)
- [ ] Critical errors by location (table view)
- [ ] Top 5 locations with most errors
- [ ] System health summary (how many locations DOWN/DEGRADED/HEALTHY)
- [ ] Auto-refresh every 30 seconds

**API Endpoint:**
- [ ] Create `GET /api/monitoring/organization/overview`
- [ ] Aggregate errors by location
- [ ] Aggregate health status by location
- [ ] Return location list with stats

**UI Components:**
- [ ] OrganizationMap component (shows pins for each location)
- [ ] LocationHealthCard component (green/yellow/red indicator)
- [ ] ErrorsByLocationChart component (bar chart)
- [ ] CriticalErrorsTable component (location, count, last error)

**Estimated Time:** 4-6 hours

---

### 2.2 Location Comparison View

**File:** `src/app/(admin)/monitoring/compare/page.tsx`

**Features:**
- [ ] Side-by-side location comparison table
- [ ] Columns: Location Name, 24h Errors, Critical Count, Health Status, Avg Response Time
- [ ] Sort by any column
- [ ] Filter by region/state
- [ ] Export to CSV

**API Endpoint:**
- [ ] Create `GET /api/monitoring/organization/compare`
- [ ] Return all locations with aggregated stats
- [ ] Support sorting and filtering

**Estimated Time:** 2-3 hours

---

## Phase 3: Location Selector & Filtering

### 3.1 Add Location Selector to Current Dashboard

**File:** `src/app/(admin)/monitoring/page.tsx`

**Changes:**
- [ ] Add location dropdown in header
- [ ] Store selected location in state
- [ ] Filter all queries by selected location
- [ ] Add "All Locations" option for org admins
- [ ] Persist selection in localStorage

**Example:**
```tsx
<select onChange={(e) => setSelectedLocation(e.target.value)}>
  <option value="all">All Locations</option>
  {locations.map(loc => (
    <option key={loc.id} value={loc.id}>{loc.name}</option>
  ))}
</select>
```

**Estimated Time:** 1-2 hours

---

### 3.2 Update Error List Page with Location Filter

**File:** `src/app/(admin)/monitoring/errors/page.tsx`

**Changes:**
- [ ] Add location filter dropdown
- [ ] Show location name in error table
- [ ] Filter errors by selected location
- [ ] Show location badge on each error row

**Estimated Time:** 1 hour

---

## Phase 4: Per-Location Alert Routing

### 4.1 Update Alert Service

**File:** `src/lib/alert-service.ts`

**Changes:**
- [ ] Query Location table for alert config
- [ ] Use location-specific email instead of global `EMAIL_TO`
- [ ] Use location-specific Slack webhook instead of global `SLACK_WEBHOOK_URL`
- [ ] Use location-specific phone number instead of global `TWILIO_TO_NUMBER`
- [ ] Fall back to global config if location config missing

**Example:**
```typescript
async function dispatchAlert(payload: AlertPayload) {
  // Get location alert config
  const location = await db.location.findUnique({
    where: { id: payload.locationId },
    select: {
      alertEmail: true,
      alertSlackUrl: true,
      alertPhoneNumber: true,
    }
  })

  // Use location config or fall back to global
  const emailTo = location?.alertEmail || process.env.EMAIL_TO
  const slackUrl = location?.alertSlackUrl || process.env.SLACK_WEBHOOK_URL
  const phoneNumber = location?.alertPhoneNumber || process.env.TWILIO_TO_NUMBER

  // Send alerts...
}
```

**Estimated Time:** 2-3 hours

---

### 4.2 Alert Configuration UI

**File:** `src/app/(admin)/settings/alerts/page.tsx`

**Features:**
- [ ] List all locations
- [ ] Configure email/Slack/SMS per location
- [ ] Test alert button (send test alert to verify config)
- [ ] Override throttle settings per location
- [ ] Save to Location.alertSettings JSON field

**API Endpoints:**
- [ ] `GET /api/settings/alerts?locationId=X` - Get alert config
- [ ] `PUT /api/settings/alerts` - Update alert config
- [ ] `POST /api/settings/alerts/test` - Send test alert

**Estimated Time:** 3-4 hours

---

## Phase 5: Cross-Location Health Monitoring

### 5.1 Background Monitoring Service

**File:** `src/lib/organization-health-monitor.ts`

**Features:**
- [ ] Monitor ALL active locations (not just one)
- [ ] Run health checks every 60 seconds per location
- [ ] Stagger checks to avoid overwhelming server (e.g., 5 locations per second)
- [ ] Store results in HealthCheck table with locationId
- [ ] Alert on location-wide outages

**Implementation:**
```typescript
export async function monitorAllLocations() {
  const locations = await db.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true, healthCheckInterval: true }
  })

  for (const location of locations) {
    // Check ORDER_CREATION
    await runHealthCheck('ORDER_CREATION', location.id, async () => {
      const result = await fetch(`/api/orders?locationId=${location.id}&test=true`)
      return result.ok
    })

    // Check DATABASE_QUERY
    await runHealthCheck('DATABASE_QUERY', location.id, async () => {
      const result = await db.employee.findFirst({ where: { locationId: location.id } })
      return !!result
    })

    // Stagger checks
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
```

**Start Service:**
- [ ] Add to server startup or cron job
- [ ] Run every 60 seconds: `setInterval(monitorAllLocations, 60000)`

**Estimated Time:** 2-3 hours

---

### 5.2 Organization Health Dashboard

**File:** `src/app/(admin)/monitoring/health/page.tsx`

**Features:**
- [ ] Show health status for ALL locations
- [ ] Color-coded indicators (green/yellow/red)
- [ ] Click location to see detailed health history
- [ ] Response time trends per location
- [ ] Alert if multiple locations are DOWN

**Estimated Time:** 2-3 hours

---

## Phase 6: Role-Based Access Control

### 6.1 Permission System

**Files:** `src/lib/permissions.ts`, `src/app/api/monitoring/*/route.ts`

**Roles:**
- **Organization Admin** - Can view ALL locations
- **Regional Manager** - Can view multiple assigned locations
- **Location Manager** - Can view ONLY their location

**Implementation:**
- [ ] Add `isOrganizationAdmin` flag to Employee or Role model
- [ ] Add `managedLocationIds` array to Employee (for regional managers)
- [ ] Check permissions in all monitoring API endpoints
- [ ] Filter dashboard data by allowed locations

**Example:**
```typescript
// Middleware
export function getAccessibleLocations(employeeId: string): string[] {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { role: true }
  })

  if (employee.role.isOrganizationAdmin) {
    // Org admin sees all
    return await db.location.findMany().map(l => l.id)
  } else if (employee.managedLocationIds) {
    // Regional manager sees assigned locations
    return employee.managedLocationIds
  } else {
    // Location manager sees only their location
    return [employee.locationId]
  }
}
```

**Update API Endpoints:**
- [ ] `GET /api/monitoring/errors` - Filter by accessible locations
- [ ] `GET /api/monitoring/health-check` - Filter by accessible locations
- [ ] `GET /api/monitoring/organization/*` - Require org admin

**Estimated Time:** 3-4 hours

---

## Phase 7: Enhanced Features (Optional)

### 7.1 Location Groups / Regions

**Schema Update:**
```prisma
model LocationGroup {
  id        String   @id @default(cuid())
  orgId     String
  name      String   // "Northeast", "West Coast", "Midwest"
  locations Location[]
}

model Location {
  // ...
  groupId   String?
  group     LocationGroup? @relation(...)
}
```

**Features:**
- [ ] Group locations by region
- [ ] Filter dashboard by region
- [ ] Compare regions side-by-side

**Estimated Time:** 2-3 hours

---

### 7.2 Error Rate Alerts

**Features:**
- [ ] Alert when error rate exceeds threshold (e.g., >50 errors/hour)
- [ ] Alert when critical error rate increases (e.g., 5+ in 10 minutes)
- [ ] Alert when location goes from HEALTHY → DEGRADED → DOWN

**Implementation:**
- [ ] Add threshold config to Location.alertSettings
- [ ] Check error rate in alert service
- [ ] Send "High Error Rate" alert

**Estimated Time:** 2-3 hours

---

### 7.3 Scheduled Reports

**Features:**
- [ ] Daily email report with error summary (all locations or per location)
- [ ] Weekly performance report
- [ ] Monthly uptime report

**Implementation:**
- [ ] Create cron job to generate reports
- [ ] Email report using email-service.ts
- [ ] Store report history

**Estimated Time:** 3-4 hours

---

## Phase 8: Performance Optimization

### 8.1 Database Indexing

**Ensure these indexes exist:**
- [ ] `ErrorLog(locationId, createdAt)` - For location-filtered queries
- [ ] `ErrorLog(locationId, severity, status)` - For filtered dashboard
- [ ] `HealthCheck(locationId, checkType, createdAt)` - For health history

### 8.2 Caching

**Add Redis caching for:**
- [ ] Location list (rarely changes)
- [ ] Organization stats (cache for 30 seconds)
- [ ] Health status (cache for 10 seconds)

**Estimated Time:** 2-3 hours

---

## Summary Checklist

**Phase 1: Database** (1-2 hours)
- [ ] Add alert fields to Location model
- [ ] Run migration
- [ ] Update seed data

**Phase 2: Organization Dashboard** (6-9 hours)
- [ ] Organization overview page
- [ ] Location comparison view
- [ ] API endpoints for aggregation

**Phase 3: Location Selector** (2-3 hours)
- [ ] Add dropdown to dashboard
- [ ] Update error list with location filter

**Phase 4: Per-Location Alerts** (5-7 hours)
- [ ] Update alert service to use location config
- [ ] Build alert configuration UI
- [ ] Test alert functionality

**Phase 5: Cross-Location Health** (4-6 hours)
- [ ] Background monitoring service
- [ ] Organization health dashboard

**Phase 6: Role-Based Access** (3-4 hours)
- [ ] Permission system
- [ ] Update API endpoints
- [ ] UI permission checks

**Phase 7: Enhanced Features** (4-6 hours, optional)
- [ ] Location groups/regions
- [ ] Error rate alerts
- [ ] Scheduled reports

**Phase 8: Performance** (2-3 hours)
- [ ] Database indexing
- [ ] Redis caching

---

## Total Estimated Time

**Core Features (Phases 1-6):** ~20-30 hours
**Optional Features (Phases 7-8):** ~6-9 hours
**Total:** ~26-39 hours (3-5 days)

---

## Testing Checklist

Before deploying multi-location monitoring:

- [ ] Test with 2-3 locations first
- [ ] Verify location-specific alerts work
- [ ] Verify organization dashboard loads quickly
- [ ] Test permission system (org admin vs location manager)
- [ ] Load test with 100+ locations
- [ ] Verify health monitoring doesn't overwhelm server
- [ ] Test alert throttling across multiple locations
- [ ] Verify dashboard auto-refresh works
- [ ] Test location selector in all pages

---

## Notes

- **Data is already multi-tenant** - All error logs include locationId
- **No data migration needed** - Existing errors already have locationId
- **Backwards compatible** - Works for single location until multi-location features enabled
- **Gradual rollout** - Can enable one feature at a time

---

**Status:** 📋 TODO - Build after Admin Console and Deployment Infrastructure
**Last Updated:** 2026-02-07
