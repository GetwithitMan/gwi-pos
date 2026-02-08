---
skill: 242
title: Error Monitoring & Reporting
status: DONE
depends_on: []
---

# Skill 242: Error Monitoring & Reporting

> **Status:** DONE
> **Domain:** Error Reporting
> **Dependencies:** None
> **Last Updated:** 2026-02-08

## Overview

Centralized error capture, performance monitoring, and health check system. Captures errors with business context (who, what, where, impact), stores in database, and provides a monitoring dashboard.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/error-capture.ts` | Centralized error capture utility |
| `src/lib/error-boundary.tsx` | React Error Boundary component |
| `src/lib/health-monitor.ts` | Health check monitoring |
| `src/lib/alert-service.ts` | Alerting (Email, SMS, Slack) |
| `src/app/(admin)/monitoring/page.tsx` | Monitoring dashboard |
| `src/app/(admin)/monitoring/errors/` | Error detail views |
| `src/app/api/monitoring/error/` | Error logging API |
| `src/app/api/monitoring/performance/` | Performance logging API |
| `src/app/api/monitoring/health-check/` | Health check API |

## Schema Models

- `ErrorLog` -- Error records with severity, context, grouping
- `PerformanceLog` -- Slow query and API timeout tracking
- `HealthCheck` -- Critical system status checks

## Connected Parts

- **All API routes**: Error capture wraps critical paths
- **Payment processing**: Priority monitoring for revenue-critical errors
- **Orders**: Order flow errors tracked with business impact context
