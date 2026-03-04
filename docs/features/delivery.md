# Feature: Delivery Management

> **Status: PLANNED** — Specced in `docs/skills/SPEC-35-DELIVERY-TRACKING.md`. Do NOT implement without a planning session.

## Summary
In-house delivery fleet management. Assign orders to drivers, track GPS location in real time, optimize routes, define delivery zones, and share tracking links with customers.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-35)
- **Driver assignment** — assign delivery orders to available drivers
- **GPS real-time tracking** — see all drivers on a map
- **Route optimization** — batch deliveries by proximity
- **Delivery zones** — define serviceable areas with delivery fees
- **Customer tracking link** — SMS link so customer can track their order
- **Driver performance analytics** — on-time %, average delivery time
- **Batch delivery assignment** — assign multiple orders to one driver

## Dependencies (anticipated)
- **Orders** — delivery orders are standard orders with delivery metadata
- **Customers** — delivery address from customer profile
- **Settings** — delivery zone configuration, fees, hours
- **Employees** — drivers are employees
- **Reports** — delivery performance reports

## SPEC Document
`docs/skills/SPEC-35-DELIVERY-TRACKING.md`

*Last updated: 2026-03-03*
